/**
 * @file tests/adversarial/10_cli_adversarial.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 10: CLI ADVERSARIAL & EDGE-CASE ATTACKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Attacks CLI (bin/faultkit.js):
 * 1. Spaces in working directory paths
 * 2. Unicode in directory paths
 * 3. Invalid / unknown --target arguments (e.g. --target bogus)
 * 4. Partially initialized / existing corrupted files without --force
 * 5. Corrupted / unparseable package.json in working directory
 */

"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CLI_PATH = path.resolve(__dirname, "../../bin/faultkit.js");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, context = "") {
  if (condition) {
    console.log(`  ✅  ${testName}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${testName}${context ? `\n      Context: ${context}` : ""}`);
    failed++;
    failures.push({ testName, context });
  }
}

function runCli(args, cwd) {
  try {
    const stdout = execSync(`node "${CLI_PATH}" ${args}`, {
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

async function run() {
  console.log("\n🔥 [ADVERSARIAL SUITE 10] CLI Adversarial Attacks");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. Path with spaces ────────────────────────────────────────────────────
  console.log("\n📋 [1] Directory Path with Spaces");
  {
    const spacedDir = fs.mkdtempSync(path.join(os.tmpdir(), "faultkit test space "));
    try {
      const res = runCli("init", spacedDir);
      assert(res.status === 0, "CLI init succeeds in directory with spaces");
      const skillPath = path.join(spacedDir, ".agents", "skills", "faultkit", "SKILL.md");
      assert(fs.existsSync(skillPath), "Skill installed in directory with spaces");
    } finally {
      fs.rmSync(spacedDir, { recursive: true, force: true });
    }
  }

  // ── 2. Unicode in directory path ───────────────────────────────────────────
  console.log("\n📋 [2] Directory Path with Unicode");
  {
    const unicodeDir = fs.mkdtempSync(path.join(os.tmpdir(), "faultkit-테스트-🚀-"));
    try {
      const res = runCli("init", unicodeDir);
      assert(res.status === 0, "CLI init succeeds in unicode path");
      const skillPath = path.join(unicodeDir, ".agents", "skills", "faultkit", "SKILL.md");
      assert(fs.existsSync(skillPath), "Skill installed in unicode directory");
    } finally {
      fs.rmSync(unicodeDir, { recursive: true, force: true });
    }
  }

  // ── 3. Unknown --target argument validation (BUG DETECTION) ────────────────
  console.log("\n📋 [3] Invalid / Unknown --target Option");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "faultkit-target-test-"));
    try {
      const res = runCli("init --target nonexistent_agent_system", tempDir);
      assert(
        res.status !== 0,
        "CLI MUST exit with error code when unknown --target is specified (NOT exit 0 silently)",
        `Actual exit status: ${res.status}, stdout: ${res.stdout.trim()}`
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // ── 4. Overwrite Protection without --force ────────────────────────────────
  console.log("\n📋 [4] Overwrite Protection without --force");
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "faultkit-overwrite-test-"));
    try {
      const skillDir = path.join(tempDir, ".agents", "skills", "faultkit");
      fs.mkdirSync(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, "SKILL.md");
      fs.writeFileSync(skillPath, "# Custom User Skill That Must Not Be Overwritten", "utf8");

      // Run init without --force
      const res = runCli("init", tempDir);
      assert(res.status === 0, "CLI exits 0 without crashing on existing modified file");
      const content = fs.readFileSync(skillPath, "utf8");
      assert(
        content.includes("Custom User Skill That Must Not Be Overwritten"),
        "Existing user skill NOT overwritten without --force flag"
      );

      // Run init WITH --force
      const resForce = runCli("init --force", tempDir);
      assert(resForce.status === 0, "CLI with --force succeeds");
      const forcedContent = fs.readFileSync(skillPath, "utf8");
      assert(
        forcedContent.includes("name: faultkit"),
        "Existing file successfully overwritten when --force is supplied"
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 10 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
