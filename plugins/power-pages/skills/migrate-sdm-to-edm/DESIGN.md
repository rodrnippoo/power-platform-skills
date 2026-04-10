# Skill Design: Migrate Site from Standard Data Model (SDM) to Enhanced Data Model (EDM)

**Status:** Draft
**Source Doc:** [Migrate standard data model sites to enhanced data model (preview)](https://learn.microsoft.com/en-us/power-pages/admin/migrate-enhanced-data-model)
**Plugin:** power-pages

---

## Overview

This skill guides the user through migrating an existing Power Pages site from the Standard Data Model (SDM) to the Enhanced Data Model (EDM). The migration involves PAC CLI commands, pre-migration analysis, data migration, post-migration customization fixes, and validation.

> **Note:** This is a preview feature. EDM migration is not yet recommended for production use without thorough testing on a copy first.

---

## Scope

### In Scope
- Pre-migration prerequisite checks
- Customization report download and analysis
- Data migration execution (config data, transactional data, or both)
- Post-migration customization remediation (5 customization types)
- Migration status verification
- Data model version update
- Rollback to SDM if needed
- Production site migration workflow (copy-first strategy)

### Out of Scope
- Creating new EDM sites from scratch (use `create-site` skill)
- Migrating unsupported templates (Community, Customer Self Service, Employee Self Service, Partner Portal on SDM)
- Dataverse schema design changes unrelated to migration
- Power Platform solution management beyond migration context

---

## Supported Templates

Only sites with these templates can be migrated:
- Starter layout 1–5
- Application processing
- Blank page
- Program registration
- Schedule and manage meetings
- FAQ

**Not migratable:** Community (D365), Customer Self Service Portal (D365), Employee Self Service Portal (D365), Partner Portal (D365) — these support new EDM creation but can't migrate from SDM.

---

## Task Breakdown

### Phase 1: Pre-Migration Validation

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 1.1 | **Check PAC CLI version** | Verify PAC CLI >= 1.31.6 is installed | `pac --version` | Yes |
| 1.2 | **Check Dataverse package version** | Verify Dataverse base portal package >= 9.3.2307.x | Manual / admin check | Guided |
| 1.3 | **Check Power Pages Core version** | Verify Power Pages Core package >= 1.0.2309.63 | Manual / admin check | Guided |
| 1.4 | **Check background operations** | If environment is in admin mode, verify background operations enabled | Manual / admin check | Guided |
| 1.5 | **Check user roles** | Verify user has System Admin, D365 Admin, or Power Platform Admin role | Manual check | Guided |

### Phase 2: Authentication & Site Discovery

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 2.1 | **Authenticate to Dataverse** | Create auth profile for the target environment | `pac auth create -u [Dataverse URL]` | Yes |
| 2.2 | **List available websites** | Retrieve list of all websites in the org | `pac pages list` | Yes |
| 2.3 | **Identify target site** | User selects which site to migrate; capture `WebSiteId` GUID | Interactive selection | Guided |
| 2.4 | **Validate template compatibility** | Check that the site's template is in the supported list | Cross-reference with supported templates | Yes |

### Phase 3: Customization Report & Analysis

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 3.1 | **Download customization report** | Generate report of all customizations on the SDM site | `pac pages migrate-datamodel --webSiteId [GUID] --siteCustomizationReportPath [PATH]` | Yes |
| 3.2 | **Parse customization report** | Read and categorize all customizations found | File parsing | Yes |
| 3.3 | **Identify custom columns on adx tables** | Flag any custom columns added to `adx_*` metadata tables | Report analysis | Yes |
| 3.4 | **Identify custom table relationships** | Flag relationships between custom tables and `adx_*` tables | Report analysis | Yes |
| 3.5 | **Identify adx references in Liquid code** | Flag Liquid snippets using `entities['adx_*']` patterns | Report analysis + code grep | Yes |
| 3.6 | **Identify adx references in FetchXML** | Flag FetchXML queries using `adx_*` entity names | Report analysis + code grep | Yes |
| 3.7 | **Identify custom workflows/plugins** | Flag workflows/plugins registered on `adx_*` tables | Report analysis | Yes |
| 3.8 | **Generate remediation plan** | Produce a summary of all found issues with fix instructions per type | Aggregation | Yes |
| 3.9 | **Present findings to user** | Show the user a clear summary and get approval to proceed | Interactive | Guided |

### Phase 4: Pre-Migration Safety

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 4.1 | **Determine if production site** | Ask user whether this is a production or dev/test site | Interactive | Guided |
| 4.2 | **Document current site state** | Capture site URL, `/_services/about` portal ID, and key config for rollback reference | Bash + manual | Yes |

> **Note:** The Microsoft doc recommends creating a full environment copy before production migration, but this is an admin center operation outside the skill's scope. The skill will surface this as advisory guidance only — not as an automated step.

### Phase 5: Migration Execution

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 5.1 | **Check EDM template solutions** | Verify if the required EDM-compatible solutions exist for the site's template. Some templates (Program Registration, Schedule & Manage Meetings) require matching EDM packages. | Manual check | Guided |
| 5.2 | **Provision EDM solutions if missing** | If EDM solutions are missing, guide the user to create a dummy EDM site for the same template — this installs the required EDM-compatible solutions in the environment. The dummy site can be deleted after migration. | Guide user through site creation | Guided |
| 5.3 | **Prompt user for migration mode** | Ask user which migration mode to use: `configurationData` (metadata only), `configurationDataReferences` (transactional data only), or `all` (both). Explain the difference and recommend `all` for most cases. | Interactive | Guided |
| 5.4 | **Execute migration** | Run the migration with the user's chosen mode | `pac pages migrate-datamodel --webSiteId [GUID] --mode [chosen-mode]` | Yes |

> **Migration modes explained:**
> - `configurationData` — Migrates site metadata (web pages, web templates, site settings, content snippets, etc. — the virtual tables)
> - `configurationDataReferences` — Migrates transactional/non-configuration data (nonconfiguration tables)
> - `all` — Migrates both types in one go (recommended for most scenarios)

> **Note:** The migration command processes records in batches of 5K. Large sites may take longer.

### Phase 6: Migration Verification

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 6.1 | **Check migration status** | Poll migration status until complete | `pac pages migrate-datamodel --webSiteId [GUID] --checkMigrationStatus` | Yes |
| 6.2 | **Handle long-running migrations** | If migration takes long (large data volumes), advise user and re-check status | Re-run status check | Guided |
| 6.3 | **Confirm migration success** | Verify status returns success before proceeding | Status check | Yes |

### Phase 7: Update Data Model Version

| # | Task | Description | PAC CLI Command | Automated? |
|---|------|-------------|-----------------|------------|
| 7.1 | **Retrieve Portal ID** | Get Portal GUID from `/_services/about` endpoint (requires web role with website access permissions) | `browser_navigate` or manual | Guided |
| 7.2 | **Update data model version** | Switch the site to use EDM | `pac pages migrate-datamodel --webSiteId [GUID] --updateDatamodelVersion --portalId [Portal-GUID]` | Yes |
| 7.3 | **Confirm version update** | Verify the SDM website record is deactivated and EDM record is active | Status check + site browse | Yes |

### Phase 8: Post-Migration Customization Remediation (Manual — Guided Instructions)

All customization fixes happen AFTER migration to EDM. The skill will present the user with a checklist of what to fix based on the customization report from Phase 3, along with step-by-step instructions. The user performs these fixes manually via the Data workspace / Power Platform UI.

#### 8A: Custom Columns on adx Metadata Tables

For each custom column found on an `adx_*` table, instruct the user to:
1. Create a new custom table (e.g., `contoso_webpage`) in the Data workspace
2. Add the custom column (e.g., `contoso_pagetype`) to the new table
3. Add a lookup column associated with `powerpagescomponent`
4. Migrate data from the old custom column to the new table

#### 8B: Relationships Between Custom Tables and adx Tables

For each relationship found between custom tables and `adx_*` tables, instruct the user to:
1. Create a new relationship replacing the `adx_*` side with `powerpagecomponent` (e.g., `powerpagecomponent_contoso_pagelogs`)
2. Verify the new relationship works and data is accessible

#### 8C: adx Table References in Liquid Code

For each Liquid reference found, instruct the user to:
1. Replace `entities['adx_*']` with the corresponding Liquid object (e.g., `entities['adx_weblinks']` → `weblinks`)
2. Where no direct Liquid object exists, use `powerpagecomponent` table with `powerpagecomponenttype` filter
3. Test affected pages to confirm rendering

#### 8D: adx Table References in FetchXML

For each FetchXML reference found, instruct the user to:
1. Replace `adx_*` entity name with `powerpagecomponent`
2. Add a filter on `powerpagecomponenttype` using the component type reference table
3. Test that rewritten queries return correct data

#### 8E: Custom Workflows and Plugins on adx Tables

For each workflow/plugin found, instruct the user to:
1. Refactor the code to target `powerpagecomponent` instead of the `adx_*` table
2. Update attribute references accordingly
3. Re-register and test the workflow/plugin

### Phase 9: Post-Migration Validation (Manual — Guided Checklist)

The skill will present the user with a validation checklist to work through manually:

- [ ] Browse all site pages — check for rendering issues
- [ ] Test forms and data operations (basic forms, advanced forms, lists)
- [ ] Test web API calls (if applicable)
- [ ] Test authentication flows (login, registration, role assignment)
- [ ] Check web roles and table permissions
- [ ] Validate pages that had Liquid/FetchXML customization fixes
- [ ] Run functional smoke tests on critical user journeys

### Phase 10: Rollback (If Needed)

| # | Task | Description | PAC CLI Command |
|---|------|-------------|-----------------|
| 10.1 | **Decide to rollback** | If validation fails and issues are blocking, decide to revert | Interactive |
| 10.2 | **Revert to SDM** | Switch site back to standard data model | `pac pages migrate-datamodel --webSiteId [GUID] --revertToStandardDataModel --portalId [Portal-GUID]` |
| 10.3 | **Verify rollback** | Confirm EDM website record is deactivated and SDM record is reactivated | Status check |

---

## Component Type Reference Table

For FetchXML and Liquid remediations, use this mapping from `adx_*` entity → `powerpagecomponenttype` value:

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

---

## Key PAC CLI Commands Summary

```bash
# Auth
pac auth create -u [Dataverse URL]

# List sites
pac pages list

# Download customization report
pac pages migrate-datamodel --webSiteId [GUID] --siteCustomizationReportPath [PATH]

# Migrate data
pac pages migrate-datamodel --webSiteId [GUID] --mode configurationData
pac pages migrate-datamodel --webSiteId [GUID] --mode configurationDataReferences
pac pages migrate-datamodel --webSiteId [GUID] --mode all

# Check status
pac pages migrate-datamodel --webSiteId [GUID] --checkMigrationStatus

# Update version
pac pages migrate-datamodel --webSiteId [GUID] --updateDatamodelVersion --portalId [Portal-GUID]

# Rollback
pac pages migrate-datamodel --webSiteId [GUID] --revertToStandardDataModel --portalId [Portal-GUID]
```

---

## Known Limitations

1. **5K record batch limit** — Migration command processes only 5K records per batch; large sites take longer
2. **Preview feature** — Not officially GA; behavior may change
3. **Template restrictions** — D365 portal templates (Community, Customer Self Service, Employee Self Service, Partner) can't be migrated from SDM
4. **EDM solutions required** — Some templates (Program Registration, Schedule & Manage Meetings) require EDM-compatible solutions to be provisioned first by creating a new EDM site for that template

---

## Production Migration Strategy

The Microsoft doc recommends creating a full environment copy before production migration. If feasible:

```
1. (Optional, recommended) Create copy of production environment via Admin Center
2. Run full migration (Phases 1-9) on the copy to validate
3. Add site configuration data to a managed solution
4. Import managed solution to production environment
5. Use PAC CLI to migrate nonconfiguration data on production
6. Update data model version on production
7. Conduct production validation
```

> The skill will surface this as advisory guidance. Environment copy is an Admin Center operation with no PAC CLI API — the skill cannot automate it. Always schedule production migration during non-business hours.

---

## Open Questions / Decisions Needed

- [ ] Should the skill automate the customization report parsing or just guide the user through it?
- [ ] Should Phase 8 (remediation) be a separate sub-skill or part of this skill?
- [ ] How to handle the 5K batch limit — should the skill loop/retry automatically?
- [ ] Should we add Playwright-based validation (browse site pages post-migration)?
- [ ] What level of rollback automation is appropriate vs. manual guidance?
- [ ] Should production migration be a separate skill given its extra complexity?
