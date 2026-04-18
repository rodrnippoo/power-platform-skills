const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const { createTempProject, writeProjectFile } = require('./test-utils');

const VALIDATOR_PATH = path.join(
  __dirname,
  '..',
  '..',
  'skills',
  'add-ai-webapi',
  'scripts',
  'validate-ai-webapi.js'
);

function runValidator(projectRoot) {
  return spawnSync(process.execPath, [VALIDATOR_PATH], {
    input: JSON.stringify({ cwd: projectRoot }),
    encoding: 'utf8',
  });
}

const VALID_SEARCH_SERVICE = `
export async function fetchSearchSummary(userQuery) {
  const token = await getCsrfToken();
  const response = await fetch('/_api/search/v1.0/summary', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      '__RequestVerificationToken': token,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams({ userQuery }).toString(),
  });
  return response.json();
}
`;

const VALID_DATA_SERVICE = `
export async function fetchCaseSummary(caseId) {
  const token = await getCsrfToken();
  const url = '/_api/summarization/data/v1.0/incidents(' + caseId + ')?$select=description,title&$expand=incident_adx_portalcomments($select=description)';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      '__RequestVerificationToken': token,
      'X-Requested-With': 'XMLHttpRequest',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
    body: JSON.stringify({ InstructionIdentifier: 'Summarization/prompt/case_summary' }),
  });
  return response.json();
}
`;

test('approves when no AI summarization calls exist', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/index.ts', 'export const noop = () => {};');

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('approves when src directory is missing', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('valid search summary service passes validation', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('valid data summarization service passes validation', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_DATA_SERVICE);

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('missing __RequestVerificationToken is flagged', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(
    projectRoot,
    'src/services/aiSummaryService.ts',
    VALID_SEARCH_SERVICE.replace("'__RequestVerificationToken': token,", '')
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing __RequestVerificationToken/);
});

test('missing X-Requested-With is warned but not blocked', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(
    projectRoot,
    'src/services/aiSummaryService.ts',
    VALID_SEARCH_SERVICE.replace("'X-Requested-With': 'XMLHttpRequest',", '')
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /X-Requested-With/);
});

test('data summarization without $select is flagged', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(
    projectRoot,
    'src/services/aiSummaryService.ts',
    VALID_DATA_SERVICE.replace(/\?\$select=[^']+/, '')
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing \$select/);
});

test('multiple AI service files are each validated', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/search.ts', VALID_SEARCH_SERVICE);
  writeProjectFile(
    projectRoot,
    'src/services/case.ts',
    VALID_DATA_SERVICE.replace("'__RequestVerificationToken': token,", '')
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /case\.ts/);
  assert.doesNotMatch(result.stderr, /search\.ts.*__RequestVerificationToken/);
});

test('Search Summary without parseSummaryWithCitations is warned but not blocked', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /parseSummaryWithCitations/);
});

test('Search Summary with parseSummaryWithCitations does not warn about parsing', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);
  writeProjectFile(
    projectRoot,
    'src/components/SummaryWithCitations.tsx',
    "import { parseSummaryWithCitations } from '../services/aiSummaryService';\nexport function SummaryWithCitations() { return parseSummaryWithCitations(''); }"
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /parseSummaryWithCitations/);
});

test('Search Summary with literal [[N]](url) handling does not warn about parsing', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);
  writeProjectFile(
    projectRoot,
    'src/components/Inline.tsx',
    "// Hand-rolled parser handling [[1]](https://example.com/foo)\nexport const re = /\\[\\[(\\d+)\\]\\]\\(([^)]+)\\)/g;"
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /parseSummaryWithCitations/);
});

test('Search Summary without extractKnowledgeArticleId is warned but not blocked', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /extractKnowledgeArticleId/);
});

test('Search Summary with extractKnowledgeArticleId does not warn about KB rewrite', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);
  writeProjectFile(
    projectRoot,
    'src/components/CitationLink.tsx',
    "import { extractKnowledgeArticleId } from '../services/aiSummaryService';\nexport function rewrite(url) { return extractKnowledgeArticleId(url); }"
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /extractKnowledgeArticleId/);
});

test('Search Summary with inline ?id= parsing does not warn about KB rewrite', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_SEARCH_SERVICE);
  writeProjectFile(
    projectRoot,
    'src/components/CitationLink.tsx',
    "export function rewrite(url) { const u = new URL(url); return u.searchParams.get('id'); }"
  );

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /extractKnowledgeArticleId/);
});

test('Data-only project does not trigger Search Summary warnings', (t) => {
  const projectRoot = createTempProject(t);
  writeProjectFile(projectRoot, 'powerpages.config.json', '{}');
  writeProjectFile(projectRoot, 'src/services/aiSummaryService.ts', VALID_DATA_SERVICE);

  const result = runValidator(projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /parseSummaryWithCitations/);
  assert.doesNotMatch(result.stderr, /extractKnowledgeArticleId/);
});
