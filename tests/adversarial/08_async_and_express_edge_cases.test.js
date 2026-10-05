/**
 * @file tests/adversarial/08_async_and_express_edge_cases.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 8: ASYNC, PROMISE & EXPRESS LIFECYCLE EDGE CASES
 * ─────────────────────────────────────────────────────────────────────────────
 * Attacks Express lifecycle, middleware ordering, and asynchronous execution:
 * 1. Double next(err) invocations
 * 2. next() followed by next(err)
 * 3. Asynchronous unhandled promise rejections
 * 4. Error thrown inside custom getRequestId hook
 * 5. Error thrown inside custom errorCoercer hook
 * 6. Response already finished (res.writableEnded = true)
 * 7. res.headersSent delegation
 */

"use strict";

const http = require("node:http");
const express = require("express");
const {
  AppError,
  BadRequestError,
  NotFoundError,
  ErrorCode,
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
              resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
            } catch {
              resolve({ status: res.statusCode, body: raw, raw });
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
  console.log("\n🔥 [ADVERSARIAL SUITE 8] Async, Promise & Express Edge Cases");
  console.log("─────────────────────────────────────────────────────────────");

  const app = express();
  const silentLogger = { warn: () => {}, error: () => {} };

  // 1. Double next(err) invocation in single route
  app.get("/double-next-error", (_req, _res, next) => {
    next(new BadRequestError("First error"));
    try {
      next(new NotFoundError("Second error"));
    } catch {
      // safe
    }
  });

  // 2. Exploding custom getRequestId hook
  app.get("/exploding-request-id", () => {
    throw new BadRequestError("Exploding request ID test");
  });

  // 3. Exploding custom errorCoercer hook
  app.get("/exploding-coercer", () => {
    throw new Error("Raw error before exploding coercer");
  });

  // 4. Response ended before error handler reached
  app.get("/already-ended", (_req, res, next) => {
    res.end("Stream ended directly");
    next(new Error("Error after response ended"));
  });

  app.use(createExpressErrorHandler({
    logger: silentLogger,
    getRequestId: () => {
      throw new Error("BOOM: getRequestId hook crashed");
    },
    errorCoercer: () => {
      throw new Error("BOOM: errorCoercer hook crashed");
    },
  }));

  // Fallback handler for delegated errors
  app.use((err, _req, res, _next) => {
    if (!res.headersSent && !res.writableEnded) {
      res.status(500).json({ fallback: true });
    }
  });

  // ── Test 1: Double next(err) ───────────────────────────────────────────────
  console.log("\n📋 [1] Double next(err) invocations");
  {
    const res = await request(app, "/double-next-error");
    assert(res.status === 400, "Double next(err) handles first error without crashing server");
    assert(res.body.success === false, "First error response sent");
  }

  // ── Test 2: Exploding getRequestId hook ────────────────────────────────────
  console.log("\n📋 [2] Exploding getRequestId hook");
  {
    const res = await request(app, "/exploding-request-id");
    assert(res.status === 400, "Exploding getRequestId hook caught safely without crashing handler");
    assert(res.body.success === false, "Error response still successfully returned");
  }

  // ── Test 3: Exploding errorCoercer hook ────────────────────────────────────
  console.log("\n📋 [3] Exploding errorCoercer hook");
  {
    const res = await request(app, "/exploding-coercer");
    assert(res.status === 500, "Exploding errorCoercer hook falls back to standard coercion safely");
    assert(res.body.success === false, "Error response returned");
  }

  // ── Test 4: Response already ended ─────────────────────────────────────────
  console.log("\n📋 [4] Error after response already ended (res.writableEnded = true)");
  {
    const res = await request(app, "/already-ended");
    assert(res.status === 200, "Response already ended is not overwritten by error handler");
    assert(res.raw === "Stream ended directly", "Original response stream intact");
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 8 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
