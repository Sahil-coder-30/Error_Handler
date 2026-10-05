/**
 * @file tests/adversarial/13_fuzz_property_and_metamorphic.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 13: FUZZ TESTING & METAMORPHIC PROPERTY TESTING
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Fuzzing coerceToAppError with 1,000 pseudo-random hostile inputs:
 *    - Random primitives, random objects, nested trees, circular references,
 *      throwing getters, proxies, symbols, bigints, arrays, functions.
 *    - Invariant: "coerceToAppError MUST NEVER THROW on ANY input".
 * 2. Invariant verification on toErrorResponse:
 *    - success is strictly false
 *    - error.code is string
 *    - error.message is string
 * 3. Metamorphic properties:
 *    - Invariance under requestId variation (only requestId changes)
 *    - Equivalence of toErrorResponse(err) and formatError(err)
 *    - Idempotence of coerceToAppError (coercing a coerced error returns identical object)
 */

"use strict";

const {
  AppError,
  BadRequestError,
  NotFoundError,
  InternalServerError,
  ErrorCode,
  coerceToAppError,
  toErrorResponse,
  formatError,
} = require("../../dist/cjs/index.js");

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

// Pseudo-random deterministic generator for repeatable fuzzing
function createRng(seed = 123456789) {
  let s = seed;
  return function next() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function generateRandomFuzzValue(rng, depth = 0) {
  if (depth > 5) return null;

  const choice = Math.floor(rng() * 16);
  switch (choice) {
    case 0: return null;
    case 1: return undefined;
    case 2: return rng() > 0.5 ? "" : "fuzz_str_" + rng().toString(36);
    case 3: return Math.floor(rng() * 1000) - 200;
    case 4: return rng() > 0.5;
    case 5: return Symbol("fuzz_sym");
    case 6: return BigInt(Math.floor(rng() * 1000000));
    case 7: return new Error("Fuzz native error " + rng());
    case 8: return new TypeError("Fuzz type error");
    case 9: {
      const arr = [];
      const len = Math.floor(rng() * 4);
      for (let i = 0; i < len; i++) {
        arr.push(generateRandomFuzzValue(rng, depth + 1));
      }
      return arr;
    }
    case 10: {
      const obj = {};
      const keys = ["name", "message", "statusCode", "status", "code", "errors", "keyValue", "details", "stack"];
      for (const k of keys) {
        if (rng() > 0.5) {
          obj[k] = generateRandomFuzzValue(rng, depth + 1);
        }
      }
      return obj;
    }
    case 11: {
      // Circular object
      const circ = { id: rng() };
      circ.loop = circ;
      return circ;
    }
    case 12: {
      // Throwing getter
      return {
        get message() { throw new Error("fuzz getter error"); },
        get statusCode() { return 500; },
      };
    }
    case 13: return Object.create(null);
    case 14: return Object.freeze({ name: "Frozen", code: 400 });
    case 15: return function dummyFuzzFn() {};
    default: return new Error("Default");
  }
}

async function run() {
  console.log("\n🔥 [ADVERSARIAL SUITE 13] Fuzz & Metamorphic Property Testing");
  console.log("─────────────────────────────────────────────────────────────");

  const rng = createRng(42);

  // ── 1. 1,000-Iteration Fuzz Invariant: NEVER THROW ────────────────────────
  console.log("\n📋 [1] 1,000-Iteration Fuzz Test on coerceToAppError & toErrorResponse");
  {
    const iterations = 1000;
    let threwCount = 0;
    let validEnvelopes = 0;

    for (let i = 0; i < iterations; i++) {
      const fuzzVal = generateRandomFuzzValue(rng);
      try {
        const coerced = coerceToAppError(fuzzVal);
        if (!(coerced instanceof AppError)) {
          threwCount++;
          continue;
        }

        const resp = toErrorResponse(fuzzVal, { isProduction: true });
        if (
          resp &&
          resp.success === false &&
          resp.error &&
          typeof resp.error.code === "string" &&
          typeof resp.error.message === "string"
        ) {
          validEnvelopes++;
        }
      } catch {
        threwCount++;
      }
    }

    assert(threwCount === 0, `1,000 random fuzz trials: coerceToAppError NEVER threw (crashes: ${threwCount})`);
    assert(validEnvelopes === iterations, `1,000 random fuzz trials: 100% returned valid OpenAPI envelopes`);
  }

  // ── 2. Metamorphic Invariant: Idempotence of Coercion ──────────────────────
  console.log("\n📋 [2] Metamorphic Property: Coercion Idempotence");
  {
    // coerceToAppError(coerceToAppError(x)) === coerceToAppError(x)
    const testCases = [
      new Error("Base error"),
      "string error",
      { name: "ValidationError", errors: { field: "err" } },
      new BadRequestError("Already AppError"),
    ];

    let allIdempotent = true;
    for (const tc of testCases) {
      const first = coerceToAppError(tc);
      const second = coerceToAppError(first);
      if (first !== second) {
        allIdempotent = false;
        break;
      }
    }
    assert(allIdempotent, "coerceToAppError is strictly idempotent: coerce(coerce(x)) === coerce(x)");
  }

  // ── 3. Metamorphic Invariant: Request ID Invariance ────────────────────────
  console.log("\n📋 [3] Metamorphic Property: Request ID Invariance");
  {
    // Formatting with requestId A vs requestId B must only change requestId fields
    const baseErr = new NotFoundError("User missing");
    const resA = toErrorResponse(baseErr, { requestId: "req-AAA" });
    const resB = toErrorResponse(baseErr, { requestId: "req-BBB" });

    assert(resA.error.code === resB.error.code, "error.code is invariant under requestId change");
    assert(resA.error.message === resB.error.message, "error.message is invariant under requestId change");
    assert(resA.error.details === resB.error.details, "error.details is invariant under requestId change");
    assert(resA.requestId === "req-AAA" && resB.requestId === "req-BBB", "requestId correctly specialized");
  }

  // ── 4. Metamorphic Invariant: Functional Alias Equivalence ─────────────────
  console.log("\n📋 [4] Metamorphic Property: toErrorResponse === formatError");
  {
    const err = new BadRequestError("Alias check", { a: 1 });
    const r1 = toErrorResponse(err, { requestId: "1" });
    const r2 = formatError(err, { requestId: "1" });
    assert(
      JSON.stringify(r1) === JSON.stringify(r2),
      "toErrorResponse and formatError produce strictly identical results"
    );
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 13 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
