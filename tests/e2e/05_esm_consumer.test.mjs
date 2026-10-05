/**
 * @file tests/e2e/05_esm_consumer.test.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * E2E TEST SUITE 5 — "Native ECMAScript Modules (ESM) Consumer"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Proves that modern ESM backends (Node.js with "type": "module", modern
 *   frameworks, bundlers, and TS with moduleResolution: "NodeNext" / "Bundler")
 *   can import from the ESM distribution without dual-package hazard or
 *   import resolution issues.
 */

import http from "node:http";
import express from "express";
import {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  InternalServerError,
  ErrorCode,
} from "../../dist/esm/index.js";
import { createExpressErrorHandler } from "../../dist/esm/express.js";

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${name}`);
    failed++;
  }
}

function request({ path, port }) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    }).on("error", reject);
  });
}

export async function run() {
  console.log(`\n📦  E2E Suite 5 — Native ESM (ECMAScript Modules) Consumer`);
  console.log("─────────────────────────────────────────────────────────────\n");

  // 1. ESM Named Imports & Inheritance
  console.log("📋  [1] ESM named imports and prototype chain");
  const err = new NotFoundError("ESM resource missing");
  assert(err instanceof AppError, "[1] NotFoundError instanceof AppError in ESM");
  assert(err instanceof Error, "[1] NotFoundError instanceof Error in ESM");
  assert(err.errorCode === ErrorCode.NOT_FOUND, "[1] ErrorCode.NOT_FOUND resolved in ESM");

  // 2. ESM Live Server HTTP Cycle
  console.log("\n📋  [2] ESM Live Express Server");
  const app = express();
  app.get("/esm-not-found", (_req, _res, next) => {
    next(new NotFoundError("ESM route not found"));
  });
  app.get("/esm-validation", (_req, _res, next) => {
    next(new ValidationError({ esmField: ["Required"] }));
  });
  app.get("/esm-native-error", (_req, _res, next) => {
    next(new Error("ESM unhandled error"));
  });

  app.use(createExpressErrorHandler({
    logger: { warn: () => {}, error: () => {} },
  }));

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  // Test 2a: 404 in ESM
  {
    const res = await request({ path: "/esm-not-found", port });
    assert(res.status === 404, "[2a] GET /esm-not-found → HTTP 404 in ESM");
    assert(res.body.success === false, "[2a] success is false");
    assert(res.body.error.code === ErrorCode.NOT_FOUND, "[2a] error.code === NOT_FOUND");
    assert(res.body.error.message === "ESM route not found", "[2a] message matches");
  }

  // Test 2b: 400 validation in ESM
  {
    const res = await request({ path: "/esm-validation", port });
    assert(res.status === 400, "[2b] GET /esm-validation → HTTP 400");
    assert(res.body.error.code === ErrorCode.VALIDATION_ERROR, "[2b] error.code === VALIDATION_ERROR");
    assert(Array.isArray(res.body.error.details.esmField), "[2b] validation details preserved");
  }

  // Test 2c: 500 error in ESM
  {
    const res = await request({ path: "/esm-native-error", port });
    assert(res.status === 500, "[2c] GET /esm-native-error → HTTP 500");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[2c] error.code === INTERNAL_SERVER_ERROR");
  }

  await new Promise((r) => server.close(r));

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  Suite 5 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((failed) => process.exit(failed > 0 ? 1 : 0));
}
