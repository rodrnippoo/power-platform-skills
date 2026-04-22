#!/usr/bin/env node

// render-report.js — render the unified security-review HTML report from
// a findings JSON file + the bundled template.
//
// The findings JSON schema is documented in the skill's
// references/orchestration.md ("Findings JSON schema" section). The
// template lives at ../assets/report-template.html; this script replaces
// `__PLACEHOLDER__` tokens in the template with values derived from the
// findings, and writes the result to --output.
//
// This script performs mechanical template substitution only — it does
// NOT generate CSS, reshape data, or make design decisions. Changes to
// the report's visual appearance or section ordering belong in the
// template file.
//
// CLI usage:
//   node render-report.js --findings <path> --output <path>
//   node render-report.js --help

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const EXIT = Object.freeze({
  OK: 0,
  UNKNOWN: 1,
  INVALID_ARGS: 2,
});

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'report-template.html');

const HELP = `Usage:
  render-report.js --findings <path> --output <path>
  render-report.js --help

Renders the unified security-review HTML report from a findings JSON file
and the bundled template. Performs mechanical token substitution only.

Options:
  --findings <path>  Path to the findings JSON (REQUIRED). See the schema
                     in references/orchestration.md.
  --output <path>    Where to write the HTML report (REQUIRED).
  -h, --help         Show this help.

Exit codes:
  0  Success.
  1  Unknown / I/O failure (template missing, write failed, etc.).
  2  Invalid CLI arguments, findings file not found / malformed.
`;

function exitWithMessage(exitCode, message) {
  process.stderr.write(message.endsWith('\n') ? message : message + '\n');
  process.exit(exitCode);
}

function invalidArgs(message) {
  const err = new Error(message);
  err.code = 'INVALID_ARGS';
  return err;
}

// HTML-escape a value for safe text content. This is NOT sufficient for
// attribute values that contain script-context content — the template is
// intentionally simple (text nodes + attribute values where user input
// is already URL-encoded or numeric).
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSummary(findings) {
  const s = findings.summary || {};
  const bs = s.bySeverity || {};
  const bc = s.byCategory || {};
  const severityRow = ['critical', 'high', 'medium', 'passing']
    .map((sev) => `<li class="sev-${sev}"><span class="count">${escapeHtml(bs[sev] ?? 0)}</span> <span class="label">${escapeHtml(sev[0].toUpperCase() + sev.slice(1))}</span></li>`)
    .join('\n');
  const categoryRows = Object.entries(bc)
    .map(([cat, count]) => `<li><span class="count">${escapeHtml(count)}</span> <span class="label">${escapeHtml(cat)}</span></li>`)
    .join('\n');
  return `
    <div class="summary">
      <div class="summary-total">Total findings: <strong>${escapeHtml(s.totalFindings ?? 0)}</strong></div>
      <div class="summary-block">
        <h3>By severity</h3>
        <ul class="severity-list">${severityRow}</ul>
      </div>
      <div class="summary-block">
        <h3>By category</h3>
        <ul class="category-list">${categoryRows}</ul>
      </div>
    </div>
  `.trim();
}

function renderFinding(f) {
  const rem = f.remediation || {};
  const statusLabel = escapeHtml(rem.appliedStatus || 'open');
  const beforeAfter = (rem.beforeValue != null || rem.afterValue != null)
    ? `
      <div class="before-after">
        <div><strong>Before:</strong> <code>${escapeHtml(JSON.stringify(rem.beforeValue ?? null))}</code></div>
        <div><strong>After:</strong> <code>${escapeHtml(JSON.stringify(rem.afterValue ?? null))}</code></div>
      </div>`
    : '';
  return `
    <article class="finding sev-${escapeHtml(f.severity || 'medium')}">
      <header>
        <span class="severity-badge sev-${escapeHtml(f.severity || 'medium')}">${escapeHtml((f.severity || 'medium').toUpperCase())}</span>
        <h4>${escapeHtml(f.title || '(untitled finding)')}</h4>
        <span class="status status-${statusLabel}">${statusLabel}</span>
      </header>
      <div class="source"><em>Source:</em> ${escapeHtml(f.source || 'unknown')}</div>
      <div class="evidence"><strong>Evidence:</strong> ${escapeHtml(f.evidence || '')}</div>
      <div class="remediation"><strong>Remediation:</strong> ${escapeHtml(rem.description || '')}${rem.delegateTo ? ` <span class="delegate">(via <code>${escapeHtml(rem.delegateTo)}</code>)</span>` : ''}</div>
      ${beforeAfter}
    </article>
  `.trim();
}

function renderCategories(findings) {
  const cats = findings.categories || [];
  if (cats.length === 0) return '<p class="empty">No category findings recorded.</p>';
  return cats.map((cat) => `
    <section class="category">
      <h3>${escapeHtml(cat.name || cat.id || '(unnamed)')}</h3>
      <div class="findings-list">
        ${(cat.findings || []).map(renderFinding).join('\n')}
      </div>
    </section>
  `.trim()).join('\n');
}

function renderPermissionsAudit(findings) {
  const pa = findings.permissionsAudit;
  if (!pa) return '';
  const s = pa.summary || {};
  return `
    <section class="permissions-audit">
      <h3>Table permissions audit</h3>
      <p>Findings from <code>/audit-permissions</code> are included under A01 Broken Access Control. Full evidence and the original severity-grouped report remain at <a href="${escapeHtml(pa.reportPath || 'docs/permissions-audit.html')}"><code>${escapeHtml(pa.reportPath || 'docs/permissions-audit.html')}</code></a>.</p>
      <ul class="permissions-summary">
        <li class="sev-critical"><span class="count">${escapeHtml(s.critical ?? 0)}</span> Critical</li>
        <li class="sev-high"><span class="count">${escapeHtml(s.warning ?? 0)}</span> Warning</li>
        <li class="sev-medium"><span class="count">${escapeHtml(s.info ?? 0)}</span> Info</li>
        <li class="sev-passing"><span class="count">${escapeHtml(s.pass ?? 0)}</span> Passing</li>
      </ul>
      ${pa.note ? `<p class="note">${escapeHtml(pa.note)}</p>` : ''}
    </section>
  `.trim();
}

function renderPendingScans(findings) {
  const pending = findings.metadata?.pendingScans;
  if (!pending || pending.length === 0) return '';
  const items = pending.map((p) => `<li>${escapeHtml(p.type || 'unknown scan')} — poll with: <code>${escapeHtml(p.pollCommand || '')}</code></li>`).join('\n');
  return `
    <aside class="pending-scans">
      <h3>Additional findings pending</h3>
      <p>Long-running scans are still in progress. Their findings will be appended to this report once they complete.</p>
      <ul>${items}</ul>
    </aside>
  `.trim();
}

function renderMetadata(findings) {
  const m = findings.metadata || {};
  return `
    <dl class="metadata">
      <dt>Framework</dt><dd>${escapeHtml(m.framework || '(not recorded)')}</dd>
      <dt>Site</dt><dd>${escapeHtml(m.siteName || '(unknown)')}</dd>
      <dt>Portal id</dt><dd><code>${escapeHtml(m.portalId || '(unknown)')}</code></dd>
      <dt>Generated</dt><dd>${escapeHtml(m.generatedAt || new Date().toISOString())}</dd>
    </dl>
  `.trim();
}

function render({ findingsPath, outputPath } = {}) {
  if (!findingsPath || typeof findingsPath !== 'string') {
    throw invalidArgs('--findings is required');
  }
  if (!outputPath || typeof outputPath !== 'string') {
    throw invalidArgs('--output is required');
  }
  if (!fs.existsSync(findingsPath)) {
    throw invalidArgs(`findings file not found: ${findingsPath}`);
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    const err = new Error(`template not found at ${TEMPLATE_PATH}`);
    err.code = 'UNKNOWN';
    throw err;
  }

  let findings;
  try {
    findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch (err) {
    throw invalidArgs(`findings file is not valid JSON: ${err.message}`);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  const tokens = {
    __METADATA__: renderMetadata(findings),
    __SUMMARY__: renderSummary(findings),
    __PENDING_SCANS__: renderPendingScans(findings),
    __CATEGORIES__: renderCategories(findings),
    __PERMISSIONS_AUDIT__: renderPermissionsAudit(findings),
  };

  let html = template;
  for (const [token, value] of Object.entries(tokens)) {
    html = html.split(token).join(value);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');

  return { outputPath, bytes: Buffer.byteLength(html, 'utf8') };
}

function parseCli(argv) {
  const options = {
    findings: { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  };
  return parseArgs({ args: argv.slice(2), options, strict: true }).values;
}

function main() {
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
  try {
    const result = render({ findingsPath: args.findings, outputPath: args.output });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const exitCode = err.code === 'INVALID_ARGS' ? EXIT.INVALID_ARGS : EXIT.UNKNOWN;
    exitWithMessage(exitCode, err.stack || err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  render,
  escapeHtml,
  renderSummary,
  renderCategories,
  renderFinding,
  renderPermissionsAudit,
  renderPendingScans,
  renderMetadata,
  TEMPLATE_PATH,
  EXIT,
};
