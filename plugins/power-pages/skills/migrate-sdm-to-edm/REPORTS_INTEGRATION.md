# HTML Reports Integration Guide

This document explains how to integrate the HTML report templates and generation scripts into the `migrate-sdm-to-edm` skill workflow.

## Folder Structure

```
plugins/power-pages/skills/migrate-sdm-to-edm/
├── assets/
│   ├── customization-report.html      # Template for customization report
│   ├── skill-execution-report.html    # Template for execution report
│   └── README.md                      # Template documentation
├── scripts/
│   └── generate-migration-reports.js  # Utility to generate reports from data
├── SKILL.md
└── DESIGN.md
```

## Workflow Integration

### Phase 3: Customization Report & Analysis

**Current flow (SKILL.md):**
1. Download customization report via PAC CLI
2. Parse and categorize findings
3. Present findings to user

**Enhanced flow with HTML reports:**
1. Download customization report via PAC CLI to `<REPORT_PATH>/SiteCustomization.csv`
2. Parse and categorize findings
3. **Generate HTML report:** Run the generation script
4. **Open in browser:** Share the file URL with the user
5. Present summary to user

**Implementation:**

```bash
# After Phase 3.1: Download Customization Report
pac pages migrate-datamodel --webSiteId "<WEBSITE_ID>" --siteCustomizationReportPath "./migration-report"

# After Phase 3.2: Parse findings
# ... parsing logic ...

# NEW: Generate HTML report
node "${CLAUDE_PLUGIN_ROOT}/skills/migrate-sdm-to-edm/scripts/generate-migration-reports.js" \
  --customization-report "./migration-report/SiteCustomization.csv" \
  --site-name "<SITE_NAME>" \
  --website-id "<WEBSITE_ID>" \
  --template-name "<TEMPLATE_NAME>" \
  --output-dir "./migration-reports"

# Share with user
echo "Customization report: file://$(pwd)/migration-reports/customization-report.html"
```

### Phase 8 & 10: Execution Report & Summary

**Current flow (SKILL.md):**
1. Present remediation checklist
2. Present final summary

**Enhanced flow with HTML reports:**
1. Generate comprehensive execution report during migration
2. **Open in browser:** Share the file URL with the user
3. Provide remediation guidance from the HTML report
4. Present final summary

**Implementation:**

```bash
# During/After Phase 5-7: Execution tracking
# Track all commands, results, and timing

# Before Phase 10: Generate execution report
node "${CLAUDE_PLUGIN_ROOT}/skills/migrate-sdm-to-edm/scripts/generate-migration-reports.js" \
  --site-name "<SITE_NAME>" \
  --website-id "<WEBSITE_ID>" \
  --portal-id "<PORTAL_ID>" \
  --template-name "<TEMPLATE_NAME>" \
  --output-dir "./migration-reports" \
  --execution-data "phase3,phase5,phase7" \
  --remediation-needed "true"

# Share with user
echo "Execution report: file://$(pwd)/migration-reports/skill-execution-report.html"
```

## Data Structures

### Customization Report CSV (from PAC CLI)

The CSV contains:
- **Type of customization** — Category (Liquid, Data Model Extension, Plugin, etc.)
- **Guidance** — Microsoft link to remediation docs
- **Snippet** — Code snippet or detail
- **Location** — File path or table name

Example:
```
Liquid contains adx references,https://go.microsoft.com/fwlink/?linkid=2247170,"{% assign homeurl = website.adx_partialurl %}","web-templates/header/Header.webtemplate.source.html"
Data Model Extension,https://go.microsoft.com/fwlink/?linkid=2247170,"Table name : adx_ad   Column name : mspp_websiteid","Table name : adx_ad"
```

### Execution Data Structure (to be tracked by skill)

During skill execution, collect:

```json
{
  "siteName": "Contoso Portal",
  "websiteId": "076bf556-9ae6-ee11-a203-6045bdf0328e",
  "portalId": "07f35d71-c45a-4a05-9702-8f127559e48e",
  "templateName": "Starter layout 1",
  "startTime": "2024-04-20T10:30:00Z",
  "prerequisites": [
    {
      "name": "PAC CLI Version",
      "required": "1.31.6 or higher",
      "actual": "1.32.1",
      "status": "success"
    }
  ],
  "pacCommands": [
    {
      "step": 1,
      "description": "Verify Authentication",
      "command": "pac auth who",
      "status": "success",
      "output": "Authenticated to https://org12345.crm.dynamics.com"
    },
    {
      "step": 2,
      "description": "List Available Sites",
      "command": "pac pages list",
      "status": "success",
      "output": "Found 3 websites"
    }
  ],
  "phases": [
    {
      "number": 1,
      "title": "Verify Prerequisites",
      "status": "completed",
      "results": [
        {
          "type": "success",
          "title": "PAC CLI Verified",
          "description": "PAC CLI version 1.32.1 meets minimum requirement"
        }
      ]
    }
  ],
  "customizations": {
    "liquidReferences": 8,
    "dataModelExtensions": 15,
    "pluginsRegistered": 2,
    "customWorkflows": 1
  },
  "remediationRequired": true,
  "remediationSteps": [
    {
      "type": "Liquid References",
      "count": 8,
      "guidance": "Replace adx_* Liquid objects with powerpagecomponent equivalents"
    }
  ],
  "endTime": "2024-04-20T10:45:00Z"
}
```

## Integration Points in SKILL.md

### Phase 3: Add HTML Report Generation

After step 3.3 (Present Findings), add:

```markdown
### 3.3a Generate and Share Customization Report

Generate an interactive HTML report of the customization findings:

\`\`\`powershell
node "${CLAUDE_PLUGIN_ROOT}/skills/migrate-sdm-to-edm/scripts/generate-migration-reports.js" \
  --customization-report "<REPORT_PATH>" \
  --site-name "<SITE_NAME>" \
  --website-id "<WEBSITE_ID>" \
  --template-name "<TEMPLATE_NAME>" \
  --output-dir "<OUTPUT_DIR>"
\`\`\`

Open the generated HTML report in your browser:
\`file://<OUTPUT_DIR>/customization-report.html\`
```

### Phase 10: Add Execution Report

After presenting the final summary, add:

```markdown
### Generate Execution Report

Generate a comprehensive HTML report of the entire migration execution:

\`\`\`powershell
node "${CLAUDE_PLUGIN_ROOT}/skills/migrate-sdm-to-edm/scripts/generate-migration-reports.js" \
  --site-name "<SITE_NAME>" \
  --website-id "<WEBSITE_ID>" \
  --portal-id "<PORTAL_ID>" \
  --template-name "<TEMPLATE_NAME>" \
  --output-dir "<OUTPUT_DIR>"
\`\`\`

The execution report includes:
- All PAC commands executed and their results
- Prerequisite verification status
- Migration phase details
- Customization analysis summary
- Remediation guidance
- Post-migration validation checklist
- Next steps

Open the report in your browser:
\`file://<OUTPUT_DIR>/skill-execution-report.html\`
```

## Using `browser_navigate` to Open Reports

In the Claude skill, after generating reports, use Playwright to open them in the user's browser:

```javascript
// Open customization report
await browser_navigate(`file://${path.resolve('./migration-reports/customization-report.html')}`);

// Take accessibility snapshot
const snapshot = await browser_snapshot();
console.log('Report loaded successfully');
```

Or inform the user of the file path for manual opening:

```
I've generated two detailed reports in the `migration-reports` folder:

1. **Customization Report**: Shows all customizations found
   Open: file://${pwd}/migration-reports/customization-report.html

2. **Execution Report**: Shows all migration steps and results
   Open: file://${pwd}/migration-reports/skill-execution-report.html

You can open these files in your browser to review the details.
```

## Development Notes

### Template Customization

If you need to modify the templates:

1. Edit `customization-report.html` or `skill-execution-report.html` in the `assets/` folder
2. Update the placeholder documentation in `assets/README.md`
3. Update the placeholder replacement logic in `generate-migration-reports.js`

### Adding New Customization Types

To add a new customization type badge:

1. Add the CSS class in the template (e.g., `.badge-newtype { ... }`)
2. Update the `badgeMap` in `generate-migration-reports.js`
3. Update the documentation

### CSV Parsing

The script uses `csv-parse` (npm package). Ensure it's available:

```bash
npm install csv-parse
```

Or modify the script to use a different CSV parser if needed.

## Sample Output

After running the generation script:

```
✓ Customization report generated: C:\path\to\migration-reports\customization-report.html
✓ Execution report generated: C:\path\to\migration-reports\skill-execution-report.html

Reports generated successfully!
Open in browser: file:///C:/path/to/migration-reports/customization-report.html
```

Both HTML files are self-contained (no external dependencies) and can be:
- Opened directly in any modern browser
- Saved for later reference
- Included in documentation
- Shared with stakeholders
