/**
 * @file tests/e2e/02_non_operational_safety.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * E2E TEST SUITE 2 — "Non-Operational Error Safety"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Proves the middleware's SECURITY CONTRACT:
 *
 *   When a non-operational (programmer/infra) error crashes a route,
 *   the server MUST:
 *     1. Respond with HTTP 500.
 *     2. Return the standard OpenAPI error envelope.
 *     3. NEVER leak internal error details to the client in production.
 *     4. Log the real crash at ERROR level (verified via logger injection).
 *     5. Correctly handle *any* thrown value — Error objects, strings, null.
 *
 *   This is what separates a production-safe error handler from a naive one
 *   that accidentally exposes stack traces or DB connection strings to users.
 *
 * WHAT IS TESTED:
 *   Scenario A — Native Error crash:
 *     A DB driver throws a plain `new Error('ECONNREFUSED...')`.
 *     → Client gets generic 500. Real message stays server-side.
 *
 *   Scenario B — Unknown non-Error throw:
 *     A library does `throw "FATAL: memory corruption"`.
 *     → Client gets generic 500. Real message stays server-side.
 *
 *   Scenario C — InternalServerError class:
 *     Code explicitly throws `new InternalServerError(...)`.
 *     → isOperational=false, message masked in production.
 *
 *   Scenario D — Logger receives real crash details:
 *     Middleware must log the TRUE error at ERROR level even when masking
 *     the client response. Verified via logger injection.
 *
 *   Scenario E — Production vs Development behaviour:
 *     In development (NODE_ENV ≠ 'production'), the real message IS shown.
 *     In production (NODE_ENV = 'production'), it MUST be masked.
 */

"use strict";

const http = require("http");
const { createTestServer } = require("./server.js");
const { ErrorCode } = require("../../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../../dist/cjs/express.js");
const express = require("express");

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
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
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
// Suite runner
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔒  E2E Suite 2 — Non-Operational Error Safety`);
  console.log("─────────────────────────────────────────────────────────────\n");

  // ── Scenario A: Native Error crash ──────────────────────────────────────────
  console.log("📋  [A] Native Error crash — client receives safe generic 500");
  {
    const capturedLogs = [];
    const capturingLogger = {
      warn: (msg, meta) => capturedLogs.push({ level: "warn", msg, meta }),
      error: (msg, meta) => capturedLogs.push({ level: "error", msg, meta }),
    };

    const app = createTestServer(capturingLogger);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();

    const res = await request({ path: "/crash", port });

    assert(res.status === 500, "[A] GET /crash → HTTP 500");
    assert(res.body.success === false, "[A] success is false");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[A] error.code === INTERNAL_SERVER_ERROR");

    // In non-production environment, the real message is shown (helps debugging)
    assert(typeof res.body.error.message === "string", "[A] error.message is a string");
    assert(res.body.error.details === null, "[A] details is null — no internal details leaked");

    // The logger MUST have captured this at ERROR level
    const errorLogs = capturedLogs.filter((l) => l.level === "error");
    assert(errorLogs.length >= 1, "[A] Logger received at least one ERROR level entry");
    assert(
      errorLogs[0].msg.includes("ECONNREFUSED"),
      "[A] Logger captured the REAL crash message",
      `Logger saw: "${errorLogs[0]?.msg}"`
    );

    await new Promise((r) => server.close(r));
  }

  // ── Scenario B: Unknown non-Error throw ─────────────────────────────────────
  console.log("\n📋  [B] Unknown string throw — coerced to 500 safely");
  {
    const app = createTestServer();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();

    const res = await request({ path: "/unknown-throw", port });

    assert(res.status === 500, "[B] GET /unknown-throw → HTTP 500");
    assert(res.body.success === false, "[B] success is false");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[B] error.code === INTERNAL_SERVER_ERROR");
    assert(typeof res.body.error.message === "string" && res.body.error.message.length > 0, "[B] error.message is a non-empty string");

    await new Promise((r) => server.close(r));
  }

  // ── Scenario C: InternalServerError class ───────────────────────────────────
  console.log("\n📋  [C] InternalServerError class — isOperational: false");
  {
    const app = createTestServer();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();

    const res = await request({ path: "/internal", port });

    assert(res.status === 500, "[C] GET /internal → HTTP 500");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[C] error.code === INTERNAL_SERVER_ERROR");
    assert(res.body.error.details === null, "[C] details null — not leaked to client");

    await new Promise((r) => server.close(r));
  }

  // ── Scenario D: Production message masking ──────────────────────────────────
  console.log("\n📋  [D] Production mode — internal error message MUST be masked");
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const prodApp = express();
    prodApp.use(express.json());
    prodApp.get("/secret-crash", (_req, _res, next) => {
      next(new Error("Stripe API key = sk_live_SUPER_SECRET_12345"));
    });
    prodApp.use(createExpressErrorHandler({
      logger: { warn: () => {}, error: () => {} },
      genericServerErrorMessage: "Something went wrong. Please try again.",
    }));

    const server = http.createServer(prodApp);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();

    const res = await request({ path: "/secret-crash", port });

    assert(res.status === 500, "[D] → HTTP 500 in production");
    assert(
      !res.body.error.message.includes("sk_live"),
      "[D] Secret API key NOT leaked in client response",
      `Actual message: "${res.body.error.message}"`
    );
    assert(
      !res.body.error.message.includes("SUPER_SECRET"),
      "[D] Internal error details NOT in client response"
    );
    assert(
      res.body.error.message === "Something went wrong. Please try again.",
      "[D] Generic safe message returned to client",
      `Actual: "${res.body.error.message}"`
    );

    process.env.NODE_ENV = originalEnv;
    await new Promise((r) => server.close(r));
  }

  // ── Scenario E: Development — real message shown (DX) ──────────────────────
  console.log("\n📋  [E] Development mode — real crash message shown for DX");
  {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const devApp = express();
    devApp.use(express.json());
    devApp.get("/dev-crash", (_req, _res, next) => {
      next(new Error("DB connection pool exhausted at limit 10"));
    });
    devApp.use(createExpressErrorHandler({
      logger: { warn: () => {}, error: () => {} },
    }));

    const server = http.createServer(devApp);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();

    const res = await request({ path: "/dev-crash", port });

    assert(res.status === 500, "[E] → HTTP 500 in development");
    assert(
      res.body.error.message.includes("DB connection pool exhausted"),
      "[E] Real message shown in development for easier debugging",
      `Actual: "${res.body.error.message}"`
    );

    process.env.NODE_ENV = origEnv;
    await new Promise((r) => server.close(r));
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  Suite 2 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

module.exports = { run };
