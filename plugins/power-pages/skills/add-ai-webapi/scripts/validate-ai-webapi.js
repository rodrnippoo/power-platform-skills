#!/usr/bin/env node

// Validates that the add-ai-webapi skill produced AI summarization integration code.
// Runs as the PostToolUse Skill hook validator.
//
// A valid run must produce at least one of:
//   - a search-summary service that POSTs to /_api/search/v1.0/summary
//   - a data-summarization service that POSTs to /_api/summarization/data/v1.0/
//
// Blocking checks (these are documented or structural and break the API at runtime):
//   - Every summarization request must attach the __RequestVerificationToken header.
//     The Data Summarization docs explicitly require a CSRF token; omitting it produces
//     a token-validation failure on mutating requests.
//   - Every data-summarization call must include $select — Power Pages Web API never
//     allows wildcard columns, and the Microsoft sample URL has $select.
//
// Advisory only (missing prints a warning but does not block):
//   - X-Requested-With: XMLHttpRequest — matches shell.ajaxSafePost's default behaviour
//     used by the Microsoft-shipped case-page Copilot snippet, but neither summarization
//     doc mandates it. Worth flagging so reviewers can confirm it was intentional.
//   - Search Summary citation parsing — the API embeds [[N]](url) markdown tokens inline
//     in Summary. Rendering Summary directly shows raw markdown. Warn when no source file
//     references parseSummaryWithCitations or contains a [[N]](url) parsing pattern.
//   - Search Summary KB-id rewrite — on code sites the API returns
//     /page-not-found/?id=<guid> citation URLs that need rewriting to the SPA's KB route.
//     Warn when search-summary code is present but no file references
//     extractKnowledgeArticleId (or an equivalent inline rewrite).

const fs = require('fs');
const path = require('path');
const { approve, block, runValidation, findProjectRoot } = require('../../../scripts/lib/validation-helpers');
const { validatePowerPagesSchema } = require('../../../scripts/lib/powerpages-schema-validator');

const SEARCH_SUMMARY_URL = '/_api/search/v1.0/summary';
const DATA_SUMMARIZATION_URL = '/_api/summarization/data/v1.0/';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.astro']);

runValidation((cwd) => {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) approve();

  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) approve();

  const sourceFiles = collectSourceFiles(srcDir);
  const hits = [];

  for (const file of sourceFiles) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hasSearch = content.includes(SEARCH_SUMMARY_URL);
    const hasData = content.includes(DATA_SUMMARIZATION_URL);
    if (hasSearch || hasData) {
      hits.push({ file, content, hasSearch, hasData });
    }
  }

  if (hits.length === 0) approve();

  const errors = [];
  const warnings = [];

  for (const hit of hits) {
    const rel = path.relative(projectRoot, hit.file);
    if (!hit.content.includes('__RequestVerificationToken')) {
      errors.push(`${rel}: summarization request missing __RequestVerificationToken header (CSRF token is required — fetch it from /_layout/tokenhtml)`);
    }
    if (!hit.content.includes('X-Requested-With')) {
      warnings.push(`${rel}: summarization request missing X-Requested-With: XMLHttpRequest header (not strictly required by the docs, but matches shell.ajaxSafePost behaviour used by the Microsoft case-page snippet)`);
    }
    if (hit.hasData && !/\$select=/.test(hit.content)) {
      errors.push(`${rel}: data summarization call missing $select — Power Pages Web API requires explicit column lists, never wildcards`);
    }
  }

  // Project-wide checks for Search Summary UI rendering. These look across all source files
  // because the parser/rewrite typically lives in a UI component (or a shared util), not the
  // file containing the fetch call. We only run them when the project actually calls
  // /_api/search/v1.0/summary somewhere.
  const projectHasSearchSummary = hits.some((h) => h.hasSearch);
  if (projectHasSearchSummary) {
    const allContent = sourceFiles
      .map((f) => {
        try {
          return fs.readFileSync(f, 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');

    // [[N]](url) parser: either by helper name or by a literal pattern that handles the token.
    const usesParserHelper = allContent.includes('parseSummaryWithCitations');
    const handlesTokenInline = /\[\[\\?d\+\\?\]\]\\?\(/.test(allContent) || /\[\[\d+\]\]\(/.test(allContent);
    if (!usesParserHelper && !handlesTokenInline) {
      warnings.push(
        'Search Summary is integrated but no source file references parseSummaryWithCitations or a [[N]](url) parsing pattern — Summary will render as raw markdown unless a parser is wired in.'
      );
    }

    // KB-id rewrite for code sites: either by helper name or by inline reading of ?id=<guid>.
    const usesRewriteHelper = allContent.includes('extractKnowledgeArticleId');
    const handlesRewriteInline = /searchParams\.get\(\s*['"]id['"]\s*\)/.test(allContent);
    if (!usesRewriteHelper && !handlesRewriteInline) {
      warnings.push(
        "Search Summary is integrated but no source file references extractKnowledgeArticleId or reads the citation URL's ?id parameter — citation links will land on the built-in /page-not-found page on code sites."
      );
    }
  }

  const schemaValidation = validatePowerPagesSchema(projectRoot);
  const schemaErrors = schemaValidation.findings
    .filter(finding => finding.severity === 'error')
    .map(finding => finding.filePath ? `${finding.message} (${path.basename(finding.filePath)})` : finding.message);

  if (schemaErrors.length > 0) {
    errors.push('Invalid Power Pages permissions/site-settings schema:\n  - ' + schemaErrors.join('\n  - '));
  }

  if (warnings.length > 0) {
    process.stderr.write('AI summarization integration warnings:\n- ' + warnings.join('\n- ') + '\n');
  }

  if (errors.length > 0) {
    block('AI summarization integration validation failed:\n- ' + errors.join('\n- '));
  }

  approve();
});

function collectSourceFiles(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }
  return results;
}
