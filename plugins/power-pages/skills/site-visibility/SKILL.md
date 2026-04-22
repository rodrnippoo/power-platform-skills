---
name: site-visibility
description: >-
  Flips a Power Pages site between Public and Private. Use when the user
  mentions site visibility, making a site internal-only, publishing a
  site to the internet, or diagnosing why a visibility flip was refused
  — even if they do not use the exact phrase "site visibility". Out of
  scope: who can sign in to a Private site (that per-site allow-list is
  managed outside this skill), anonymous-access DLP, IP allow-lists,
  and governance policies — those belong to other skills or admin
  tooling and must not route here.
user-invocable: true
argument-hint: "[optional: Public or Private]"
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: opus
---

> **Plugin check**: Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-version.js"` — if it outputs a message, show it to the user before proceeding.

# Site Visibility

Flip a Power Pages site between Public and Private. The apply is one command call behind a user approval — no batch, no silent changes. Deploy mechanics are owned by `/deploy-site`; here, the apply is the command call itself.

Who can sign in to a Private site is a separate per-site allow-list managed from the Power Pages Studio interface — this skill does not touch it. If the user asks how to restrict Private-site viewers, point them at that interface.

## When to load which reference

- `references/commands.md` — when building the `--setVisibility` command line, and when deciding how to react to an error code on stderr.
- `${CLAUDE_PLUGIN_ROOT}/references/admin-script-conventions.md` — when the user asks why the portal id differs from what they see in `pac pages list`, or when diagnosing prerequisite or auth failures.

## Gotchas

- `pac pages list` and `.powerpages-site/website.yml` store the **website record id**, not the portal id. Every command in this skill takes the portal id. Resolve by running `website.js --websiteRecordId <guid>` first; passing the record id produces `A001` (portal not found).
- Never resolve the site by name. Site names can duplicate inside a single environment, so a name-based lookup can silently target the wrong site. Only `--websiteRecordId` is safe.
- A `null` from the resolver is not a dead-end — it means either the site has not been deployed, or the PAC auth profile is pointing at a different environment than the one that owns the site. Ask the user which applies before recovering.
- Flipping visibility restarts the site. Expect up to a few minutes of propagation delay before the new state is reflected in the website record — do not treat an immediate "unchanged" read as a failure.
- A Private site depends on Entra authentication being enabled. If the user plans to disable Entra auth on the site, flip to Public first — otherwise sign-in breaks on the Private site.
- Developer sites cannot be made Public — `D005` is an absolute block. **Even a tenant admin cannot override it.** Stop and tell the user the only path is a site in a non-developer environment.
- Trial and other non-production sites can be blocked from Public by tenant governance policy — `A039` is conditional, not absolute. A tenant admin can adjust the governance policy to allow the flip. If the caller is not a tenant admin, surface the message and stop.
- `A037` means the caller is not authorized to flip visibility. Ask a tenant admin to perform the flip.
- Non-production lock-in: once a non-production site is flipped to Private, the tenant governance policy may prevent flipping back to Public. Warn the user before the Public → Private flip if the site is non-production.

## Workflow

At the start of Phase 1, create one task per phase with `TaskCreate`. Mark `in_progress` when you enter a phase and `completed` the moment it ends — do not batch updates. The final response carries a progress tracking table (see the end of this file) so the user can see at-a-glance what each phase produced.

### Phase 1 — Prerequisites and portal id resolution

1. Confirm the working directory is a Power Pages code site by locating `.powerpages-site/website.yml`. If it is missing, tell the user to run `/deploy-site` first and stop.
2. Read the `id` field from `.powerpages-site/website.yml`. That value is the **website record id**.
3. Resolve the portal id (only by `websiteRecordId` — not by name, since names can duplicate):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/lib/website.js" --websiteRecordId <id-from-step-2>
   ```
   Parse the returned JSON. The `id` field is the portal id. Keep the full record — Phase 2 reads the visibility field from it.
4. Handle the two failure modes distinctly:
   - **Non-zero exit** with a prerequisite message (missing PAC auth, missing Azure CLI token): surface the message to the user verbatim and stop. Do not attempt installation or re-authentication on their behalf.
   - **Exit 0 with `null` on stdout**: the resolver ran but found no matching record. Tell the user this means one of two things — (a) the site has not been deployed (recovery: run `/deploy-site`), or (b) the active PAC profile is pointing at a different environment than the one that owns the site (recovery: `pac auth who` to check, then `pac auth select` to switch). Ask which applies before doing anything else.

### Phase 2 — Read current visibility

From the website record fetched in Phase 1, read the `SiteVisibility` field. Value is `Public` or `Private`.

State the current visibility back to the user in one sentence before continuing.

### Phase 3 — Align on the target visibility

Use `AskUserQuestion` to confirm the target. This skill has a single operation: flip visibility.

| Current | Target | Action |
|---|---|---|
| Public | Private | One call to `--setVisibility` |
| Private | Public | One call to `--setVisibility` |
| Public | Public | Confirm and exit (no-op) |
| Private | Private | Confirm and exit (no-op) |

### Phase 4 — Apply the flip

Pause with `AskUserQuestion` showing the exact command you are about to run and the required disclosures below. Wait for approval. Then run it. One approval, one command call.

Reference: `references/commands.md` for the exact command shape.

**Required disclosures before approval**

- Flipping **to Public**: the site becomes reachable from the internet.
- Flipping **to Private**: requires Entra authentication to stay enabled on the site — confirm the user is not planning to disable Entra auth.
- Flipping a non-production site **Public → Private**: the tenant governance policy may block a future flip back to Public.

Get explicit approval covering each relevant disclosure before calling the command. Do not approve silently.

**Error handling**

Branch on the command's exit code. The full table lives in `references/commands.md`; the ones to handle here:

- Exit `3` (`A001`, portal not found): re-resolve portal id via `website.js` or ask the user to confirm the site is deployed in the current environment.
- Exit `4` (`A037`, not authorized): ask a tenant admin to perform the flip.
- Exit `5` (`A039`, trial / non-production blocked by governance): a tenant admin can adjust the governance policy to allow the flip; if the user is not a tenant admin, stop.
- Exit `6` (`D005`, developer site): cannot be made Public. Even a tenant admin cannot override this. Stop.
- Exit `2` (invalid arguments): re-read `references/commands.md`, correct the flag, retry.
- Exit `1` (unknown / transport): show the stderr message verbatim to the user and stop.

Do not retry on exit codes `4`, `5`, or `6` — those are state refusals, not transient failures.

### Phase 5 — Verify

Wait 60 seconds before re-checking. The flip restarts the site and propagation typically takes a few minutes to reflect in the website record — re-reading immediately gives a false "unchanged" result.

Then re-run the resolver from Phase 1 and read the `SiteVisibility` field. Confirm it matches the target.

If the value has not updated, poll with wait-and-retry:

- Wait another 60–90 seconds and re-read.
- Repeat up to 3 polls total (roughly 3–5 minutes of total wait from the original apply).
- If still out of sync after the last poll, do not claim success. Show the user the discrepancy, ask how to proceed, and stop making changes.

### Phase 6 — Summarize and record usage

Summarize the before → after visibility for the user and remind them the site restart takes 30–60 seconds to fully propagate.

> Reference: `${CLAUDE_PLUGIN_ROOT}/references/skill-tracking-reference.md`

Follow the skill-tracking instructions in the reference to record this skill's usage. Use `--skillName "SiteVisibility"`.

Close by asking: "Anything else on site visibility, or done?" If the user wants to harden the site further, suggest `/security` for a posture review.

## Progress tracking table

Keep this table in your final response, filling each status as phases complete:

| Phase | Status |
|---|---|
| 1. Prerequisites and portal id resolution | ☐ |
| 2. Read current visibility | ☐ |
| 3. Align on target visibility | ☐ |
| 4. Apply the flip | ☐ |
| 5. Verify | ☐ |
| 6. Summarize and record usage | ☐ |
