/**
 * @file tests/cli.test.js
 * @description Unit and integration tests for the FaultKit CLI (bin/faultkit.js).
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

let passed = 0;
let failed = 0;

function assert(cond, name, context = "") {
  if (cond) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${name}${context ? `\n      Context: ${context}` : ""}`);
    failed++;
  }
}

const CLI_PATH = path.resolve(__dirname, "..", "bin", "faultkit.js");
const LEGACY_CLI_PATH = path.resolve(__dirname, "..", "bin", "faultguard.js");

function runCli(args, cwd = process.cwd(), script = CLI_PATH) {
  try {
    const stdout = execSync(`node "${script}" ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : "",
      stderr: err.stderr ? err.stderr.toString() : "",
    };
  }
}

function run() {
  console.log("\n🛠️  Testing FaultKit CLI");
  console.log("─────────────────────────────────────────────────────────────\n");

  // 1. Version flag
  console.log("📋 [1] --version and version command");
  {
    const res1 = runCli("--version");
    assert(res1.status === 0, "--version exits with code 0");
    assert(res1.stdout.trim().startsWith("v1."), "--version outputs version number");

    const res2 = runCli("version");
    assert(res2.status === 0, "version command exits with code 0");
    assert(res2.stdout.trim().startsWith("v1."), "version command outputs version");

    const resLegacy = runCli("--version", process.cwd(), LEGACY_CLI_PATH);
    assert(resLegacy.status === 0, "legacy faultguard CLI alias exits with 0");
    assert(resLegacy.stdout.trim().startsWith("v1."), "legacy CLI outputs version");
  }

  // 2. Help flag
  console.log("\n📋 [2] --help and help command");
  {
    const res = runCli("--help");
    assert(res.status === 0, "--help exits with code 0");
    assert(res.stdout.includes("npx faultkit <command>"), "Usage includes command syntax");
    assert(res.stdout.includes("init"), "Help lists 'init' command");
    assert(res.stdout.includes("info"), "Help lists 'info' command");
  }

  // 3. Info command
  console.log("\n📋 [3] info command");
  {
    const res = runCli("info");
    assert(res.status === 0, "info exits with code 0");
    assert(res.stdout.includes("Guaranteed OpenAPI Error Shape"), "Outputs OpenAPI schema contract");
    assert(res.stdout.includes("faultkit/express"), "Outputs Express subpath export");
  }

  // 4. Unknown command
  console.log("\n📋 [4] Unknown command error handling");
  {
    const res = runCli("nonexistent-command");
    assert(res.status === 1, "Exits with code 1 for unknown command");
    assert(res.stderr.includes("Unknown command"), "Outputs error message to stderr");
  }

  // 5. Init command in a clean temp directory
  console.log("\n📋 [5] init command in isolated directory");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "faultkit-cli-test-"));

    try {
      // 5a: Dry run
      const dryRes = runCli("init --dry-run", tempDir);
      assert(dryRes.status === 0, "init --dry-run exits with 0");
      assert(dryRes.stdout.includes("Dry-Run"), "Identifies dry-run mode");
      const expectedSkillPath = path.join(tempDir, ".agents", "skills", "faultkit", "SKILL.md");
      assert(!fs.existsSync(expectedSkillPath), "Dry run does not create file on disk");

      // 5b: Standard init (installs .agents/skills/faultkit/SKILL.md)
      const initRes = runCli("init", tempDir);
      assert(initRes.status === 0, "init exits with 0");
      assert(initRes.stdout.includes("[Created]"), "Reports created file");
      assert(fs.existsSync(expectedSkillPath), "SKILL.md is created on disk");

      const content = fs.readFileSync(expectedSkillPath, "utf8");
      assert(content.includes("name: faultkit"), "Skill content has correct frontmatter");
      assert(content.includes("Agent Decision Tree"), "Skill contains decision tree");

      // 5c: Idempotent re-run
      const rerunRes = runCli("init", tempDir);
      assert(rerunRes.status === 0, "Second init exits with 0");
      assert(rerunRes.stdout.includes("[Identical]"), "Detects identical file without error");

      // 5d: Target Cursor
      const cursorRes = runCli("init --target cursor", tempDir);
      assert(cursorRes.status === 0, "init --target cursor exits with 0");
      const cursorRulePath = path.join(tempDir, ".cursor", "rules", "faultkit.mdc");
      assert(fs.existsSync(cursorRulePath), "Cursor MDC rule created");
      const cursorContent = fs.readFileSync(cursorRulePath, "utf8");
      assert(cursorContent.includes("globs:"), "Cursor rule has globs in frontmatter");

      // 5e: Target All with --force
      const allRes = runCli("init --target all --force", tempDir);
      assert(allRes.status === 0, "init --target all exits with 0");
      assert(fs.existsSync(path.join(tempDir, ".github", "copilot-instructions.md")), "Copilot instructions created");
      assert(fs.existsSync(path.join(tempDir, "CLAUDE.md")), "CLAUDE.md created");
    } finally {
      // Clean up tempDir
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  CLI Test Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

if (require.main === module) {
  const code = run();
  process.exit(code === 0 ? 0 : 1);
}

module.exports = { run };
