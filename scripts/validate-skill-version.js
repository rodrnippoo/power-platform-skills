#!/usr/bin/env node
/**
 * Validates that skill versions follow semver and are properly incremented
 * when changes are detected. Used in CI to enforce versioning discipline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Parse a semver string into its components.
 * @param {string} version - semver string like "1.2.3"
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parseSemver(version) {
  const match = version && version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two semver objects. Returns true if `next` is greater than `current`.
 * @param {{ major, minor, patch }} current
 * @param {{ major, minor, patch }} next
 * @returns {boolean}
 */
function isVersionIncremented(current, next) {
  if (next.major > current.major) return true;
  if (next.major === current.major && next.minor > current.minor) return true;
  if (
    next.major === current.major &&
    next.minor === current.minor &&
    next.patch > current.patch
  )
    return true;
  return false;
}

/**
 * Get the version field from a skill JSON file on a given git ref.
 * Returns null if the file doesn't exist on that ref.
 * @param {string} filePath
 * @param {string} ref - git ref, e.g. "origin/main"
 * @returns {string | null}
 */
function getVersionAtRef(filePath, ref) {
  try {
    const content = execSync(`git show ${ref}:${filePath}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(content);
    return parsed.version || null;
  } catch {
    return null;
  }
}

/**
 * Find all skill JSON files that have been modified compared to a base ref.
 * @param {string} baseRef
 * @returns {string[]}
 */
function getChangedSkillFiles(baseRef) {
  try {
    const output = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      encoding: 'utf8',
    });
    return output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.endsWith('.json') && f.includes('skill'));
  } catch (err) {
    console.error('Failed to get changed files:', err.message);
    return [];
  }
}

function main() {
  const baseRef = process.env.BASE_REF || 'origin/main';
  const changedFiles = getChangedSkillFiles(baseRef);

  if (changedFiles.length === 0) {
    console.log('No skill files changed. Skipping version check.');
    process.exit(0);
  }

  let hasErrors = false;

  for (const filePath of changedFiles) {
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping deleted file: ${filePath}`);
      continue;
    }

    let current;
    try {
      current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      console.error(`❌ Could not parse ${filePath}`);
      hasErrors = true;
      continue;
    }

    const newVersion = current.version;
    const oldVersionStr = getVersionAtRef(filePath, baseRef);

    if (!oldVersionStr) {
      console.log(`✅ New skill file detected: ${filePath} (version: ${newVersion})`);
      continue;
    }

    const oldVersion = parseSemver(oldVersionStr);
    const nextVersion = parseSemver(newVersion);

    if (!nextVersion) {
      console.error(`❌ Invalid semver in ${filePath}: "${newVersion}"`);
      hasErrors = true;
      continue;
    }

    if (!isVersionIncremented(oldVersion, nextVersion)) {
      console.error(
        `❌ Version not incremented in ${filePath}: ${oldVersionStr} → ${newVersion}`
      );
      hasErrors = true;
    } else {
      console.log(
        `✅ Version properly incremented in ${filePath}: ${oldVersionStr} → ${newVersion}`
      );
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

main();
