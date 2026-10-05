#!/usr/bin/env node
/**
 * @file bin/faultguard.js
 * @description Safe, non-invasive CLI for FaultGuard.
 * Provides `init` command to install AI-agent native skills and instructions
 * into consumer projects (Antigravity, Cursor, Copilot, Claude).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PKG_ROOT = path.resolve(__dirname, "..");
const PKG_JSON = JSON.parse(
  fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")
);

const BUNDLED_SKILL_PATH = path.join(
  PKG_ROOT,
  "skills",
  "faultguard",
  "SKILL.md"
);

function printHelp() {
  console.log(`
FaultGuard CLI v${PKG_JSON.version}
A framework-agnostic, OpenAPI-compliant custom error handling package.

USAGE:
  npx faultguard <command> [options]

COMMANDS:
  init          Install agent skills and rules into your workspace
  info          Display package architecture and OpenAPI schema summary
  version       Show installed FaultGuard version
  help          Show this help message

OPTIONS FOR 'init':
  --target <agents|cursor|copilot|claude|all>
                Specify which coding agent ecosystem to configure:
                - agents:  Antigravity / Agent Skills standard (.agents/skills/faultguard/SKILL.md)
                - cursor:  Cursor AI rules (.cursor/rules/faultguard.mdc)
                - copilot: GitHub Copilot instructions (.github/copilot-instructions.md)
                - claude:  Claude Code instructions (CLAUDE.md)
                - all:     Generate integration for all supported agents
                (Default: auto-detects based on project layout, always includes 'agents')
  -f, --force   Overwrite existing files without prompting
  --dry-run     Preview changes without creating or writing any files
  -h, --help    Show help for init command

EXAMPLES:
  $ npx faultguard init
  $ npx faultguard init --target cursor
  $ npx faultguard init --target all --force
  $ npx faultguard info
`);
}

function printInfo() {
  console.log(`
FaultGuard Architecture & Contract Summary (v${PKG_JSON.version})
─────────────────────────────────────────────────────────────
Package:      ${PKG_JSON.name}
Description:  ${PKG_JSON.description}
License:      ${PKG_JSON.license}
Engines:      Node ${PKG_JSON.engines ? PKG_JSON.engines.node : ">=18.0.0"}

Exported Subpaths:
  - "faultguard"          Core error classes, types, and Grafana/Loki Pino logger
  - "faultguard/express"  Express error middleware factory (isolated peer dependency)
  - "faultguard/logger"   Direct subpath to Pino logger and serialization utilities

Guaranteed OpenAPI Error Shape:
  {
    "success": false,
    "error": {
      "code": "STRING_ENUM",
      "message": "Human-readable message",
      "details": null | Record<string, unknown>
    }
  }

Agent Skills:
  Canonical skill available at:
  - .agents/skills/faultguard/SKILL.md (install with: npx faultguard init)
`);
}

function getBundledSkillContent() {
  if (fs.existsSync(BUNDLED_SKILL_PATH)) {
    return fs.readFileSync(BUNDLED_SKILL_PATH, "utf8");
  }
  // Fallback to .agents/skills if run from source repo
  const altPath = path.join(PKG_ROOT, ".agents", "skills", "faultguard", "SKILL.md");
  if (fs.existsSync(altPath)) {
    return fs.readFileSync(altPath, "utf8");
  }
  throw new Error(`Bundled skill template not found at ${BUNDLED_SKILL_PATH}`);
}

function generateCursorMdc(skillContent) {
  // Strip YAML frontmatter from SKILL.md and add Cursor MDC frontmatter
  const body = skillContent.replace(/^---[\s\S]*?---\s*/, "");
  return `---
description: FaultGuard Error Handling and Pino Logging Guidelines
globs: ["**/*.ts", "**/*.js"]
---

${body}`;
}

function generateCopilotSnippet(skillContent) {
  const body = skillContent.replace(/^---[\s\S]*?---\s*/, "");
  return `\n\n<!-- BEGIN FAULTGUARD INSTRUCTIONS -->\n# FaultGuard Error Handling Guidelines\n\n${body}\n<!-- END FAULTGUARD INSTRUCTIONS -->\n`;
}

function generateClaudeSnippet(skillContent) {
  const body = skillContent.replace(/^---[\s\S]*?---\s*/, "");
  return `\n\n<!-- BEGIN FAULTGUARD INSTRUCTIONS -->\n# FaultGuard Guidelines\n\n${body}\n<!-- END FAULTGUARD INSTRUCTIONS -->\n`;
}

function writeFileSafely(targetPath, content, options) {
  const { force, dryRun } = options;
  const relPath = path.relative(process.cwd(), targetPath);

  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, "utf8");
    if (existing === content) {
      console.log(`  🔹 [Identical] ${relPath} (already up to date)`);
      return { status: "identical", path: relPath };
    }
    if (!force) {
      console.log(`  ⚠️  [Skipped]   ${relPath} (file exists; use --force to overwrite)`);
      return { status: "skipped", path: relPath };
    }
  }

  if (dryRun) {
    console.log(`  🔍 [Dry-Run]   Would write ${relPath}`);
    return { status: "dry-run", path: relPath };
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, content, "utf8");
  console.log(`  ✅ [Created]   ${relPath}`);
  return { status: "created", path: relPath };
}

function appendFileSafely(targetPath, snippet, marker, options) {
  const { force, dryRun } = options;
  const relPath = path.relative(process.cwd(), targetPath);

  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, "utf8");
    if (existing.includes(marker)) {
      console.log(`  🔹 [Identical] ${relPath} (instructions already present)`);
      return { status: "identical", path: relPath };
    }
    if (!force) {
      console.log(`  ⚠️  [Skipped]   ${relPath} (already exists without marker; use --force to append)`);
      return { status: "skipped", path: relPath };
    }
    if (dryRun) {
      console.log(`  🔍 [Dry-Run]   Would append to ${relPath}`);
      return { status: "dry-run", path: relPath };
    }
    fs.appendFileSync(targetPath, snippet, "utf8");
    console.log(`  ✅ [Appended]  ${relPath}`);
    return { status: "appended", path: relPath };
  }

  if (dryRun) {
    console.log(`  🔍 [Dry-Run]   Would create ${relPath}`);
    return { status: "dry-run", path: relPath };
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, snippet.trimStart(), "utf8");
  console.log(`  ✅ [Created]   ${relPath}`);
  return { status: "created", path: relPath };
}

function runInit(args) {
  let target = "auto";
  let force = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--target" && args[i + 1]) {
      target = args[++i].toLowerCase();
    } else if (arg === "-f" || arg === "--force") {
      force = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      return 0;
    }
  }

  console.log(`\n🛡️  Initializing FaultGuard AI-Agent Integration...`);
  if (dryRun) console.log("   (Dry-Run Mode: No files will be modified)\n");
  else console.log("");

  const skillContent = getBundledSkillContent();
  const cwd = process.cwd();
  const options = { force, dryRun };

  const targets = new Set();
  if (target === "all") {
    targets.add("agents");
    targets.add("cursor");
    targets.add("copilot");
    targets.add("claude");
  } else if (target === "auto") {
    // Default: Always install the canonical Agent Skill standard
    targets.add("agents");
    // Detect Cursor
    if (fs.existsSync(path.join(cwd, ".cursor"))) {
      targets.add("cursor");
    }
    // Detect GitHub
    if (fs.existsSync(path.join(cwd, ".github"))) {
      targets.add("copilot");
    }
  } else {
    targets.add(target);
  }

  const results = [];

  if (targets.has("agents") || targets.has("antigravity")) {
    const dest = path.join(cwd, ".agents", "skills", "faultguard", "SKILL.md");
    results.push(writeFileSafely(dest, skillContent, options));
  }

  if (targets.has("cursor")) {
    const dest = path.join(cwd, ".cursor", "rules", "faultguard.mdc");
    results.push(writeFileSafely(dest, generateCursorMdc(skillContent), options));
  }

  if (targets.has("copilot")) {
    const dest = path.join(cwd, ".github", "copilot-instructions.md");
    results.push(
      appendFileSafely(
        dest,
        generateCopilotSnippet(skillContent),
        "BEGIN FAULTGUARD INSTRUCTIONS",
        options
      )
    );
  }

  if (targets.has("claude")) {
    const dest = path.join(cwd, "CLAUDE.md");
    results.push(
      appendFileSafely(
        dest,
        generateClaudeSnippet(skillContent),
        "BEGIN FAULTGUARD INSTRUCTIONS",
        options
      )
    );
  }

  console.log("\n✨ FaultGuard agent integration setup complete!");
  console.log("   AI coding agents can now discover, inspect, and use FaultGuard rules.\n");
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "-h" || command === "--help" || command === "help") {
    printHelp();
    process.exit(0);
  }

  if (command === "-v" || command === "--version" || command === "version") {
    console.log(`v${PKG_JSON.version}`);
    process.exit(0);
  }

  if (command === "info") {
    printInfo();
    process.exit(0);
  }

  if (command === "init") {
    const exitCode = runInit(args.slice(1));
    process.exit(exitCode);
  }

  console.error(`Unknown command: '${command}'\nRun 'npx faultguard --help' for usage.`);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  runInit,
  printHelp,
  printInfo,
};
