---
name: security
description: >-
  Orchestrates an end-to-end security review of a Power Pages site —
  assesses the current posture against whatever framework or grouping
  the user picks (OWASP Top 10, severity-ordered, by sub-skill, a
  bring-your-own checklist, or a freeform focus on specific areas);
  presents findings in a unified HTML report; and applies
  remediations with per-change user approval by delegating to the
  right sub-skill (site-visibility, web-application-firewall,
  security-headers, security-scan, code-analysis) or existing plugin
  skill (setup-auth, create-webroles, audit-permissions, deploy-site).
  Use when the user asks for a security review, security audit,
  security posture check, OWASP assessment, hardening sweep, or wants
  to see every security signal the plugin can surface — even if they
  do not name a specific framework. Out of scope: running any
  individual check in isolation (call the specific sub-skill
  directly), and compliance against frameworks other than OWASP
  (cloud / NIST / PCI / HIPAA compliance requires dedicated tooling
  outside this plugin).
user-invocable: true
argument-hint: "[optional: framework — owasp / checklist / freeform]"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate, TaskList, Agent
model: opus
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

# Security

Coordinate a security review of a Power Pages site. This skill does no scanning of its own — every finding comes from one of the specialized sub-skills or existing plugin skills, and every remediation delegates back to the skill that owns the concern. The meta-skill's value is the *framework-driven sequencing*, the *unified report*, and the *per-change approval loop* that makes hardening safe.

Every change is one sub-skill invocation behind explicit user approval — no batch application, no silent writes. The sub-skill that owns the change stays authoritative; this skill never reimplements anything they do.

## When to load which reference

- `references/orchestration.md` — load at the start of Phase 2 (framework selection) for the OWASP category → sub-skill mapping, the full finding-type → delegation table, and the JSON schema the HTML report consumes.

## Gotchas

- **Framework-driven, not tool-driven.** OWASP is a framework. `security-scan` (ZAP-based dynamic scan) is a tool that covers *a subset* of OWASP. Running ZAP alone is not an OWASP review. Known ZAP gaps include design-time intent (table-permission misuse) and network-level checks — cover those via `/audit-permissions` and the posture snapshot.
- **Delegate table-permission audits; do not reimplement them.** `/audit-permissions` already produces an HTML report at `docs/permissions-audit.html` with severity-grouped findings and delegates fixes to the `table-permissions-architect` agent. This skill INCLUDES those findings in the unified report and keeps a link back to the existing `permissions-audit.html` for deep-dive evidence. Do NOT parse permission YAML or re-query Dataverse from here.
- **Auth / role remediations go through their own skills.** When the review surfaces an auth issue, the fix invokes `/setup-auth`. Role-based access fixes invoke `/create-webroles`. These skills have their own approval flows — do not bypass them with direct Dataverse writes.
- **Long-running sub-skills do NOT block.** `/security-scan --deep` and `/code-analysis` SAST scans run in the background. If the user wants them included in the review, start them early (Phase 3 or 4) and let them run while the rest of the review proceeds. The HTML report shows partial results immediately; deeper findings append when the scans complete.
- **Bypass option for long-running scans is explicitly labeled "not recommended".** If the user wants to skip deep-scan or static code analysis for a review, surface the trade-off: "Bypassing means the review may miss OWASP A03 (injection), A10 (SSRF), and similar dataflow-derived findings." Accept the bypass if they confirm, and note it in the report.
- **Cross-cloud runtime sources.** When proposing CSP remediations in Phase 6, remember `/security-headers` needs the cloud-specific `content.powerapps.*` host — never propose a remediation that lists all four clouds' hosts together. Delegate to `/security-headers` which handles this.
- **Per-change approval is mandatory.** Phase 6 pauses with `AskUserQuestion` before every remediation. The user can accept, skip, or defer each finding individually — never batch-approve.

## Workflow

Copy this checklist into your first response and check items off as each phase completes:

```
Progress:
- [ ] Phase 1: Check prerequisites and resolve portal id
- [ ] Phase 2: Align on the security framework
- [ ] Phase 3: Discover current posture
- [ ] Phase 4: Audit and analyze
- [ ] Phase 5: Present findings in a unified HTML report
- [ ] Phase 6: Harden (per-change approval, delegated remediations)
- [ ] Phase 7: Post-hardening close-out
```

At the start of Phase 1, create one task per phase with `TaskCreate`. Mark `in_progress` when you enter a phase, `completed` the moment it ends.

### Phase 1 — Prerequisites and portal id resolution

1. Confirm the working directory is a Power Pages code site — `.powerpages-site/website.yml` must exist. If missing, tell the user to run `/deploy-site` first and stop.
2. Read the `id` field from `.powerpages-site/website.yml` — this is the website record id.
3. Resolve the portal id once, and keep it for every sub-skill read in Phase 3 onward:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/website.js" --websiteRecordId <id-from-step-2>
   ```
   The `id` field on the returned record is the portal id.
4. Failure modes (consistent with the other skills):
   - Non-zero exit with a prerequisite message → surface verbatim, stop. Do not install or re-authenticate on the user's behalf.
   - Exit 0 with `null` → site not deployed OR PAC profile pointed at the wrong environment. Ask which applies before recovering.

### Phase 2 — Align on the review scope and grouping

Use `AskUserQuestion`. Do NOT pre-select an option — let the user pick based on their context. The grouping choice shapes how Phase 4 buckets findings and how Phase 5 structures the report.

Common choices, each optimized for a different use case:

1. **OWASP Top 10** — findings bucketed into A01–A10. Familiar framing for posture reviews and compliance discussions. See the category → sub-skill mapping in `references/orchestration.md`.
2. **By severity** — flat list ordered Critical → High → Medium → Passing. Fastest path to "what should I fix first".
3. **By sub-skill** — grouped by which sub-skill surfaced the finding (site-visibility, WAF, headers, scan, permissions, code-analysis). Maps most directly to the Phase 6 fix path.
4. **Custom checklist** — user points at a file (`.md`, `.txt`, `.yml`) in the working directory, or pastes a checklist inline. Findings match against each checklist item.
5. **Freeform / targeted** — user describes what they want checked (e.g. "only the CSP and WAF rules"). Scope the review to exactly that area.

If the user isn't sure which to pick, briefly surface the trade-off (OWASP for compliance conversations; severity for triage; sub-skill for fix-path clarity; checklist for internal standards) and ask again. Don't push them toward OWASP by default — a security review should fit their question, not impose an abstraction.

Record the chosen grouping — Phase 4 buckets findings accordingly and Phase 5 renders the report using the chosen scheme.

### Phase 3 — Discover current posture

Run the posture snapshot — a bundled script that issues the read commands from every sub-skill in parallel:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security/scripts/posture-snapshot.js" \
  --portalId <guid> \
  --projectRoot "<project-root>"
```

The output is a single JSON blob with:
- Visibility state + admin-delegation group id (from `website.js`)
- WAF status + current rules (from `waf.js --status` / `--rules`)
- Deep-scan state + latest report summary + score (from `scan.js --ongoing` / `--report` / `--score`)
- HTTP/* site-settings audit (from `security-headers.js --audit`)
- Detected project languages (from `detect-languages.js`)

Also invoke the existing table-permissions flow in parallel:
```
/audit-permissions
```
This produces `docs/permissions-audit.html`. Wait for that skill to complete before Phase 4 — its findings are load-bearing for the unified report.

**Do NOT kick off a deep dynamic scan (`/security-scan --deep`) or a SAST scan (`/code-analysis`) here unconditionally.** Ask in Phase 2 whether to include them (long-running), and if yes, start them NOW so they run in the background while Phase 4–5 proceed. Completion will be surfaced by the registered hooks; pick up results when they arrive.

### Phase 4 — Audit and analyze

For each signal gathered in Phase 3, classify it as Critical / High / Medium or Passing check per the severity scheme in `references/orchestration.md`. Then bucket findings according to whichever grouping the user picked in Phase 2:

- **OWASP Top 10** — use the category → sub-skill mapping in `references/orchestration.md`. Each finding falls into A01–A10 based on the signal's source and nature.
- **By severity** — no per-category bucketing; sort findings by severity (Critical → High → Medium) and group the passing checks at the end.
- **By sub-skill** — bucket by source (site-visibility / WAF / headers / scan / permissions / code-analysis). Maps findings to the skill that owns the fix.
- **Custom checklist** — decide which checklist item each signal fulfills or violates. Each checklist item becomes a bucket; findings land in the matching bucket with their severity and evidence.
- **Freeform / targeted** — restrict the review to the areas the user described; drop other signals from the report. Within the scope, group by whichever sub-structure fits (usually by sub-skill).

Severity assignment and source-skill identification apply regardless of grouping. The findings JSON schema in `references/orchestration.md` supports arbitrary category IDs — `categories[].id` is `A01` for OWASP, a slug for checklist items, the sub-skill name for by-sub-skill grouping, `critical` / `high` / `medium` for by-severity grouping, or a custom label for freeform.

### Phase 5 — Present findings in a unified HTML report

Build a findings JSON that matches the schema in `references/orchestration.md`, then render:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security/scripts/render-report.js" \
  --findings <findings.json> \
  --output docs/security-review.html
```

The report includes, in this order:
- Executive summary (counts by severity + by OWASP category)
- Framework used, timestamp, portal id + site name
- Per-category finding list, each finding showing: description, evidence (what was checked and what was seen), severity, source sub-skill, suggested remediation, and status (open / fixed / deferred).
- **Table-permissions section that INCLUDES the findings from `/audit-permissions`** re-rendered under the unified severity scheme, with a prominent "Full evidence: docs/permissions-audit.html" link back to the original report. Do NOT duplicate the `permissions-audit.html` doc — link to it.
- Pending long-running results banner: if a deep scan or SAST is still running, the report carries a "Additional findings pending from <scan-type>" notice with the polling command.

Open the report in the browser (or tell the user the path) and pause here for review before any remediation.

### Phase 6 — Harden (per-change approval, delegated remediations)

For each open finding the user wants to address, delegate to the owning sub-skill. Use `AskUserQuestion` per finding — accept / skip / defer. Never batch approvals.

Delegation map (full version in `references/orchestration.md`):

| Finding area | Delegate to | What that skill does |
|---|---|---|
| Authentication / identity provider / anti-forgery token | `/setup-auth` | Configures identity providers, login/logout, token handling |
| Web-role / role-based access | `/create-webroles` | Defines and assigns web roles |
| Table permissions | `/audit-permissions` | Runs `table-permissions-architect` agent for fixes |
| CSP / CORS / SameSite / other HTTP headers | `/security-headers` | Writes `HTTP/<Header>` site-setting YAML |
| WAF enable/disable/rules | `/web-application-firewall` | Admin-layer WAF changes |
| Visibility (Public/Private) | `/site-visibility` | Admin-layer visibility flip |
| Dynamic scan (verification after hardening) | `/security-scan` | Quick sync scan or deep async scan |
| Static-code finding (dependency CVE, SAST) | `/code-analysis` | Framework-driven SAST / SCA / IaC |
| Deploy any Dataverse-bound change | `/deploy-site` | Push the YAML / site-setting changes |

After each successful remediation, update the `status` field in the findings JSON and re-render the HTML report so the "fixed" markers appear. Capture before / after state on anything that touched Dataverse — the report's `remediation` block shows both.

### Phase 7 — Post-hardening close-out

1. If the user applied any remediation, offer to re-run the relevant sub-skill's read command to verify the change stuck (e.g., re-read `--status` after a WAF enable; re-audit site-settings after a header change).
2. For long-running scans that completed during the session, incorporate their findings — re-render the report with the updated JSON so the final artifact is complete.
3. Clean up transient working files at the project root (findings JSON drafts, plan files produced by sub-skills) unless the user wants to keep them. The unified HTML report itself is a deliverable — leave it in place at `docs/security-review.html`.
4. Summarize for the user:
   - Total findings → how many fixed / deferred / skipped.
   - Per-category counts post-hardening.
   - Any bypassed checks (deep scan, SAST) and the command the user can run later to complete them.

> Reference: `${CLAUDE_PLUGIN_ROOT}/references/skill-tracking-reference.md`

Follow the skill-tracking instructions in the reference to record this skill's usage. Use `--skillName "Security"`.

Close by asking: "Anything else on the security review, or done?"

## Progress tracking table

Keep this table in your final response, filling each status as phases complete:

| Phase | Status |
|---|---|
| 1. Prerequisites and portal id resolution | ☐ |
| 2. Align on framework | ☐ |
| 3. Discover current posture | ☐ |
| 4. Audit and analyze | ☐ |
| 5. Present findings in unified report | ☐ |
| 6. Harden (per-change approval) | ☐ |
| 7. Post-hardening close-out | ☐ |
