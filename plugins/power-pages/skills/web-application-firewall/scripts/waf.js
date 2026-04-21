#!/usr/bin/env node

// waf.js — Power Pages Web Application Firewall commands.
//
// Six modes:
//   --status                          Read current WAF status
//   --rules [--ruleType X]            Read current rule configuration
//   --enable                          Enable WAF (async)
//   --disable                         Disable WAF (async)
//   --create-rules --body <file>      Create/update rules (sync)
//   --delete-custom --names <file>    Delete custom rules by name (async)
//
// All write modes support --dry-run (validates locally without calling
// the service). Async modes (enable / disable / delete-custom) return
// { "accepted": true, "operation_location": "...", "retry_after_seconds": N }
// on acceptance; callers poll the paired read command for completion.
//
// CLI usage:
//   node waf.js --<mode> --portalId <guid> [mode flags] [--dry-run]
//   node waf.js --help

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { callAdminApi } = require('../../../scripts/lib/admin-api');

// Exit codes — documented in --help and in the skill's references/commands.md.
const EXIT = Object.freeze({
  OK: 0,
  UNKNOWN: 1,            // transport / unknown failure after retries (incl. 401/403)
  INVALID_ARGS: 2,       // bad or missing CLI flags / body
  NOT_FOUND: 3,          // A001
  NO_INFRASTRUCTURE: 4,  // B001
  IN_PROGRESS: 5,        // B003
  REGION_BLOCKED: 6,     // B022
  TRIAL_BLOCKED: 7,      // B023
});

const CATALOGUED_EXIT = Object.freeze({
  A001: EXIT.NOT_FOUND,
  B001: EXIT.NO_INFRASTRUCTURE,
  B003: EXIT.IN_PROGRESS,
  B022: EXIT.REGION_BLOCKED,
  B023: EXIT.TRIAL_BLOCKED,
});

const VALID_RULE_TYPES = new Set(['Custom', 'Managed']);
const VALID_CUSTOM_RULE_TYPES = new Set(['MatchRule', 'RateLimitRule']);
const VALID_CUSTOM_RULE_ACTIONS = new Set(['Allow', 'Block', 'Log', 'Redirect']);
const RATE_LIMIT_WINDOW_MIN_MINUTES = 1;
const RATE_LIMIT_WINDOW_MAX_MINUTES = 5;

// Codes that represent "WAF is not applicable to this site" — trial portal
// or region without the feature. The read commands normalize these to null
// instead of throwing.
const WAF_UNAVAILABLE_CODES = new Set(['B022', 'B023']);

// Default polling interval when the service does not include Retry-After.
const DEFAULT_RETRY_AFTER_SECONDS = 60;

const HELP = `Usage:
  waf.js --<mode> --portalId <guid> [mode flags] [--dry-run]
  waf.js --help

Modes:
  --status                                 Read current WAF status.
  --rules [--ruleType <Custom|Managed>]    Read current rule configuration.
  --enable                                 Enable WAF on this site (async).
  --disable                                Disable WAF on this site (async).
  --create-rules --body <file>             Create or update rule collection.
  --delete-custom --names <file>           Remove named custom rules (async).

Common flags:
  --portalId <guid>                        Power Pages portal id (REQUIRED).
                                           Resolve via scripts/lib/website.js
                                           first — NOT the website record id.
  --dry-run                                For writes: validate locally and
                                           print the intended call; skip the
                                           network request.
  -h, --help                               Show this help.

Output:
  stdout  JSON result on success. Async operations return
          { "accepted": true, "operation_location": "...",
            "retry_after_seconds": N }. Already-in-progress cases return
          { "accepted": false, "alreadyOngoing": true }.
  stderr  Diagnostics, transient-retry notices, and catalogued service
          error codes (A001 / B001 / B003 / B022 / B023) when applicable.

Exit codes:
  0  Success.
  1  Unknown or transport failure (includes HTTP 401/403 for non-admin).
  2  Invalid or missing CLI arguments, or invalid body file.
  3  Portal not found (A001).
  4  Edge infrastructure missing for this site (B001).
  5  Another WAF operation is in progress (B003).
  6  WAF not available in this region (B022).
  7  Trial portal — WAF requires a production site (B023).
`;

/**
 * Extract a catalogued service error code from a parsed response body.
 * The service uses a JSON envelope for most errors but returns plain-text
 * bodies for the region-unsupported / trial-unsupported 400 paths on
 * GetWAFStatus. Handle both shapes.
 */
function extractErrorCode(body) {
  if (body && typeof body === 'object') {
    return (
      body.errorCode ||
      body.code ||
      (body.error && (body.error.code || body.error.errorCode)) ||
      null
    );
  }
  if (typeof body === 'string') {
    const lower = body.toLowerCase();
    if (lower.includes('not supported for trial')) return 'B023';
    if (lower.includes('not available')) return 'B022';
  }
  return null;
}

function isWafUnavailable(res) {
  if (res.statusCode !== 400) return false;
  const code = extractErrorCode(res.body);
  return code != null && WAF_UNAVAILABLE_CODES.has(code);
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

/**
 * Extract async-handoff info from a 202 response. admin-api.js does not
 * currently expose response headers, so when not present we fall back to
 * DEFAULT_RETRY_AFTER_SECONDS — still useful to the caller even without
 * the operation-location URL.
 */
function extractAsyncHandoff(res) {
  const headers = res.headers || {};
  const opLocation = headers['operation-location'] || headers['Operation-Location'] || null;
  const retryAfterRaw = headers['retry-after'] || headers['Retry-After'];
  const retryAfter = Number(retryAfterRaw);
  return {
    operation_location: opLocation,
    retry_after_seconds: Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : DEFAULT_RETRY_AFTER_SECONDS,
  };
}

// ===== Public API functions =====

/**
 * Read current WAF status. Returns null when WAF is not applicable to the
 * site (trial portal or region-blocked).
 */
async function getWafStatus({ portalId, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'GET',
    operation: 'getWafStatus',
    portalId,
    environmentId,
    cloud,
    deps,
  });
  if (isWafUnavailable(res)) return null;
  throwWithCode('getWafStatus', res);
  return res.body;
}

/**
 * Read current rule configuration. Optional ruleType filter narrows to
 * Custom or Managed. Returns null when WAF is not applicable.
 */
async function getWafRules({ portalId, ruleType, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  if (ruleType !== undefined && !VALID_RULE_TYPES.has(ruleType)) {
    throw invalidArgs(
      `--ruleType must be one of ${[...VALID_RULE_TYPES].join(', ')} (got: ${ruleType})`,
    );
  }
  const res = await callAdminApi({
    method: 'GET',
    operation: 'getWafRules',
    portalId,
    environmentId,
    cloud,
    extraQuery: ruleType ? { ruleType } : undefined,
    deps,
  });
  if (isWafUnavailable(res)) return null;
  throwWithCode('getWafRules', res);
  return res.body;
}

async function enableWaf(options) {
  return toggleWaf('enableWaf', options);
}

async function disableWaf(options) {
  return toggleWaf('disableWaf', options);
}

async function toggleWaf(operation, { portalId, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const res = await callAdminApi({
    method: 'POST',
    operation,
    portalId,
    environmentId,
    cloud,
    deps,
  });
  if (res.statusCode === 409) {
    return { accepted: false, alreadyOngoing: true };
  }
  if (res.statusCode === 202) {
    return { accepted: true, ...extractAsyncHandoff(res) };
  }
  throwWithCode(operation, res);
  // Non-standard success (e.g. 200 with empty body) — treat as accepted.
  return { accepted: true };
}

async function createWafRules({ portalId, body, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const validationError = validateCreateRulesBody(body);
  if (validationError) {
    throw invalidArgs(`Body validation failed: ${validationError}`);
  }
  const res = await callAdminApi({
    method: 'PUT',
    operation: 'createWafRules',
    portalId,
    environmentId,
    cloud,
    body,
    deps,
  });
  throwWithCode('createWafRules', res);
  return res.body;
}

async function deleteWafCustomRules({ portalId, ruleNames, environmentId, cloud, deps } = {}) {
  requirePortalId(portalId);
  const validationError = validateNamesList(ruleNames);
  if (validationError) {
    throw invalidArgs(validationError);
  }
  const res = await callAdminApi({
    method: 'PUT',
    operation: 'deleteWafCustomRules',
    portalId,
    environmentId,
    cloud,
    body: ruleNames,
    deps,
  });
  if (res.statusCode === 202) {
    return { accepted: true, ...extractAsyncHandoff(res) };
  }
  throwWithCode('deleteWafCustomRules', res);
  return { accepted: true };
}

// ===== Local validation helpers =====

/**
 * Validate the body passed to --create-rules. Returns an error message
 * string on failure, or null on success.
 *
 * Checks structure, enum values, and the local-only invariants that the
 * service would also reject (unique names, unique priorities, rate-limit
 * window range). Intentionally does NOT enforce the narrower Power Pages
 * surface (e.g. only Allow/Block actions) — surface-level constraints
 * live in the docs; the script mirrors the API's accepted schema so a
 * caller with legitimate need can still submit Log / Redirect actions.
 */
function validateCreateRulesBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Body must be a JSON object with CustomRules and/or ManagedRules arrays';
  }
  const customRules = body.CustomRules;
  const managedRules = body.ManagedRules;
  const hasCustom = Array.isArray(customRules) && customRules.length > 0;
  const hasManaged = Array.isArray(managedRules) && managedRules.length > 0;
  if (!hasCustom && !hasManaged) {
    return 'Body must contain at least one of CustomRules or ManagedRules (non-empty array)';
  }

  if (customRules !== undefined && !Array.isArray(customRules)) {
    return 'CustomRules must be an array';
  }
  if (managedRules !== undefined && !Array.isArray(managedRules)) {
    return 'ManagedRules must be an array';
  }

  const seenNames = new Set();
  const seenPriorities = new Map();
  for (const rule of customRules || []) {
    if (!rule || typeof rule !== 'object') {
      return 'Every custom rule must be an object';
    }
    if (typeof rule.name !== 'string' || rule.name.length === 0) {
      return 'Every custom rule must have a non-empty name';
    }
    if (seenNames.has(rule.name)) {
      return `Duplicate custom rule name: ${rule.name}`;
    }
    seenNames.add(rule.name);
    if (!Number.isInteger(rule.priority)) {
      return `Custom rule "${rule.name}": priority is required and must be an integer`;
    }
    if (seenPriorities.has(rule.priority)) {
      return `Duplicate priority ${rule.priority} between "${seenPriorities.get(rule.priority)}" and "${rule.name}"`;
    }
    seenPriorities.set(rule.priority, rule.name);
    if (!VALID_CUSTOM_RULE_TYPES.has(rule.ruleType)) {
      return `Custom rule "${rule.name}": ruleType must be one of ${[...VALID_CUSTOM_RULE_TYPES].join(', ')}`;
    }
    if (!VALID_CUSTOM_RULE_ACTIONS.has(rule.action)) {
      return `Custom rule "${rule.name}": action must be one of ${[...VALID_CUSTOM_RULE_ACTIONS].join(', ')}`;
    }
    if (rule.ruleType === 'MatchRule') {
      if (!Array.isArray(rule.matchConditions) || rule.matchConditions.length === 0) {
        return `Custom rule "${rule.name}": MatchRule requires at least one matchCondition`;
      }
    }
    if (rule.ruleType === 'RateLimitRule') {
      if (!Number.isInteger(rule.rateLimitThreshold) || rule.rateLimitThreshold < 1) {
        return `Custom rule "${rule.name}": RateLimitRule requires rateLimitThreshold as a positive integer`;
      }
      const window = rule.rateLimitDurationInMinutes;
      if (!Number.isInteger(window) || window < RATE_LIMIT_WINDOW_MIN_MINUTES || window > RATE_LIMIT_WINDOW_MAX_MINUTES) {
        return `Custom rule "${rule.name}": rateLimitDurationInMinutes must be ${RATE_LIMIT_WINDOW_MIN_MINUTES}-${RATE_LIMIT_WINDOW_MAX_MINUTES} (got ${window})`;
      }
    }
  }

  for (const managed of managedRules || []) {
    if (!managed || typeof managed !== 'object') {
      return 'Every managed rule must be an object';
    }
    if (typeof managed.RuleSetType !== 'string' || managed.RuleSetType.length === 0) {
      return 'Every managed rule requires RuleSetType';
    }
    if (typeof managed.RuleSetVersion !== 'string' || managed.RuleSetVersion.length === 0) {
      return 'Every managed rule requires RuleSetVersion';
    }
    if (typeof managed.RuleSetAction !== 'string' || managed.RuleSetAction.length === 0) {
      return 'Every managed rule requires RuleSetAction';
    }
  }

  return null;
}

/**
 * Validate the array passed to --delete-custom. Returns an error message
 * string on failure, or null on success.
 */
function validateNamesList(ruleNames) {
  if (!Array.isArray(ruleNames) || ruleNames.length === 0) {
    return '--names must be a non-empty JSON array of rule names';
  }
  for (const name of ruleNames) {
    if (typeof name !== 'string' || name.length === 0) {
      return `Each rule name must be a non-empty string (got: ${JSON.stringify(name)})`;
    }
  }
  return null;
}

function readJsonFile(path) {
  if (!fs.existsSync(path)) {
    throw invalidArgs(`File not found: ${path}`);
  }
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (e) {
    throw invalidArgs(`Could not read ${path}: ${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw invalidArgs(`Invalid JSON in ${path}: ${e.message}`);
  }
}

// ===== CLI wiring =====

function parseCli(argv) {
  const options = {
    status: { type: 'boolean' },
    rules: { type: 'boolean' },
    enable: { type: 'boolean' },
    disable: { type: 'boolean' },
    'create-rules': { type: 'boolean' },
    'delete-custom': { type: 'boolean' },
    portalId: { type: 'string' },
    ruleType: { type: 'string' },
    body: { type: 'string' },
    names: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  };
  return parseArgs({ args: argv.slice(2), options, strict: true }).values;
}

function pickMode(args) {
  const modes = [
    args.status && 'status',
    args.rules && 'rules',
    args.enable && 'enable',
    args.disable && 'disable',
    args['create-rules'] && 'create-rules',
    args['delete-custom'] && 'delete-custom',
  ].filter(Boolean);
  if (modes.length === 0) return null;
  if (modes.length > 1) return { error: `Multiple mode flags set: ${modes.join(', ')} — pick exactly one` };
  return { mode: modes[0] };
}

async function runMode(mode, args) {
  switch (mode) {
    case 'status':
      return getWafStatus({ portalId: args.portalId });

    case 'rules':
      return getWafRules({ portalId: args.portalId, ruleType: args.ruleType });

    case 'enable':
      if (args['dry-run']) {
        requirePortalId(args.portalId);
        return { dryRun: true, operation: 'enableWaf', portalId: args.portalId };
      }
      return enableWaf({ portalId: args.portalId });

    case 'disable':
      if (args['dry-run']) {
        requirePortalId(args.portalId);
        return { dryRun: true, operation: 'disableWaf', portalId: args.portalId };
      }
      return disableWaf({ portalId: args.portalId });

    case 'create-rules': {
      if (!args.body) throw invalidArgs('--create-rules requires --body <file>');
      const body = readJsonFile(args.body);
      const validationError = validateCreateRulesBody(body);
      if (validationError) throw invalidArgs(`Body validation failed: ${validationError}`);
      if (args['dry-run']) {
        requirePortalId(args.portalId);
        return { dryRun: true, operation: 'createWafRules', portalId: args.portalId, body };
      }
      return createWafRules({ portalId: args.portalId, body });
    }

    case 'delete-custom': {
      if (!args.names) throw invalidArgs('--delete-custom requires --names <file>');
      const ruleNames = readJsonFile(args.names);
      const validationError = validateNamesList(ruleNames);
      if (validationError) throw invalidArgs(validationError);
      if (args['dry-run']) {
        requirePortalId(args.portalId);
        return { dryRun: true, operation: 'deleteWafCustomRules', portalId: args.portalId, ruleNames };
      }
      return deleteWafCustomRules({ portalId: args.portalId, ruleNames });
    }

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
      `Missing mode flag — pick one of --status, --rules, --enable, --disable, --create-rules, --delete-custom.\n\n${HELP}`,
    );
    return;
  }
  if (pick.error) {
    exitWithMessage(EXIT.INVALID_ARGS, `${pick.error}\n\n${HELP}`);
    return;
  }

  try {
    const result = await runMode(pick.mode, args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const exitCode = err.code === 'INVALID_ARGS'
      ? EXIT.INVALID_ARGS
      : CATALOGUED_EXIT[err.code] ?? EXIT.UNKNOWN;
    exitWithMessage(exitCode, err.stack || err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getWafStatus,
  getWafRules,
  enableWaf,
  disableWaf,
  createWafRules,
  deleteWafCustomRules,
  extractErrorCode,
  isWafUnavailable,
  validateCreateRulesBody,
  validateNamesList,
  VALID_RULE_TYPES,
  EXIT,
};
