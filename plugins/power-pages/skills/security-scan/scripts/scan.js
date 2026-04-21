#!/usr/bin/env node

// scan.js — Power Pages security scan commands.
//
// Five modes:
//   --quick [--lcid N]                Quick synchronous diagnostic scan
//   --deep                            Start async OWASP deep scan (anonymous)
//   --ongoing                         Is a deep scan currently running?
//   --report                          Fetch latest completed deep-scan report
//   --score                           Fetch latest deep-scan score (totalRules / succeededRules)
//
// Scope note: the underlying service supports authenticated-page scans (where
// the scanner signs in as a user to test auth-gated pages), but this script
// does NOT accept credentials as CLI arguments. Passing secrets via argv leaks
// them to shell history, process lists, and any tool that captures argv.
// Authenticated-page coverage is available through the Power Pages Studio
// interface, which collects credentials via a UI form.
//
// Notable shape differences vs waf.js:
//   - Deep-start 202 has no Operation-Location / Retry-After headers; response
//     is a plain { "accepted": true } signal. Callers poll --ongoing to observe
//     completion (the scan runs for a substantial period server-side).
//   - Z003 (scan already ongoing) surfaces as 204 No Content on start, report,
//     and score. Distinct exit code 4 so skills can branch.
//   - No A037 / A039 / D005 / B-series codes; scan operations don't use those.
//     Trial / developer / non-production state refusals come through as A010.
//
// CLI usage:
//   node scan.js --<mode> --portalId <guid> [mode flags] [--dry-run]
//   node scan.js --help

const { parseArgs } = require('node:util');
const { callAdminApi } = require('../../../scripts/lib/admin-api');

// Exit codes — documented in --help and in the skill's references/commands.md.
const EXIT = Object.freeze({
  OK: 0,
  UNKNOWN: 1,         // transport / unknown failure after retries; also A009
  INVALID_ARGS: 2,    // bad or missing CLI flags
  NOT_FOUND: 3,       // A001
  ALREADY_ONGOING: 4, // Z003 — applies to start, report, score
  INVALID_STATE: 5,   // A010 — bad input, or site state refusal (trial / dev / non-prod)
});

const CATALOGUED_EXIT = Object.freeze({
  A001: EXIT.NOT_FOUND,
  Z003: EXIT.ALREADY_ONGOING,
  A010: EXIT.INVALID_STATE,
});

const HELP = `Usage:
  scan.js --<mode> --portalId <guid> [mode flags] [--dry-run]
  scan.js --help

Modes:
  --quick [--lcid <int>]                   Synchronous diagnostic scan.
                                           Returns an array of pass/warn/error
                                           items immediately.
  --deep                                   Start async OWASP-based deep scan
                                           against the site's public surface
                                           (anonymous). 202 accept is immediate;
                                           scan runs server-side for an
                                           extended period. Authenticated-page
                                           coverage is NOT available here; use
                                           the Power Pages Studio interface.
  --ongoing                                Boolean: is a deep scan running?
  --report                                 Fetch latest completed deep-scan
                                           report as structured JSON.
  --score                                  Fetch latest deep-scan score as
                                           { totalRules, succeededRules }.

Common flags:
  --portalId <guid>                        Power Pages portal id (REQUIRED).
                                           Resolve via scripts/lib/website.js
                                           first — NOT the website record id.
  --dry-run                                For writes (--deep): validate
                                           locally, skip the network request.
  -h, --help                               Show this help.

Output:
  stdout  JSON result on success. --deep returns { "accepted": true } on
          acceptance or { "accepted": false, "alreadyOngoing": true } if a
          scan is already running. No operation_location is emitted — the
          service does not provide one for deep scans; poll --ongoing.
  stderr  Diagnostics, transient-retry notices, and catalogued service
          error codes (A001 / A010 / Z003) when applicable.

Exit codes:
  0  Success.
  1  Unknown / transport failure (includes rate-limit exhaustion and HTTP
     401/403 for callers lacking the required role).
  2  Invalid or missing CLI arguments.
  3  Portal not found (A001).
  4  A scan is already ongoing on this site (Z003). Poll --ongoing and retry.
  5  Invalid input or site state (A010). Includes bad arguments AND trial /
     developer / non-production sites that cannot be scanned.
`;

function extractErrorCode(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  return (
    body.errorCode ||
    body.code ||
    (body.error && (body.error.code || body.error.errorCode)) ||
    null
  );
}

// Z003 surfaces as 204 No Content on start / report / score paths.
function isAlreadyOngoing(res) {
  return res.statusCode === 204;
}

function exitWithMessage(exitCode, message) {
  process.stderr.write(message.endsWith('\n') ? message : message + '\n');
  process.exit(exitCode);
}

function invalidArgs(message) {
  const err = new Error(message);
  err.code = 'INVALID_ARGS';
  return err;
}

function requirePortalId(portalId) {
  if (!portalId || typeof portalId !== 'string') {
    throw invalidArgs('--portalId is required');
  }
}

function throwWithCode(operation, res) {
  if (res.error) {
    const err = new Error(`${operation} failed: ${res.error}`);
    err.code = 'TRANSPORT';
    throw err;
  }
  if (res.statusCode >= 400) {
    const cataloguedCode = extractErrorCode(res.body);
    const suffix = cataloguedCode ? ` (${cataloguedCode})` : '';
    const err = new Error(`${operation} failed: HTTP ${res.statusCode}${suffix}`);
    err.statusCode = res.statusCode;
    err.code = cataloguedCode || 'HTTP_ERROR';
    throw err;
  }
}

// ===== Public API functions =====

/**
 * Quick synchronous diagnostic scan. Returns an array of diagnostic items.
 * LCID, when supplied, controls the language of the diagnostic messages.
 * Omit to use the service's default.
 */
async function runQuickScan({ portalId, lcid, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'POST',
    operation: 'scan/quick/execute',
    portalId,
    environmentId,
    cloud,
    extraQuery: lcid ? { lcid: String(lcid) } : undefined,
    deps,
  });
  throwWithCode('runQuickScan', res);
  return res.body;
}

/**
 * Start an async deep scan against the site's public surface (anonymous).
 * Server accepts with 202 and runs for an extended period server-side.
 * Returns { accepted: true } on acceptance, or
 * { accepted: false, alreadyOngoing: true } when a scan is already running
 * (Z003 surfaces as HTTP 204).
 *
 * This function does not accept credentials — authenticated-page scanning
 * is intentionally out of scope here; use the Power Pages Studio interface
 * for that, where credentials are collected via a UI form rather than an
 * argv value that leaks to shell history / process lists.
 */
async function startDeepScan({ portalId, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'POST',
    operation: 'scan/deep/start',
    portalId,
    environmentId,
    cloud,
    deps,
  });
  if (isAlreadyOngoing(res)) {
    return { accepted: false, alreadyOngoing: true };
  }
  throwWithCode('startDeepScan', res);
  return { accepted: true };
}

/**
 * Is a deep scan currently running? Returns boolean.
 */
async function isDeepScanOngoing({ portalId, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'GET',
    operation: 'scan/deep/isongoing',
    portalId,
    environmentId,
    cloud,
    deps,
  });
  throwWithCode('isDeepScanOngoing', res);
  const body = res.body;
  if (body && typeof body === 'object') {
    return body.status === true || body.status === 'true';
  }
  return Boolean(body);
}

/**
 * Fetch the latest completed deep-scan report. Throws with code Z003 if a
 * scan is in progress (HTTP 204); throws with TRANSPORT / HTTP_ERROR if no
 * deep scan has ever completed on this site.
 */
async function getLatestDeepScanReport({ portalId, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'GET',
    operation: 'scan/deep/getLatestCompletedReport',
    portalId,
    environmentId,
    cloud,
    deps,
  });
  if (isAlreadyOngoing(res)) {
    const err = new Error(
      'getLatestDeepScanReport failed: a scan is currently running (Z003). Wait for it to complete.',
    );
    err.code = 'Z003';
    throw err;
  }
  throwWithCode('getLatestDeepScanReport', res);
  return res.body;
}

/**
 * Fetch the security score. Same refusal pattern as getLatestDeepScanReport.
 */
async function getSecurityScore({ portalId, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'GET',
    operation: 'scan/deep/getSecurityScore',
    portalId,
    environmentId,
    cloud,
    deps,
  });
  if (isAlreadyOngoing(res)) {
    const err = new Error(
      'getSecurityScore failed: a scan is currently running (Z003). Wait for it to complete.',
    );
    err.code = 'Z003';
    throw err;
  }
  throwWithCode('getSecurityScore', res);
  return res.body;
}

// ===== CLI wiring =====

function parseCli(argv) {
  const options = {
    quick: { type: 'boolean' },
    deep: { type: 'boolean' },
    ongoing: { type: 'boolean' },
    report: { type: 'boolean' },
    score: { type: 'boolean' },
    portalId: { type: 'string' },
    lcid: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  };
  return parseArgs({ args: argv.slice(2), options, strict: true }).values;
}

function pickMode(args) {
  const modes = [
    args.quick && 'quick',
    args.deep && 'deep',
    args.ongoing && 'ongoing',
    args.report && 'report',
    args.score && 'score',
  ].filter(Boolean);
  if (modes.length === 0) return null;
  if (modes.length > 1) {
    return { error: `Multiple mode flags set: ${modes.join(', ')} — pick exactly one` };
  }
  return { mode: modes[0] };
}

function parseLcid(raw) {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidArgs(`--lcid must be a positive integer (got: ${raw})`);
  }
  return parsed;
}

async function runMode(mode, args) {
  switch (mode) {
    case 'quick': {
      const lcid = parseLcid(args.lcid);
      return runQuickScan({ portalId: args.portalId, lcid });
    }

    case 'deep': {
      if (args['dry-run']) {
        requirePortalId(args.portalId);
        return { dryRun: true, operation: 'startDeepScan', portalId: args.portalId };
      }
      return startDeepScan({ portalId: args.portalId });
    }

    case 'ongoing':
      return isDeepScanOngoing({ portalId: args.portalId });

    case 'report':
      return getLatestDeepScanReport({ portalId: args.portalId });

    case 'score':
      return getSecurityScore({ portalId: args.portalId });

    default:
      throw new Error(`Unreachable: unknown mode "${mode}"`);
  }
}

async function main() {
  let args;
  try {
    args = parseCli(process.argv);
  } catch (err) {
    exitWithMessage(EXIT.INVALID_ARGS, `Argument error: ${err.message}\n\n${HELP}`);
    return;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const pick = pickMode(args);
  if (pick === null) {
    exitWithMessage(
      EXIT.INVALID_ARGS,
      `Missing mode flag — pick one of --quick, --deep, --ongoing, --report, --score.\n\n${HELP}`,
    );
    return;
  }
  if (pick.error) {
    exitWithMessage(EXIT.INVALID_ARGS, `${pick.error}\n\n${HELP}`);
    return;
  }

  try {
    const result = await runMode(pick.mode, args);
    // --ongoing returns a boolean; serialize directly so stdout is valid JSON.
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const exitCode =
      err.code === 'INVALID_ARGS'
        ? EXIT.INVALID_ARGS
        : CATALOGUED_EXIT[err.code] ?? EXIT.UNKNOWN;
    exitWithMessage(exitCode, err.stack || err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runQuickScan,
  startDeepScan,
  isDeepScanOngoing,
  getLatestDeepScanReport,
  getSecurityScore,
  extractErrorCode,
  isAlreadyOngoing,
  EXIT,
};
