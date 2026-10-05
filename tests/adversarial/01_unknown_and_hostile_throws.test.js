/**
 * @file tests/adversarial/01_unknown_and_hostile_throws.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 1: UNKNOWN & HOSTILE THROW ATTACKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggressively attacks coerceToAppError, toErrorResponse, and Express middleware
 * with hostile, esoteric, malformed, and non-standard JavaScript thrown values.
 */

"use strict";

const http = require("node:http");
const express = require("express");
const {
  AppError,
  InternalServerError,
  BadRequestError,
  ErrorCode,
  coerceToAppError,
  toErrorResponse,
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
  console.log("\n🔥 [ADVERSARIAL SUITE 1] Unknown & Hostile Throw Attacks");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. Native Built-in Errors ───────────────────────────────────────────────
  console.log("\n📋 [1] Standard Native Errors (TypeError, RangeError, URIError, SyntaxError, EvalError)");
  {
    const errors = [
      new TypeError("Cannot read properties of undefined"),
      new RangeError("Maximum call stack size exceeded"),
      new URIError("URI malformed"),
      new SyntaxError("Unexpected token in JSON"),
      new EvalError("Eval error occurred"),
    ];

    for (const err of errors) {
      const coerced = coerceToAppError(err);
      assert(coerced instanceof AppError, `coerceToAppError(${err.name}) returns AppError`);
      assert(coerced.statusCode === 500, `${err.name} maps to HTTP 500`);
      assert(coerced.errorCode === ErrorCode.INTERNAL_SERVER_ERROR, `${err.name} code is INTERNAL_SERVER_ERROR`);
      assert(coerced.isOperational === false, `${err.name} isOperational is false`);
    }
  }

  // ── 2. AggregateError (ES2021) with nested error list ───────────────────────
  console.log("\n📋 [2] AggregateError with multiple sub-errors");
  {
    const sub1 = new Error("Sub error 1");
    const sub2 = new TypeError("Sub error 2");
    const aggErr = new AggregateError([sub1, sub2], "Multiple database write failures");

    const coerced = coerceToAppError(aggErr);
    assert(coerced instanceof AppError, "AggregateError coerces to AppError");
    assert(coerced.statusCode === 500, "AggregateError maps to 500");
    assert(coerced.message === "Multiple database write failures", "AggregateError message preserved");

    // Check if sub-errors are preserved in details
    const formatted = toErrorResponse(aggErr, { isProduction: false });
    assert(formatted.success === false, "toErrorResponse handles AggregateError");
  }

  // ── 3. Primitive & Non-Object Throws ────────────────────────────────────────
  console.log("\n📋 [3] Primitive & Non-Object Thrown Values");
  {
    const primitives = [
      { val: "raw string error", desc: "string" },
      { val: "", desc: "empty string" },
      { val: "   \t\n   ", desc: "whitespace string" },
      { val: 0, desc: "number 0" },
      { val: 123, desc: "positive number" },
      { val: -404, desc: "negative number" },
      { val: NaN, desc: "NaN" },
      { val: Infinity, desc: "Infinity" },
      { val: true, desc: "boolean true" },
      { val: false, desc: "boolean false" },
      { val: Symbol("hostile_symbol"), desc: "Symbol" },
      { val: 9007199254740991n, desc: "BigInt" },
      { val: null, desc: "null" },
      { val: undefined, desc: "undefined" },
      { val: [1, 2, 3], desc: "Array of numbers" },
      { val: [new Error("inner")], desc: "Array of Error" },
      { val: function hostileFunc() { return "fail"; }, desc: "Function" },
    ];

    for (const { val, desc } of primitives) {
      let coerced;
      let didThrow = false;
      try {
        coerced = coerceToAppError(val);
      } catch (e) {
        didThrow = true;
      }
      assert(!didThrow, `coerceToAppError(${desc}) NEVER throws`);
      assert(coerced instanceof AppError, `coerceToAppError(${desc}) returns AppError`);
      assert(coerced.statusCode === 500, `coerceToAppError(${desc}) status is 500`);
      assert(coerced.isOperational === false, `coerceToAppError(${desc}) isOperational is false`);
    }
  }

  // ── 4. Getter Bombs & Hostile Proxies ───────────────────────────────────────
  console.log("\n📋 [4] Hostile Getter Bombs and Throwing Traps");
  {
    // Object whose getters explode on access
    const getterBomb = {
      get name() { throw new Error("BOOM: name getter exploded"); },
      get message() { throw new Error("BOOM: message getter exploded"); },
      get stack() { throw new Error("BOOM: stack getter exploded"); },
      get statusCode() { throw new Error("BOOM: statusCode getter exploded"); },
      get status() { throw new Error("BOOM: status getter exploded"); },
      get code() { throw new Error("BOOM: code getter exploded"); },
      get errors() { throw new Error("BOOM: errors getter exploded"); },
      get keyValue() { throw new Error("BOOM: keyValue getter exploded"); },
      get details() { throw new Error("BOOM: details getter exploded"); },
    };

    let coercedBomb;
    let bombThrew = false;
    try {
      coercedBomb = coerceToAppError(getterBomb);
    } catch {
      bombThrew = true;
    }
    assert(!bombThrew, "Hostile getter bomb does not crash coerceToAppError");
    assert(coercedBomb instanceof AppError, "Getter bomb produces AppError");
    assert(coercedBomb.statusCode === 500, "Getter bomb coerced to 500");

    // Hostile Proxy with traps on all meta operations
    const hostileProxy = new Proxy({}, {
      get(_target, prop) {
        throw new Error(`Trapped get for property '${String(prop)}'`);
      },
      has(_target, prop) {
        throw new Error(`Trapped has for property '${String(prop)}'`);
      },
      ownKeys() {
        throw new Error("Trapped ownKeys");
      },
      getOwnPropertyDescriptor() {
        throw new Error("Trapped getOwnPropertyDescriptor");
      },
    });

    let coercedProxy;
    let proxyThrew = false;
    try {
      coercedProxy = coerceToAppError(hostileProxy);
    } catch {
      proxyThrew = true;
    }
    assert(!proxyThrew, "Hostile proxy trap does not crash coerceToAppError");
    assert(coercedProxy instanceof AppError, "Hostile proxy produces AppError");
    assert(coercedProxy.statusCode === 500, "Hostile proxy coerced to 500");
  }

  // ── 5. Frozen, Sealed & Prototype-less Objects ─────────────────────────────
  console.log("\n📋 [5] Object.freeze, Object.seal, and Object.create(null)");
  {
    const frozenError = Object.freeze(new Error("Frozen native error"));
    const coercedFrozen = coerceToAppError(frozenError);
    assert(coercedFrozen.statusCode === 500, "Frozen native error coerced safely");

    const frozenCustom = Object.freeze({ statusCode: 403, message: "Forbidden attempt" });
    const coercedFrozenCustom = coerceToAppError(frozenCustom);
    assert(coercedFrozenCustom.statusCode === 403, "Frozen custom status object preserves status");

    const bareNullProto = Object.create(null);
    bareNullProto.message = "No prototype error";
    bareNullProto.statusCode = 404;
    const coercedBare = coerceToAppError(bareNullProto);
    assert(coercedBare.statusCode === 404, "Object.create(null) with 404 coerced correctly");
    assert(coercedBare.errorCode === ErrorCode.NOT_FOUND, "Object.create(null) mapped to NOT_FOUND");
  }

  // ── 6. Live Express Integration with Hostile Throws ────────────────────────
  console.log("\n📋 [6] Live Express Handling of Hostile Throws");
  {
    const app = express();
    const silentLogger = { warn: () => {}, error: () => {} };

    app.get("/throw-bigint", () => {
      throw 999999999999999999n;
    });

    app.get("/throw-symbol", () => {
      throw Symbol("hostile");
    });

    app.get("/throw-proxy", () => {
      throw new Proxy({}, {
        get() { throw new Error("Trap in express route"); },
      });
    });

    app.use(createExpressErrorHandler({ logger: silentLogger }));

    const resBigInt = await request(app, "/throw-bigint");
    assert(resBigInt.status === 500, "Express route throwing BigInt returns HTTP 500");
    assert(resBigInt.body.success === false, "BigInt response success is false");

    const resSymbol = await request(app, "/throw-symbol");
    assert(resSymbol.status === 500, "Express route throwing Symbol returns HTTP 500");
    assert(resSymbol.body.success === false, "Symbol response success is false");

    const resProxy = await request(app, "/throw-proxy");
    assert(resProxy.status === 500, "Express route throwing Proxy returns HTTP 500");
    assert(resProxy.body.success === false, "Proxy response success is false");
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 1 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
