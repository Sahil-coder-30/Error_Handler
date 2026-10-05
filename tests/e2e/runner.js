/**
 * @file tests/e2e/runner.js
 * @description Master runner for all 5 E2E test suites.
 */

"use strict";

const suite1 = require("./01_error_response_shape.test.js");
const suite2 = require("./02_non_operational_safety.test.js");
const suite3 = require("./03_js_interop.test.js");
const suite4 = require("./04_adversarial_and_edge_cases.test.js");
const suite6 = require("../logger.test.js");
const suiteStressLogger = require("../stress_logger_standalone.test.js");
const suiteStressErrorHandler = require("../stress_errorhandler_standalone.test.js");
const suiteStressCombined = require("../stress_combined_e2e.test.js");

async function runAll() {
  console.log("============================================================");
  console.log("   RUNNING ALL END-TO-END (E2E) & STRESS TESTS FOR FAULTKIT");
  console.log("============================================================");

  let totalFailures = 0;

  try {
    totalFailures += await suite1.run();
    totalFailures += await suite2.run();
    totalFailures += await suite3.run();
    totalFailures += await suite4.run();
    totalFailures += await suite6.run();
    totalFailures += await suiteStressLogger.run();
    totalFailures += await suiteStressErrorHandler.run();
    totalFailures += await suiteStressCombined.run();

    // Dynamically import ESM suite 5
    const suite5 = await import("./05_esm_consumer.test.mjs");
    totalFailures += await suite5.run();

    console.log("============================================================");
    if (totalFailures === 0) {
      console.log("  🎉 ALL 9 E2E, LOGGER & ADVERSARIAL STRESS SUITES PASSED! ");
      console.log("  Verified: CJS, ESM, Types, HTTP Contract, Pino Logging & Chaos.");
      console.log("  100% PRODUCTION READY & BATTLE TESTED FOR PRODUCTION.    ");
    } else {
      console.error(`  💥 ${totalFailures} test failure(s) detected across suites.`);
    }
    console.log("============================================================\n");

    process.exit(totalFailures > 0 ? 1 : 0);
  } catch (err) {
    console.error("Fatal error during E2E test execution:", err);
    process.exit(1);
  }
}

runAll();
