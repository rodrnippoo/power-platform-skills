---
name: add-ai-webapi
description: >-
  Integrates Power Pages generative-AI summarization into a code site: the Search Summary API,
  the Data Summarization API, and the canonical Case-page Copilot preset. Orchestrates analysis,
  per-target service code with CSRF handling, and AI site-setting creation. Delegates Web API
  site settings, table permissions, and web roles to `/integrate-webapi` and `/create-webroles`.
  Use when the user wants to add AI summaries, Copilot summarization, search summary,
  case/incident summary, or wire the `/_api/summarization/data/v1.0/` or `/_api/search/v1.0/summary`
  endpoints into their site.
user-invocable: true
argument-hint: Optional description of which pages/tables need AI capabilities
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill, Task, TaskCreate, TaskUpdate, TaskList, mcp__plugin_power-pages_microsoft-learn__microsoft_docs_search, mcp__plugin_power-pages_microsoft-learn__microsoft_docs_fetch
model: opus
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

# Add AI Web API

Integrate Power Pages generative-AI summarization into a code site. This skill focuses on the AI layer (Layer 3): the summarization service code and the `Summarization/*` site settings. The underlying Web API prerequisites — `Webapi/<table>/enabled`, `Webapi/<table>/fields`, table permissions, and web roles — are **delegated** to `/integrate-webapi` and `/create-webroles` so there is a single source of truth for every layer.

## The three APIs covered

| # | API | URL | Body | Response |
|---|-----|-----|------|----------|
| 1 | **Search Summary** | `POST /_api/search/v1.0/summary` | `{ userQuery }` | `{ Summary, Citations }` |
| 2 | **Data Summarization** | `POST /_api/summarization/data/v1.0/<entitySet>(<id>)?$select=...&$expand=...` | `{ InstructionIdentifier }` or `{ RecommendationConfig }` | `{ Summary, Recommendations }` |
| 3 | **Case-page Copilot preset** | Specialisation of (2) for `incident` | `{ InstructionIdentifier: "Summarization/prompt/case_summary" }` with `$select=description,title` and `$expand=incident_adx_portalcomments($select=description)` | same as (2) |

> Reference: `${CLAUDE_PLUGIN_ROOT}/skills/add-ai-webapi/references/ai-api-reference.md` — canonical
> API shapes, required headers, site-setting names, and error codes. Read this at the start of the
> workflow; fetch the Microsoft Learn source pages with `mcp__plugin_power-pages_microsoft-learn__microsoft_docs_fetch`
> if the user asks for the latest.

> **Preview notice**: the Data Summarization API and the Case-page Copilot preset are both marked
> **preview** on Microsoft Learn. If the runtime returns error code `90041001` the tenant does not
> have generative AI features enabled — admins must turn them on at the environment level before
> any of this skill's output will work end-to-end. Search summary is also behind a preview
> workspace toggle (`Copilot → Site search (preview) → Enable Site search with generative AI
> (preview)`). Mention this explicitly to the user before Phase 7, and again in the Phase 8
> summary.

> **Built-in search control vs. custom code path**: if the site uses the Microsoft-shipped Power
> Pages search **control** and only wants AI-summarised search results on that page, they don't
> need this skill — just the Copilot workspace toggle and the `Search/Summary/Title` content
> snippet. This skill is for sites that build their own search UI or need to call
> `/_api/search/v1.0/summary` from custom code. Confirm which path the user is on in Phase 1.

## Core principles

- **Layer 3 only, delegate the rest.** Web API site settings, table permissions, and web roles all belong to `/integrate-webapi` and `/create-webroles`. This skill creates the summarization service code and the `Summarization/*` site settings — nothing else.
- **Sequential agent spawning.** Per `plugins/power-pages/AGENTS.md`, spawn the `ai-webapi-integration` agent sequentially per target (never in parallel). The first call establishes the shared summarization service file and CSRF helper; subsequent calls extend it. `ai-webapi-settings-architect` runs alone, after all code integrations land.
- **Raw `fetch` + CSRF.** Every summarization request attaches `__RequestVerificationToken` (from `/_layout/tokenhtml`) and `X-Requested-With: XMLHttpRequest`. Never route through an OData wrapper.
- **Skip `/integrate-webapi` when it's not needed.** If every confirmed target is Search Summary (which has no per-table Web API prerequisites), or every Layer 1/2 prerequisite already exists on disk, the skill goes straight from Phase 3 to Phase 5.
- **Use TaskCreate/TaskUpdate** — create the todo list upfront with all phases before starting.

> **Prerequisites:**
>
> - An existing Power Pages code site created via `/create-site`
> - A Dataverse data model (tables + columns) set up via `/setup-datamodel` or manually — for data
>   summarization and the case preset
> - The site must have been deployed at least once (`.powerpages-site` folder must exist) for the
>   settings phase

**Initial request:** $ARGUMENTS

---

## Workflow

(Phase headings below the workflow keep the technical "Layer 1+2 / Layer 3" names because they
describe the runtime layering and are what maintainers grep for. The titles here mirror the
user-facing task list.)

1. **Check site is ready** — locate project, detect framework, check data model, deployment status, and web-role presence.
2. **Find where AI summaries fit** — scan code for search / data / case-preset candidates.
3. **Confirm what to add** — review the manifest and pick which APIs / targets to integrate.
4. **Set up data access for AI** — invoke `/create-webroles` if needed, then invoke `/integrate-webapi` in AI-only read mode for data/case targets. Skip entirely for search-only or when prerequisites already exist.
5. **Add AI summary code** — invoke the `ai-webapi-integration` agent sequentially per target.
6. **Register AI prompts** — invoke the `ai-webapi-settings-architect` agent.
7. **Verify everything** — header-contract grep, `$select` grep, `npm run build`, validator script.
8. **Review and deploy** — record skill usage, summarise, offer `/deploy-site`.

---

## Iteration mode (after first run)

This skill is a **one-shot setup skill** — Phases 1–8 run end-to-end the first time the user asks
to integrate a summarization API. Once an AI surface is in place (service file, framework wrapper,
UI call site, and `Summarization/*` settings all exist), follow-up requests to tweak the rendered
UI (colours, spacing, copy, moving a button, a different empty-state message, wiring a second
recommendation into the hook, etc.) are **not** a reason to re-enter this skill mentally and run
every phase again. Doing so triggers a full `pac pages upload-code-site` and a chain of
`git commit`s for each tweak, which is exactly the noisy cadence the Phase 5.5 / 6.4 prompts above
are there to avoid.

When the user asks for follow-up UI changes to an already-integrated AI surface:

- **Edit the file(s) and run `npm run build`** locally to verify the tweak compiles. That is the
  whole validation loop for a UI change.
- **Do NOT automatically run `pac pages upload-code-site`.** Uploading should happen once, at the
  end of the session, when the user has finished tweaking.
- **Do NOT automatically `git commit`.** Let the user batch related tweaks into a single commit.
- **Batch the deployment and commit into a single end-of-session prompt** once the user signals
  they're done (or when you've completed the last requested change). Use `AskUserQuestion`:

  | Question | Header | Options |
  |----------|--------|---------|
  | All the UI tweaks look good. Deploy the site and commit the changes now? | Deploy & commit | Yes, deploy and commit (Recommended), Just commit — I'll deploy later, Just deploy — I'll commit later, Neither — I'll handle both myself |

Re-enter the full skill flow only when the user is adding a **new** AI surface (a new page, a new
table, a second API). If you're unsure whether a request is a tweak or a new surface, ask.

---

## Phase 1: Verify Site Exists

**Goal**: Locate the Power Pages project root and confirm prerequisites.

### 1.0 Detect iteration mode (before anything else)

Re-entry detection comes first because the rest of the skill assumes a first-time setup. Two
signals together indicate a prior `/add-ai-webapi` run:

1. A summarization service exists: `src/services/aiSummaryService.*` (or any source file under
   `src/` that contains `/_api/search/v1.0/summary` or `/_api/summarization/data/v1.0/`).
2. At least one Layer 3 site setting exists in
   `.powerpages-site/site-settings/Summarization-*.sitesetting.yml`, **or** the user is invoking
   for a search-only target where Layer 3 settings are intentionally absent and the service file
   alone is sufficient evidence.

If both signals are present, ask:

| Question | Header | Options |
|----------|--------|---------|
| It looks like an AI summary surface is already wired into this site. Is this request a tweak to the existing one, or are you adding a brand-new surface (new page, new table, second API)? | Mode | Tweak the existing surface (Recommended for visual/copy edits), Add a new surface (run the full skill again), Not sure — show me what's already wired |

- **Tweak the existing surface**: stop running this skill. Switch into the workflow described in
  the [Iteration mode](#iteration-mode-after-first-run) section above — Edit + `npm run build`,
  no auto upload-code-site, no auto commit, batched end-of-session prompt for deploy + commit.
- **Add a new surface**: continue with Phase 1.1 (full flow). The downstream phases will detect
  existing infrastructure (CSRF helper, summarization service, settings) and extend rather than
  duplicate.
- **Not sure — show me what's already wired**: list the existing service file(s), wired UI
  components, and `Summarization/*` settings, then re-ask the same question.

If only signal (1) is present (service file but no settings), treat it as an in-flight first
run (e.g., a previous attempt failed before Phase 6) and continue with the full flow.

### 1.1 Create todo list

Create all 8 phase tasks upfront via `TaskCreate` — see [Progress Tracking](#progress-tracking).

### 1.2 Locate project

Look for `powerpages.config.json` in the current directory or immediate subdirectories.

```powershell
Get-ChildItem -Path . -Filter "powerpages.config.json" -Recurse -Depth 1
```

**If not found**: tell the user to create a site first with `/create-site`.

### 1.3 Detect framework

Read `package.json` and detect React / Vue / Angular / Astro. See
`${CLAUDE_PLUGIN_ROOT}/references/framework-conventions.md`.

### 1.4 Check for data model

Look for `.datamodel-manifest.json`. If found, read it — tables listed here are candidates for the
data summarization API and the case preset (if an `incident` table is present).

### 1.5 Check deployment status — hard prerequisite

Look for `.powerpages-site`. Phase 4 (`/integrate-webapi`) and Phase 6 (`ai-webapi-settings-architect`)
both require this folder to exist. Deferring the deploy until later is **not** a viable workaround:
once Phase 5 has written the AI-calling service code, deploying a site whose Layer 1/2/3 settings
aren't yet on disk publishes runtime-broken code (every summarization call 403/500s until a second
deploy lands). The cleanest sequence is to deploy the **clean scaffold** now, before any AI code
exists.

**If `.powerpages-site` does NOT exist:**

| Question | Header | Options |
|----------|--------|---------|
| `.powerpages-site` was not found. The AI summary skill needs the site deployed at least once before configuring permissions and settings. Deploy the clean scaffold now (no AI code yet — keeps the intermediate state safe), or stop and run `/deploy-site` yourself first? | Bootstrap deploy | Yes, deploy the scaffold now (Recommended), Stop — I'll deploy first then re-run /add-ai-webapi |

On **Yes**: invoke the `Skill` tool for `power-pages:deploy-site` and wait for completion. Then
re-check `.powerpages-site` exists before proceeding.

On **Stop**: end the skill with a clear next-step message ("Run `/deploy-site`, then re-invoke
`/add-ai-webapi` to continue"). Do NOT continue to Phase 2 — the downstream sub-skills can't run.

### 1.6 Check web roles

Look for `.powerpages-site/web-roles/*.yml`. Record whether any roles exist — the Phase 4
delegation needs at least one role before `/integrate-webapi` can create table permissions.

**Output**: confirmed project root, framework, data-model availability, deployment status, web-role inventory.

---

## Phase 2: Explore AI integration points

**Goal**: Find every candidate for each of the three APIs — scoped to AI only.

Use the **Explore agent** (via `Task` with `subagent_type: "Explore"`) with thoroughness "medium":

> "Analyse this Power Pages code site for generative-AI summarization integration opportunities.
> Report the following as structured sections:
>
> **Search summary candidates.** Find any search page/component (filenames matching `Search*`, or
> components that call `/_api/search/v1.0/query`). Note the file path and whether it currently
> calls `/_api/search/v1.0/summary`. (Note: `*Results*` alone is ambiguous — a file named
> `SearchResults.tsx` is a search-summary target, but `WorkOrderResults.tsx` iterating a Dataverse
> collection is a list-summary target. Classify by what the component fetches, not just the name.)
>
> **Related-record discovery candidates.** Additionally, flag any detail page whose content would
> benefit from surfacing related records via Search Summary — e.g. "suggested KB articles" on a
> case/incident page, "similar cases" on a ticket page, "related products" on a product page. These
> are not necessarily named `Search*`; look for intent signals in component/page names and comments
> (`suggested`, `related`, `similar`, `recommended`, `KB`, `knowledge base`). Search Summary's
> grounded retrieval is often a better fit for this than a hand-rolled OData match because it
> returns AI-ranked citations from across the site's knowledge index. Report each as
> `<page> — recommended Search Summary candidate (related-record discovery)`.
>
> **Data summarization candidates.** For each Dataverse table in `.datamodel-manifest.json`, find
> components that display records from that table. Note the file path, the table logical name, the
> entity set name (plural), the lookup/expand relationships, and whether the component already
> calls `/_api/summarization/data/v1.0/`. Also flag any placeholder posts that already use
> `InstructionIdentifier` in a body like
> `{ "InstructionIdentifier": "Summarization/prompt/<table>_instruction_identifier_<usecase>" }` —
> these are explicit TODOs for this skill to implement.
>
> **Classify each data-summarization candidate as `single-record` or `list`** using:
>
> - `single-record` — filename contains `Detail`, `View`, or `Edit`; the component reads a record
>   id from the route (e.g. `useParams()`, `route.params.id`, `?id=<guid>` in the URL) and fetches
>   one record.
> - `list` — filename contains `List`, `History`, `Overview`, `Dashboard`, or the component
>   iterates a server-returned collection (maps over an array of records). Be cautious with
>   `Results` — a page that renders search hits is a search-summary target; a page that iterates a
>   Dataverse collection is a list-summary target. Classify by what the component actually fetches.
>
> This classification drives URL shape (record vs collection form), prompt pattern (narrative vs
> tabular-insight), and default `ContentSizeLimit` downstream. Include it as a column in the
> manifest below.
>
> **Also check for target-kind / user-intent mismatch.** If the filename heuristic says
> `single-record` but the user's verbal request implies a list (plural nouns — "cases",
> "orders"; scope qualifier — "all open", "my"; cross-record phrase — "for this customer's
> history"), OR vice versa, classify as `intent-mismatch` and flag for Phase 3 disambiguation.
> Do NOT silently pick one interpretation over the other — the target page kind and the user's
> ask can legitimately disagree (e.g., a CaseDetail page where the user wants a summary of the
> customer's other open cases, not this case).
>
> **For every data-summarization candidate (list OR single-record), also capture the existing
> fetch's OData query**: the exact `$select`, `$expand`, `$filter` (list only), and `$orderby`
> (list only) values the component already sends, plus any `Prefer` header. If the target page
> has **no** existing fetch (e.g., a Dashboard or landing page the user wants to decorate with a
> summary card), record `existing fetch: none`.
>
> **Classify the scope** for each candidate by comparing the user's verbal request
> (`$ARGUMENTS`) to the existing fetch. For list targets the scope dimension is `$filter` (which
> rows); for single-record targets the scope dimension is `$select`/`$expand` (which facets of
> the one record). Parse the request for scope qualifiers:
>
> - **List scope qualifiers:** `open`, `overdue`, `recent`, `active`, `pending`, `my`, `all`,
>   date ranges, named statuses.
> - **Single-record scope qualifiers:** "including its <related-table>", "with its <facet>",
>   "covering <aspect>" — signals the user wants the summary to include columns or expansions
>   beyond the existing record fetch. E.g., "summary including line items" on an order-detail
>   page where the existing fetch doesn't expand `cr363_Order_LineItems`.
>
> Classifications (applies to BOTH list and single-record):
>
> - `matches-existing-fetch` — the request is generic ("add a summary of this record",
>   "summarize this list"). Phase 5 uses the existing fetch's scope verbatim without asking.
> - `scope-extends-beyond-existing-fetch` — the request mentions columns / expansions / filters
>   not in the existing fetch. Phase 3 will ask a scope-confirmation question — do NOT invent
>   additions in the manifest.
> - `needs-definition` — the target page has no existing fetch at all. Phase 3 will ask.
> - `intent-mismatch` — the filename heuristic and user's verbal intent disagree on target kind
>   (e.g., filename says single-record but the request says "my open cases" = list). Phase 3
>   will ask a target-kind disambiguation question first.
>
> Record the classification plus any detected qualifier as extra fields on the manifest row
> (e.g., `existing fetch: $select=title,description; no $expand. User qualifier: "with its
> line items". Scope: scope-extends-beyond-existing-fetch`).
>
> **Case preset candidates.** Specifically check for an `incident` (or `adx_case`) table in the
> manifest and a case/incident detail page in the source (names containing `Case`, `Incident`,
> `Ticket`). If both exist, mark this as a high-priority recommendation.
>
> **Existing infrastructure.** Report (a) whether a CSRF helper already exists — grep for
> `_layout/tokenhtml` and `getCsrfToken` — and where it lives; (b) whether
> `src/shared/powerPagesApi.ts` exists (from a prior `/integrate-webapi` run); (c) whether
> `src/services/aiSummaryService.*` already exists from a prior run.
>
> **Layer 1/2 status.** For every data-summarization / case-preset target plus every `$expand`
> target, report a single status: does `Webapi/<table>/enabled` exist, does
> `Webapi/<table>/fields` exist, and does at least one table permission with `read: true` exist?
> Report per target as one of: `ready` (all three present), `missing` (any of the three absent).
> For Search Summary targets, report `n/a (search has no per-table prereqs)`.
>
> **Layer 3 status.** For every data-summarization / case-preset target, report whether
> `Summarization/Data/Enable` and the specific `Summarization/prompt/<id>` identifier the code
> will send exist in `.powerpages-site/site-settings/`. For Search Summary targets, report
> `n/a (search uses the Copilot workspace toggle, not a per-call site setting)` — do not flag
> them as `missing`, otherwise the skill will spuriously invoke `ai-webapi-settings-architect`
> for a search-only run."

From the Explore agent's output, compile the **integration manifest**:

| # | API | Target file | Target kind | Entity Set | `$select` / `$expand` | Layer 1/2 status | Layer 3 status |
|---|-----|-------------|-------------|-----------|----------------------|------------------|----------------|
| 1 | Search summary | `src/pages/SearchResults.tsx` | n/a | — | — | n/a (search needs no per-table prereqs) | n/a (search uses workspace toggle, no per-setting toggle) |
| 2 | Case preset | `src/pages/CaseDetail.tsx` | single-record | `incidents` | `$select=description,title&$expand=incident_adx_portalcomments($select=description)` | missing | missing (`Summarization/prompt/case_summary` not present) |
| 3 | Data summarization | `src/pages/ProductDetail.tsx` | single-record | `cr4fc_products` | `$select=cr4fc_name,cr4fc_description` | missing | missing (`Summarization/Data/Enable` + prompt identifier not present) |
| 4 | Data summarization | `src/pages/WorkOrderList.tsx` | list | `cr363_workorders` | `$select=cr363_name,cr363_status,cr363_priority&$orderby=createdon desc&$count=true` | missing | missing (`Summarization/Data/Enable` + prompt identifier not present; `Summarization/Data/ContentSizeLimit=200000` recommended) |

Compute the two delegation decisions directly from the two status columns:

- **Run `/integrate-webapi`?** → True if any row's Layer 1/2 status is `missing`.
- **Run `ai-webapi-settings-architect`?** → True if any row's Layer 3 status is `missing`.

**Output**: integration manifest + delegation decisions + existing-infra report.

---

## Phase 3: Review AI plan

**Goal**: Present the manifest and confirm which APIs / targets to integrate.

Show the user:

1. The list of APIs and targets found.
2. For each: which file references it and what the service will do.
3. The two delegation decisions from Phase 2 ("Will invoke `/integrate-webapi` for [tables]",
   "Will invoke `ai-webapi-settings-architect` for Layer 3").
4. Existing-infrastructure notes (CSRF helper reuse, `powerPagesApi.ts`, previous
   `aiSummaryService.*`).

### Approval cadence (set expectations up-front)

Before asking the integration question, briefly tell the user how many more decision points are
coming so the "one-shot" run isn't surprising. Count them from the [Key decision points](#key-decision-points-wait-for-user)
list, subtracting the ones that don't apply (e.g., search-only runs skip the Phase 6 architect
plan; if `/integrate-webapi` is being skipped per Phase 4.1, those approvals drop too). A typical
multi-target run pauses 5–7 more times after this one. Phrase it as a heads-up, not a warning —
e.g., "I'll pause for your input ~5 more times after this (web-role choice, two architect plans,
two commit prompts, final deploy)."

### The integration question

Use `AskUserQuestion` and **build the option list dynamically** from the Phase 2 manifest — do
not hardcode "Search summary, Data summarization, and the Case-page preset" when only one or two
categories actually have candidates. Construct the question text from what was found:

- If all three categories have candidates: "I found candidates for Search Summary, Data
  Summarization, and the Case-page preset. Which should I integrate?"
- If only two categories: "I found candidates for [category A] and [category B]. Which should I
  integrate?"
- If only one category with one target: skip "All of them" — just confirm the single target
  ("Wire Search Summary into `<page>`?").

The default option list, with rows present only when the corresponding category has candidates:

| Option | When to include |
|--------|-----------------|
| All of them (Recommended) | Two or more categories present |
| Only the Case-page preset | Case preset present AND another category present |
| Only Search Summary | Search candidates present AND another category present |
| Let me select specific ones | Always (multi-target runs) |
| None — cancel | Always |

If the user chooses "Let me select specific ones", follow up with a multi-select question listing
each row of the integration manifest. When a detail-page candidate was flagged in Phase 2 as a
related-record-discovery target, include it as a dedicated option (in addition to any data/case
option for the same page) so the user can consciously pick the AI-grounded path rather than a
hand-rolled OData match — e.g.:

- `Search Summary on CaseDetail.tsx (finds related KB articles via generative AI)`
- `Search Summary on ProductDetail.tsx (finds related products via generative AI)`

Label the option with the page name and the outcome it produces, not just "Search Summary", so the
user sees exactly where the AI surface will appear.

### Per-target follow-up: list summaries need an extra decision

For every confirmed target whose page renders a **collection** of records (filename matches
`*List*`, `*History*`, `*Results*`, or the target component iterates a server-returned array in
the UI), ask a follow-up question before moving to Phase 4. Single-record summary targets (case
detail, product detail, the case-page preset) skip this question.

| Question | Header | Options |
|----------|--------|---------|
| Should this list summary fire automatically when the page loads, or only when the user clicks a button? | Trigger | Auto on mount (Recommended when the list is short and the extra API call won't slow the page noticeably), Manual via button (Recommended when the list is large or filters change frequently) |

Both options produce the same hook/composable surface (`refresh`, `summariseWithRecommendation`)
— only the initial state of the wrapper differs. Record the choice per target and pass it to the
`ai-webapi-integration` agent in Phase 5 so it wires the correct initial trigger.

**Scope-confirmation follow-up (when Phase 2 flagged `scope-extends-beyond-existing-fetch`,
`needs-definition`, or `intent-mismatch`):** ask before Phase 5 so the summary reflects what
the user actually wants, not what the existing fetch happens to show. The question text and
options vary by target kind and classification.

**For LIST targets with `scope-extends-beyond-existing-fetch`** (user qualifier detected, existing fetch has a
different or no `$filter`):

| Question | Header | Options |
|----------|--------|---------|
| You asked for a summary of `<user qualifier>` `<entity>`. The existing list on this page currently shows `<existing scope description>`. Which scope should the summary cover? | Scope | Use my scope — `$filter=<filter derived from the verbal qualifier>` (Recommended), Mirror the existing list — `$filter=<existing $filter or "none">`, Let me write the OData `$filter`, Both — create two summary cards (advanced) |

**For LIST targets with `needs-definition`** (no existing list fetch on the target page):

| Question | Header | Options |
|----------|--------|---------|
| The target page has no existing list to mirror. Which rows should the summary cover? | Scope | Use my scope — `$filter=<filter derived from the verbal qualifier>` (Recommended), Summarise all `<entity>` rows the signed-in user can see (no filter beyond row-level security), Let me write the OData `$filter` |

**For SINGLE-RECORD targets with `scope-extends-beyond-existing-fetch`** (user mentions facets / related records not in the existing record fetch — e.g., "include its line items" when the fetch has no `$expand`):

| Question | Header | Options |
|----------|--------|---------|
| Your request mentions `<user qualifier>` — this isn't in the existing record fetch (which selects `<existing $select>`). Which facets should the summary include? | Facets | Include the mentioned facets — `$select=<baseline>,<added columns>`, `$expand=<added expansions with nav-prop casing>` (Recommended), Use the existing fetch's columns only (no additions), Use the canonical `<preset>` if applicable (e.g., case preset for `incident`), Let me write the `$select`/`$expand` |

Translate the qualifier to concrete columns / expansions using the datamodel manifest — e.g.,
"include its line items" on `cr363_order` with a related `cr363_orderlineitem` table via a
`cr363_Order_LineItems` navigation property maps to
`$expand=cr363_Order_LineItems($select=<lineitem primary name + amount>)`. Show the proposed
value inside the option. Any new `$expand` target becomes a new Phase 4 prerequisite (Web API
enabled + parent-scope permission on the child table).

**For any target with `intent-mismatch`** (filename says single-record but user ask implies list, or vice versa):

| Question | Header | Options |
|----------|--------|---------|
| The target page is `<filename>` (looks like `<filename-classification>`). Your request mentions `<user-verbal-qualifier>` — that sounds more like a `<other-classification>`. Which do you want? | Target kind | `<user-verbal-classification>` — <describe what the summary would cover> (Recommended — matches your ask), `<filename-classification>` — <describe the alternative>, Both — wire two summary cards on the same page |

The chosen scope flows into the Phase 5 agent-invocation prompt as the **Scope for the summary
call** field — not as an override of the existing fetch. The existing fetch on the target
component stays in place unchanged regardless of what scope the summary uses.

### Handling "None — cancel"

When the user picks `None — cancel`:

1. Mark the remaining tasks as `completed` with a `(skipped — cancelled by user)` suffix in the
   activeForm so the task list reads cleanly rather than leaving them stuck `pending`.
2. Jump straight to **Phase 8.1** (record skill usage with `--skillName "AddAiWebapi"` and an
   outcome of `cancelled`) and **Phase 8.2** (present a one-line summary: "No changes made — you
   cancelled at the plan-review step").
3. Skip Phases 4, 5, 6, 7, and 8.3 entirely. Do **not** invoke `/integrate-webapi`,
   `ai-webapi-integration`, `ai-webapi-settings-architect`, or `/deploy-site`. Do **not** commit.

**Output**: user-confirmed integration manifest, or a clean cancellation.

---

## Phase 4: Delegate Layer 1 + Layer 2

**Goal**: Ensure every Web API prerequisite for the AI target tables exists, by delegating to
`/create-webroles` and `/integrate-webapi` (AI-only read mode) instead of writing Layer 1/2 files
directly.

### 4.1 Skip-check

Skip this entire phase when **any** of the following is true:

- Every confirmed target is Search Summary (search has no per-table Web API prerequisites).
- The Phase 2 delegation decision said "Run `/integrate-webapi`? No" — all Layer 1/2 prerequisites
  are already on disk from prior runs.
- `.powerpages-site` does not exist (the sub-skills both require it).

In the skip case, proceed to Phase 5 and note this in the final summary.

### 4.2 Create missing web roles (if needed)

From Phase 1.6: if no web roles exist in `.powerpages-site/web-roles/`, or the roles that exist
don't match the site's auth model, ask the user:

| Question | Header | Options |
|----------|--------|---------|
| `/integrate-webapi` needs at least one web role to attach table permissions to. No matching role was found. Create one now via `/create-webroles`? | Web role | Yes, create via /create-webroles (Recommended), Skip — I'll handle roles separately |

On **Yes**: invoke the `Skill` tool for `power-pages:create-webroles` and wait for it to
complete. Then re-check `.powerpages-site/web-roles/` before proceeding to 4.3.

On **Skip**: this puts the run on a known-broken path — the AI endpoints will return 403 at
runtime until the user manually creates a web role + table permissions. Don't fall through
silently. Confirm the trade-off with a second `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Without a web role I can't set up table permissions, so the AI endpoints will return 403 at runtime until you configure them yourself. Stop here so you can run `/create-webroles` first, or continue to write the frontend code anyway and let me flag the gap in the final summary? | Continue? | Stop here (Recommended), Continue — write frontend code only and flag the gap in the summary |

On **Stop here**: end the skill cleanly. Tell the user to run `/create-webroles` (and optionally
`/integrate-webapi`) first, then re-invoke `/add-ai-webapi`.

On **Continue**: skip the rest of Phase 4 (the `/integrate-webapi` delegation needs a web role to
attach permissions to, so running 4.3 would fail) and jump to Phase 5. In the Phase 8 summary,
flag the Layer 1/2 gap loudly — list the exact files the user still needs to create
(`Webapi/<table>/enabled`, `Webapi/<table>/fields`, table permissions per target) so the path to
a working runtime is obvious from the final message.

### 4.3 Invoke `/integrate-webapi` in AI-only read mode

Build the sentinel arguments from the Phase 2 manifest:

- `primary=<primary table logical name>` (for data targets, the table whose record is being summarised; for case preset, `incident`)
- `tables=<primary plus every $expand target, comma-separated>`
- `expand-targets=<every $expand target, comma-separated; empty for pure data-summary targets with no $expand>`
- `caller=add-ai-webapi`

Invoke the `Skill` tool for `power-pages:integrate-webapi` with a single prompt:

> `[AI-READ-ONLY] mode=ai-read-only primary=<primary> tables=<list> expand-targets=<list> caller=add-ai-webapi`
>
> Configure Layer 1/2 (Web API site settings + table permissions) for the following Power Pages
> AI summarization targets: <table list>. This is a read-only integration — the `/_api/summarization/data/v1.0/`
> endpoint never mutates Dataverse. Return when all Web API site settings, table permissions, and the
> shared `powerPagesApi.ts` client are written to disk. Do not deploy — the parent skill batches the
> deployment at the end.

`/integrate-webapi` detects the `[AI-READ-ONLY]` sentinel (its Phase 1.6) and runs its full flow
with hardened prompts: read-only table permissions, minimal fields list (no PK, only `_<col>_value`
for lookups), and a read-only service layer. It still presents plan-mode approval prompts to the
user for each architect — this skill does not suppress those.

Wait for `/integrate-webapi` to complete. Re-check the file system:

- `src/shared/powerPagesApi.ts` exists
- For every target table: `Webapi/<table>/enabled` exists, `Webapi/<table>/fields` exists
- For every target table: at least one table permission with `read: true` exists; Parent-scope
  permission present for every `$expand` target

If any prerequisite is still missing, surface this to the user before moving on — something in the
delegated flow didn't land (for example, the user declined the architect's plan). Do NOT silently
fall back to writing Layer 1/2 files here.

**Output**: Layer 1/2 prerequisites are on disk; shared `powerPagesApi.ts` + read-only service
exists; web roles exist.

---

## Phase 5: Implement Layer 3 code

**Goal**: Create the AI summarization service and wire it into each target's UI.

### 5.1 Invoke the `ai-webapi-integration` agent — first target (sequential)

For the first target in the confirmed manifest, invoke the agent at
`${CLAUDE_PLUGIN_ROOT}/agents/ai-webapi-integration.md` via `Task`. The prompt below is a
**template** — replace every `[…]` block with the concrete value for the current target before
invoking. The agent does not interpret square-bracket placeholders; sending the literal text
`[search | data | case-preset]` will confuse it.

> "Integrate the **<API name>** for the Power Pages code site.
>
> - APIs to wire: <one of: `search`, `data`, `case-preset`>
> - Target file: <absolute or project-relative path to the page/component to wire>
> - Target kind: <one of: `single-record`, `list`, `n/a (search)`> — from the Phase 2 manifest.
>   `list` means use `fetchListSummary` + the collection-endpoint URL form (see agent §2.1);
>   `single-record` means use `fetchDataSummary` + the record-endpoint URL form.
> - Trigger mode (list targets only, from Phase 3 follow-up): <one of: `auto-on-mount`,
>   `manual-button`>. Set the wrapper's initial trigger accordingly. Omit for single-record
>   targets (always auto on a user action).
> - Framework: <React | Vue | Angular | Astro>
> - Project root: <absolute path>
> - If data/case-preset: table logical name `<logical_name>`, entity set `<entity_set_name>`,
>   `$select=<columns>`, `$expand=<NavProp($select=...)>` (omit for search), `InstructionIdentifier`
>   `Summarization/prompt/<identifier>`
> - For `list` targets — Scope for the summary call (resolved by the orchestrator from Phase 2 +
>   Phase 3; the agent uses these values verbatim and does NOT re-derive from the existing fetch):
>   - `$filter`: `<exact filter value to use on the summary URL, or "none">`
>   - `$orderby`: `<exact value, typically mirrors the existing fetch>`
>   - Scope source: `<one of: "mirror-existing-fetch" | "user-verbal-scope" | "user-custom-odata" | "no-filter" | "both" (dual summary)>`
>   - Target's existing list fetch (for reference, may be `none`): `<verbatim URL + any Prefer header>`
>     — the agent MUST leave this fetch in place unchanged; the summary is an ADDITION, not a
>     replacement.
>   - Regardless of scope source: the new summary URL must NOT include `$top` and must NOT set
>     `Prefer: odata.maxpagesize`. Those belong to the UI's paginated fetch only. Pagination is
>     UI behaviour; the server-side cap is `Summarization/Data/ContentSizeLimit`.
> - `$expand` navigation property casing (data/list targets with `$expand` only): each nav
>   property name verbatim as it appears in Dataverse metadata's
>   `ReferencedEntityNavigationPropertyName` — do not auto-lowercase. If unknown, the agent must
>   query `EntityDefinitions(LogicalName='<primary>')/ManyToOneRelationships` (or
>   `/OneToManyRelationships`) before building the URL. See agent §2.2.
> - Existing CSRF helper: <path + export name, or `none — define inline`>
> - Existing summarization service: <path, or `none — create new`>. If present, grep the file for
>   `normalizeSummaryString`, `postSummary`, `fetchListSummary`, `buildSummaryQuery` — reuse any
>   that already exist rather than redeclaring.
> - Placeholder POSTs to replace at this target (from Phase 2 Explore): <list each as
>   `path:line — body`, or write `none` if Phase 2 didn't flag any in this file>
>
> Create or extend the summarization service with raw `fetch`, both required headers, and the
> framework-idiomatic wrapper. Wire the call into the target file with loading/error/empty/
> recommendation handling. If a placeholder POST was flagged for this file, **replace it in
> place** rather than adding a second fetch. Do NOT create a second `getCsrfToken` if one already
> exists."

The first call is sequential because it establishes the shared summarization service file
(`src/services/aiSummaryService.*`) and the CSRF helper that subsequent targets reuse.

### 5.2 Verify service + CSRF helper exist

Before spawning more agents, verify:

- The summarization service file exists (default `src/services/aiSummaryService.ts`).
- `getCsrfToken` is defined once in the codebase (or imported from a pre-existing helper).

### 5.3 Invoke the agent for remaining targets — sequentially

Per `plugins/power-pages/AGENTS.md`, agent spawning is **sequential**. Invoke
`ai-webapi-integration` once per remaining target, waiting for each completion before starting the
next. Each target only adds an independent exported function, a framework wrapper (if not already
present), and wires one UI file — there are no merge conflicts, but the sequential rule keeps
failure modes simple.

If there is only one target total, skip 5.3.

### 5.4 Replace placeholder POSTs

For any placeholder `InstructionIdentifier` body the Explore agent flagged in Phase 2, the
sub-agent will have replaced them. Confirm by grepping for `InstructionIdentifier` in the affected
files and verifying each resolved call uses the real entity set and id.

### 5.5 Offer to commit

Don't commit automatically — on iterative runs an unprompted `git commit` here creates a noisy
series of commits for what is effectively one set of changes. Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Commit these Layer 3 integration changes now? | Commit | Yes, commit now (Recommended), Skip — I'll commit later |

On **Yes**:

```powershell
git add -A
git commit -m "Add AI summarization integration for [targets]"
```

On **Skip**: proceed without committing. The user will batch the commit themselves at the end.

**Output**: summarization service + framework wrappers + UI call sites created for every confirmed
target.

---

## Phase 6: Configure Layer 3 settings

**Goal**: Register the `Summarization/*` site settings via the `ai-webapi-settings-architect` agent.

### 6.1 Skip-check

Skip this phase when both of the following are true:

- Every confirmed target is Search Summary (search has no per-call `Summarization/*` site settings;
  see [ai-api-reference.md](references/ai-api-reference.md#1-search-summary-api)).
- No Data Summarization or Case preset target was added in Phase 3.

For search-only, remind the user to enable **Site search with generative AI (preview)** in the
site's Copilot workspace after deploy, and proceed to Phase 7.

### 6.2 Confirm deployment prerequisite still holds

Phase 1.5 already gated on `.powerpages-site` existing. Re-check it here as a guard — if it has
disappeared between Phase 1 and now (rare, but possible if the user manually cleaned the folder),
stop and re-run the Phase 1.5 bootstrap-deploy prompt. Do NOT silently fall through into the
architect with a missing folder.

### 6.3 Invoke `ai-webapi-settings-architect`

Invoke the agent at `${CLAUDE_PLUGIN_ROOT}/agents/ai-webapi-settings-architect.md` via `Task`:

> "Analyse this Power Pages code site and propose generative-AI summarization site settings.
> The following AI APIs were integrated in Phase 5: [data / case-preset list with per-target
> `InstructionIdentifier` values]. Check for existing `Summarization/*` settings. Layer 1
> (`Webapi/<table>/*`) and Layer 2 (table permissions) were configured in Phase 4 via
> `/integrate-webapi` in AI-only read mode — verify they are present on disk and cite them as
> met in your plan's prerequisite table. Propose the AI plan via plan mode, and on approval
> create the YAMLs with `create-site-setting.js`."

Wait for the agent to complete. If it reports missing Layer 1/2 prerequisites, something in
Phase 4 didn't land — read the file system, identify the gap, and surface it to the user rather
than attempting to create Layer 1/2 files here.

### 6.4 Offer to commit

Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Commit the new `Summarization/*` site settings? | Commit | Yes, commit now (Recommended), Skip — I'll commit later |

On **Yes**:

```powershell
git add -A
git commit -m "Add AI summarization site settings"
```

On **Skip**: proceed without committing.

**Output**: `Summarization/Data/Enable`, `Summarization/prompt/<id>` settings created.

---

## Phase 7: Verify

**Goal**: Confirm every expected file exists, all POSTs set both required headers, and the project
builds.

> **Preview-feature reminder** (per the Preview notice at the top of this skill): even after the
> build passes, the runtime needs a tenant admin to enable generative AI features (otherwise the
> first call returns `90041001`), and Search Summary additionally needs **Site search with
> generative AI (preview)** toggled on in the site's Copilot workspace. Surface both reminders
> here so the user isn't surprised after deploy if everything looks "configured" but the API
> still fails.

### 7.1 File inventory

For each confirmed target, confirm:

- **Service file**: `src/services/aiSummaryService.ts` (or project-convention equivalent) contains
  the expected exported function (`fetchSearchSummary`, `fetchDataSummary`, or `fetchCaseSummary`).
- **Framework wrapper** (non-Astro): React hook in `src/hooks/`, Vue composable in
  `src/composables/`, or Angular service in `src/app/services/`.
- **UI wiring**: at least one page/component imports the service or wrapper and calls it.
- **Shared API client** `src/shared/powerPagesApi.ts` exists when any data/case target was in scope.

### 7.2 Header contract grep

```
Grep: "_api/search/v1\\.0/summary|_api/summarization/data/v1\\.0/" in src/**/*.{ts,tsx,js,jsx,vue,astro}
```

For every file that matches, verify the surrounding fetch includes:

- `__RequestVerificationToken` (CSRF token, fetched from `/_layout/tokenhtml`)
- `X-Requested-With: XMLHttpRequest`

For data summarization calls, additionally verify:

- The URL contains `$select=` (no wildcards)
- `OData-MaxVersion: 4.0` and `OData-Version: 4.0` headers are set

If any file is missing a required header, fix it before proceeding — these are hard rules. Missing
CSRF produces 500s; missing `$select` produces 403s.

### 7.3 Build check

```powershell
cd "<PROJECT_ROOT>"
npm run build
```

Fix any type or import errors. Common issues: missing import of the summarization service in a
wired page; type mismatch between `DataSummaryResponse` and the UI consumer; duplicate
`getCsrfToken` declarations (if Phase 5 failed to reuse the existing helper).

### 7.4 Present verification results

| Target file | API | Service fn | Wrapper | UI call site | Headers ✓ | `$select` ✓ |
|-------------|-----|-----------|---------|--------------|-----------|-------------|
| `src/pages/SearchResults.tsx` | Search summary | `fetchSearchSummary` | `useSearchSummary` | Yes | Yes | n/a |
| `src/pages/CaseDetail.tsx` | Case preset | `fetchCaseSummary` | `useCaseSummary` | Yes | Yes | Yes |
| `src/pages/ProductDetail.tsx` | Data summarization | `fetchDataSummary` | `useProductSummary` | Yes | Yes | Yes |

(Same row order, same example file paths, and the same "Search summary / Case preset / Data
summarization" labels as the Phase 2 manifest example, so a maintainer reading both tables can
trace each row top-to-bottom.)

**Build status:** Pass / Fail (with details).

**Output**: all integration files verified; project builds.

---

## Phase 8: Review & Deploy

**Goal**: Record skill usage, present a summary, and offer deployment.

### 8.1 Record skill usage

> Reference: `${CLAUDE_PLUGIN_ROOT}/references/skill-tracking-reference.md`

Use `--skillName "AddAiWebapi"`.

### 8.2 Present summary

| Step | Status | Details |
|------|--------|---------|
| Web roles | Created via /create-webroles / Reused existing / Skipped | role name(s) |
| Layer 1/2 (Web API settings + permissions) | Created via /integrate-webapi / Reused existing / Skipped (search-only) | list of files written |
| Summarization service | Created / Extended | exported functions, file path |
| Framework wrappers | Created / Extended | hook/composable/service paths |
| UI call sites | Wired | list of files |
| Layer 3 (Summarization/* settings) | Created / Already existed / Skipped | `Summarization/Data/Enable`, one per prompt |

### 8.3 Ask to deploy

| Question | Header | Options |
|----------|--------|---------|
| Everything is ready. Deploy the site so the summarization APIs become live? | Deploy | Yes, deploy now (Recommended), No, I'll deploy later |

**Yes**: invoke `/deploy-site`.
**No**: acknowledge. Remind that the API calls will not work until the site is deployed with the
new settings and permissions.

### 8.4 Post-deploy notes

- **Site search with generative AI** (for the search summary): toggle
  **Copilot → Site search (preview) → "Enable Site search with generative AI (preview)"** in the
  Set up workspace.
- **Test recipe** (matches the Microsoft Learn case-page walkthrough):
  - **Case preset** — sign in as a user with the assigned web role, go to **My support**, create a
    new case with a filled-in description, **add at least one comment** (the preset's
    `$expand=incident_adx_portalcomments($select=description)` returns nothing for an empty
    comment collection, which trips error `90041005`), then click the chevron on the Copilot
    summary card. Confirm `/_api/summarization/data/v1.0/incidents(<id>)?...` returns 200 with a
    non-empty `Summary`.
  - **Data summarization** — open a record-detail page for the target table. Click the summary
    action. Confirm 200 in the network tab and the returned `Summary` renders. Click a
    recommendation chip and confirm the follow-up request sends `RecommendationConfig` (not
    `InstructionIdentifier`) and returns a refined summary.
  - **Search summary** — perform a search. Confirm `/_api/search/v1.0/summary` returns 200, the
    summary paragraph renders above the keyword results, the inline `[[N]](url)` markdown is
    rendered as framework-native anchors (not raw markdown text), and `[1]`, `[2]`, ... tokens
    are clickable links pointing at the **rewritten SPA route** (e.g. `/knowledge/<guid>`),
    **not** the raw `/page-not-found/?id=<guid>` URLs the API returns on a code site. If a
    citation is dropping the user on the built-in 404 page, the `extractKnowledgeArticleId`
    rewrite isn't wired — see the agent's Step 5 "Citation URL rewriting" section.
- **Error-code reference**: full table of `90041001`–`90041006` and what each means lives in
  [`references/ai-api-reference.md` §2 Error codes](references/ai-api-reference.md#error-codes-http-400).
  Open it when the user reports a 400. One runtime-specific note worth surfacing up front:
  **403 on a summarization call is always a Layer 1/2 issue** (column casing in
  `Webapi/<table>/fields`, or missing `read: true` table permission) — re-run `/integrate-webapi`
  in AI-only read mode to fix it rather than hand-editing YAML.
- **Column permission profiles can silently hide content.** If the summary has obvious omissions,
  check Dataverse column permission profiles on the web role before suspecting the prompt or
  fields list.

**Output**: summary presented, deployment completed or deferred, post-deploy guidance given.

---

## Important Notes

### Throughout all phases

- **Use TaskCreate/TaskUpdate** to track progress at every phase.
- **Ask for user confirmation** at key decision points (list below).
- **Sequential agent spawning** — per `plugins/power-pages/AGENTS.md:67`. Never spawn `ai-webapi-integration` in parallel across targets.
- **Commit at milestones** — after implementation (Phase 5) and after settings creation (Phase 6).
- **Never use an OData wrapper for summarization fetches** — raw `fetch` only.
- **Never write Layer 1/2 files directly** — always delegate to `/integrate-webapi` / `/create-webroles`. This skill is Layer 3.

### Key decision points (wait for user)

1. At Phase 1.5: bootstrap deploy or stop (if `.powerpages-site` missing).
2. After Phase 3: confirm which APIs / targets to integrate.
3. At Phase 4.2: create missing web role via `/create-webroles` (if needed).
4. At Phase 4.2 (Skip path): confirm continuing despite known broken-runtime risk.
5. Inside the Phase 4.3 `/integrate-webapi` delegation: approve its architect plans (sub-skill owns these prompts).
6. At Phase 5.5: commit the integration changes now or later.
7. Inside the Phase 6.3 `ai-webapi-settings-architect` call: approve its plan.
8. At Phase 6.4: commit the new settings now or later.
9. At Phase 8.3: deploy now or later.

### List-summary use case playbook

When the target is a LIST of records (not a single record), the defaults for a single-record
Copilot card (case preset style) are the wrong defaults. Apply every rule below:

1. **Use the collection endpoint** — `POST /_api/summarization/data/v1.0/<entitySet>?$select=...` —
   not the account-anchored `accounts(<id>)?$expand=<navprop>` form. Row-level security already
   scopes the collection; the extra `/_api/accounts?$top=1` lookup and fragile nested
   `$filter;$top;$orderby` inside `$expand` are both avoidable.
2. **Ask "auto-load or button?"** — per the Phase 3 follow-up above. Auto is usually right for
   short lists; button is safer when the collection is large or filters change often.
3. **Scope: mirror the existing list fetch — OR confirm with the user when the scope is
   ambiguous.** If the target page has an existing list fetch AND the user's request is
   generic ("add a summary to this list"), mirror `$filter`/`$orderby` from the existing fetch
   so the summary covers the same rows the user sees. `$select` / `$expand` can be supersets
   (add a lookup expand → name for AI context), but never drop columns the UI displays. **When
   the user's request contains a scope qualifier the existing fetch doesn't have** (e.g., "open
   invoices" when the page shows all), **OR the target page has no existing list fetch at all**
   (e.g., a Dashboard page), **do NOT guess the `$filter` — ASK the user** via a Phase 3 scope
   follow-up. Silently inventing an OData filter gives the user a summary they didn't ask for.
   Strip `$top` entirely, and do NOT carry over any `Prefer: odata.maxpagesize` header —
   pagination is UI behaviour, not summary scope. Let `Summarization/Data/ContentSizeLimit`
   govern the server-side cap.
4. **Use the tabular-insight prompt**, not a narrative prompt. The 3-insights / <=200-words /
   no-suggested-actions pattern produces much stronger output than "write a 4-sentence narrative".
5. **Include 1–2 domain-neutral few-shot examples** in the prompt (sales-by-region, software
   purchases). Avoid domain-matched examples — the model copies example figures instead of
   grounding on the user's data.
6. **Ship `normalizeSummaryString`** in the service layer. The tabular-insight prompt returns
   `Summary` as a JSON-encoded string array; rendering it raw shows `[\"...\"]` in the UI.
7. **Ship a tiny safe-markdown renderer** in the UI (React/Vue/Angular/Astro). Insights contain
   `**bold**` and `\n\n` separators; `{summary}` renders them as raw asterisks.
8. **Use YAML block-literal** (`value: |` with indented content) for any prompt > 200 chars or
   containing `:`, `|`, `` ` ``, `<|`, `> `, a colon-quote, or a newline. Plain-scalar YAML breaks
   `pac pages upload-code-site` silently for these.
9. **Verify `$expand` nav-property casing** against Dataverse metadata
   (`EntityDefinitions(LogicalName='<primary>')/ManyToOneRelationships` →
   `ReferencedEntityNavigationPropertyName`). The nav prop is PascalCase; the lookup column is
   lowercase. Mismatched casing returns 400.
10. **Set `Summarization/Data/ContentSizeLimit = 200000`** by default for list-summary targets —
    enough headroom for ~500 rows of narrow records. Bump only when real data hits error
    `90041004`.

### Progress tracking

Before starting Phase 1, create a task list with all phases using `TaskCreate`:

| Task subject | activeForm | Description |
|-------------|------------|-------------|
| Check site is ready | Checking site prerequisites | Locate project root, detect framework, check data model, deployment status, web-role inventory |
| Find where AI summaries fit | Scanning code for AI summary opportunities | Use Explore agent to find search/data/case candidates, existing infra, and delegation decisions |
| Confirm what to add | Confirming the AI summary plan | Present manifest and confirm which APIs and targets to integrate |
| Set up data access for AI | Setting up Web API access and permissions | Invoke /create-webroles if needed, then /integrate-webapi in AI-only read mode (or skip for search-only) |
| Add AI summary code | Adding AI summary code to your pages | Sequential ai-webapi-integration calls: first target creates shared service + CSRF helper, remaining targets extend it |
| Register AI prompts | Registering AI prompt settings | Invoke ai-webapi-settings-architect to create Summarization/* settings |
| Verify everything | Verifying file inventory, headers, and the build | Confirm service file, wrappers, UI wiring, header contract, run project build |
| Review and deploy | Reviewing summary and deploying | Record skill usage, present summary, offer /deploy-site, give post-deploy guidance |

Mark each task `in_progress` when starting and `completed` when done via `TaskUpdate`.

---

**Begin with Phase 1: Verify Site Exists**
