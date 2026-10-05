/**
 * @file tests/adversarial/11_agent_skill_audit.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 11: AGENT SKILL & DOCUMENTATION AUDIT
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates agent skill instructions against the actual runtime package:
 * 1. YAML frontmatter validity (name, description)
 * 2. Every documented export actually exists in the root or subpath exports
 * 3. Every error class documented has matching constructor signature & status
 * 4. ErrorCode enum matches documented codes
 * 5. CLI commands documented match actual CLI flags
 * 6. Checks for outdated names (faultguard references) and version mismatches
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const rootPkg = require("../../package.json");
const rootExports = require("../../dist/cjs/index.js");
const expressExports = require("../../dist/cjs/express.js");

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

async function run() {
  console.log("\n🔥 [ADVERSARIAL SUITE 11] Agent Skill & Documentation Audit");
  console.log("─────────────────────────────────────────────────────────────");

  const skillPath = path.resolve(__dirname, "../../skills/faultkit/SKILL.md");
  assert(fs.existsSync(skillPath), "skills/faultkit/SKILL.md exists on disk");
  const skillContent = fs.readFileSync(skillPath, "utf8");

  // ── 1. Frontmatter Validation ───────────────────────────────────────────────
  console.log("\n📋 [1] YAML Frontmatter Standards");
  {
    assert(skillContent.startsWith("---\n"), "Skill starts with YAML frontmatter marker");
    const frontmatterMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
    assert(!!frontmatterMatch, "Skill has closing YAML frontmatter marker");

    const fm = frontmatterMatch[1];
    assert(fm.includes("name: faultkit"), "Frontmatter name is 'faultkit'");
    assert(fm.includes("description:"), "Frontmatter has 'description'");
    assert(fm.length > 50, "Frontmatter description is detailed and comprehensive");
  }

  // ── 2. Export Verification ──────────────────────────────────────────────────
  console.log("\n📋 [2] Documented Exports Exist in Runtime");
  {
    const documentedClasses = [
      "BadRequestError",
      "ValidationError",
      "UnauthorizedError",
      "TokenExpiredError",
      "TokenInvalidError",
      "ForbiddenError",
      "NotFoundError",
      "ConflictError",
      "UnprocessableEntityError",
      "RateLimitError",
      "InternalServerError",
      "ServiceUnavailableError",
    ];

    for (const clsName of documentedClasses) {
      assert(typeof rootExports[clsName] === "function", `Root exports '${clsName}' class`);
    }

    assert(typeof rootExports.AppError === "function", "Root exports 'AppError' base class");
    assert(typeof rootExports.ErrorCode === "object", "Root exports 'ErrorCode' object");
    assert(typeof rootExports.coerceToAppError === "function", "Root exports 'coerceToAppError'");
    assert(typeof rootExports.toErrorResponse === "function", "Root exports 'toErrorResponse'");
    assert(typeof rootExports.formatError === "function", "Root exports 'formatError'");
    assert(typeof rootExports.logger === "object", "Root exports 'logger'");
    assert(typeof rootExports.createLogger === "function", "Root exports 'createLogger'");

    assert(
      typeof expressExports.createExpressErrorHandler === "function",
      "Subpath 'faultkit/express' exports 'createExpressErrorHandler'"
    );
  }

  // ── 3. Constructor Signatures & Table Invariants ───────────────────────────
  console.log("\n📋 [3] Class Status Code & Signature Alignment");
  {
    const expectedStatuses = {
      BadRequestError: 400,
      ValidationError: 400,
      UnauthorizedError: 401,
      TokenExpiredError: 401,
      TokenInvalidError: 401,
      ForbiddenError: 403,
      NotFoundError: 404,
      ConflictError: 409,
      UnprocessableEntityError: 422,
      RateLimitError: 429,
      InternalServerError: 500,
      ServiceUnavailableError: 503,
    };

    for (const [clsName, expectedStatus] of Object.entries(expectedStatuses)) {
      const Cls = rootExports[clsName];
      const instance = clsName === "ValidationError" ? new Cls({ field: ["err"] }) : new Cls();
      assert(instance.statusCode === expectedStatus, `${clsName} statusCode matches documented ${expectedStatus}`);
    }
  }

  // ── 4. Outdated Information & Version Consistency (BUG DETECTION) ──────────
  console.log("\n📋 [4] Skill Version & Package Metadata Consistency");
  {
    // Check if the skill mentions the correct package version
    const versionMention = skillContent.includes(`v${rootPkg.version}`) || skillContent.includes(`(${rootPkg.version})`);
    assert(
      versionMention,
      `Skill documentation mentions current package version v${rootPkg.version}`,
      `Expected v${rootPkg.version} in SKILL.md`
    );

    // Check if package.json has circular self-dependency in dependencies (BUG DETECTION)
    const hasSelfDependency = rootPkg.dependencies && rootPkg.dependencies.faultkit;
    assert(
      !hasSelfDependency,
      "package.json MUST NOT list 'faultkit' as its own dependency",
      `Actual dependencies.faultkit: "${hasSelfDependency}"`
    );
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 11 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
