/**
 * @file tests/adversarial/07_nested_causes_and_serialization.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 7: NESTED CAUSES & ERROR SERIALIZATION ATTACKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Attacks serialization and cause chains:
 * 1. Error cause chains: A -> B -> C -> D
 * 2. Self-referential and circular causes: err.cause = err
 * 3. Non-Error causes (string, number, object, null)
 * 4. BigInt values inside error details (BUG DETECTION)
 * 5. Circular references inside operational error details (BUG DETECTION)
 * 6. Malicious / throwing toJSON() on thrown objects
 * 7. Exotic objects in details: Map, Set, Buffer, Date, RegExp, TypedArray
 */

"use strict";

const http = require("node:http");
const express = require("express");
const {
  AppError,
  BadRequestError,
  ValidationError,
  InternalServerError,
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
  console.log("\n🔥 [ADVERSARIAL SUITE 7] Nested Causes & Serialization Attacks");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. Error Cause Chains (A -> B -> C -> D) ────────────────────────────────
  console.log("\n📋 [1] Multi-Level Error Cause Chains");
  {
    const errD = new Error("Level D: Database disk read error");
    const errC = new Error("Level C: Repository failed to fetch user", { cause: errD });
    const errB = new Error("Level B: Service failed to authenticate", { cause: errC });
    const errA = new Error("Level A: HTTP Request handler failed", { cause: errB });

    let resp;
    let didThrow = false;
    try {
      resp = toErrorResponse(errA);
    } catch {
      didThrow = true;
    }
    assert(!didThrow, "4-level nested cause chain does not crash toErrorResponse");
    assert(resp.success === false, "Envelope success is false");
  }

  // ── 2. Circular Causes (err.cause = err) ───────────────────────────────────
  console.log("\n📋 [2] Circular Causes (err.cause = err)");
  {
    const circularCauseErr = new Error("Self-referencing cause error");
    circularCauseErr.cause = circularCauseErr;

    let resp;
    let didThrow = false;
    try {
      resp = toErrorResponse(circularCauseErr);
    } catch {
      didThrow = true;
    }
    assert(!didThrow, "Self-referencing cause does not cause infinite recursion in toErrorResponse");
    assert(resp.success === false, "Handles circular cause safely");

    // Mutual circular causes
    const err1 = new Error("Err 1");
    const err2 = new Error("Err 2");
    err1.cause = err2;
    err2.cause = err1;

    let respMutual;
    let mutualThrew = false;
    try {
      respMutual = toErrorResponse(err1);
    } catch {
      mutualThrew = true;
    }
    assert(!mutualThrew, "Mutual circular causes do not crash toErrorResponse");
  }

  // ── 3. Non-Error Causes (primitive / null causes) ───────────────────────────
  console.log("\n📋 [3] Non-Error Causes");
  {
    const strCause = new Error("Error with string cause", { cause: "raw string cause" });
    assert(!toErrorResponse(strCause).success, "String cause handled");

    const nullCause = new Error("Error with null cause", { cause: null });
    assert(!toErrorResponse(nullCause).success, "Null cause handled");

    const numCause = new Error("Error with number cause", { cause: 504 });
    assert(!toErrorResponse(numCause).success, "Number cause handled");
  }

  // ── 4. BigInt in Operational Error Details (BUG DETECTION) ─────────────────
  console.log("\n📋 [4] BigInt in Error Details (JSON Serialization Trap)");
  {
    // A financial or blockchain error containing BigInt details
    const bigIntErr = new BadRequestError("Transaction failed", {
      amountWei: 1000000000000000000n,
      txId: "0x123",
    });

    const app = express();
    app.get("/bigint-details", () => {
      throw bigIntErr;
    });
    app.use(createExpressErrorHandler({ logger: { warn: () => {}, error: () => {} } }));

    // In Express, res.json() calls JSON.stringify() which throws TypeError on BigInt!
    // The middleware MUST handle or serialize BigInt safely without crashing Express!
    let res;
    let crashed = false;
    try {
      res = await request(app, "/bigint-details");
    } catch (err) {
      crashed = true;
    }

    assert(
      !crashed && res && res.status === 400 && res.body && res.body.success === false,
      "Operational error with BigInt in details MUST NOT crash Express serialization into HTML dump",
      `Actual body type: ${typeof res.body}, body: ${typeof res.body === "string" ? res.body.slice(0, 100) : JSON.stringify(res.body)}`
    );
  }

  // ── 5. Circular Object in Operational Error Details (BUG DETECTION) ────────
  console.log("\n📋 [5] Circular Reference in Operational Error Details");
  {
    const circularObj = { name: "Order" };
    circularObj.self = circularObj;

    const circularDetailErr = new BadRequestError("Circular order details", circularObj);

    const app = express();
    app.get("/circular-details", () => {
      throw circularDetailErr;
    });
    app.use(createExpressErrorHandler({ logger: { warn: () => {}, error: () => {} } }));

    let res;
    let crashed = false;
    try {
      res = await request(app, "/circular-details");
    } catch (err) {
      crashed = true;
    }

    assert(
      !crashed && res && res.status === 400 && res.body && res.body.success === false,
      "Operational error with circular details MUST NOT crash Express serialization into HTML dump",
      `Actual body type: ${typeof res.body}, body: ${typeof res.body === "string" ? res.body.slice(0, 100) : JSON.stringify(res.body)}`
    );
  }

  // ── 6. Malicious / Throwing toJSON() Methods ────────────────────────────────
  console.log("\n📋 [6] Hostile toJSON() implementations");
  {
    const hostileToJsonErr = {
      name: "Error",
      message: "Hostile toJSON",
      toJSON() {
        throw new Error("Malicious toJSON exploded");
      },
    };

    let coerced;
    let threw = false;
    try {
      coerced = toErrorResponse(hostileToJsonErr);
    } catch {
      threw = true;
    }
    assert(!threw, "Hostile toJSON method does not crash toErrorResponse");
    assert(coerced.success === false, "Returns safe error envelope");
  }

  // ── 7. Exotic Types in Details ──────────────────────────────────────────────
  console.log("\n📋 [7] Exotic Types in Details (Map, Set, Date, RegExp, Buffer)");
  {
    const exoticErr = new BadRequestError("Exotic types", {
      date: new Date("2026-01-01T00:00:00Z"),
      regex: /^[a-z]+$/i,
      map: new Map([["k", "v"]]),
      set: new Set([1, 2, 3]),
      buf: Buffer.from("hello"),
    });

    let res;
    let threw = false;
    try {
      res = toErrorResponse(exoticErr);
      JSON.stringify(res);
    } catch {
      threw = true;
    }
    assert(!threw, "Exotic types in details can be serialized to JSON safely");
    assert(res.success === false, "Envelope is valid");
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 7 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
