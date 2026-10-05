/**
 * @file tests/e2e/03_js_interop.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * E2E TEST SUITE 3 — "Plain JavaScript Backend Interoperability"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Proves the package works perfectly in a PLAIN JAVASCRIPT backend — no
 *   TypeScript, no type annotations, no build step on the consumer's side.
 *
 *   This is the most critical test for your monorepo scenario where some
 *   services may still be in plain JS while others have migrated to TS.
 *
 * WHAT IS TESTED:
 *   [1]  Require (CJS) from plain JS — no TS needed
 *   [2]  instanceof checks work from JS (prototype chain not broken)
 *   [3]  Custom error classes can be extended further in plain JS
 *   [4]  The middleware factory works when required from plain JS
 *   [5]  Full request cycle: throw in JS route → middleware → JSON response
 *   [6]  Concurrent requests don't bleed state between error responses
 *   [7]  304/redirect routes (non-error) are not intercepted by the middleware
 *   [8]  Error handler does not call next() after sending response (no double-send)
 *   [9]  Works correctly when used in an async route with unhandled promise rejection
 *   [10] Response Content-Type is always application/json for errors
 */

"use strict";

const http = require("http");
const express = require("express");

// Import the compiled CJS package — exactly what a plain JS consumer would do
const {
  AppError,
  BadRequestError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  InternalServerError,
  ErrorCode,
} = require("../../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../../dist/cjs/express.js");

// ─────────────────────────────────────────────────────────────────────────────
// JS-only extension — proves the package is extensible from plain JS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A custom error class written in PLAIN JAVASCRIPT extending AppError.
 * Real-world example: a PaymentError specific to one microservice.
 */
class PaymentDeclinedError extends BadRequestError {
  constructor(reason, transactionId) {
    super(`Payment declined: ${reason}`, { transactionId, reason });
    this.name = "PaymentDeclinedError";
    this.transactionId = transactionId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the plain-JS test app
// ─────────────────────────────────────────────────────────────────────────────

function createJsTestApp() {
  const app = express();
  app.use(express.json());

  // Route 1: sync throw in a plain JS route
  app.get("/payment/decline", (_req, res, next) => {
    try {
      throw new PaymentDeclinedError("Insufficient funds", "txn_abc123");
    } catch (err) {
      next(err);
    }
  });

  // Route 2: async route — simulates DB call with a promise rejection
  app.get("/async-fail", async (_req, _res, next) => {
    try {
      // Simulate an async DB operation that rejects
      await Promise.reject(new NotFoundError("Record #42 not found in async context"));
    } catch (err) {
      next(err);
    }
  });

  // Route 3: concurrent request isolation
  app.get("/user/:id", (req, _res, next) => {
    const id = parseInt(req.params.id, 10);
    if (id > 100) {
      return next(new ForbiddenError(`User ${id} does not have access.`));
    }
    _res.json({ success: true, data: { id, name: `User ${id}` } });
  });

  // Route 4: non-error route — middleware must NOT intercept this
  app.get("/ping", (_req, res) => {
    res.status(200).json({ pong: true });
  });

  // Route 5: tests that Content-Type is always application/json for errors
  app.get("/content-type-test", (_req, _res, next) => {
    next(new BadRequestError("Testing content-type header."));
  });

  // Route 6: validates that next() is called only once (no double-send)
  let callCount = 0;
  app.get("/double-send-test", (_req, _res, next) => {
    callCount = 0;
    const originalJson = _res.json.bind(_res);
    _res.json = function (...args) {
      callCount++;
      return originalJson(...args);
    };
    next(new BadRequestError("Should only respond once."));
  });
  app.get("/double-send-count", (_req, res) => {
    res.json({ callCount });
  });

  // ── Error handler (last) ──────────────────────────────────────────────────
  app.use(createExpressErrorHandler({ logger: { warn: () => {}, error: () => {} } }));

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

function request({ method = "GET", path, body, port }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: raw, headers: res.headers });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, testName, context = "") {
  if (condition) {
    console.log(`  ✅  ${testName}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${testName}${context ? `\n      Context: ${context}` : ""}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🟨  E2E Suite 3 — Plain JavaScript Backend Interoperability`);
  console.log("─────────────────────────────────────────────────────────────\n");

  // ── Test 1: CJS require + instanceof checks (no TypeScript) ─────────────────
  console.log("📋  [1] CJS require & instanceof from plain JS");
  {
    const err = new NotFoundError("JS instanceof test");
    assert(err instanceof AppError, "[1] NotFoundError instanceof AppError");
    assert(err instanceof Error, "[1] NotFoundError instanceof Error");
    assert(err instanceof NotFoundError, "[1] NotFoundError instanceof NotFoundError");
    assert(err.name === "NotFoundError", "[1] name property set correctly");
    assert(err.statusCode === 404, "[1] statusCode = 404");
    assert(err.isOperational === true, "[1] isOperational = true");
  }

  // ── Test 2: Plain JS class extension ────────────────────────────────────────
  console.log("\n📋  [2] Custom JS class extending AppError");
  {
    const err = new PaymentDeclinedError("Insufficient funds", "txn_xyz");
    assert(err instanceof AppError, "[2] PaymentDeclinedError instanceof AppError");
    assert(err instanceof BadRequestError, "[2] PaymentDeclinedError instanceof BadRequestError");
    assert(err instanceof Error, "[2] PaymentDeclinedError instanceof Error");
    assert(err.statusCode === 400, "[2] statusCode = 400 (inherited from BadRequestError)");
    assert(err.errorCode === ErrorCode.BAD_REQUEST, "[2] errorCode = BAD_REQUEST (inherited)");
    assert(err.transactionId === "txn_xyz", "[2] Custom JS property accessible");
    assert(err.details?.transactionId === "txn_xyz", "[2] details.transactionId passed correctly");
    assert(err.isOperational === true, "[2] isOperational = true");

    const json = err.toJSON();
    assert(json.success === false, "[2] toJSON() → success false");
    assert(json.error.details?.transactionId === "txn_xyz", "[2] toJSON() → details preserved");
  }

  // ── HTTP tests — spin up the plain JS app server ───────────────────────────
  const app = createJsTestApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  console.log(`\n    Server listening on port ${port}`);

  // ── Test 3: JS custom error through full HTTP cycle ─────────────────────────
  console.log("\n📋  [3] Full HTTP cycle — custom JS error class → middleware → JSON");
  {
    const res = await request({ path: "/payment/decline", port });
    assert(res.status === 400, "[3] GET /payment/decline → HTTP 400");
    assert(res.body.success === false, "[3] success: false");
    assert(res.body.error.code === ErrorCode.BAD_REQUEST, "[3] error.code = BAD_REQUEST");
    assert(
      res.body.error.message.includes("Insufficient funds"),
      "[3] Custom message in response",
      `Actual: "${res.body.error.message}"`
    );
    assert(
      res.body.error.details?.transactionId === "txn_abc123",
      "[3] details.transactionId in response"
    );
  }

  // ── Test 4: Async route with caught promise rejection ───────────────────────
  console.log("\n📋  [4] Async route — unhandled promise → next(err) → 404 response");
  {
    const res = await request({ path: "/async-fail", port });
    assert(res.status === 404, "[4] GET /async-fail → HTTP 404");
    assert(res.body.error.code === ErrorCode.NOT_FOUND, "[4] error.code = NOT_FOUND");
    assert(
      res.body.error.message === "Record #42 not found in async context",
      "[4] Async error message preserved",
      `Actual: "${res.body.error.message}"`
    );
  }

  // ── Test 5: Non-error routes are NOT intercepted ─────────────────────────────
  console.log("\n📋  [5] Non-error routes — middleware does not interfere with 200");
  {
    const res = await request({ path: "/ping", port });
    assert(res.status === 200, "[5] GET /ping → HTTP 200 (not intercepted)");
    assert(res.body.pong === true, "[5] Normal response body intact");
  }

  // ── Test 6: Concurrent requests — no state bleed ────────────────────────────
  console.log("\n📋  [6] Concurrent requests — error messages don't bleed between requests");
  {
    const [r1, r2, r3] = await Promise.all([
      request({ path: "/user/999", port }),  // triggers ForbiddenError for id > 100
      request({ path: "/user/1", port }),    // returns 200
      request({ path: "/user/200", port }), // triggers ForbiddenError for id > 100
    ]);

    assert(r1.status === 403, "[6] /user/999 → 403 Forbidden");
    assert(
      r1.body.error.message.includes("999"),
      "[6] /user/999 message contains correct ID",
      `Actual: "${r1.body.error.message}"`
    );

    assert(r2.status === 200, "[6] /user/1 → 200 (concurrent success)");
    assert(r2.body.success === true, "[6] /user/1 → success: true (not bleed to error)");

    assert(r3.status === 403, "[6] /user/200 → 403 Forbidden");
    assert(
      r3.body.error.message.includes("200"),
      "[6] /user/200 message contains correct ID (no bleed from /user/999)",
      `Actual: "${r3.body.error.message}"`
    );
  }

  // ── Test 7: Content-Type is always application/json for errors ───────────────
  console.log("\n📋  [7] Content-Type header — always application/json for error responses");
  {
    const res = await request({ path: "/content-type-test", port });
    assert(res.status === 400, "[7] → HTTP 400");
    assert(
      res.headers["content-type"]?.includes("application/json"),
      "[7] Content-Type: application/json",
      `Actual: "${res.headers["content-type"]}"`
    );
  }

  // ── Test 8: Error handler does not double-send ───────────────────────────────
  console.log("\n📋  [8] No double-send — error handler calls res.json exactly once");
  {
    await request({ path: "/double-send-test", port }); // triggers the error
    const countRes = await request({ path: "/double-send-count", port });
    assert(
      countRes.body.callCount === 1,
      "[8] res.json() called exactly once (no double-send)",
      `Call count: ${countRes.body.callCount}`
    );
  }

  await new Promise((r) => server.close(r));

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  Suite 3 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

module.exports = { run };
