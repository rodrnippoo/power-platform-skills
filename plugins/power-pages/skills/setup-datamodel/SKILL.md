---
name: setup-datamodel
description: >
  This skill should be used when the user asks to "create Dataverse tables",
  "set up the data model", "setup dataverse", "create tables for my site",
  "setup dataverse schema", "create the database", "build my data model",
  or wants to create Dataverse tables, columns, and relationships for their
  Power Pages site based on a data model proposal.
user-invocable: true
allowed-tools: Read, Write, Bash, Grep, Glob, AskUserQuestion, Task, TaskCreate, TaskUpdate, TaskList, mcp__plugin_power-pages_microsoft-learn__microsoft_docs_search, mcp__plugin_power-pages_microsoft-learn__microsoft_code_sample_search, mcp__plugin_power-pages_microsoft-learn__microsoft_docs_fetch, mcp__plugin_power-pages_playwright__browser_navigate, mcp__plugin_power-pages_playwright__browser_take_screenshot, mcp__plugin_power-pages_playwright__browser_wait_for, mcp__plugin_power-pages_playwright__browser_resize
model: opus
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/setup-datamodel/scripts/validate-datamodel.js"'
          timeout: 30
        - type: prompt
          prompt: >
            If a Dataverse data model was being set up in this session (via /power-pages:setup-datamodel),
            verify before allowing stop: 1) A data model was obtained (either the data-model-architect agent
            was invoked OR the user uploaded an existing ER diagram that was parsed), 2) The user approved
            the proposal, 3) All approved tables were created, 4) A summary was presented.
            If incomplete, return { "ok": false, "reason": "<specific issues>" }. Otherwise return { "ok": true }.
          timeout: 30
---

# Set Up Dataverse Data Model

Guide the user through creating Dataverse tables, columns, and relationships for their Power Pages site. Follow a systematic approach: verify prerequisites, obtain a data model (via AI analysis or user-provided diagram), review and approve, then create all schema objects via OData API.

## Core Principles

- **Never create without approval**: Always present the full data model proposal and get explicit user confirmation before making any Dataverse changes.
- **Use TaskCreate/TaskUpdate**: Track all progress throughout all phases — create the todo list upfront with all phases before starting any work.
- **Resilient execution**: Refresh tokens proactively, check for existing tables before creating, and report failures without automated rollback.

**Initial request:** $ARGUMENTS

---

## Phase 1: Verify Prerequisites

**Goal**: Confirm PAC CLI authentication, acquire an Azure CLI token, and verify API access

**Actions**:
1. Create todo list with all 8 phases (see [Progress Tracking](#progress-tracking) table)
2. Follow the prerequisite steps in `${CLAUDE_PLUGIN_ROOT}/references/dataverse-prerequisites.md` to verify PAC CLI auth, acquire an Azure CLI token, and confirm API access. Store the environment URL as `$envUrl`.

**Output**: Verified PAC CLI auth, valid Azure CLI token, confirmed API access, `$envUrl` stored

---

## Phase 2: Choose Data Model Source

**Goal**: Determine whether the user will upload an existing ER diagram or let AI analyze the site

**Actions**:
1. Ask the user how they want to define the data model using the `AskUserQuestion` tool:

   **Question**: "How would you like to define the data model for your site?"

   | Option | Description |
   |--------|-------------|
   | **Upload an existing ER diagram** | Provide an image (PNG/JPG) or Mermaid diagram of your existing data model |
   | **Let the Data Model Architect figure it out** | The Data Model Architect will analyze your site's source code and propose a data model automatically |

2. Route to the appropriate path:

### Path A: Upload Existing ER Diagram

If the user chooses to upload an existing diagram:

1. Ask the user to provide their ER diagram. Supported formats:
   - **Image file** (PNG, JPG) — Use the `Read` tool to view the image and extract tables, columns, relationships, and cardinalities from it
   - **Mermaid syntax** — The user can paste Mermaid ER diagram text directly in chat
   - **Text description** — A structured list of tables, columns, and relationships

2. Parse the diagram into the same structured format used by the data-model-architect agent:
   - Publisher prefix (ask the user, or retrieve from the environment via `pac env who`)
   - Table definitions: `logicalName`, `displayName`, `status` (new/modified/reused), `columns`, `relationships`
   - Column definitions: `logicalName`, `displayName`, `type`, `required`
   - Relationship definitions: type (1:N or M:N), referenced/referencing tables

3. Query existing Dataverse tables (same as Phase 3 would) to mark each table as `new`, `modified`, or `reused`.

4. Generate a Mermaid ER diagram from the parsed data (if the user provided an image or text) for visual confirmation.

5. Proceed directly to **Phase 4: Review Proposal** with the parsed data model.

### Path B: Let the Data Model Architect Figure It Out

If the user chooses to let the Data Model Architect figure it out, proceed to **Phase 3: Invoke Data Model Architect** (the existing automated flow).

**Output**: Data model source chosen and, for Path A, parsed data model ready for review

---

## Phase 3: Invoke Data Model Architect

**Goal**: Spawn the data-model-architect agent to autonomously analyze the site and propose a data model

**Actions**:
1. Use the `Task` tool to spawn the `data-model-architect` agent. This agent autonomously:
   - Analyzes the site's source code to infer data requirements
   - Queries existing Dataverse tables via OData GET requests
   - Identifies reuse opportunities (reuse, extend, or create new)
   - Proposes a complete data model with an ER diagram

2. Spawn the agent:

   ```
   Task tool:
     subagent_type: general-purpose
     prompt: |
       You are the data-model-architect agent. Follow the instructions in
       the agent definition file at:
       ${CLAUDE_PLUGIN_ROOT}/agents/data-model-architect.md

       Analyze the current project and Dataverse environment, then propose
       a complete data model. Return:
       1. Publisher prefix
       2. Table definitions (logicalName, displayName, status, columns, relationships)
       3. Mermaid ER diagram
   ```

3. Wait for the agent to return its structured proposal before proceeding.

**Output**: Structured data model proposal from the agent (publisher prefix, table definitions, ER diagram)

---

## Phase 4: Interactive ER Diagram Review

**Goal**: Launch the interactive ER diagram editor in the browser so the user can visually review, refine, and approve the data model before any Dataverse changes are made.

The editor is a rich single-page application with a three-panel layout:
- **Left** — searchable entity/relationship explorer with add/delete actions
- **Center** — live Mermaid ER diagram with zoom, pan, and view modes (Visual / Code / Split)
- **Right** — context-sensitive property editor for the selected table, column, or relationship

**Actions**:

### 4.1 Write Input File

Write the data model returned by the agent (or parsed from the user's upload) to a temp JSON file.
The model must follow this structure:

```json
{
  "publisherPrefix": "<prefix>",
  "tables": [
    {
      "id": "<uuid>",
      "logicalName": "<prefix>_tablename",
      "displayName": "Table Display Name",
      "description": "",
      "status": "new",
      "columns": [
        {
          "id": "<uuid>",
          "logicalName": "<prefix>_columnname",
          "displayName": "Column Name",
          "type": "SingleLine.Text",
          "required": true,
          "maxLength": 100,
          "description": ""
        }
      ]
    }
  ],
  "relationships": [
    {
      "id": "<uuid>",
      "type": "1:N",
      "referencedTable": "<from_logical_name>",
      "referencingTable": "<to_logical_name>",
      "referencingAttribute": "<prefix>_fkcolumnid",
      "label": "has"
    }
  ],
  "mermaidDiagram": ""
}
```

Use the `Write` tool to create this file:

```
File path: /tmp/er-input.json
Contents:  the JSON above, populated from the agent's proposal
```

Also clean up any previous run's files:

```bash
rm -f /tmp/er-approved.json /tmp/er-editor-port.txt
```

### 4.2 Launch the Editor Server

Start the interactive editor server in the background using bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/setup-datamodel/scripts/launch-er-editor.js" \
  /tmp/er-input.json \
  /tmp/er-approved.json \
  /tmp/er-editor-port.txt &
```

Then wait for the server to be ready (it writes its port to the port file):

```bash
for i in $(seq 1 30); do
  if [ -f /tmp/er-editor-port.txt ]; then break; fi
  sleep 0.5
done
EDITOR_PORT=$(cat /tmp/er-editor-port.txt)
echo "Editor URL: http://127.0.0.1:$EDITOR_PORT"
```

### 4.3 Open in Browser

Use Playwright to navigate to the editor:

1. Resize the browser viewport for a wide layout: **width: 1600, height: 900**
2. Navigate to `http://127.0.0.1/<EDITOR_PORT>` (use the port from the port file)
3. Wait for the page to fully load (wait for selector `#approve-btn`)
4. Take a screenshot to confirm the editor opened correctly

Inform the user:

> "The interactive ER diagram editor is now open in your browser. You can:
> - Click any table in the left panel to edit its properties
> - Add or remove tables, columns, and relationships
> - Switch between Visual, Code, and Split views
> - Use Ctrl+Z / Ctrl+Y to undo/redo changes
> - When you're satisfied, click **Approve & Create Tables** in the editor"

### 4.4 Wait for User Approval

Poll for the approved output file. The editor server writes this file and exits when the user clicks Approve, or exits with code 2 if the user clicks Cancel.

```bash
APPROVED=false
for i in $(seq 1 120); do
  if [ -f /tmp/er-approved.json ]; then
    APPROVED=true
    break
  fi
  sleep 5
done

if [ "$APPROVED" = "false" ]; then
  echo "TIMEOUT"
else
  echo "APPROVED"
  cat /tmp/er-approved.json
fi
```

- **If `APPROVED`**: Read `/tmp/er-approved.json` and use it as the authoritative data model for Phases 5–8
- **If `TIMEOUT`** (10 minutes elapsed): Use `AskUserQuestion` to ask if the user is still reviewing, then resume polling or cancel
- **If the server process exits with code 2** (user clicked Cancel): Stop the skill gracefully

### 4.5 Read Approved Model

Use the `Read` tool to load the approved data model:

```
Read: /tmp/er-approved.json
```

Extract from it:
- `publisherPrefix` — used for all new table/column logical names
- `tables` — the final list of tables with their columns and status (new/modified/reused)
- `relationships` — the final list of relationships to create
- `mermaidDiagram` — the final Mermaid ER diagram (for documentation)

Use these values for all subsequent phases. The approved model supersedes any earlier proposal.

### 4.6 Confirm with User

Present a brief summary of the approved model to the user in chat:

```
✅ Data model approved:
  • X new tables to create
  • Y tables to modify (add columns)
  • Z tables to reuse as-is
  • N relationships to create

Proceeding to pre-creation checks…
```

**Output**: User-approved data model read from `/tmp/er-approved.json`, ready for Phase 5

---

## Phase 5: Pre-Creation Checks

**Goal**: Refresh the token, verify what already exists in Dataverse, and build the creation plan to avoid duplicates

**Actions**:

### 5.1 Refresh Token

Re-acquire the Azure CLI token (tokens expire after ~60 minutes):

```powershell
$token = az account get-access-token --resource "$envUrl" --query accessToken -o tsv
```

### 5.2 Query Existing Tables

For each table in the approved proposal marked as `new`, check whether it already exists:

```powershell
$headers = @{ Authorization = "Bearer $token"; Accept = "application/json" }
Invoke-RestMethod -Uri "$envUrl/api/data/v9.2/EntityDefinitions(LogicalName='<table_logical_name>')" -Headers $headers
```

- **If 404**: Table does not exist, proceed to create it
- **If 200**: Table already exists — skip creation, warn the user

For tables marked as `modified`, verify the table exists (it should) and check which columns are missing.

### 5.3 Build Creation Plan

From the pre-creation checks, build a list of:

- Tables to create (new tables that don't exist yet)
- Columns to add (new columns on existing/modified tables)
- Relationships to create
- Tables/columns to skip (already exist)

Inform the user of any skipped items.

**Output**: Finalized creation plan with tables, columns, and relationships to create or skip

---

## Phase 6: Create Tables & Columns

**Goal**: Create each approved table and its columns using the Dataverse OData Web API

**Actions**:

Refer to `references/odata-api-patterns.md` for full JSON body templates.

### 6.1 Create Tables

For each new table, POST to the EntityDefinitions endpoint:

```powershell
$body = <JSON body from references/odata-api-patterns.md>
$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
  Accept = "application/json"
}
Invoke-RestMethod -Method Post -Uri "$envUrl/api/data/v9.2/EntityDefinitions" -Headers $headers -Body $body
```

Use the deep-insert pattern to create the table and its columns in a single POST request. See `references/odata-api-patterns.md` for the complete JSON structure.

### 6.2 Add Columns to Existing Tables

For tables marked as `modified`, add new columns one at a time:

```powershell
$body = <column JSON from references/odata-api-patterns.md>
Invoke-RestMethod -Method Post -Uri "$envUrl/api/data/v9.2/EntityDefinitions(LogicalName='<table>')/Attributes" -Headers $headers -Body $body
```

### 6.3 Track Progress

Track each creation attempt and its result (success/failure/skipped). Do NOT attempt automated rollback on failure — report failures and continue with remaining items.

### 6.4 Refresh Token if Needed

If creating many tables, refresh the token between batches (every 3–4 tables) to avoid expiration:

```powershell
$token = az account get-access-token --resource "$envUrl" --query accessToken -o tsv
```

**Output**: All approved tables and columns created (or failures reported)

---

## Phase 7: Create Relationships

**Goal**: Create all relationships between the newly created and existing tables

**Actions**:

### 7.1 One-to-Many Relationships

Create lookup columns that establish 1:N relationships:

```powershell
$body = <relationship JSON from references/odata-api-patterns.md>
Invoke-RestMethod -Method Post -Uri "$envUrl/api/data/v9.2/RelationshipDefinitions" -Headers $headers -Body $body
```

### 7.2 Many-to-Many Relationships

Create M:N relationships (intersect tables are created automatically):

```powershell
$body = <M:N relationship JSON from references/odata-api-patterns.md>
Invoke-RestMethod -Method Post -Uri "$envUrl/api/data/v9.2/RelationshipDefinitions" -Headers $headers -Body $body
```

### 7.3 Track Relationship Creation

Track each relationship creation attempt. Report failures without rolling back.

**Output**: All approved relationships created (or failures reported)

---

## Phase 8: Publish & Verify

**Goal**: Publish all customizations, verify tables exist, write the manifest, and present a summary

**Actions**:

### 8.1 Publish Customizations

Publish all customizations so the new tables and columns become available:

```powershell
$publishBody = @{
  ParameterXml = "<importexportxml><entities><entity>$( ($tables | ForEach-Object { $_.logicalName }) -join '</entity><entity>' )</entity></entities></importexportxml>"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$envUrl/api/data/v9.2/PublishXml" -Headers $headers -Body $publishBody -ContentType "application/json"
```

See `references/odata-api-patterns.md` for the full PublishXml pattern.

### 8.2 Verify Tables Exist

For each created table, run a verification query:

```powershell
Invoke-RestMethod -Uri "$envUrl/api/data/v9.2/EntityDefinitions(LogicalName='<table>')?`$select=LogicalName,DisplayName" -Headers $headers
```

### 8.3 Write Manifest

After successful verification, write `.datamodel-manifest.json` to the project root. This file records which tables and columns were verified to exist, and is used by the validation hook.

```json
{
  "environmentUrl": "https://org12345.crm.dynamics.com",
  "tables": [
    {
      "logicalName": "cr123_project",
      "displayName": "Project",
      "status": "new",
      "columns": [
        { "logicalName": "cr123_name", "type": "String" },
        { "logicalName": "cr123_description", "type": "Memo" }
      ]
    }
  ]
}
```

Use the `Write` tool to create this file at `<PROJECT_ROOT>/.datamodel-manifest.json`. Only include tables and columns that were confirmed to exist in Step 8.2. See `${CLAUDE_PLUGIN_ROOT}/references/datamodel-manifest-schema.md` for the full schema specification.

### 8.4 Record Skill Usage

> Reference: `${CLAUDE_PLUGIN_ROOT}/references/skill-tracking-reference.md`

Follow the skill tracking instructions in the reference to record this skill's usage. Use `--skillName "SetupDatamodel"`.

### 8.5 Present Summary

Present a summary to the user:

| Table | Status | Columns | Relationships |
|-------|--------|---------|---------------|
| `cr123_project` (Project) | Created | 5 columns | 2 relationships |
| `contact` (Contact) | Reused | 1 column added | — |
| `cr123_task` (Task) | Created | 4 columns | 1 relationship |

Include:
- Total tables created/modified/reused/failed
- Total columns created/skipped/failed
- Total relationships created/failed
- Any errors encountered with details
- Location of the manifest file (`.datamodel-manifest.json`)

### 8.6 Suggest Next Steps

After the summary, suggest:
- Review created tables in the Power Pages maker portal
- Populate tables with sample data for testing: `/power-pages:add-sample-data`
- Integrate tables with your site's frontend via Web API: `/power-pages:integrate-webapi`
- If the site is not yet built: `/power-pages:create-site`
- If the site is ready to deploy: `/power-pages:deploy-site`

**Output**: Published customizations, verified tables, manifest written, summary presented

---

## Important Notes

### Throughout All Phases

- **Use TaskCreate/TaskUpdate** to track progress at every phase
- **Ask for user confirmation** at key decision points (see list below)
- **Refresh tokens proactively** — re-acquire the Azure CLI token before any batch of API calls, especially if more than a few minutes have passed
- **Report failures without rollback** — track each creation attempt and continue with remaining items on failure

### Key Decision Points (Wait for User)

1. After Phase 2: Data model source chosen (upload vs. AI)
2. After Phase 4: Approve data model proposal before any creation
3. After Phase 5: Acknowledge any skipped items before proceeding
4. After Phase 8: Review summary and choose next steps

### Progress Tracking

Before starting Phase 1, create a task list with all phases using `TaskCreate`:

| Task subject | activeForm | Description |
|-------------|------------|-------------|
| Verify prerequisites | Verifying prerequisites | Confirm PAC CLI auth, acquire Azure CLI token, verify API access |
| Choose data model source | Choosing data model source | Ask user to upload ER diagram or let AI analyze the site |
| Invoke data model architect | Invoking data model architect | Spawn agent to analyze site and propose data model |
| Review and approve proposal | Reviewing proposal | Present data model proposal to user, get explicit approval |
| Pre-creation checks | Running pre-creation checks | Refresh token, query existing tables, build creation plan |
| Create tables and columns | Creating tables and columns | POST to OData API to create tables and columns |
| Create relationships | Creating relationships | POST to OData API to create 1:N and M:N relationships |
| Publish and verify | Publishing and verifying | Publish customizations, verify tables, write manifest, present summary |

Mark each task `in_progress` when starting it and `completed` when done via `TaskUpdate`. This gives the user visibility into progress and keeps the workflow deterministic.

---

**Begin with Phase 1: Verify Prerequisites**
