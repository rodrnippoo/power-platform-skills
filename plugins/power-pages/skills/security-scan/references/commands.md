# Security scan commands

Per-command spec for the five commands shipped with this skill. `SKILL.md` decides when to call each; this file is how to invoke them.

## Contents

- [Shared exit codes](#shared-exit-codes)
- [Run a quick diagnostic scan](#run-a-quick-diagnostic-scan) — sync
- [Start a deep scan](#start-a-deep-scan) — async
- [Is a deep scan ongoing?](#is-a-deep-scan-ongoing)
- [Fetch the latest completed deep-scan report](#fetch-the-latest-completed-deep-scan-report)
- [Fetch the security score](#fetch-the-security-score)
- [Response shape — quick scan items](#response-shape--quick-scan-items)
- [Response shape — deep scan report](#response-shape--deep-scan-report)

## Shared exit codes

Every command uses the same exit-code space.

| Code | Meaning |
|---|---|
| `0` | Success. Parse stdout for the result. |
| `1` | Unknown or transport failure. Includes rate-limit exhaustion (daily / weekly scan cap), generic server errors (`A009`), and authorization failures (HTTP 401 / 403 for callers who lack the required role). |
| `2` | Invalid or missing CLI arguments. |
| `3` | Portal not found (`A001`). |
| `4` | A scan is already ongoing for this site (`Z003`). Distinct from exit 1 so the skill can branch — poll `--ongoing` until the in-flight scan settles, then retry. |
| `5` | Invalid input or site state (`A010`). Includes malformed arguments, bad LCID, and site-state refusals (trial / developer / non-production sites cannot be scanned; the service reports this the same way as a bad argument). Read the stderr message to distinguish. |

`node scan.js --help` prints the same table.

## Run a quick diagnostic scan

Runs a synchronous set of built-in diagnostic checks against the site. Returns an array of pass / warning / error items covering common configuration and security patterns.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security-scan/scripts/scan.js" \
  --quick \
  --portalId <guid> \
  [--lcid <integer>]
```

**Read or write**: read (no state change).

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--quick` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |
| `--lcid` | query value | integer | no | service default (omit the flag to use it) | Microsoft Locale ID; controls the language of the diagnostic messages. Bad LCID returns `A010`. |

**Response**

On success: JSON array, each item with:
```json
{
  "name": "<issue title>",
  "category": "<category name>",
  "result": "<Pass|Error|Warning|Information>",
  "description": "<detailed explanation>",
  "link": "<documentation URL>"
}
```

Items whose test was not run are not included.

**Errors**: `A001`, `A010` (bad LCID or invalid site state).

## Start a deep scan

Kicks off an asynchronous OWASP-based dynamic scan against the site's public surface. The service accepts the request immediately; the scan runs server-side for an extended period and the user is notified by email on completion.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security-scan/scripts/scan.js" \
  --deep \
  --portalId <guid> \
  [--dry-run]
```

**Read or write**: write, async.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--deep` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |
| `--dry-run` | safety flag | flag | no | off | validates locally, prints the intended call, does not contact the service |

**Authenticated scans are out of scope for this command.** The underlying service supports authenticated-page scanning (the scanner signs in as a user to test auth-gated pages), but this script does not accept credentials as CLI arguments — passing secrets via `argv` leaks them to shell history, process lists, and any tool that captures process arguments. Users who need authenticated-page coverage should run the scan from the Power Pages Studio interface, where credentials are collected via a UI form.

**Response**

On acceptance, the script emits the plugin's async-handoff shape:
```json
{
  "accepted": true,
  "operation_location": null,
  "retry_after_seconds": 60,
  "poll_command": "scan.js --ongoing --portalId <guid>"
}
```

`operation_location` is `null` because the service does not emit a service-side poll URL for deep-scan start. The caller polls via `poll_command` (the skill's `--ongoing` mode) after waiting at least `retry_after_seconds` seconds; the 60-second default matches the plugin-wide admin-API poll cadence and is declared as `DEEP_SCAN_DEFAULT_RETRY_AFTER_SECONDS` in `scan.js`.

If a scan is already running on the site, the same async-handoff fields are returned along with an `alreadyOngoing` flag so the caller can distinguish "just started" from "already in flight":
```json
{
  "accepted": false,
  "alreadyOngoing": true,
  "operation_location": null,
  "retry_after_seconds": 60,
  "poll_command": "scan.js --ongoing --portalId <guid>"
}
```

**Errors**: `A001`, `Z003` (already ongoing — surfaces as exit 4, distinct from transport failures), `A010` (trial / developer / non-production site state, or bad arguments).

## Is a deep scan ongoing?

Returns a boolean — whether a deep scan is currently running for the site.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security-scan/scripts/scan.js" \
  --ongoing \
  --portalId <guid>
```

**Read or write**: read.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--ongoing` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |

**Response**

```json
true
```

or

```json
false
```

**Errors**: `A001`, transport failures.

## Fetch the latest completed deep-scan report

Returns the structured report from the most recently completed deep scan.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security-scan/scripts/scan.js" \
  --report \
  --portalId <guid>
```

**Read or write**: read.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--report` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |

**Response**

On success: the report object — see [response shape — deep scan report](#response-shape--deep-scan-report).

If a scan is currently running, refuses with `Z003` → exit 4 (the running scan needs to finish first). If no deep scan has ever completed on this site, the service returns a server error → exit 1 (the site has no report to fetch — run `--deep` first).

**Errors**: `A001`, `Z003`, transport (no report exists yet).

## Fetch the security score

Returns the raw score pair from the latest completed deep scan.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/security-scan/scripts/scan.js" \
  --score \
  --portalId <guid>
```

**Read or write**: read.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--score` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |

**Response**

On success:
```json
{
  "totalRules": 42,
  "succeededRules": 38
}
```

`totalRules` is the count of rules evaluated by the most recent scan; `succeededRules` is how many passed. No percentage, letter grade, or composite score is computed by the service — the caller derives whatever representation they want.

Same refusal behavior as `--report` when a scan is in progress (`Z003`) or when no completed scan exists yet.

**Errors**: `A001`, `Z003`, transport.

## Response shape — quick scan items

Each element of the `--quick` response array:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Human-readable issue title. |
| `category` | string | Category classification (configuration, security, etc.). |
| `result` | enum string | One of `Pass`, `Error`, `Warning`, `Information`. |
| `description` | string | Detailed explanation of the finding. |
| `link` | string | Documentation URL for deeper context. |

Items whose test did not run are omitted from the array.

## Response shape — deep scan report

The `--report` response is a structured object:

| Field | Type | Notes |
|---|---|---|
| `totalRules` | integer | Number of security rules the scan evaluated. |
| `failedRules` | integer | Count of rules that reported one or more vulnerabilities. |
| `vulnerabilityCount` | integer | Total vulnerability findings across all failed rules. |
| `triggeredBy` | string | Username of the account that started the scan. |
| `startTime` | string | ISO 8601 timestamp when the scan started. |
| `endTime` | string | ISO 8601 timestamp when the scan finished. |
| `rules` | array | Grouped list — one entry per evaluated rule. |

Each entry in `rules`:

| Field | Type | Notes |
|---|---|---|
| `ruleId` | string | Identifier of the OWASP / ZAP rule. |
| `ruleName` | string | Human-readable rule name. |
| `status` | string | `Pass` or `Fail`. |
| `vulnerabilities` | array | Per-vulnerability detail (only populated when status is `Fail`). |

Each vulnerability:

| Field | Type | Notes |
|---|---|---|
| `severity` | string | Typically `High`, `Medium`, or `Low`. |
| `description` | string | What was detected. |
| `location` | string | URL or request path where it was detected. |
| `evidence` | string | The matched content / pattern that triggered the rule. |

The exact key names and shape follow what the service returns — if a field is absent for a given scan, treat it as unset rather than throwing.
