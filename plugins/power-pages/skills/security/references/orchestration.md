# Security review orchestration reference

Single consolidated reference for the `security` meta-skill — the OWASP category → sub-skill mapping, the full finding-type → delegation table, the findings JSON schema the HTML report consumes, and how `audit-permissions` integrates into the unified report.

## Contents

- [Grouping modes — how findings are organized](#grouping-modes--how-findings-are-organized)
- [OWASP Top 10 → sub-skill mapping](#owasp-top-10--sub-skill-mapping)
- [Full delegation table](#full-delegation-table)
- [Severity scheme](#severity-scheme)
- [Findings JSON schema](#findings-json-schema)
- [`audit-permissions` integration](#audit-permissions-integration)
- [Posture snapshot — what each read returns](#posture-snapshot--what-each-read-returns)
- [Bring-your-own checklist — how to scope](#bring-your-own-checklist--how-to-scope)

## Grouping modes — how findings are organized

The meta-skill supports five grouping modes; the user picks one in Phase 2. Grouping does not change which signals are collected — only how they are presented in the report.

| Grouping | `categories[].id` convention | When it fits | Reference section |
|---|---|---|---|
| **OWASP Top 10** | `A01`, `A02`, …, `A10` | Compliance conversations, audit framing, cross-team reviews | [OWASP Top 10 → sub-skill mapping](#owasp-top-10--sub-skill-mapping) |
| **By severity** | `critical`, `high`, `medium`, `passing` | Triage — "what should I fix first" | Uses the same [severity scheme](#severity-scheme); each severity is a bucket |
| **By sub-skill** | `site-visibility`, `web-application-firewall`, `security-headers`, `security-scan`, `code-analysis`, `audit-permissions`, `setup-auth`, `create-webroles` | Fix-path clarity — matches the [full delegation table](#full-delegation-table) |
| **Custom checklist** | Slug of each checklist item (e.g., `verify-csp-set`, `verify-waf-enabled`) | Internal standards, compliance-as-code, teams with their own hardening list | [Bring-your-own checklist](#bring-your-own-checklist--how-to-scope) |
| **Freeform / targeted** | Whatever labels fit the user's described scope | Narrow asks — "only headers and WAF" | None — use the most fitting sub-skill grouping inside the scope the user specified |

Whichever grouping is chosen, the severity scheme and the sub-skill source are still recorded on every finding. The report's executive summary always shows counts by severity regardless of grouping, so that information is never lost.

## OWASP Top 10 → sub-skill mapping

Each OWASP category can draw signals from multiple sub-skills. This table is the authoritative map the meta-skill uses to bucket findings.

| Category | Description | Signals from |
|---|---|---|
| **A01 Broken Access Control** | Resources / functions reachable without the right checks | `/site-visibility` (public site with no gating); `/audit-permissions` (overly-broad table-permission scope); `/create-webroles` (missing web roles that should gate pages); `/security-headers` (CORS that bypasses same-origin); `/code-analysis` (CWE-22 path traversal, CWE-284/285 improper authz) |
| **A02 Cryptographic Failures** | Data-in-transit or data-at-rest protections bypassed or misconfigured | `/security-headers` (HSTS is Power-Pages-managed — flag only if TLS is being disabled elsewhere); `/security-scan` deep scan (TLS misconfig, weak crypto detection) |
| **A03 Injection** | SQLi, XSS, command injection, expression-language injection, etc. | `/security-scan` deep scan (dynamic reflection / confirmed injections); `/code-analysis` with Semgrep or CodeQL (static dataflow findings tagged CWE-79, CWE-89, CWE-78, CWE-917, etc.) |
| **A04 Insecure Design** | Design-level weaknesses beyond mis-configuration | `/security-headers` (CORS `*` + credentials, overly-permissive CSP that defeats same-origin intent); `/site-visibility` (Private site without Entra-auth-required access list); `/audit-permissions` (design gaps the `table-permissions-architect` agent identifies) |
| **A05 Security Misconfiguration** | Missing hardening on well-known controls | `/security-headers` (missing `HTTP/Content-Security-Policy`, missing `HTTP/X-Frame-Options`, `--audit` reporting catalogued names under `missing`); `/web-application-firewall` (WAF disabled on a production site); `/security-scan` quick scan (Pass/Warning items for common misconfig patterns) |
| **A06 Vulnerable and Outdated Components** | Known CVEs in third-party dependencies | `/code-analysis` in CVE / SCA mode (Trivy) |
| **A07 Identification and Authentication Failures** | Missing or weak auth, session handling, credential protection | `/setup-auth` (login/logout, identity providers, anti-forgery tokens); `/code-analysis` (CWE-287, CWE-306, CWE-798 hardcoded credentials) |
| **A08 Software and Data Integrity Failures** | Unvalidated deserialization, code signing gaps, CI/CD integrity | `/code-analysis` (CWE-502 deserialization, CWE-494 untrusted code) |
| **A09 Security Logging and Monitoring Failures** | Insufficient visibility into what's happening | `/web-application-firewall` log capture setting (log capture disabled, retention too short); `/security-scan` (findings not being reviewed — flag if the latest completed report is stale relative to recent deploys) |
| **A10 Server-Side Request Forgery (SSRF)** | Server-side requests to attacker-controlled URLs | `/security-scan` deep scan; `/code-analysis` (CWE-918) |

Categories that rely on both dynamic AND static evidence (A03, A06, A08, A10) benefit most from running `/security-scan --deep` and `/code-analysis` early so their long-running scans complete before the report is finalized.

## Full delegation table

Every finding type and which sub-skill owns both the analysis AND the remediation. The meta-skill never reimplements these — it invokes them with per-change approval.

| Finding area | Read / analyze via | Remediate via | Notes |
|---|---|---|---|
| Site visibility (Public / Private) | `/site-visibility` (Phase 2 read) | `/site-visibility` | Public → Private and back only; admin-delegation group is separate admin tooling |
| HTTP security headers (CSP, CORS, SameSite, X-Frame-Options, etc.) | `/security-headers --audit` | `/security-headers --write` | CSP changes use plan-validate-execute; cloud-specific runtime host required |
| WAF enable / disable | `/web-application-firewall --status` | `/web-application-firewall --enable` or `--disable` | Async; poll status after kicking off |
| WAF rules (custom + managed-rule overrides) | `/web-application-firewall --rules` | `/web-application-firewall --create-rules` or `--delete-custom` | Plan file required; first-match-wins semantics matter |
| Dynamic vulnerability scan | `/security-scan --ongoing` / `--report` / `--score` | `/security-scan --deep` (to trigger a fresh scan) | Long-running; starts in background |
| Static-code vulnerabilities (SAST) | `/code-analysis` (Semgrep or CodeQL) | Code edits — the sub-skill produces findings; the user fixes the code | Long-running for CodeQL |
| Dependency CVEs (SCA) | `/code-analysis` (Trivy) | `package.json` / lock-file updates — out of sub-skill scope beyond reporting | Fast scan |
| Table permissions | `/audit-permissions` | `/audit-permissions` (which invokes the `table-permissions-architect` agent for fixes) | The `table-permissions-architect` agent is preserved as the fix path; this skill never bypasses it |
| Web roles | `/create-webroles` | `/create-webroles` | Creates role records + UI gating rules |
| Authentication / identity providers / anti-forgery | `/setup-auth` | `/setup-auth` | Configures OAuth / OIDC providers, login/logout, token handling |
| Deploy any Dataverse-bound change | — | `/deploy-site` | Site-settings YAML needs `/deploy-site` to reach Dataverse; visibility and WAF are admin-layer so they skip this |

## Severity scheme

The unified report uses a four-level scheme aligned with the existing `audit-permissions` report:

| Level | Meaning |
|---|---|
| **Critical** | Active exploit path exists, or sensitive data is exposed. Fix before any further deploy. |
| **High** | Significant weakness; a typical attacker could exploit it. Fix in the current sprint. |
| **Medium** | Weakness that raises attack surface or indicates risky design. Fix in the next cycle. |
| **Passing check** | Control is in place and working as intended. Surface in the report so users see what is NOT flagged — not everything is a problem. |

Severity assignment guidance:

- `/security-scan` deep-scan findings come with the scanner's own severity — map `error` to Critical, `warning` to High, `note` to Medium.
- `/code-analysis` tags (CWE, OWASP, `security-severity` number) feed into the same map — findings with `security-severity` ≥ 7 are Critical, 4 ≤ s < 7 are High, < 4 are Medium.
- `/audit-permissions` uses its own severity; preserve its output verbatim in the report.
- Configuration absences (e.g., no CSP at all, WAF disabled on production) are High by default; the user can re-rank if context warrants.

## Findings JSON schema

The `render-report.js` script consumes a single JSON file with this shape. Build it by aggregating the posture snapshot + individual sub-skill outputs.

```json
{
  "metadata": {
    "framework": "OWASP Top 10",
    "siteName": "<site name from website record>",
    "portalId": "<guid>",
    "generatedAt": "2026-04-22T00:00:00Z",
    "pendingScans": [
      { "type": "deep-security-scan", "pollCommand": "node scan.js --ongoing --portalId <guid>" }
    ]
  },
  "summary": {
    "totalFindings": N,
    "bySeverity": { "critical": N, "high": N, "medium": N, "passing": N },
    "byCategory": { "A01 Broken Access Control": N, "A02 Cryptographic Failures": N, ... }
  },
  "categories": [
    {
      "id": "A01",
      "name": "A01 Broken Access Control",
      "findings": [
        {
          "id": "site-vis-public-nogate",
          "title": "Public site with no web-role gating on <page>",
          "severity": "high",
          "source": "site-visibility + create-webroles",
          "evidence": "SiteVisibility=Public; page /admin reachable anonymously; no web role restricts access",
          "remediation": {
            "description": "Gate /admin behind a 'site-admin' web role, or switch visibility to Private",
            "delegateTo": "/create-webroles or /site-visibility",
            "appliedStatus": "open",
            "beforeValue": null,
            "afterValue": null
          }
        }
      ]
    }
  ],
  "permissionsAudit": {
    "reportPath": "docs/permissions-audit.html",
    "summary": {
      "critical": N,
      "warning": N,
      "info": N,
      "pass": N
    },
    "note": "Full evidence lives in docs/permissions-audit.html; this summary is included under A01 Broken Access Control with deep-link to the original."
  }
}
```

Key integrity rules for the JSON:
- `categories[].id` is the OWASP short id (`A01`, `A02`, …) when using OWASP; for BYO-checklist it's a stable slug of the checklist item.
- `remediation.appliedStatus` transitions `open → fixed | skipped | deferred` as Phase 6 proceeds.
- `remediation.beforeValue` / `afterValue` are populated only when Phase 6 actually applies a change.
- `permissionsAudit` is populated from the `audit-permissions` output; the report UI embeds its severity counts but links back to the original HTML for full evidence.

## `audit-permissions` integration

Per the plugin's established pattern, the meta-skill must integrate with — not duplicate — `audit-permissions`:

1. **Invoke `/audit-permissions`** during Phase 3 and wait for it to complete. Its output is the file at `docs/permissions-audit.html`.
2. **Parse** that output (or its intermediate JSON if captured) to extract the severity counts and top findings.
3. **Include** those findings under the unified report's A01 Broken Access Control category, with the severity counts surfaced in the summary and a prominent "Full evidence: docs/permissions-audit.html" link back.
4. **Do not** re-render the full permission-audit findings inline — the original report is the deep-dive; the unified report is the cross-category view.
5. **Preserve delegation** — remediation of a permission finding in Phase 6 invokes `/audit-permissions`, which in turn delegates fixes to the `table-permissions-architect` agent. The meta-skill does not write permission YAML directly.

## Posture snapshot — what each read returns

`scripts/posture-snapshot.js` runs these reads in parallel and aggregates them into a single JSON. Each row below is one field of the output.

| Field | Source command | Purpose |
|---|---|---|
| `website` | `scripts/lib/website.js --websiteRecordId <id>` | Site name, portal id, `SiteVisibility`, cloud, etc. |
| `waf.status` | `skills/web-application-firewall/scripts/waf.js --status` | WAF enabled / disabled, region availability, log capture |
| `waf.rules` | `skills/web-application-firewall/scripts/waf.js --rules` | Current custom + managed-rule overrides |
| `scan.ongoing` | `skills/security-scan/scripts/scan.js --ongoing` | Whether a deep scan is currently running |
| `scan.report` | `skills/security-scan/scripts/scan.js --report` | Latest completed deep-scan report (or `null` if none) |
| `scan.score` | `skills/security-scan/scripts/scan.js --score` | `{ totalRules, succeededRules }` from the latest completed scan |
| `headers.audit` | `skills/security-headers/scripts/security-headers.js --audit --projectRoot <root>` | Present / missing / forbidden HTTP/* site-settings |
| `languages` | `skills/code-analysis/scripts/detect-languages.js --projectRoot <root>` | Which CodeQL-supported languages are in the project |

The script fails open — if any individual read fails, its field is populated as `{ "error": "<message>" }` and the others still proceed. The meta-skill surfaces any failed reads in the report so the user sees what information is missing.

## Bring-your-own checklist — how to scope

When the user picks "bring-your-own checklist" in Phase 2, collect the checklist in one of two ways:

- **File pointer** — user names a path (`.md`, `.txt`, `.yml`); read the file and parse each line / bullet / YAML entry as one checklist item.
- **Inline paste** — user pastes the checklist into the conversation; treat each line as one item.

For each checklist item, in Phase 4:

1. Decide which sub-skill's output is the right evidence source.
2. Grade the item Critical / High / Medium / Passing based on what the sub-skill reports.
3. Add the item to the unified report under a custom `checklists` top-level category (parallel to `categories` in the findings JSON — `render-report.js` handles both shapes).
4. For remediation, delegate to whichever sub-skill owns the concern, same as OWASP mode.

If a checklist item has no matching sub-skill signal — e.g., "verify legal review was performed" — flag it as a manual-review item in the report and stop; the meta-skill does not pretend to cover non-automatable concerns.
