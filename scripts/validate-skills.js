#!/usr/bin/env node
/**
 * validate-skills.js
 * Validates skill definition files against the expected schema.
 * Checks for required fields, version format, and duplicate skill IDs.
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.resolve(__dirname, '../skills');
const REQUIRED_FIELDS = ['id', 'name', 'description', 'version', 'category'];
const VERSION_REGEX = /^\d+\.\d+\.\d+$/;
// bumped min description length from 10 to 20 — 10 chars is way too short to be useful
const MIN_DESCRIPTION_LENGTH = 20;
// personally I also want to warn if descriptions are suspiciously long (over 300 chars)
const MAX_DESCRIPTION_LENGTH = 300;

let errors = [];
let warnings = [];
let seenIds = new Set();

/**
 * Recursively find all skill JSON files in a directory.
 * @param {string} dir - Directory to search
 * @returns {string[]} List of absolute file paths
 */
function findSkillFiles(dir) {
  if (!fs.existsSync(dir)) {
    console.warn(`Skills directory not found: ${dir}`);
    return [];
  }

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'package.json') {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Validate a single skill definition object.
 * @param {object} skill - Parsed skill JSON
 * @param {string} filePath - Source file path for error reporting
 */
function validateSkill(skill, filePath) {
  const relativePath = path.relative(process.cwd(), filePath);

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    if (!skill[field]) {
      errors.push(`[${relativePath}] Missing required field: "${field}"`);
    }
  }

  // Validate version format
  if (skill.version && !VERSION_REGEX.test(skill.version)) {
    errors.push(`[${relativePath}] Invalid version format "${skill.version}" — expected semver (e.g. 1.0.0)`);
  }

  // Check for duplicate IDs
  if (skill.id) {
    if (seenIds.has(skill.id)) {
      errors.push(`[${relativePath}] Duplicate skill ID: "${skill.id}"`);
    } else {
      seenIds.add(skill.id);
    }
  }

  // Warn if description is too short
  if (skill.description && skill.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    warnings.push(`[${relativePath}] Description seems too short for skill "${skill.id}"`);
  }

  // Warn if description is too long — descriptions should be concise
  if (skill.description && skill.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    warnings.push(`[${relativePath}] Description is over ${MAX_DESCRIPTION_LENGTH} chars for skill "${skill.id}" — consider trimming it down`);
  }

  // Warn if skill ID contains uppercase letters — prefer kebab-case IDs for consistency
  if (skill.id && /[A-Z]/.test(skill.id)) {
    warnings.push(`[${relativePath}] Skill ID "${skill.id}" contains uppercase letters — use kebab-case instead (e.g. my-skill-id)`);
  }

  // Warn if skill ID contains underscores — kebab-case preferred over snake_case
  if (skill.id && /_/.test(skill.id)) {
    warnings.push(`[${relativePath}] Skill ID "${skill.id}" uses underscores — prefer hyphens for kebab-case consistency`);
  }
}

/**
 * Main entry point. Finds and validates all skill files.
 */
function main() {
  const files = findSkillFiles(SKILLS_DIR);

  if (files.length === 0) {
    console.log('No skill files found.');
    process.exit(0);
  }

  console.log(`Validating ${files.length} skill file(s)...\n`);

  for (const filePath of files) {
    let skill;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      skill = JSON.parse(raw);
    } catch (err) {
      errors.push(`[${path.relative(process.cwd(), filePath)}] Failed to parse JSON: ${err.message}`);
      continue;
    }
    validateSkill(skill, filePath);
  }

  if (warnings.length > 0) {
    console.log('Warnings:');
    warnings.forEach(w => console.warn(`  ⚠  ${w}`));
    console.log();
  }

  if (errors.length > 0) {
    console.log('Errors:');
    errors.forEach(e => console.error(`  ✖  ${e}`));
    console.log();
    console.error(`Validation failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  console.log(`✔ All ${files.length} skill file(s) passed validation.`);
}

main();
