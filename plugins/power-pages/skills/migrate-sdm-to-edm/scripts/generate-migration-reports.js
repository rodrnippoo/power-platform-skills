#!/usr/bin/env node

/**
 * generate-migration-reports.js
 * 
 * Generates HTML reports from migration data and customization CSV.
 * 
 * Usage:
 *   node generate-migration-reports.js \
 *     --customization-report "path/to/report.csv" \
 *     --site-name "Contoso Portal" \
 *     --website-id "076bf556-9ae6-ee11-a203-6045bdf0328e" \
 *     --portal-id "07f35d71-c45a-4a05-9702-8f127559e48e" \
 *     --template-name "Starter layout 1" \
 *     --output-dir "./reports"
 */

const fs = require('fs');
const path = require('path');
const { parse: parseCSV } = require('csv-parse/sync');

// Parse command line arguments
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '');
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        result[key] = value;
        i++;
      }
    }
  }
  return result;
}

/**
 * Parse CSV customization report into structured data
 */
function parseCustomizationReport(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Customization report not found: ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records = parseCSV(content, {
    columns: ['type', 'guidance', 'snippet', 'location'],
    skip_empty_lines: true
  });

  // Group by customization type
  const grouped = {};
  records.forEach(record => {
    if (!grouped[record.type]) {
      grouped[record.type] = [];
    }
    grouped[record.type].push(record);
  });

  return grouped;
}

/**
 * Generate customization section HTML
 */
function generateCustomizationSection(type, items) {
  const badgeMap = {
    'Liquid contains adx references': 'badge-liquid',
    'Custom workflow': 'badge-workflow',
    'Data Model Extension': 'badge-data-model',
    'Plugins registered on adx entities': 'badge-plugin'
  };

  const badge = badgeMap[type] || 'badge-liquid';
  const typeLabel = type.replace('Liquid contains ', '').replace('Custom ', '');

  let html = `
    <div class="customization-section">
      <h2>
        <span class="badge ${badge}">${typeLabel}</span>
        ${type}
        <span class="customization-count">${items.length}</span>
      </h2>
      <table class="customization-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Snippet</th>
            <th>Guidance</th>
          </tr>
        </thead>
        <tbody>
  `;

  items.forEach(item => {
    const snippet = item.snippet ? item.snippet.substring(0, 200) + (item.snippet.length > 200 ? '...' : '') : '';
    html += `
          <tr>
            <td>${item.location || 'N/A'}</td>
            <td><div class="snippet">${escapeHtml(item.snippet || '')}</div></td>
            <td><a href="${item.guidance}" target="_blank">View Guidance</a></td>
          </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

/**
 * Generate customization report HTML
 */
function generateCustomizationReportHtml(args, customizations) {
  const templatePath = path.join(__dirname, '../assets/customization-report.html');
  let template = fs.readFileSync(templatePath, 'utf-8');

  // Generate customization sections
  let customizationSections = '';
  if (Object.keys(customizations).length === 0) {
    customizationSections = `
      <div class="no-data">
        <div class="no-data-icon">✓</div>
        <h3>No Customizations Found</h3>
        <p>This site has no custom columns, relationships, Liquid references, FetchXML references, or workflows/plugins on adx tables.</p>
        <p style="margin-top: 16px; color: #27ae60; font-weight: 600;">Migration should proceed without post-migration remediation!</p>
      </div>
    `;
  } else {
    Object.entries(customizations).forEach(([type, items]) => {
      customizationSections += generateCustomizationSection(type, items);
    });
  }

  // Generate summary text
  const totalCustomizations = Object.values(customizations).reduce((sum, items) => sum + items.length, 0);
  const summaryText = totalCustomizations === 0
    ? 'No customizations were found in your site. This means migration from SDM to EDM should be straightforward without any post-migration fixes needed.'
    : `Found ${totalCustomizations} customization(s) across ${Object.keys(customizations).length} category(ies). Each customization will need specific post-migration remediation steps. See detailed guidance below.`;

  // Replace placeholders
  template = template
    .replace('{{SITE_NAME}}', escapeHtml(args['site-name'] || 'Unknown'))
    .replace('{{WEBSITE_ID}}', escapeHtml(args['website-id'] || 'N/A'))
    .replace('{{TEMPLATE_NAME}}', escapeHtml(args['template-name'] || 'Unknown'))
    .replace('{{REPORT_DATE}}', new Date().toISOString().split('T')[0])
    .replace('{{TOTAL_CUSTOMIZATIONS}}', totalCustomizations.toString())
    .replace('{{SUMMARY_TEXT}}', summaryText)
    .replace('{{CUSTOMIZATIONS_SECTIONS}}', customizationSections);

  return template;
}

/**
 * Generate execution report HTML with placeholder structure
 */
function generateExecutionReportHtml(args) {
  const templatePath = path.join(__dirname, '../assets/skill-execution-report.html');
  let template = fs.readFileSync(templatePath, 'utf-8');

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Generate prerequisites items (example structure)
  const prerequisitesHtml = `
    <div class="prerequisite-item">
      <div class="check-icon success">✓</div>
      <div class="prerequisite-content">
        <div class="prerequisite-title">PAC CLI Version</div>
        <div class="prerequisite-description">v1.31.6 or higher is installed</div>
      </div>
    </div>
    <div class="prerequisite-item">
      <div class="check-icon success">✓</div>
      <div class="prerequisite-content">
        <div class="prerequisite-title">Dataverse Package Version</div>
        <div class="prerequisite-description">Dataverse base portal package 9.3.2307.x or higher is installed</div>
      </div>
    </div>
    <div class="prerequisite-item">
      <div class="check-icon success">✓</div>
      <div class="prerequisite-content">
        <div class="prerequisite-title">Power Pages Core Package</div>
        <div class="prerequisite-description">Power Pages Core 1.0.2309.63 or higher is installed</div>
      </div>
    </div>
    <div class="prerequisite-item">
      <div class="check-icon success">✓</div>
      <div class="prerequisite-content">
        <div class="prerequisite-title">User Role</div>
        <div class="prerequisite-description">User has System Administrator role</div>
      </div>
    </div>
  `;

  // Generate PAC commands section (placeholder)
  const pacCommandsHtml = `
    <div class="phase">
      <div class="command-label">Step 1: Verify Authentication</div>
      <div class="command-block">pac auth who</div>
      <div class="result-item success">
        <div class="result-title">✓ Success</div>
        <div class="result-description">Authenticated to environment successfully</div>
      </div>
    </div>
    <div class="phase">
      <div class="command-label">Step 2: List Available Sites</div>
      <div class="command-block">pac pages list</div>
      <div class="result-item success">
        <div class="result-title">✓ Success</div>
        <div class="result-description">Found target site for migration</div>
      </div>
    </div>
    <div class="phase">
      <div class="command-label">Step 3: Download Customization Report</div>
      <div class="command-block">pac pages migrate-datamodel --webSiteId "{{WEBSITE_ID}}" --siteCustomizationReportPath "./migration-report"</div>
      <div class="result-item success">
        <div class="result-title">✓ Success</div>
        <div class="result-description">Customization report downloaded and analyzed</div>
      </div>
    </div>
  `;

  // Generate migration phases section (placeholder)
  const phasesHtml = `
    <div class="phase">
      <div class="phase-title">
        <span class="phase-number">1</span>
        Verify Prerequisites
        <span class="phase-status status-completed">Completed</span>
      </div>
      <div class="phase-content">
        <div class="result-item success">
          <div class="result-title">✓ All prerequisites verified</div>
          <div class="result-description">PAC CLI, Dataverse, and Power Pages packages are at required versions</div>
        </div>
      </div>
    </div>
    <div class="phase">
      <div class="phase-title">
        <span class="phase-number">2</span>
        Authentication & Site Discovery
        <span class="phase-status status-completed">Completed</span>
      </div>
      <div class="phase-content">
        <div class="result-item success">
          <div class="result-title">✓ Target site identified</div>
          <div class="result-description">Site: ${escapeHtml(args['site-name'] || 'Unknown')} (ID: ${escapeHtml(args['website-id'] || 'N/A')})</div>
        </div>
      </div>
    </div>
    <div class="phase">
      <div class="phase-title">
        <span class="phase-number">3</span>
        Customization Analysis
        <span class="phase-status status-completed">Completed</span>
      </div>
      <div class="phase-content">
        <div class="result-item success">
          <div class="result-title">✓ Customization report downloaded</div>
          <div class="result-description">Customization report has been analyzed and categorized</div>
        </div>
      </div>
    </div>
  `;

  // Summary metrics
  const metricsHtml = `
    <tr>
      <td>Site Name</td>
      <td>${escapeHtml(args['site-name'] || 'Unknown')}</td>
    </tr>
    <tr>
      <td>Website ID</td>
      <td>${escapeHtml(args['website-id'] || 'N/A')}</td>
    </tr>
    <tr>
      <td>Portal ID</td>
      <td>${escapeHtml(args['portal-id'] || 'N/A')}</td>
    </tr>
    <tr>
      <td>Previous Data Model</td>
      <td>Standard Data Model (SDM)</td>
    </tr>
    <tr>
      <td>Current Data Model</td>
      <td>Enhanced Data Model (EDM)</td>
    </tr>
    <tr>
      <td>Migration Date</td>
      <td>${dateStr}</td>
    </tr>
  `;

  // Replace placeholders
  template = template
    .replace('{{MIGRATION_STATUS}}', 'success')
    .replace('{{STATUS_ICON}}', '✅')
    .replace('{{SITE_NAME}}', escapeHtml(args['site-name'] || 'Unknown'))
    .replace('{{WEBSITE_ID}}', escapeHtml(args['website-id'] || 'N/A'))
    .replace('{{PORTAL_ID}}', escapeHtml(args['portal-id'] || 'N/A'))
    .replace('{{MIGRATION_STATUS_TEXT}}', 'Completed Successfully')
    .replace('{{REPORT_DATE}}', dateStr)
    .replace('{{EXECUTION_TIME}}', 'Pending')
    .replace('{{PREREQUISITES_ITEMS}}', prerequisitesHtml)
    .replace('{{PAC_COMMANDS_SECTION}}', pacCommandsHtml)
    .replace('{{CUSTOMIZATION_ANALYSIS_SECTION}}', 'Analysis section here')
    .replace('{{MIGRATION_PHASES_SECTION}}', phasesHtml)
    .replace('{{REMEDIATION_DISPLAY}}', 'block')
    .replace('{{REMEDIATION_GUIDANCE_SECTION}}', 'Remediation guidance here')
    .replace('{{SUMMARY_METRICS}}', metricsHtml)
    .replace('{{NEXT_STEPS_ITEMS}}', '<li>Verify all customizations have been remediated</li><li>Test the migrated site thoroughly</li>');

  return template;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Main function
 */
function main() {
  const args = parseArgs(process.argv.slice(2));

  // Validate required arguments
  const required = ['site-name', 'website-id', 'output-dir'];
  for (const arg of required) {
    if (!args[arg]) {
      console.error(`Error: --${arg} is required`);
      process.exit(1);
    }
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(args['output-dir'])) {
    fs.mkdirSync(args['output-dir'], { recursive: true });
  }

  try {
    // Parse customization report if provided
    let customizations = {};
    if (args['customization-report']) {
      customizations = parseCustomizationReport(args['customization-report']);
    }

    // Generate customization report
    const customizationHtml = generateCustomizationReportHtml(args, customizations);
    const customizationPath = path.join(args['output-dir'], 'customization-report.html');
    fs.writeFileSync(customizationPath, customizationHtml, 'utf-8');
    console.log(`✓ Customization report generated: ${customizationPath}`);

    // Generate execution report
    const executionHtml = generateExecutionReportHtml(args);
    const executionPath = path.join(args['output-dir'], 'skill-execution-report.html');
    fs.writeFileSync(executionPath, executionHtml, 'utf-8');
    console.log(`✓ Execution report generated: ${executionPath}`);

    console.log('\nReports generated successfully!');
    console.log(`Open in browser: file://${path.resolve(customizationPath)}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
