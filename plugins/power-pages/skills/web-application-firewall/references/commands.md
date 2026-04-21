# Web Application Firewall commands

Per-command spec for the six commands shipped with this skill. `SKILL.md` decides when to call them; this file is how to invoke each one and what each one expects.

## Contents

- [Shared exit codes](#shared-exit-codes)
- [Check WAF status](#check-waf-status)
- [List WAF rules](#list-waf-rules)
- [Enable WAF](#enable-waf) — async
- [Disable WAF](#disable-waf) — async
- [Create or update WAF rules](#create-or-update-waf-rules) — sync, body
- [Delete custom WAF rules by name](#delete-custom-waf-rules-by-name) — async, body
- [Body schema — custom rules](#body-schema--custom-rules)
- [Body schema — managed rules](#body-schema--managed-rules)
- [Body schema — names file for delete](#body-schema--names-file-for-delete)

## Shared exit codes

Every command in this skill uses the same exit-code space.

| Code | Meaning |
|---|---|
| `0` | Success. Parse stdout for the result. |
| `1` | Unknown or transport failure (after automatic retries). Includes `HTTP 401 / 403` for callers who lack the required role. |
| `2` | Invalid or missing CLI arguments, or invalid body file contents. |
| `3` | Portal not found (`A001`). |
| `4` | Edge infrastructure not provisioned for this site (`B001`). Not a self-service fix. |
| `5` | Another WAF enable/disable operation is already in progress (`B003`). Poll `--status` and retry once it settles. |
| `6` | WAF not available in this region (`B022`). Not a self-service fix. |
| `7` | Trial portal — WAF only supported on production sites (`B023`). User must convert to production. |

`node waf.js --help` prints the same table.

## Check WAF status

Returns the current WAF state for the site, or `null` when WAF is not applicable (trial portal or region-blocked).

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/web-application-firewall/scripts/waf.js" \
  --status \
  --portalId <guid>
```

**Read or write**: read.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--status` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty; format not deep-checked locally |

**Response**

On success, a JSON object describing the current state:

```json
{
  "status": "Enabled",
  "operationInProgress": false,
  "logCapture": true,
  "logRetentionDays": 30
}
```

Or `null` when WAF is not applicable to this site. The service also returns a plain-text (non-JSON) body in some region / trial 400 paths; the command detects that and normalizes to `null`.

**Errors**: `A001` (portal not found), `A010` (malformed portal id), other codes from the shared catalogue.

## List WAF rules

Returns the current rule configuration — custom rules and managed-rule overrides.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/web-application-firewall/scripts/waf.js" \
  --rules \
  --portalId <guid> \
  [--ruleType <Custom|Managed>]
```

**Read or write**: read.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--rules` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |
| `--ruleType` | query value | enum | no | (both) | one of `Custom`, `Managed` — filters the response; omit to return both |

**Response**

On success, a JSON object with two arrays — see body schemas below for each rule's shape:

```json
{
  "CustomRules": [ ... ],
  "ManagedRules": [ ... ]
}
```

Returns `null` when WAF is not applicable (same rule as `--status`).

**Errors**: same catalogue codes as `--status`.

## Enable WAF

Starts enabling WAF on the site. Returns immediately; provisioning continues server-side.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/web-application-firewall/scripts/waf.js" \
  --enable \
  --portalId <guid> \
  [--dry-run]
```

**Read or write**: write, async.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--enable` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |
| `--dry-run` | safety flag | flag | no | off | validates locally without contacting the service |

**Response**

On acceptance (`202`), a polling pointer:

```json
{
  "accepted": true,
  "operation_location": "https://...",
  "retry_after_seconds": 60
}
```

If another enable/disable operation is already in flight, the response instead is:

```json
{
  "accepted": false,
  "alreadyOngoing": true
}
```

**Errors**: `B001` (edge infrastructure missing), `B003` (concurrent op — surfaced as `alreadyOngoing`), `B022` (region), `B023` (trial).

## Disable WAF

Starts disabling WAF on the site. Same response and error model as `--enable`.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/web-application-firewall/scripts/waf.js" \
  --disable \
  --portalId <guid> \
  [--dry-run]
```

**Read or write**: write, async. See `--enable` for parameters, response, and errors.

## Create or update WAF rules

Submits a rule configuration. Custom rules carry a `name`, managed rules a `RuleSetType` + `RuleSetVersion`. Submit the full target collection in one call — partial bodies can have unpredictable effects on rules that are not mentioned.

To remove individual custom rules by name, use [`--delete-custom`](#delete-custom-waf-rules-by-name) instead — do not try to remove rules by omitting them from a `--create-rules` body.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/web-application-firewall/scripts/waf.js" \
  --create-rules \
  --portalId <guid> \
  --body <file> \
  [--dry-run]
```

**Read or write**: write, sync.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--create-rules` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |
| `--body` | body file | file path | yes | — | file must exist; contents must be valid JSON with `CustomRules` and/or `ManagedRules` top-level arrays; at least one non-empty; names and priorities unique across custom rules; rate-limit windows in 1–5 |
| `--dry-run` | safety flag | flag | no | off | runs the same local validation without contacting the service |

**Body shape (top level)**

```json
{
  "CustomRules": [ ... ],
  "ManagedRules": [ ... ]
}
```

At least one of the two arrays must be non-empty. See [custom rules schema](#body-schema--custom-rules) and [managed rules schema](#body-schema--managed-rules) for the per-rule structure.

**Response**

On `200 OK`, the applied rule set — same top-level shape as the body, echoing every rule as stored server-side.

**Errors**: `A010` (schema validation failure surfaced locally by the command, or rejected by the service), `B001`, `B022`, `B023`.

## Delete custom WAF rules by name

Removes the named custom rules. Returns immediately; deletion is asynchronous.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/web-application-firewall/scripts/waf.js" \
  --delete-custom \
  --portalId <guid> \
  --names <file> \
  [--dry-run]
```

**Read or write**: write, async.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--delete-custom` | mode selector | flag | yes | — | must be present |
| `--portalId` | path value | GUID string | yes | — | non-empty |
| `--names` | body file | file path | yes | — | file must exist; contents must be a non-empty JSON array of non-empty strings |
| `--dry-run` | safety flag | flag | no | off | validates the names file locally without contacting the service |

**Body shape**

See [names-file schema](#body-schema--names-file-for-delete).

**Response**

On acceptance (`202`), same shape as `--enable`:

```json
{
  "accepted": true,
  "operation_location": "https://...",
  "retry_after_seconds": 60
}
```

**Errors**: `B001`, `B022`, `B023`.

Unknown rule names in the input do not fail the call — they are silently ignored by the service (best-effort deletion).

## Body schema — custom rules

Each object in the `CustomRules` array:

| Field | Type | Required | Values / notes |
|---|---|---|---|
| `name` | string | yes | Unique identifier for the rule. Used as the key for updates and deletes. |
| `priority` | integer | yes | Evaluation order — lower values run first. Must be unique across the rule set. |
| `enabledState` | string | no | `Enabled` (default) or `Disabled`. A Disabled rule is retained but not evaluated. |
| `ruleType` | string | yes | `MatchRule` (single evaluation) or `RateLimitRule` (threshold over a window). |
| `action` | string | yes | `Allow` or `Block`. The API may accept `Log` and `Redirect`, but Power Pages WAF only documents Allow/Block — use only those. |
| `matchConditions` | array of condition objects | required for `MatchRule` | See match condition schema below. |
| `rateLimitThreshold` | integer | required for `RateLimitRule` | Request count above which the action fires. |
| `rateLimitDurationInMinutes` | integer | required for `RateLimitRule` | Window length in minutes — must be in `1..5`. |

**Match condition object**

| Field | Type | Required | Values / notes |
|---|---|---|---|
| `matchVariable` | string | yes | `RemoteAddr` (original client IP, honors `X-Forwarded-For`) or `SocketAddr` (direct edge-connection IP, e.g. a proxy). |
| `selector` | string | no | Typically empty for Power Pages WAF rules — the narrow Geo / IP / URI vocabulary does not require a sub-variable selector. |
| `operator` | string | yes | `Equal`, `IPMatch`, `GeoMatch`, `BeginsWith`, `EndsWith`, `Contains`, `LessThan`, `GreaterThan`, `RegEx`. |
| `negateCondition` | boolean | no | Default `false`. |
| `matchValues` | array of strings | yes | Values to test against. For `GeoMatch` use 2-letter country codes (`US`, `DE`, etc.); for `IPMatch` use IPs or CIDRs (`10.0.0.0/8`). |

### What Power Pages WAF actually supports

Even though the API accepts a broader schema, the Power Pages WAF surface documents a narrower subset:

- **Match variables**: Geo (via `GeoMatch`), IP (via `IPMatch`), URI (via `BeginsWith` / `Equal` / `Contains` / `RegEx`). No body, header, cookie, or query-string matching.
- **Actions**: `Allow`, `Block` only. Do not use `Log` or `Redirect` unless you have explicit confirmation they are supported — the public surface does not document them.
- **Rate-limit window**: 1 to 5 minutes only.
- **Priority**: first-match-wins. Once a rule matches, later rules are skipped. To express "allow US only, block the rest", you need two rules — an allow for US followed by a block-all with a higher priority number.

## Body schema — managed rules

Each object in the `ManagedRules` array:

| Field | Type | Required | Values / notes |
|---|---|---|---|
| `RuleSetType` | string | yes | Microsoft-managed rule-set family name. |
| `RuleSetVersion` | string | yes | Version of the rule set. Microsoft updates the set over time; version here is the baseline the site is tracking. |
| `RuleSetAction` | string | yes | `Block` — Power Pages WAF only documents Prevention mode. |
| `Exclusions` | array | no | Not used by the Power Pages UI; prefer `RuleGroupOverrides` for false-positive mitigation. |
| `RuleGroupOverrides` | array | no | Disable specific rules inside the set — see below. |

**Rule group override object**

| Field | Type | Required | Values / notes |
|---|---|---|---|
| `ruleGroupName` | string | yes | Group within the managed rule set. |
| `rules` | array of rule-override objects | yes | Individual rules to override. |

**Rule override object**

| Field | Type | Required | Values / notes |
|---|---|---|---|
| `ruleId` | string | yes | Managed rule id — read from `--rules` output to find a specific rule to disable. |
| `enabledState` | string | yes | `Enabled` or `Disabled`. `Disabled` is the standard false-positive mitigation. |
| `action` | string | no | Override the action for this rule specifically. |

There is no Detection / Audit-only mode for Power Pages WAF and no path-scoped exclusions. The only mitigation for a false-positive managed rule is `enabledState: Disabled` via an override.

## Body schema — names file for delete

The `--names` file for `--delete-custom` must be a non-empty JSON array of strings, each a `name` of an existing custom rule:

```json
["rule-to-delete-1", "rule-to-delete-2"]
```

Unknown names do not fail the call — the service silently skips them.
