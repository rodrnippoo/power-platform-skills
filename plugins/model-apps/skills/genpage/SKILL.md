---
name: genpage
version: 2.0.0
description: Creates, updates, and deploys Power Apps generative pages for model-driven apps using React v17, TypeScript, and Fluent UI V9. Orchestrates specialist agents for planning, entity creation, and code generation. Use it when user asks to build, retrieve, or update a page in an existing Microsoft Power Apps model-driven app. Use it when user mentions "generative page", "page in a model-driven", or "genux".
author: Microsoft Corporation
argument-hint: "[optional: page description or 'deploy' or 'update']"
user-invocable: true
model: sonnet
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, Task, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# Power Apps Generative Pages Builder

**Triggers:** genpage, generative page, create genpage, genux page, build genux, power apps page, model page
**Keywords:** power apps, generative pages, genux, model-driven, dataverse, react, fluent ui, pac cli
**Aliases:** /genpage, /gen-page, /genux

## Overview

This skill orchestrates three specialist agents:

1. **`genpage-planner`** — validates prerequisites, gathers requirements, detects what
   entities and apps exist, presents a plan for approval, writes `genpage-plan.md`
2. **`genpage-datamodel-builder`** — creates Dataverse entities (tables, columns,
   relationships, choices, sample data) using the Dataverse Skills plugin
3. **`genpage-page-builder`** — generates one complete `.tsx` file per page; multiple
   builders run in parallel for multi-page requests

You (the skill) coordinate the agents and own app creation, RuntimeTypes generation,
deployment, browser verification, and the edit flow.

## References

- **Code generation rules**: [genpage-rules-reference.md](../../references/genpage-rules-reference.md)
- **Troubleshooting**: [troubleshooting.md](../../references/troubleshooting.md)
- **Sample pages**: [samples/](../../samples/)

## Development Standards

- **React 17 + TypeScript** — all generated code
- **Fluent UI V9** — `@fluentui/react-components` exclusively (DatePicker from `@fluentui/react-datepicker-compat`, TimePicker from `@fluentui/react-timepicker-compat`)
- **Single file architecture** — all components, utilities, styles in one `.tsx` file
- **No external libraries** — only React, Fluent UI V9, approved Fluent icons, D3.js for charts
- **Type-safe DataAPI** — use RuntimeTypes when Dataverse entities are involved
- **Responsive design** — flexbox, relative units, never `100vh`/`100vw`
- **Accessibility** — WCAG AA, ARIA labels, keyboard navigation, semantic HTML
- **Complete code** — no placeholders, TODOs, or ellipses in final output

---

## Instructions

Follow these phases in order for every `/genpage` invocation.

### Phase 0: Create Working Directory

Derive a short folder name from the user's requirements:

1. Extract the page name or a 2-4 word summary from `$ARGUMENTS`
2. Convert to kebab-case (e.g., "Candidate Tracker" → `candidate-tracker`)
3. Create the folder: `mkdir -p <folder-name>`
4. Resolve its absolute path — this is the **working directory** for all subsequent phases

### Phase 1: Plan

Invoke the `genpage-planner` agent using the `Task` tool.

Pass a prompt that includes:

- The user's requirements: `$ARGUMENTS`
- The working directory (absolute path from Phase 0)
- The plugin root path: `${CLAUDE_PLUGIN_ROOT}`

Example prompt:

> You are the genpage-planner agent. Plan generative page(s) for the following requirements:
>
> [paste $ARGUMENTS here]
>
> Working directory: [absolute path from Phase 0]
> Plugin root: ${CLAUDE_PLUGIN_ROOT}
>
> Follow the instructions in your agent file. Write genpage-plan.md to the working
> directory. Return the page list, entity status, and app selection when complete.

**Wait for the planner to finish.** The planner will present the plan to the user via
plan mode and wait for approval before returning. Do not proceed to Phase 2 until the
planner task completes successfully.

**If the planner returns `{ "action": "edit" }`:** The user chose to edit an existing
page. Skip to the **Edit Flow** section below.

### Phase 2: Create Entities (Conditional)

Read `genpage-plan.md` from the working directory. Check the **Entity Creation Required**
section.

**If entities need creating:**
- Invoke the `genpage-datamodel-builder` agent via the `Task` tool
- Pass: path to `genpage-plan.md`, working directory
- Wait for completion

**If no entities need creating:** Skip to Phase 3.

### Phase 3: App Creation/Selection

Read `genpage-plan.md` for the app decision:

**If "create new":**
```powershell
pac model create --name "App Name"
```
Store the new app-id for Phase 6.

**If existing app-id:** Use it directly.

### Phase 4: Generate RuntimeTypes (Conditional)

If any page uses Dataverse entities, generate the TypeScript schema:

```powershell
pac model genpage generate-types --data-sources "entity1,entity2,..." --output-file <working-dir>/RuntimeTypes.ts
```

> **Windows + Bash**: Always use forward slashes in file paths (e.g., `D:/temp/RuntimeTypes.ts`).

After generating, read the RuntimeTypes.ts file to verify it generated correctly.

**For mock data pages only:** Skip this phase.

### Phase 5: Build Pages (Parallel)

Read `genpage-plan.md` and extract the pages table. For each page, invoke a
`genpage-page-builder` agent via the `Task` tool. **Fire all invocations in a single
message** for parallel execution.

For each page, pass a prompt that includes:

- Page name (e.g., "Candidate Tracker")
- Target file name (e.g., "candidate-tracker.tsx")
- Absolute path to `genpage-plan.md`
- Absolute path to `RuntimeTypes.ts` (if Dataverse entities; omit for mock data)
- Working directory
- Plugin root: `${CLAUDE_PLUGIN_ROOT}`

Example prompt per page:

> You are the genpage-page-builder agent. Generate the **[Page Name]** page.
>
> - Target file: [filename].tsx
> - Plan document: [absolute path to genpage-plan.md]
> - RuntimeTypes: [absolute path to RuntimeTypes.ts] (or "mock data — no RuntimeTypes")
> - Working directory: [absolute path from Phase 0]
> - Plugin root: ${CLAUDE_PLUGIN_ROOT}
>
> Follow the instructions in your agent file. Write [filename].tsx and return your
> result when done.

Wait for all page-builder tasks to complete before proceeding.

### Phase 6: Deploy

For each `.tsx` file produced, deploy to Power Apps.

**Copy the upload commands below exactly — `--app-id`, `--code-file`, `--prompt`, `--agent-message` are all required and must use these exact flag names.**

**For Dataverse entity pages:**

```powershell
pac model genpage upload `
  --app-id <app-id> `
  --code-file <working-dir>/<file>.tsx `
  --name "Page Display Name" `
  --data-sources "entity1,entity2" `
  --prompt "User's original request summary" `
  --model "<current-model-id>" `
  --agent-message "Description of what was built and any relevant details" `
  --add-to-sitemap
```

**For mock data pages:** Same but omit `--data-sources`.

**For updating existing pages:** Use `--page-id`, omit `--add-to-sitemap`:

```powershell
pac model genpage upload `
  --app-id <app-id> `
  --page-id <page-id> `
  --code-file <working-dir>/<file>.tsx `
  --data-sources "entity1,entity2" `
  --prompt "User's original request summary" `
  --model "<current-model-id>" `
  --agent-message "Description of what was built and any relevant details"
```

### Phase 7: Verify in Browser (Optional)

After successful deployment, ask the user (use `AskUserQuestion`):
> "Would you like to verify the page(s) in the browser using Playwright?"

Options: **Yes, verify in browser** / **Skip verification**

If the user chooses to skip, go directly to Phase 8.

If the user chooses to verify:

#### 7.1 Navigate and Authenticate

Construct the URL from the environment base URL, app-id, and page-id returned by upload:

```
https://<env>.crm.dynamics.com/main.aspx?appid=<app-id>&pagetype=genux&id=<page-id>
```

1. Use `browser_navigate` to open the constructed URL
2. If you get a "page closed" or "browser closed" error, retry navigation once
3. Use `browser_snapshot` to capture the page state. Always snapshot before any clicks
4. If a sign-in page appears, use `browser_click` on the sign-in option, then `browser_wait_for`
5. Use `browser_wait_for` for the genux page content to render

#### 7.2 Structural Verification

Use `browser_snapshot` and verify expected DOM elements based on the page type:

| Page Type | Expected Elements |
|-----------|-------------------|
| Data Grid | Table/grid element with column headers and data rows |
| Form / Wizard | Form fields (inputs, dropdowns) and Next/Back buttons |
| CRUD | Data grid + action buttons (Add, Edit, Delete) |
| Dashboard | Multiple sections/panels with headings |
| Card Layout | Card containers with content |
| File Upload | File input or drop zone element |
| Navigation Sidebar | Nav element with menu items |

#### 7.3 Interactive Testing

Test interactions based on the page type. **Always take a fresh `browser_snapshot` before each click.** Move on after 2 failed attempts per interaction.

| Page Type | Test Action | Expected Result |
|-----------|-------------|-----------------|
| Data Grid | Click a column header | Sort order changes |
| Form / Wizard | Click Next button | Step advances |
| CRUD | Click Add/New button | Form or dialog appears |
| Dashboard | Click a tab or section toggle | Content area updates |
| Card Layout | Click a card action button | Card responds |
| Navigation Sidebar | Click a menu item | Content area updates |

**Skip these:** Dataverse data mutations, file upload dialogs, complex form validation, pagination.

#### 7.4 Visual Confirmation

Use `browser_take_screenshot` to capture a final screenshot.

#### 7.5 Fix and Re-deploy

If issues are found: fix the code, re-deploy (Phase 6), repeat verification.

**Common Playwright issues:**
- "Target page, context or browser has been closed" → retry the navigation
- "Ref not found" → take a fresh `browser_snapshot` before clicking any element
- Sign-in required → user must sign in manually first

### Phase 8: Summary

Present a final summary:

```
## Genpage Complete

| Page | File | Entities | Status |
|------|------|----------|--------|
| [Name] | [file].tsx | [entities or "mock data"] | Deployed |

App: [app name] ([app-id])
Screenshots: [if verification was done]
Next steps: Share with team, iterate on design, create additional pages
```

---

## Edit Flow

The edit workflow stays inline in the orchestrator — it does not route through the
planner/builder agents. This is triggered when the user asks to edit an existing page
(detected in Phase 1 when the planner returns `{ "action": "edit" }`), or when the
user's prompt clearly describes editing an existing page.

### Edit Step 1: Validate Prerequisites

Run these checks (first invocation per session only). Run each command separately:

```powershell
node --version
```

```powershell
pac help
```

Verify PAC CLI version >= 2.3.1. See [troubleshooting.md](../../references/troubleshooting.md) if issues arise.

### Edit Step 2: Authenticate and Select Environment

```powershell
pac auth list
```

Follow the same auth flow as described in the planner agent (select profile, confirm environment).

### Edit Step 3: Download and Understand Existing Page

Ask the user for the app-id and page-id, then download:

```powershell
pac model genpage download --app-id <app-id> --page-id <page-id> --output-directory ./output-dir
```

Read the downloaded code to understand the current implementation. Ask the user what changes to make.

### Edit Step 4: Plan Changes

Present a plan describing the proposed changes before modifying code. Wait for confirmation.

### Edit Step 5: Generate Schema (If Needed)

If the page uses Dataverse entities:

```powershell
pac model genpage generate-types --data-sources "entity1,entity2" --output-file RuntimeTypes.ts
```

Read RuntimeTypes.ts to verify column names.

### Edit Step 6: Read Rules and Modify Code

Read [genpage-rules-reference.md](../../references/genpage-rules-reference.md) before modifying code. Apply the requested changes while preserving existing functionality. Follow all development standards.

### Edit Step 7: Deploy Updated Page

```powershell
pac model genpage upload `
  --app-id <app-id> `
  --page-id <page-id> `
  --code-file page-name.tsx `
  --data-sources "entity1,entity2" `
  --prompt "User's original request summary" `
  --model "<current-model-id>" `
  --agent-message "Description of what was changed"
```

Note: Use `--page-id` for updates. Omit `--add-to-sitemap`.

### Edit Step 8: Verify and Summarize

Offer browser verification (same as Phase 7 above), then provide a summary of changes made.
