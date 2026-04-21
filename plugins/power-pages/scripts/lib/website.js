#!/usr/bin/env node

// Reads Power Pages website records from the Admin API.
//
// Terminology (important — these are two different GUIDs):
//
//   websiteRecordId  Dataverse website record primary key. This is what
//                    `.powerpages-site/website.yml` stores as `id` and what
//                    `pac pages list` surfaces as "Website Record ID". It is
//                    the identifier callers / users naturally have.
//
//   portalId         Power Platform portal identifier. This is the `{id}` /
//                    `{websiteId}` segment in Admin API URL paths such as
//                    `/websites/{id}/enableWaf`. It is NOT the same value as
//                    websiteRecordId. You get it by listing websites via
//                    `/websites` and reading the `id` field of the matching
//                    record. All subsequent Admin API calls that require a
//                    per-site URL path must use portalId.
//
// Exposes two helpers:
//
//   - getWebsite({ websiteRecordId, ... })
//     Resolves a Dataverse websiteRecordId to the full website record from
//     `GET /powerpages/environments/{envId}/websites`. The returned record
//     includes `id` (portalId), `websiteRecordId`, `name`, and the rest of the
//     server-exposed fields. Returns `null` when no record matches.
//
//   - listWebsites({ ... })
//     `GET /powerpages/environments/{envId}/websites?skip=N&select=fields`
//     Follows `@odata.nextLink` across pages (server default page size 30).
//     Returns a plain array of website records (empty when the environment
//     has no sites).
//
// Both helpers throw on Admin API failures (auth, network, transient errors
// after retry exhaust). Both go through `scripts/lib/admin-api.js`, so they
// inherit the house call pattern (PAC cloud resolution, Azure CLI token,
// one-shot call, 401/429/5xx retry).
//
// Usage (CLI):
//   node website.js --websiteRecordId <guid> [--environmentId <guid>] [--cloud <name>] [--select name,type]
//   node website.js --list [--environmentId <guid>] [--cloud <name>] [--select name,type]

const { callAdminApi } = require('./admin-api');

const MAX_PAGES = 500; // defensive cap — ~15,000 websites per environment max

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[argv[i].slice(2)] = argv[++i];
    } else if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = true;
    }
  }
  return out;
}

/**
 * Extracts the `skip` query value from an `@odata.nextLink` URL.
 * Returns the parsed integer, or `null` if missing / unparseable.
 */
function extractSkipFromNextLink(nextLink) {
  if (typeof nextLink !== 'string' || nextLink.length === 0) return null;
  const match = nextLink.match(/[?&]skip=(-?\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return parsed;
}

function buildExtraQuery({ select, skip }) {
  const q = {};
  if (select) q.select = select;
  if (skip !== undefined && skip !== null) q.skip = String(skip);
  return Object.keys(q).length > 0 ? q : undefined;
}

/**
 * Resolves a Dataverse websiteRecordId to the full website record (which
 * includes the portalId in its `id` field). Uses the list endpoint with
 * pagination because the Admin API does not expose a direct
 * "lookup by websiteRecordId" route — the only per-site GET (`GetPortalById`)
 * takes portalId.
 *
 * Matching is case-insensitive to tolerate GUID casing differences between
 * `pac pages list`, `.powerpages-site/website.yml`, and the Admin API.
 *
 * @param {object} options
 * @param {string} options.websiteRecordId     Required Dataverse record id
 * @param {string} [options.environmentId]
 * @param {string} [options.cloud]
 * @param {string} [options.select]            Optional comma-separated field list
 * @param {number} [options.maxPages]          Passed through to the underlying listWebsites
 * @param {object} [options.deps]              Dependency overrides for testing
 *
 * @returns {Promise<object|null>}  Website record on match, `null` when no
 *   record matches. Throws on Admin API failure.
 */
async function getWebsite({ websiteRecordId, environmentId, cloud, select, maxPages, deps } = {}) {
  if (!websiteRecordId || typeof websiteRecordId !== 'string') {
    throw new Error('websiteRecordId is required');
  }

  const target = websiteRecordId.toLowerCase();
  const websites = await listWebsites({ environmentId, cloud, select, maxPages, deps });

  const match = websites.find(
    (w) => typeof w.websiteRecordId === 'string' && w.websiteRecordId.toLowerCase() === target,
  );
  return match || null;
}

/**
 * Lists every website in the environment, following `@odata.nextLink` across
 * pages (server default page size is 30).
 *
 * @returns {Promise<object[]>}  Array of website records. Empty when the
 *   environment has no sites. Throws on Admin API failure.
 */
async function listWebsites({ environmentId, cloud, select, maxPages = MAX_PAGES, deps } = {}) {
  const websites = [];
  const seenSkips = new Set();
  let skip;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const res = await callAdminApi({
      method: 'GET',
      operation: 'websites',
      environmentId,
      cloud,
      extraQuery: buildExtraQuery({ select, skip }),
      deps,
    });

    if (res.error) throw new Error(`Failed to list websites: ${res.error}`);
    if (res.statusCode >= 400) {
      throw new Error(`Failed to list websites: HTTP ${res.statusCode}`);
    }

    const page = (res.body && typeof res.body === 'object') ? res.body : {};
    if (Array.isArray(page.value)) websites.push(...page.value);
    pagesFetched += 1;

    const nextLink = page['@odata.nextLink'] || page.nextLink;
    if (!nextLink) break;

    const nextSkip = extractSkipFromNextLink(nextLink);
    if (nextSkip === null) break;

    // Defensive: server returned a `skip` we've already used or a non-increasing value.
    // Break instead of looping forever. `skip === undefined` on the first request
    // means the server implicitly served skip=0, so treat that as the current offset.
    const effectiveCurrentSkip = skip === undefined ? 0 : skip;
    if (seenSkips.has(nextSkip)) break;
    if (nextSkip <= effectiveCurrentSkip) break;
    seenSkips.add(nextSkip);
    skip = nextSkip;
  }

  return websites;
}

async function main() {
  const args = parseArgs(process.argv);
  try {
    if (args.list) {
      const websites = await listWebsites({
        environmentId: args.environmentId,
        cloud: args.cloud,
        select: args.select,
      });
      process.stdout.write(JSON.stringify(websites, null, 2));
      return;
    }
    if (!args.websiteRecordId) {
      process.stderr.write('Usage: node website.js --websiteRecordId <guid> [--environmentId <guid>] [--cloud <name>] [--select fields]\n');
      process.stderr.write('   or: node website.js --list [--environmentId <guid>] [--cloud <name>] [--select fields]\n');
      process.exit(1);
    }
    const website = await getWebsite({
      websiteRecordId: args.websiteRecordId,
      environmentId: args.environmentId,
      cloud: args.cloud,
      select: args.select,
    });
    process.stdout.write(JSON.stringify(website, null, 2));
  } catch (err) {
    process.stderr.write(`Unexpected error: ${err.stack || err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getWebsite,
  listWebsites,
  extractSkipFromNextLink,
  MAX_PAGES,
};
