/**
 * @file tests/adversarial/runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * MASTER RUNNER FOR ADVERSARIAL TEST SUITE
 * ─────────────────────────────────────────────────────────────────────────────
 * Executes all 12 adversarial suites:
 * 1.  01_unknown_and_hostile_throws
 * 2.  02_database_and_mongoose_attacks
 * 3.  03_request_id_and_correlation
 * 4.  04_non_http_and_esm_transport
 * 5.  05_custom_codes_and_status_attacks
 * 6.  06_production_security_and_redaction
 * 7.  07_nested_causes_and_serialization
 * 8.  08_async_and_express_edge_cases
 * 9.  09_logger_hostile_attacks
 * 10. 10_cli_adversarial
 * 11. 11_agent_skill_audit
 * 12. 13_fuzz_property_and_metamorphic
 * 13. 14_mutation_verification
 */

"use strict";

const s1 = require("./01_unknown_and_hostile_throws.test.js");
const s2 = require("./02_database_and_mongoose_attacks.test.js");
const s3 = require("./03_request_id_and_correlation.test.js");
const s4 = require("./04_non_http_and_esm_transport.test.js");
const s5 = require("./05_custom_codes_and_status_attacks.test.js");
const s6 = require("./06_production_security_and_redaction.test.js");
const s7 = require("./07_nested_causes_and_serialization.test.js");
const s8 = require("./08_async_and_express_edge_cases.test.js");
const s9 = require("./09_logger_hostile_attacks.test.js");
const s10 = require("./10_cli_adversarial.test.js");
const s11 = require("./11_agent_skill_audit.test.js");
const s13 = require("./13_fuzz_property_and_metamorphic.test.js");
const s14 = require("./14_mutation_verification.test.js");

async function runAll() {
  console.log("============================================================");
  console.log("   RUNNING FAULTKIT ADVERSARIAL & ATTACK TEST MATRIX        ");
  console.log("============================================================\n");

  let totalPassed = 0;
  let totalFailed = 0;
  const allFailures = [];

  const suites = [
    { name: "Suite 1: Unknown & Hostile Throws", runner: s1.run },
    { name: "Suite 2: Database & Mongoose Attacks", runner: s2.run },
    { name: "Suite 3: Request ID & Concurrency", runner: s3.run },
    { name: "Suite 4: Non-HTTP & ESM Transport", runner: s4.run },
    { name: "Suite 5: Custom Codes & HTTP Status Attacks", runner: s5.run },
    { name: "Suite 6: Production Security & Redaction", runner: s6.run },
    { name: "Suite 7: Nested Causes & Serialization", runner: s7.run },
    { name: "Suite 8: Async & Express Edge Cases", runner: s8.run },
    { name: "Suite 9: Logger Hostile Attacks", runner: s9.run },
    { name: "Suite 10: CLI Adversarial Attacks", runner: s10.run },
    { name: "Suite 11: Agent Skill Audit", runner: s11.run },
    { name: "Suite 13: Fuzz & Metamorphic Properties", runner: s13.run },
    { name: "Suite 14: Mutation Verification", runner: s14.run },
  ];

  for (const suite of suites) {
    try {
      const res = await suite.runner();
      totalPassed += res.passed;
      totalFailed += res.failed;
      if (res.failures && res.failures.length > 0) {
        allFailures.push(...res.failures.map((f) => ({ ...f, suite: suite.name })));
      }
    } catch (err) {
      console.error(`💥 Fatal error running ${suite.name}:`, err);
      totalFailed++;
      allFailures.push({ testName: `Fatal error in ${suite.name}`, context: err.message, suite: suite.name });
    }
  }

  console.log("============================================================");
  console.log("   ADVERSARIAL ATTACK MATRIX SUMMARY                        ");
  console.log("============================================================");
  console.log(`  Total Tests Executed: ${totalPassed + totalFailed}`);
  console.log(`  Passed:               ${totalPassed}`);
  console.log(`  Failed (Bugs Found):  ${totalFailed}`);
  console.log("────────────────────────────────────────────────────────────");

  if (allFailures.length > 0) {
    console.log(`\n🚨 DISCOVERED BREAKAGES & DEFECTS (${allFailures.length}):`);
    allFailures.forEach((f, i) => {
      console.log(`\n  [#${i + 1}] [${f.suite}] ${f.testName}`);
      if (f.context) console.log(`       Details: ${f.context}`);
    });
  }

  console.log("\n============================================================\n");
  return { totalPassed, totalFailed, allFailures };
}

if (require.main === module) {
  runAll().then(({ totalFailed }) => {
    // Note: Do not exit with 1 during adversarial inspection reporting if we want to run both
    process.exit(totalFailed > 0 ? 1 : 0);
  });
}

module.exports = { runAll };
