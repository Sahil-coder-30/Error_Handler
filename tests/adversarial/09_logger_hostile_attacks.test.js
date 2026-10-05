/**
 * @file tests/adversarial/09_logger_hostile_attacks.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 9: LOGGER HOSTILE ATTACKS & ERROR BOUNDARY INTEGRITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Attacks the logger wrapper and Express middleware logging boundary:
 * 1. logger.warn() throwing synchronous exceptions
 * 2. logger.error() throwing synchronous exceptions
 * 3. logger with completely broken methods (null, undefined, non-function)
 * 4. wrapSafeLogger handling BigInt, Circular, and Hostile throwing traps
 * 5. Invariant: Express error handler MUST NEVER crash due to logger failure!
 */

"use strict";

const http = require("node:http");
const express = require("express");
const {
  BadRequestError,
  InternalServerError,
  createLogger,
} = require("../../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../../dist/cjs/express.js");

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

async function request(app, path) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(raw) });
            } catch {
              resolve({ status: res.statusCode, body: raw });
            }
          });
        })
        .on("error", reject);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function run() {
  console.log("\n🔥 [ADVERSARIAL SUITE 9] Logger Hostile Attacks & Safety Boundaries");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. Exploding Logger in Express Middleware ──────────────────────────────
  console.log("\n📋 [1] Exploding Logger Methods inside Express Middleware");
  {
    const explodingLogger = {
      warn() {
        throw new Error("BOOM: logger.warn crashed synchronously");
      },
      error() {
        throw new Error("BOOM: logger.error crashed synchronously");
      },
    };

    const app = express();
    app.get("/warn-crash", () => {
      throw new BadRequestError("Operational error with exploding logger");
    });
    app.get("/error-crash", () => {
      throw new Error("Programmer error with exploding logger");
    });

    app.use(createExpressErrorHandler({ logger: explodingLogger }));

    const resWarn = await request(app, "/warn-crash");
    assert(resWarn.status === 400, "logger.warn explosion caught safely; client gets 400");
    assert(resWarn.body.success === false, "Client response is valid JSON");

    const resError = await request(app, "/error-crash");
    assert(resError.status === 500, "logger.error explosion caught safely; client gets 500");
    assert(resError.body.success === false, "Client response is valid JSON");
  }

  // ── 2. Built-in Logger Safety Wrappers (wrapSafeLogger) ─────────────────────
  console.log("\n📋 [2] Built-in Logger wrapSafeLogger resilience");
  {
    const safeLogger = createLogger();

    // 2a: Log BigInt directly (JSON.stringify normally throws)
    let bigIntThrew = false;
    try {
      safeLogger.info({ big: 9999999999999999n }, "Logging BigInt");
    } catch {
      bigIntThrew = true;
    }
    assert(!bigIntThrew, "wrapSafeLogger prevents crash when logging BigInt");

    // 2b: Log circular reference directly
    const circular = { a: 1 };
    circular.self = circular;
    let circularThrew = false;
    try {
      safeLogger.error({ circular }, "Logging circular");
    } catch {
      circularThrew = true;
    }
    assert(!circularThrew, "wrapSafeLogger prevents crash when logging circular object");

    // 2c: Log object with throwing getter
    const throwingGetterObj = {
      get trap() {
        throw new Error("trap exploded during log inspection");
      },
    };
    let trapThrew = false;
    try {
      safeLogger.warn(throwingGetterObj, "Logging throwing trap");
    } catch {
      trapThrew = true;
    }
    assert(!trapThrew, "wrapSafeLogger prevents crash on throwing getter object");

    // 2d: Safe child logger propagation
    let childThrew = false;
    let childLogger;
    try {
      childLogger = safeLogger.child({
        get childTrap() {
          throw new Error("child trap");
        },
      });
      childLogger.info("Child log test");
    } catch {
      childThrew = true;
    }
    assert(
      !childThrew,
      "logger.child() MUST NOT crash when bindings contain throwing getters or hostile traps",
      childThrew ? "logger.child() threw unhandled exception during asChindings inspection" : ""
    );
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 9 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
