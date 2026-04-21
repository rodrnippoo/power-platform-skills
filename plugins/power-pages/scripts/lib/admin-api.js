#!/usr/bin/env node

// Thin wrapper around the Power Pages Admin API:
//
//   1. Resolve cloud + environmentId via `getPacAuthInfo()`.
//   2. Pick the base URL from `CLOUD_TO_API[cloud]` (no trailing slash).
//   3. Acquire the Azure CLI token via `getAuthToken(baseUrl)`.
//   4. Build the URL by string concatenation and attach `api-version=...`.
//   5. Send via `makeRequest({ url, method, headers, body, includeHeaders, timeout })`.
//   6. Handle transient errors: 401 → refresh token + retry; 429/500/502/503 → backoff + retry;
//      network error → retry. Up to 2 retries total (mirrors dataverse-request.js).

const {
  getAuthToken,
  getPacAuthInfo,
  makeRequest,
  CLOUD_TO_API,
} = require('./validation-helpers');

const DEFAULT_API_VERSION = '2022-03-01-preview';
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_RETRY_DELAY_MS = 5000;
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503]);

function resolveBaseUrl(cloud) {
  return (CLOUD_TO_API[cloud] || CLOUD_TO_API.Public).replace(/\/+$/, '');
}

function buildUrl({ baseUrl, environmentId, portalId, operation, apiVersion, extraQuery }) {
  const trimmedOp = (operation || '').replace(/^\/+/, '');
  // `portalId` is the Admin API URL path segment (the `{id}` / `{websiteId}`
  // in routes like `/websites/{id}/enableWaf`). This is distinct from the
  // Dataverse websiteRecordId; resolve via `scripts/lib/website.js` first.
  const pathPrefix = portalId
    ? `powerpages/environments/${environmentId}/websites/${portalId}`
    : `powerpages/environments/${environmentId}`;
  const fullPath = trimmedOp ? `${pathPrefix}/${trimmedOp}` : pathPrefix;
  const params = [`api-version=${encodeURIComponent(apiVersion || DEFAULT_API_VERSION)}`];
  if (extraQuery) {
    for (const [k, v] of Object.entries(extraQuery)) {
      if (v !== undefined && v !== null) params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return `${baseUrl}/${fullPath}?${params.join('&')}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Calls the Power Pages Admin API. See the top-of-file comment for the call pattern.
 *
 * @param {object} options
 * @param {string} options.method              HTTP method (GET / POST / PUT / DELETE / PATCH)
 * @param {string} options.operation           Operation suffix after the websites/{id}/ segment (e.g., "getWafStatus")
 * @param {string} [options.environmentId]     Environment GUID. Falls back to `pac auth who`.
 * @param {string} [options.portalId]          Portal GUID — the `{id}` segment in Admin API URL paths
 *                                             (e.g. `/websites/{id}/enableWaf`). NOT the Dataverse
 *                                             websiteRecordId; resolve via `scripts/lib/website.js`.
 *                                             Optional — some operations are environment-level.
 * @param {string} [options.cloud]             Cloud name. Falls back to `pac auth who`.
 * @param {object} [options.body]              JSON body (object — will be stringified)
 * @param {object} [options.extraQuery]        Extra query-string parameters
 * @param {string} [options.apiVersion]        Override the default api-version
 * @param {number} [options.timeout=15000]     Per-request timeout
 * @param {object} [options.deps]              Dependency overrides for testing
 *
 * @returns {Promise<{ statusCode: number, body: any, error?: string }>}
 *   Long-running operations return `{ statusCode: 202, body: null }`;
 *   the caller is responsible for re-checking via the appropriate GET endpoint.
 */
async function callAdminApi(options) {
  const deps = {
    getAuthToken,
    getPacAuthInfo,
    makeRequest,
    sleep,
    ...(options.deps || {}),
  };

  let cloud = options.cloud;
  let environmentId = options.environmentId;
  if (!environmentId || !cloud) {
    const auth = deps.getPacAuthInfo();
    if (!auth) {
      return { error: 'Could not resolve environmentId / cloud. Run `pac auth create` and try again.' };
    }
    cloud = cloud || auth.cloud;
    environmentId = environmentId || auth.environmentId;
  }

  const baseUrl = resolveBaseUrl(cloud);
  let token = deps.getAuthToken(baseUrl);
  if (!token) {
    return {
      error: 'Failed to get Azure CLI access token. Ensure you are logged in with: az login',
    };
  }

  const url = buildUrl({
    baseUrl,
    environmentId,
    portalId: options.portalId,
    operation: options.operation,
    apiVersion: options.apiVersion,
    extraQuery: options.extraQuery,
  });

  let bodyStr = null;
  if (options.body !== undefined && options.body !== null) {
    bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  function buildHeaders() {
    const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (bodyStr) h['Content-Type'] = 'application/json';
    return h;
  }

  // Transient-error retry loop: 401 (refresh token), 429/500/502/503 (backoff), network errors.
  // Mirrors the pattern in dataverse-request.js.
  let response = null;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    response = await deps.makeRequest({
      url,
      method: options.method,
      headers: buildHeaders(),
      body: bodyStr,
      timeout: options.timeout ?? 15000,
    });

    if (response.error) {
      if (attempt < MAX_TRANSIENT_RETRIES) {
        await deps.sleep(TRANSIENT_RETRY_DELAY_MS);
        continue;
      }
      return { error: response.error };
    }

    if (response.statusCode === 401 && attempt < MAX_TRANSIENT_RETRIES) {
      const refreshed = deps.getAuthToken(baseUrl);
      if (!refreshed) {
        return { error: 'Token refresh failed. Run `az login` again.' };
      }
      token = refreshed;
      continue;
    }

    if (TRANSIENT_STATUS_CODES.has(response.statusCode) && attempt < MAX_TRANSIENT_RETRIES) {
      await deps.sleep(TRANSIENT_RETRY_DELAY_MS);
      continue;
    }

    break;
  }

  return {
    statusCode: response.statusCode,
    body: parseJsonBody(response.body),
  };
}

module.exports = {
  callAdminApi,
  buildUrl,
  resolveBaseUrl,
  parseJsonBody,
  DEFAULT_API_VERSION,
};
