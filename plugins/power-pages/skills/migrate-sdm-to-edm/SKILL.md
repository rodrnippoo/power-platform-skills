---
name: migrate-sdm-to-edm
description: >-
  This skill should be used when the user asks to "migrate to enhanced data model",
  "migrate from standard to enhanced", "switch to EDM", "migrate SDM to EDM",
  "upgrade data model", "migrate site data model", or wants to migrate an existing
  Power Pages site from the Standard Data Model (SDM) to the Enhanced Data Model (EDM)
  using PAC CLI.
user-invocable: true
argument-hint: Optional site name or WebSiteId GUID
allowed-tools: Read, Bash, Glob, Grep, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
model: sonnet
---

# Migrate Power Pages Site from Standard to Enhanced Data Model

Guide the user through migrating an existing Power Pages site from the Standard Data Model (SDM) to the Enhanced Data Model (EDM). Follow a systematic approach: verify prerequisites, authenticate, analyze customizations, execute migration, update data model version, guide post-migration remediation, and offer rollback if needed.

> **Important:** This is a preview feature. EDM migration behavior may change before GA.

## Core Principles

- **Verify before acting**: Always confirm PAC CLI version, authentication, and template compatibility before attempting migration.
- **Use TaskCreate/TaskUpdate**: Track all progress throughout all phases — create the todo list upfront with all phases before starting any work.
- **Confirm before mutating**: Always present migration parameters and customization findings to the user and get explicit approval before executing migration commands.
- **Graceful failure**: Track command results, report failures clearly, and offer rollback guidance — never auto-rollback.

**Supported templates:** Starter layout 1–5, Application processing, Blank page, Program registration, Schedule and manage meetings, FAQ.

**Not migratable:** Community (D365), Customer Self Service Portal (D365), Employee Self Service Portal (D365), Partner Portal (D365) — these support new EDM creation but can't be migrated from SDM.

**Initial request:** $ARGUMENTS

---

## Phase 1: Verify Prerequisites

**Goal**: Ensure PAC CLI is installed with the correct version and the user has the required roles

**Actions**:

1. Create todo list with all 10 phases (see [Progress Tracking](#progress-tracking) table)

2. Run `pac --version` to check PAC CLI version:

   ```powershell
   pac --version
   ```

3. **If version >= 1.31.6**: Proceed.
4. **If version < 1.31.6 or not installed**:

   Tell the user: "PAC CLI version 1.31.6 or higher is required for migration. You can update by running:"

   ```powershell
   dotnet tool update --global Microsoft.PowerApps.CLI.Tool
   ```

   If `dotnet` is not available, direct the user to <https://aka.ms/PowerPlatformCLI>.

5. Inform the user about additional prerequisites they should verify manually:

   - Dataverse base portal package **9.3.2307.x** or higher
   - Power Pages Core package **1.0.2309.63** or higher ([Update the Power Pages solution](https://learn.microsoft.com/en-us/power-pages/admin/update-solution))
   - If the environment is in **administration mode**, background operations must be enabled
   - User must have one of: **System Administrator**, **Dynamics 365 Administrator**, or **Power Platform Administrator** role

6. Use `AskUserQuestion` to confirm:

   | Question | Header | Options |
   |----------|--------|---------|
   | Please verify: (1) Dataverse base portal package >= 9.3.2307.x, (2) Power Pages Core >= 1.0.2309.63, (3) You have System Admin / D365 Admin / Power Platform Admin role. Can you confirm these are in place? | Prerequisites | Yes, all confirmed, I need to check — pause here |

   - **If "Yes"**: Proceed to Phase 2.
   - **If "I need to check"**: Wait for the user to confirm before proceeding.

**Output**: PAC CLI version verified, user confirmed remaining prerequisites

---

## Phase 2: Authentication & Site Discovery

**Goal**: Authenticate to Dataverse and identify the target site for migration

**Actions**:

### 2.1 Check Authentication

Run `pac auth who` to check current authentication status:

```powershell
pac auth who
```

**If authenticated**: Extract the **Environment URL** and proceed to 2.2.

**If not authenticated**: Ask the user for their Dataverse environment URL using `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| You are not authenticated with PAC CLI. Please provide your Dataverse environment URL (e.g., `https://org12345.crm.dynamics.com`). | Auth | I'll paste the URL, I don't know my URL |

If "I don't know my URL": Direct them to Power Platform admin center > Environments > Environment URL.

Once the URL is provided, authenticate:

```powershell
pac auth create -u "<DATAVERSE_URL>"
```

Verify with `pac auth who` again.

### 2.2 List Available Websites

```powershell
pac pages list
```

Parse the output to extract website names, IDs, and templates.

### 2.3 Identify Target Site

If `$ARGUMENTS` contains a WebSiteId GUID, use it directly. Otherwise, present the list of sites to the user using `AskUserQuestion` and let them pick the site to migrate. Capture the **WebSiteId GUID**.

### 2.4 Validate Template Compatibility

Cross-reference the selected site's template against the supported templates list. If the template is **not supported**, inform the user and stop:

> "The template '<template-name>' cannot be migrated from SDM to EDM. Only these templates are supported: Starter layout 1–5, Application processing, Blank page, Program registration, Schedule and manage meetings, FAQ."

**Output**: Authenticated, target site identified with WebSiteId GUID, template validated

---

## Phase 3: Customization Report & Analysis

**Goal**: Download and analyze the customization report to identify all changes that will need post-migration remediation

**Actions**:

### 3.1 Download Customization Report

```powershell
pac pages migrate-datamodel --webSiteId "<WEBSITE_ID>" --siteCustomizationReportPath "<REPORT_PATH>"
```

Use a sensible default for `<REPORT_PATH>` (e.g., the current working directory or a `migration-report` subfolder).

### 3.2 Parse and Categorize

Read the downloaded report and categorize findings into five types:

1. **Custom columns on adx metadata tables** — Custom columns added to `adx_*` tables (e.g., `contoso_pagetype` on `adx_webpage`)
2. **Relationships between custom tables and adx tables** — Relationships like `adx_webpage_contoso_pagelogs`
3. **Adx table references in Liquid code** — Liquid snippets using `entities['adx_*']` patterns
4. **Adx table references in FetchXML** — FetchXML queries referencing `adx_*` entity names
5. **Custom workflows/plugins on adx tables** — Workflows or plugins registered on `adx_*` primary entities

### 3.3 Present Findings

Present the findings to the user in a clear summary, grouped by type. For each finding, include the table/entity name and what needs to change post-migration.

If **no customizations are found**: Inform the user — "No customizations detected. Migration should be straightforward with no post-migration fixes needed."

If **customizations are found**: Show the summary and note — "These customizations will need to be fixed **after** migration. I'll guide you through each fix in Phase 8."

### 3.4 Get Approval to Proceed

Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| The customization report has been analyzed. Do you want to proceed with the migration? | Proceed | Yes, proceed with migration, No, I need to review more |

- **If "Yes"**: Proceed to Phase 4.
- **If "No"**: Pause and let the user ask questions or review the report.

**Output**: Customization report downloaded, parsed, categorized, and approved by user

---

## Phase 4: Pre-Migration Safety

**Goal**: Document the current site state for rollback reference

**Actions**:

### 4.1 Determine Site Type

Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Is this a production site or a dev/test site? | Site Type | Production, Dev/Test |

**If "Production"**: Display advisory guidance:

> "Microsoft recommends creating a full copy of the production environment before migration (via Power Platform Admin Center). This is outside the scope of this tool, but if feasible, consider doing it for safety. Also consider scheduling migration during non-business hours."

### 4.2 Document Current State

Capture and display:
- Site URL
- WebSiteId GUID (already captured)
- Portal ID (if accessible via `/_services/about`)
- Current data model version (standard)

Store these values for rollback reference in Phase 10.

**Output**: Site type identified, current state documented for rollback reference

---

## Phase 5: Migration Execution

**Goal**: Ensure EDM solutions are provisioned and execute the data migration

**Actions**:

### 5.1 Check EDM Template Solutions

Some templates require matching EDM-compatible solutions. Inform the user:

> "Templates like **Program Registration** and **Schedule and Manage Meetings** require EDM-compatible solutions to be present in the environment. If they're missing, the migration will show a warning."

Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Does your environment already have EDM-compatible solutions for your site's template? If you're unsure, you can try the migration and it will warn you if they're missing. | EDM Solutions | Yes, they're installed, Not sure — try migration and see, I need to install them first |

**If "I need to install them first"**: Guide the user:

> "To provision the required EDM solutions, create a new site in an EDM-enabled environment using the same template as your current site. This will install the EDM-compatible solution packages. The dummy site can be deleted after migration."

Wait for the user to confirm they've done this before proceeding.

### 5.2 Choose Migration Mode

Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Which data should be migrated? | Migration Mode | All — metadata + transactional data (Recommended), Configuration data only — site metadata (web pages, templates, settings, etc.), Configuration data references only — transactional/non-configuration data |

Map selection to mode value:
- "All" → `all`
- "Configuration data only" → `configurationData`
- "Configuration data references only" → `configurationDataReferences`

### 5.3 Execute Migration

```powershell
pac pages migrate-datamodel --webSiteId "<WEBSITE_ID>" --mode <CHOSEN_MODE>
```

If the command outputs a template warning (`Found template <name>. One of the prerequisite for migrate needs Enhanced data model template`), inform the user they need to provision EDM solutions first (see 5.1) and pause.

**Output**: Migration command executed

---

## Phase 6: Migration Verification

**Goal**: Verify the migration completed successfully before proceeding

**Actions**:

### 6.1 Check Migration Status

```powershell
pac pages migrate-datamodel --webSiteId "<WEBSITE_ID>" --checkMigrationStatus
```

### 6.2 Evaluate Status

- **If migration is complete/successful**: Proceed to Phase 7.
- **If migration is still in progress**: Inform the user:

  > "Migration is still running — this can take a while for sites with large data volumes (the tool processes 5K records per batch). Let me check again."

  Re-run the status check. Repeat as needed.

- **If migration failed**: Present the error to the user and offer options:

  | Question | Header | Options |
  |----------|--------|---------|
  | Migration encountered an error. How would you like to proceed? | Error | Retry the migration, Skip to rollback (Phase 10), Stop and troubleshoot manually |

**Output**: Migration status confirmed as successful

---

## Phase 7: Update Data Model Version

**Goal**: Switch the site from SDM to EDM

**Actions**:

### 7.1 Retrieve Portal ID

The Portal GUID is needed for the version update command. Ask the user:

| Question | Header | Options |
|----------|--------|---------|
| I need the Portal ID (GUID) to complete the migration. You can find this by navigating to your site URL with `/_services/about` appended (e.g., `https://yoursite.powerappsportals.com/_services/about`). The Portal ID is shown on that page. Can you provide it? | Portal ID | I'll paste the Portal ID |

If the Portal ID was already captured in Phase 4.2, use it directly without asking again.

### 7.2 Update Data Model Version

```powershell
pac pages migrate-datamodel --webSiteId "<WEBSITE_ID>" --updateDatamodelVersion --portalId "<PORTAL_ID>"
```

### 7.3 Confirm Update

Inform the user:

> "The data model version has been updated. The website record linked to the standard data model has been deactivated, and the site now uses the enhanced data model."

**Output**: Site switched to Enhanced Data Model

---

## Phase 8: Post-Migration Customization Remediation

**Goal**: Guide the user through fixing any customizations identified in Phase 3

**Actions**:

If **no customizations were found** in Phase 3, skip to Phase 9.

Otherwise, present the remediation checklist based on the customization types found. For each type, provide step-by-step instructions the user can follow in the Data workspace / Power Platform UI.

### 8A: Custom Columns on adx Metadata Tables

If custom columns were found, instruct the user:

> **For each custom column on an `adx_*` table:**
> 1. Open the **Data workspace** in Power Pages
> 2. Create a new table (e.g., `contoso_webpage`)
> 3. Add the custom column (e.g., `contoso_pagetype`) to the new table
> 4. Add a lookup column associated with `powerpagescomponent`
> 5. Migrate data from the old custom column to the new table

### 8B: Relationships Between Custom Tables and adx Tables

If custom relationships were found, instruct the user:

> **For each relationship between a custom table and an `adx_*` table:**
> 1. Open the **Data workspace**
> 2. Create a new relationship replacing the `adx_*` side with `powerpagecomponent` (e.g., `powerpagecomponent_contoso_pagelogs`)
> 3. Verify the new relationship works and data is accessible

### 8C: adx Table References in Liquid Code

If Liquid references were found, instruct the user:

> **For each `entities['adx_*']` reference in Liquid code:**
> 1. Replace with the corresponding Liquid object where available (e.g., `entities['adx_weblinks']` → `weblinks`)
> 2. Where no direct Liquid object exists, use the `powerpagecomponent` table with a `powerpagecomponenttype` filter
> 3. Test affected pages to confirm rendering

### 8D: adx Table References in FetchXML

If FetchXML references were found, instruct the user using the component type mapping:

> **For each `<entity name='adx_*'>` in FetchXML:**
> 1. Replace the `adx_*` entity name with `powerpagecomponent`
> 2. Add a filter: `<condition attribute='powerpagecomponenttype' operator='eq' value='<TYPE_VALUE>'/>`
> 3. Use the component type reference table to find the correct value (e.g., Web Role = 11, Web Page = 2)
> 4. Test that the rewritten query returns correct data

**Example — before (SDM):**
```xml
{% fetchxml app_webroles %}
<fetch>
  <entity name='adx_webrole'>
    <attribute name='adx_name'/>
  </entity>
</fetch>
{% endfetchxml %}
```

**After (EDM):**
```xml
{% fetchxml app_webroles %}
<fetch>
  <entity name='powerpagecomponent'>
    <attribute name='adx_name'/>
    <filter type='and'>
      <condition attribute='powerpagecomponenttype' operator='eq' value='11'/>
    </filter>
  </entity>
</fetch>
{% endfetchxml %}
```

### 8E: Custom Workflows and Plugins on adx Tables

If workflows/plugins were found, instruct the user:

> **For each workflow/plugin registered on an `adx_*` table:**
> 1. Refactor the code to target `powerpagecomponent` (logical name: `powerpagecomponent`) instead of the `adx_*` table
> 2. Update attribute references accordingly
> 3. Re-register the workflow/plugin on the new table
> 4. Test execution

### Component Type Reference Table

Provide this table to the user for 8C and 8D remediations:

| Component | Type Value |
|-----------|------------|
| Publishing State | 1 |
| Web Page | 2 |
| Web File | 3 |
| Web Link Set | 4 |
| Web Link | 5 |
| Page Template | 6 |
| Content Snippet | 7 |
| Web Template | 8 |
| Site Setting | 9 |
| Web Page Access Control Rule | 10 |
| Web Role | 11 |
| Website Access | 12 |
| Site Marker | 13 |
| Basic Form | 15 |
| Basic Form Metadata | 16 |
| List | 17 |
| Table Permission | 18 |
| Advanced Form | 19 |
| Advanced Form Step | 20 |
| Advanced Form Metadata | 21 |
| Poll Placement | 24 |
| Ad Placement | 26 |
| Bot Consumer | 27 |
| Column Permission Profile | 28 |
| Column Permission | 29 |
| Redirect | 30 |
| Publishing State Transition Rule | 31 |
| Shortcut | 32 |
| Cloud Flow | 33 |
| UX Component | 34 |

**Output**: Remediation instructions presented for all applicable customization types

---

## Phase 9: Post-Migration Validation

**Goal**: Present the user with a validation checklist

**Actions**:

Present the following checklist:

> **Post-migration validation checklist:**
> - [ ] Browse all site pages — check for rendering issues
> - [ ] Test forms and data operations (basic forms, advanced forms, lists)
> - [ ] Test web API calls (if applicable)
> - [ ] Test authentication flows (login, registration, role assignment)
> - [ ] Check web roles and table permissions
> - [ ] Validate pages that had Liquid/FetchXML customization fixes
> - [ ] Run functional smoke tests on critical user journeys

Use `AskUserQuestion`:

| Question | Header | Options |
|----------|--------|---------|
| Please work through the validation checklist above. Does everything look good? | Validation | Yes, everything works, There are issues — I need to rollback |

- **If "Yes"**: Proceed to Phase 10 (Summary).
- **If "There are issues"**: Proceed to Phase 10 (Rollback).

**Output**: User confirmed validation status

---

## Phase 10: Rollback or Summary

**Goal**: Either revert to SDM or present a successful migration summary

### If Rollback Needed

If the user reported issues in Phase 9, offer rollback:

```powershell
pac pages migrate-datamodel --webSiteId "<WEBSITE_ID>" --revertToStandardDataModel --portalId "<PORTAL_ID>"
```

Inform the user:

> "The site has been reverted to the standard data model. The EDM website record has been deactivated and the SDM website record has been reactivated."

### If Migration Successful

Present the summary:

> **Migration Summary:**
> - **Site**: <site name>
> - **WebSiteId**: <GUID>
> - **Previous data model**: Standard (SDM)
> - **Current data model**: Enhanced (EDM)
> - **Customizations remediated**: <count by type, or "None">
> - **Status**: Migration complete

### Record Skill Usage

> Reference: `${CLAUDE_PLUGIN_ROOT}/references/skill-tracking-reference.md`

Follow the skill tracking instructions in the reference to record this skill's usage. Use `--skillName "MigrateSdmToEdm"`.

**Output**: Migration complete (or rolled back), skill usage recorded

---

## Progress Tracking

| Phase | Task Subject | Active Form |
|-------|-------------|-------------|
| Phase 1 | Verify prerequisites | Verifying prerequisites |
| Phase 2 | Authenticate and discover sites | Authenticating and discovering sites |
| Phase 3 | Analyze customization report | Analyzing customization report |
| Phase 4 | Document pre-migration state | Documenting pre-migration state |
| Phase 5 | Execute migration | Executing migration |
| Phase 6 | Verify migration status | Verifying migration status |
| Phase 7 | Update data model version | Updating data model version |
| Phase 8 | Guide customization remediation | Guiding customization remediation |
| Phase 9 | Validate post-migration | Validating post-migration |
| Phase 10 | Summarize or rollback | Completing migration |
