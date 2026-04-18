# Power Pages Generative-AI Summarization APIs

Reference for the three Power Pages endpoints that return AI-generated summaries. All three use the same portal session auth — a CSRF token fetched from `/_layout/tokenhtml` sent as the `__RequestVerificationToken` header. No `Authorization` bearer is needed.

Sources (Microsoft Learn):

- Search Summary API — https://learn.microsoft.com/en-us/power-pages/configure/search/generative-ai#search-summary-api
- Data Summarization API — https://learn.microsoft.com/en-us/power-pages/configure/data-summarization-api
- Case-page Copilot preset — https://learn.microsoft.com/en-us/power-pages/configure/add-copilot-summarization-to-case-page

---

## Semantics vs. HTTP method — why these rules differ from `/integrate-webapi`

All three endpoints are **semantically reads**: they return an AI-generated summary of content
the caller could already read through the regular Power Pages Web API, and they never mutate
Dataverse. They use **POST** for transport only — because the request carries a body
(`userQuery`, `InstructionIdentifier`, `RecommendationConfig`) that doesn't fit in a GET query
string cleanly.

This matters because the general `/integrate-webapi` rulebook assumes POST means mutation. Several
of those rules do **not** apply here:

| `/integrate-webapi` rule for POST | Why it doesn't apply to AI summarization |
|-----------------------------------|------------------------------------------|
| Set lookup relationships via `NavigationProperty@odata.bind` | No writes happen — there's nothing to bind. |
| Send `Prefer: return=representation` and handle the `Location` / `OData-EntityId` header | The response always contains the summary body; no record is created. |
| Require `If-Match: *` | That header is for PATCH; not applicable. |
| Table permissions should grant `create: true` / `write: true` for POST callers | AI callers need **`read: true` only**. |
| `Webapi/<table>/fields` should include the primary key for CRUD | Primary key isn't needed — the record id is in the URL path, not a selected column. MS's shipped case preset ships `Webapi/incident/fields = description,title` with no `incidentid`. |
| Lookup columns need both the LogicalName and `_<col>_value` forms | Only the `_<col>_value` read form is needed. The LogicalName write form is only required if the same table has non-AI mutation code elsewhere. |

**Runtime auth path.** When a request hits `/_api/summarization/data/v1.0/<table>(<id>)?...`, the
Power Pages runtime walks this sequence before the generative layer sees any content:

1. Is `Webapi/<table>/enabled = true`? → if not, 403
2. Does the caller's web role have a table permission on `<table>` with `read: true`? → if not, 403
3. Are all columns named in `$select` / `$expand` allowlisted in `Webapi/<table>/fields`? → if not, 403
4. For each `$expand` target, repeat steps 1–3 on that table (and confirm Parent-scope with
   `appendTo: true` on the parent) → if not, 403
5. Is `Summarization/Data/Enable = true`? → if not, error `90041003`
6. Does the `InstructionIdentifier` value correspond to an existing
   `Summarization/prompt/<identifier>` site setting? → if not, error from the summariser

Only after step 6 does the request reach the Azure OpenAI layer that produces the summary. This
is why the `add-ai-webapi` skill orders its work as Phase 4 (Layer 1 + Layer 2 via
`/integrate-webapi` in AI-only read mode) before Phase 6 (Layer 3 via `ai-webapi-settings-architect`)
— Layer 3 can't be validated until Layers 1 and 2 are on disk.

---

## 1. Search Summary API

Summarises search results using generative AI for a user query. Requires that **Site search with generative AI** is enabled in the site's Copilot workspace.

| Method | URI |
|--------|-----|
| POST | `/_api/search/v1.0/summary` |

> **At-a-glance gotchas (full detail below):**
> - **Content-Type:** `application/x-www-form-urlencoded` — *not* `application/json`. JSON returns 400.
> - **Indexed content:** the API grounds on the site's knowledge-article index. A code site with no
>   `knowledgearticle` data (or with the search index not yet built) returns empty
>   `Summary` / `Citations`. Verify your site has knowledge articles populated and indexed before
>   debugging the API itself.
> - **Citation URLs on code sites:** returned as `/page-not-found/?id=<guid>`. Rewrite to your SPA's
>   KB route (default `/knowledge/:id`) — see the "Citation URLs on code sites" subsection.

**Request body (wire format):**

The Microsoft Learn sample calls this with jQuery as:

```javascript
shell.ajaxSafePost({
  type: "POST",
  url: ".../_api/search/v1.0/summary",
  contentType: "application/x-www-form-urlencoded",
  data: { userQuery: "Fix problems with slow coffee dispense" }
})
```

With that `contentType`, jQuery serialises `data` into a URL-encoded string. The actual wire body is:

```http
Content-Type: application/x-www-form-urlencoded

userQuery=Fix+problems+with+slow+coffee+dispense
```

> **⚠️ Content-Type is the #1 way to break this endpoint.** The Search Summary API **requires**
> `application/x-www-form-urlencoded` — sending `application/json` (even with the correct payload
> shape) returns a 400. This is the opposite of the Data Summarization endpoint, which requires
> JSON. Do **NOT** reuse `buildPowerPagesHeaders()` defaults (or any other shared header helper
> that defaults to `application/json`) without explicitly overriding `contentType` for this call.
> A copy-paste from the data endpoint is the most common source of Search Summary 400s in the
> field.

**Response body:**

```json
{
  "Summary": "To fix slow coffee dispense, descale the boiler[[1]](https://contoso.powerappsportals.com/knowledgebase/article/KA-01055) and verify the pump pressure is within spec[[2]](https://contoso.powerappsportals.com/knowledgebase/article/KA-01092).",
  "SummaryTitle": "Troubleshooting slow coffee dispense",
  "SearchTitle": "Fix problems with slow coffee dispense",
  "Citations": {
    "[1]": "https://contoso.powerappsportals.com/knowledgebase/article/KA-01055",
    "[2]": "https://contoso.powerappsportals.com/knowledgebase/article/KA-01092"
  },
  "CitationTitleMapping": {
    "[1]": "KA-01055 — Descaling the espresso boiler",
    "[2]": "KA-01092 — Pump pressure calibration"
  },
  "Chunks": [
    { "Id": "...", "Title": "...", "Url": "...", "Score": 0.87 }
  ],
  "ErrorMessage": "",
  "ResponseStatus": "Success"
}
```

**Notes:**

- `Summary` embeds citations inline as markdown-style links: `[[N]](url)`. Rendering `{Summary}`
  directly in a `<p>` (or via `v-html` / `innerHTML`) will show raw markdown syntax — the caller
  must parse the token pattern and emit framework-native clickable elements. Do **not**
  pass the raw string through `dangerouslySetInnerHTML` or a markdown renderer; it's a single
  inline token grammar, not general markdown.
- `Citations` is an object keyed by citation tokens (`[1]`, `[2]`, ...) that map tokens to the
  source URL (see "Citation URLs on code sites" below for a gotcha).
- `CitationTitleMapping` is an object keyed by the same tokens that maps each token to a
  human-readable title — **use this as the visible label** for citation links and citation-list
  rows, with the URL as a fallback only when the mapping is absent.
- `SummaryTitle` is a short AI-generated heading for the summary block; `SearchTitle` echoes back
  the user's query.
- `Chunks` is an array of the underlying content chunks the summary was grounded on (rarely needed
  by UI code; useful for debugging).
- `ErrorMessage` / `ResponseStatus` are populated on failure (the API returns 200 with a non-empty
  `ErrorMessage` for soft-failures like "no results").
- Enablement is a tenant/site toggle — no per-table `Webapi/*` site setting is required for search summary.
- Faceted search is **not** available when generative AI search is enabled.
- Content snippet `Search/Summary/Title` controls the section heading on the built-in search results page.

**TypeScript shape:**

```ts
export interface SearchSummaryChunk {
  Id?: string;
  Title?: string;
  Url?: string;
  Score?: number;
}

export interface SearchSummaryResponse {
  Summary: string;
  Citations: Record<string, string>;
  // Extras — optional because older server versions omit them, but real tenants return them today.
  SummaryTitle?: string;
  SearchTitle?: string;
  CitationTitleMapping?: Record<string, string>;
  Chunks?: SearchSummaryChunk[];
  ErrorMessage?: string;
  ResponseStatus?: string;
}
```

**Parsing inline citations.** The `Summary` string contains `[[N]](url)` tokens that must be
split into alternating text and citation runs so the UI can render each citation as a clickable
element (with its `CitationTitleMapping[token]` label, or the URL as fallback). Use this helper
verbatim — a hand-rolled `split(/(\[\d+\])/)` is not sufficient because the server embeds the URL
inside the token, not just the `[N]` marker:

```ts
type SummaryPart =
  | { kind: 'text'; text: string }
  | { kind: 'citation'; token: string; url: string };

function parseSummaryWithCitations(summary: string): SummaryPart[] {
  if (!summary) return [];
  const re = /\[\[(\d+)\]\]\(([^)]+)\)/g;
  const parts: SummaryPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(summary)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', text: summary.slice(last, m.index) });
    parts.push({ kind: 'citation', token: `[${m[1]}]`, url: m[2].trim() });
    last = re.lastIndex;
  }
  if (last < summary.length) parts.push({ kind: 'text', text: summary.slice(last) });
  return parts;
}
```

Render each `citation` part as a framework-native anchor element, using
`CitationTitleMapping[token]` for the visible label when available.

### Citation URLs on code sites

On Microsoft-shipped portal templates the `Citations` URLs point at the built-in Knowledge Base
page (`/knowledgebase/article/<articleNumber>`). On **code sites** the built-in KB page does
not exist, so the Search Summary service falls back to returning URLs of the form:

```
https://<host>/page-not-found/?id=<knowledgearticleid-guid>
```

The `id` query-string parameter is the actual `knowledgearticleid` GUID from Dataverse. SPAs that
surface knowledge articles typically route them at something like `/knowledge/:id`, so the
citation URL must be rewritten before it's rendered as a clickable link — otherwise every
citation lands on the built-in 404 page.

Drop-in helper for extracting the GUID so callers can reconstruct their own SPA route:

```ts
function extractKnowledgeArticleId(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const id = parsed.searchParams.get('id');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
  } catch {}
  return null;
}
```

Usage sketch:

```ts
const articleId = extractKnowledgeArticleId(citationUrl);
const href = articleId ? `/knowledge/${articleId}` : citationUrl;
```

Treat a successful `extractKnowledgeArticleId` match as authoritative — it means the server
returned a fallback page-not-found URL with the real GUID attached. A null result means the URL
is a regular site page and should be used verbatim.

### Empty response handling

When no content is indexed for the query, Search Summary returns a 200 with an empty `Summary`
(and typically empty `Citations`, or a non-empty `ErrorMessage` like "No results found"). The UI
must render an explicit empty state ("No related items found") rather than hiding the whole
section — hiding reads as a broken feature because the user sees their query disappear. Branch
the render on `Summary.trim().length === 0` (not just `!Summary`) to catch whitespace-only
responses.

---

## 2. Data Summarization API

Summarises a single Dataverse record (optionally with expanded related collections) using generative AI. Built on the Power Pages Web API, so all read-operation OData options apply (`$select`, `$expand`, `$filter` inside `$expand`, etc.). **Preview feature.**

| Method | URI |
|--------|-----|
| POST | `/_api/summarization/data/v1.0/<entitySetName>(<recordId>)?<odata-query>` |

**Request body (first request — use a maker-defined prompt):**

```json
{ "InstructionIdentifier": "Summarization/prompt/<table>_instruction_identifier_<usecase>" }
```

**Request body (follow-up — use a recommended prompt from a prior response):**

```json
{ "RecommendationConfig": "<hashed config string from prior response, verbatim>" }
```

- **Exactly one** of `InstructionIdentifier` and `RecommendationConfig` is set per call.
- `InstructionIdentifier` must match a site-setting name that exists — e.g. site setting `Summarization/prompt/case_summary` is identified as `"Summarization/prompt/case_summary"`.
- `RecommendationConfig` is an opaque hashed value that must be sent verbatim; any modification invalidates it.

**Response body:**

```json
{
  "Summary": "The data results provide information…",
  "Recommendations": [
    { "Text": "would you like to know about…?", "Config": "HSYmaicakjvIwTFYeCIjKOyC7nQ4RTSiDJ+/LBK56r4=" }
  ]
}
```

- `Recommendations` is always an array (may be empty). Feed a `Config` back as `RecommendationConfig` to get a refined summary.
- Respects row-level security: only records the user can read are considered.
- Inherits the `$expand` / nested-expand behaviour of the Power Pages Web API — each expanded related table needs its own Web API site settings and table permissions.

### Collection endpoint for list summaries

When the caller wants "N rows the user can see" (e.g., a list of recent work orders for the
signed-in contact) rather than one specific record, use the **collection** form of the URI — not
an account-anchored record form with nested `$expand`:

```
POST /_api/summarization/data/v1.0/<entitySetName>?$select=...
  &$expand=<NavProp>($select=...)
  &$orderby=<col> desc
  &$count=true
  [&$filter=...]
  [&$top=<n>]
```

The endpoint respects table permissions, so the user only sees rows the row-level security layer
already scopes for them — no explicit record id in the path is needed. Prefer this pattern over
the record form (`accounts(<id>)?$expand=cr363_account_workorder(...)`) for list/history/results
pages because it:

- Eliminates the otherwise-required `/_api/accounts?$top=1` lookup to resolve the anchor id.
- Keeps `$filter` / `$orderby` / `$top` at the root, where they're straightforward — nested
  `$filter;$top;$orderby` inside `$expand` on the record form is fragile.

Use the record form only when the caller genuinely needs a single named record. For
list/history/results pages, default to the collection form.

### Sizing

Prefer **omitting `$top`** for list summaries. The server caps input text via
`Summarization/Data/ContentSizeLimit` (default `100000` characters) and surfaces error
`90041004` when exceeded. Only set `$top` when you have an explicit UX reason (e.g., "top 10
highest-priority tickets"). A hardcoded `$top=25` is usually wrong — it silently caps the data
the user thinks they're summarising.

### Summary may be a JSON-encoded string array for list prompts

Prompts that instruct the model to emit "three insights" (the tabular-insight pattern — see
`agents/ai-webapi-settings-architect.md`) return `Summary` as a **JSON-encoded string array**,
not a paragraph:

```
"Summary": "[\"**Insight 1 heading** ...\",\"**Insight 2 heading** ...\",\"**Insight 3 heading** ...\"]"
```

The model follows the "three insights" contract and serialises the list as an array. Rendering
`{payload.Summary}` directly in the UI shows the raw brackets, escaped quotes, and Unicode
escapes (e.g. `\u0027`). Normalise in the shared `postSummary`-style helper in
`aiSummaryService.ts` so every caller gets the normalised shape:

```ts
function normalizeSummaryString(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return raw
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
      return parsed.join('\n\n')
    }
  } catch { /* fall through */ }
  return raw
}
```

Both paragraph and array shapes should continue to work — smoke-test both during rollout.

### Required site settings

| Name | Value | Type | Purpose |
|------|-------|------|---------|
| `Summarization/Data/Enable` | `true` | boolean | Master toggle for the data summarization API |
| `Summarization/prompt/<identifier>` | `<prompt text>` | string | One or more maker-defined prompts; the `<identifier>` portion is referenced by `InstructionIdentifier` |
| `Summarization/Data/ContentSizeLimit` | `100000` | integer | Optional. Input-content character cap (default `100000`). **When to raise:** only when a specific list-summary target hits error `90041004` consistently with realistic data volumes. Raise in increments of `50000`, not wholesale — higher limits cost more per call. For list-summary targets, `200000` is a safer default (~500 rows of narrow records). |
| `Webapi/<table>/enabled` | `true` | boolean | **Required** — the table being summarised must also have Web API enabled |
| `Webapi/<table>/fields` | `<validated columns>` | string | Columns the API can read; must include every column named in `$select`/`$expand` |

### Error codes (HTTP 400)

| Code | Message |
|------|---------|
| `90041001` | Generative AI features are disabled |
| `90041003` | Data summarization disabled for this site. Enable using the site setting. |
| `90041004` | Content length exceeds the limit |
| `90041005` | No records found to summarize |
| `90041006` | Error occurred while summarizing the content. |

### Empty response handling

Two distinct "empty" shapes can come back from this endpoint and the UI must handle both rather
than hiding the summary section:

1. **Error `90041005` ("No records found to summarize")** — a 400 whose error body contains the
   `90041005` code. Hits when the record exists but every column in `$select` (and every
   `$expand` collection that would contribute content) is empty. Render a calm "No summary
   available for this record yet" message in the summary slot.
2. **200 with empty `Summary` / empty `Recommendations`** — rarer, but possible when the model
   has nothing meaningful to return. Branch on `!response.Summary?.trim()`. Render the same
   empty-state message; keep the section visible so the user can tell the feature is working and
   simply has nothing to summarise yet.

Hiding the entire summary section on empty reads as a broken feature — users interpret the
missing surface as "the Copilot card never loaded". Always render **one of four** branches:
`loading`, `error`, `content`, `empty`. See the agent's Step 5 for the UI contract.

---

## 3. Case-page Copilot preset

The canonical implementation of the data-summarization API for the **incident** (case) table. Shipped by the Customer self-service and Community portal templates as a Copilot summary section on the support case page.

| Field | Value |
|-------|-------|
| Entity set | `incidents` |
| Record id | Case GUID (from `?id=` query string on the case page) |
| `$select` | `description,title` |
| `$expand` | `incident_adx_portalcomments($select=description)` |
| `InstructionIdentifier` | `Summarization/prompt/case_summary` |

**Request URL template:**

```
POST /_api/summarization/data/v1.0/incidents(<caseId>)?$select=description,title&$expand=incident_adx_portalcomments($select=description)
```

**Request body:**

```json
{ "InstructionIdentifier": "Summarization/prompt/case_summary" }
```

### Required site settings for the preset

| Setting description | Name | Value |
|---------------------|------|-------|
| Enable data summarization | `Summarization/Data/Enable` | `true` |
| Prompt for the case summary | `Summarization/prompt/case_summary` | `Summarize key details and critical information` |
| Enable Web API for incident | `Webapi/incident/enabled` | `true` |
| Allowed fields for incident | `Webapi/incident/fields` | `description,title` |
| Enable Web API for portal comments | `Webapi/adx_portalcomment/enabled` | `true` |
| Allowed fields for portal comments | `Webapi/adx_portalcomment/fields` | `description` |

> The `adx_portalcomment` table is expanded via `incident_adx_portalcomments($select=description)` — both tables need Web API site settings **and** table permissions with `read: true`.

### Empty response handling

The case preset trips `90041005` more often than the generic data endpoint because it expands
`incident_adx_portalcomments($select=description)` — a freshly-created case with no comments
and a blank `description` has literally nothing to summarise. Treat `90041005` here as a
first-class empty state, not an error: render "No case summary yet — add a description or a
comment and try again" in the summary card (keep the Copilot shell visible, including the
gradient border and header) rather than hiding the section or showing a generic error.

SKILL.md Phase 8's test recipe already tells the user to add at least one comment before
clicking the chevron — surface that same guidance in the empty-state text so testers know why
they're seeing it.

---

## CSRF token handling (all three APIs)

Every POST to these endpoints must include the portal anti-forgery token fetched from `/_layout/tokenhtml`. Use raw `fetch` — do **not** route through an OData wrapper that injects Dataverse-specific headers.

```ts
async function getCsrfToken(): Promise<string> {
  const res = await fetch('/_layout/tokenhtml');
  const html = await res.text();
  const match = html.match(/value="([^"]+)"/);
  if (!match) throw new Error('CSRF token not found');
  return match[1];
}
```

Send on every summarization request:

| Header | Search Summary | Data Summarization / Case preset |
|--------|----------------|----------------------------------|
| `Content-Type` | `application/x-www-form-urlencoded` | `application/json; charset=utf-8` |
| `Accept` | `application/json` | `application/json` |
| `__RequestVerificationToken` | CSRF token from `/_layout/tokenhtml` | CSRF token from `/_layout/tokenhtml` |
| `X-Requested-With` | `XMLHttpRequest` (recommended — matches `shell.ajaxSafePost`) | `XMLHttpRequest` (recommended — matches `shell.ajaxSafePost`) |
| `OData-MaxVersion` | — | `4.0` |
| `OData-Version` | — | `4.0` |

The CSRF token is explicitly required by the Data Summarization docs. Neither summarization page
documents `X-Requested-With`, but it's part of the `shell.ajaxSafePost` behaviour that Microsoft's
own case-page sample relies on — include it for consistency with stock Power Pages calls.

If a `getCsrfToken` helper already exists elsewhere in the site (for example from `/add-cloud-flow` or an earlier `/add-ai-webapi` run), **reuse it** — do not create a duplicate.

---

## Function-naming convention

| API | Service function | React hook |
|-----|------------------|------------|
| Search summary | `fetchSearchSummary(userQuery: string)` | `useSearchSummary()` |
| Data summarization (generic) | `fetchDataSummary(entitySetName: string, recordId: string, options?: DataSummaryOptions)` | `useDataSummary(entitySet, id, options?)` |
| Case preset | `fetchCaseSummary(caseId: string)` | `useCaseSummary(caseId)` |

`DataSummaryOptions` shape:

```ts
interface DataSummaryOptions {
  select?: string;       // $select — comma-separated root columns
  expand?: string;       // $expand — nav property(ies) with optional nested $select/$filter/$orderby
  filter?: string;       // $filter — rare on the root entity, but supported (all Web API read ops apply)
  orderby?: string;      // $orderby — same caveat
  instructionIdentifier?: string;  // Set ONE of these two:
  recommendationConfig?: string;   //   identifier on first call, config on follow-up
}
```

For other frameworks (Vue composable, Angular service, Astro util) follow the same name stems, with the framework's idiomatic wrapper.

---

## Docs quirks (as of the Microsoft Learn pages fetched 2026-04-17)

Three places in the upstream docs are confusing or typo'd. Don't get tripped up by them:

1. **Search-summary "Example: Request" block is jQuery syntax, not an HTTP body.** The Search
   Summary page shows:

   ```
   POST https://contoso.powerappsportals.com/_api/search/v1.0/summary
   {
           data: { userQuery: "Fix problems with slow coffee dispense" }
   }
   ```

   That block is not a literal JSON request body — it's jQuery-style parameters leaking into the
   "HTTP request" formatting. The authoritative shape is the JavaScript sample immediately below it,
   which uses `contentType: "application/x-www-form-urlencoded"` and `data: { userQuery: "..." }`.
   On the wire, the body is `userQuery=Fix+problems+with+slow+coffee+dispense`.

2. **`"Citations'"` with a stray apostrophe in the response sample.** The docs' sample response
   literally prints:

   ```
   "Citations'":{
                 "[1]": " https://contoso.powerappsportals.com /knowledgebase/article/KA-01055",
   }
   ```

   The apostrophe and the leading space inside the URL are typos. Real responses return the field
   as `Citations` (no apostrophe) and the URL values have no leading whitespace.

3. **`X-Requested-With: XMLHttpRequest` is not documented but matches stock behaviour.** Neither
   the Search Summary nor the Data Summarization pages list `X-Requested-With`. The Microsoft-shipped
   case-page Copilot snippet uses `shell.ajaxSafePost`, which injects it automatically. The skill
   sets it for consistency with every other Power Pages call; the post-Skill validator warns (but
   does not block) if it's missing.

## Instruction-identifier naming

Use the convention `Summarization/prompt/<table>_instruction_identifier_<usecase>` for maker-defined prompts (e.g. `Summarization/prompt/product_instruction_identifier_overview`, `Summarization/prompt/order_instruction_identifier_timeline`). The case-page preset uses the shorter canonical name `Summarization/prompt/case_summary` — keep it exactly as Microsoft ships it.
