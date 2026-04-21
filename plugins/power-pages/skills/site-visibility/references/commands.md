# Site visibility commands

Per-command spec for the single command shipped with this skill. `SKILL.md` decides when to call it; this file is how to invoke it.

Cross-skill conventions (prerequisites, portal id resolution, JSON output, exit-code semantics, full shared error-code catalogue) live in `${CLAUDE_PLUGIN_ROOT}/references/admin-script-conventions.md`. Read that first if you have not already.

## Contents

- [Set site visibility](#set-site-visibility)
- [Errors this skill's command may surface](#errors-this-skills-command-may-surface)

## Set site visibility

Switch the site between Public and Private.

**Command**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/site-visibility/scripts/site-visibility.js" \
  --setVisibility \
  --portalId <guid> \
  --value <Public|Private> \
  [--dry-run]
```

**Read or write**: write. Supports `--dry-run`, which validates the arguments locally and prints the intended call on stdout without contacting the admin API. A successful `--dry-run` does NOT imply the real call would succeed — upstream state checks (authorization, developer / non-production gate) only run when `--dry-run` is absent.

**Parameters**

| Flag | Kind | Type | Required | Default | Validation |
|---|---|---|---|---|---|
| `--setVisibility` | mode selector | flag | yes | — | must be present (chooses this command's operation) |
| `--portalId` | path value | GUID string | yes | — | non-empty string; format is not deep-checked locally — malformed values come back as `A001` or `A010` from the service |
| `--value` | query value | enum string | yes | — | one of `Public`, `Private` (case-sensitive); the command rejects anything else before any network call |
| `--dry-run` | safety flag | flag | no | off | when present, validates the other flags locally, prints the intended call as JSON on stdout, and exits `0` without contacting the admin API |

**Response**

On success the command prints `{ "updated": true }` to stdout and exits `0`.

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Unknown or transport-level failure (after automatic retries). |
| `2` | Invalid or missing CLI arguments. |
| `3` | Portal not found (`A001`). |
| `4` | Caller not authorized to flip visibility (`A037`). |
| `5` | Tenant governance policy blocks non-production → Public (`A039`). |
| `6` | Developer site — cannot be made Public; no admin can override (`D005`). |

Skills branch on the exit code and fall back to parsing the stderr message only when the exit code is `1` (unknown). `node site-visibility.js --help` emits the same table.

**Errors this command can surface**

| Code on stderr | Condition |
|---|---|
| `A001` | Portal id not found — wrong id, or site deleted |
| `A010` | `--value` was not `Public` or `Private`, or a malformed portal id reached the service |
| `A037` | Caller is not authorized to flip visibility — change refused |
| `A039` | Trial or other non-production site blocked from Public by tenant governance — a tenant admin can adjust the governance policy to allow it |
| `D005` | Developer site — cannot be made Public; not overridable by any admin |

Transport-level failures (`HTTP 4xx` or `HTTP 5xx` without a catalogued code) are surfaced verbatim in the stderr message. Transient `401 / 429 / 5xx` classes are already retried internally — by the time the command exits non-zero for one of them, retry has already failed.

## Errors this skill's command may surface

Full condition descriptions and recovery guidance for every code above live in `${CLAUDE_PLUGIN_ROOT}/references/admin-script-conventions.md#shared-error-code-catalogue`. Do not duplicate them here — if a new code appears, add it to the shared catalogue and reference it from the table above.
