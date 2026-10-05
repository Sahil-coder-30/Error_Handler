/**
 * @file tests/e2e/04_adversarial_and_edge_cases.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * E2E TEST SUITE 4 — "Adversarial Edge Cases & Real-World Chaos Testing"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Validates bulletproof resilience against real-world chaos, malicious/odd
 *   inputs, third-party library errors, and framework edge cases before publishing.
 *
 * SCENARIOS TESTED:
 *   1. Malformed JSON payload (Express express.json() throws SyntaxError status 400)
 *   2. res.headersSent guard (prevents ERR_HTTP_HEADERS_SENT Node crashes)
 *   3. throw null
 *   4. throw undefined
 *   5. throw 0
 *   6. throw false
 *   7. throw circular reference object
 *   8. throw Object.create(null) (object with no prototype)
 *   9. Third-party library error with err.status = 403 (e.g. CSRF protection)
 *   10. Third-party library error with err.statusCode = 429 (e.g. Redis rate limiter)
 *   11. Native Error with empty string message
 *   12. Third-party 503 error (e.g. AWS SDK ServiceUnavailable)
 */

"use strict";

const http = require("http");
const express = require("express");
const { createExpressErrorHandler } = require("../../dist/cjs/express.js");
const { ErrorCode, AppError } = require("../../dist/cjs/index.js");

function createChaosApp() {
  const app = express();

  // Route: Malformed JSON test (express.json() parses body and throws if invalid)
  app.post("/json-body", express.json(), (req, res) => {
    res.json({ ok: true, data: req.body });
  });

  // Route: headersSent edge case
  app.get("/headers-already-sent", (req, res, next) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("Starting stream...");
    // Simulate error after headers sent:
    next(new Error("Stream crashed midway"));
  });

  const faultguardMiddleware = createExpressErrorHandler({
    logger: { warn: () => {}, error: () => {} },
  });

  // Chaos throws: invoke the middleware directly for falsy values
  // (since Express router interprets next(null) / next(undefined) as 'no error, proceed to next route')
  app.get("/throw-null", (req, res, next) => {
    faultguardMiddleware(null, req, res, next);
  });

  app.get("/throw-undefined", (req, res, next) => {
    faultguardMiddleware(undefined, req, res, next);
  });

  app.get("/throw-zero", (req, res, next) => {
    faultguardMiddleware(0, req, res, next);
  });

  app.get("/throw-false", (req, res, next) => {
    faultguardMiddleware(false, req, res, next);
  });

  app.get("/throw-circular", (_req, _res, next) => {
    const circular = { name: "circular" };
    circular.self = circular;
    next(circular);
  });

  app.get("/throw-bare-object", (_req, _res, next) => {
    const bare = Object.create(null);
    bare.code = 123;
    next(bare);
  });

  app.get("/throw-empty-error", (_req, _res, next) => {
    next(new Error(""));
  });

  // Third-party library error emulation
  app.get("/third-party-csrf", (_req, _res, next) => {
    const err = new Error("invalid csrf token");
    err.status = 403;
    next(err);
  });

  app.get("/third-party-ratelimit", (_req, _res, next) => {
    const err = new Error("Too many login attempts");
    err.statusCode = 429;
    next(err);
  });

  app.get("/third-party-service-unavailable", (_req, _res, next) => {
    const err = new Error("Database cluster failover in progress");
    err.status = 503;
    next(err);
  });

  // Mount faultguard error handler
  app.use(faultguardMiddleware);

  // Fallback Express handler for headersSent case
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err, _req, res, _next) => {
    if (!res.writableEnded) {
      res.end();
    }
  });

  return app;
}

function request({ method = "GET", path, rawBody, headers = {}, port }) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        ...(rawBody ? { "Content-Length": Buffer.byteLength(rawBody) } : {}),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
        } catch {
          resolve({ status: res.statusCode, body: raw, raw });
        }
      });
    });

    req.on("error", reject);
    if (rawBody) req.write(rawBody);
    req.end();
  });
}

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

async function run() {
  console.log(`\n⚡  E2E Suite 4 — Adversarial & Chaos Testing`);
  console.log("─────────────────────────────────────────────────────────────\n");

  const app = createChaosApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  // 1. Malformed JSON payload from client
  console.log("📋  [1] Malformed JSON payload (express.json() SyntaxError status 400)");
  {
    const res = await request({
      method: "POST",
      path: "/json-body",
      rawBody: '{"invalid": json_without_quotes}',
      headers: { "Content-Type": "application/json" },
      port,
    });
    assert(res.status === 400, "[1] Malformed JSON → HTTP 400 (not 500)");
    assert(res.body.success === false, "[1] success === false");
    assert(res.body.error.code === ErrorCode.BAD_REQUEST, "[1] error.code === BAD_REQUEST");
    assert(typeof res.body.error.message === "string", "[1] readable message preserved");
  }

  // 2. res.headersSent protection
  console.log("\n📋  [2] res.headersSent safeguard (no ERR_HTTP_HEADERS_SENT crash)");
  {
    const res = await request({ path: "/headers-already-sent", port });
    assert(res.status === 200, "[2] Preserves initially sent headers without server crash");
    assert(res.raw.includes("Starting stream..."), "[2] Stream content received before error delegation");
  }

  // 3. Chaos: throw null
  console.log("\n📋  [3] Chaos: throw null");
  {
    const res = await request({ path: "/throw-null", port });
    assert(res.status === 500, "[3] throw null safely handled as HTTP 500");
    assert(res.body.success === false, "[3] success is false");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[3] INTERNAL_SERVER_ERROR");
  }

  // 4. Chaos: throw undefined
  console.log("\n📋  [4] Chaos: throw undefined");
  {
    const res = await request({ path: "/throw-undefined", port });
    assert(res.status === 500, "[4] throw undefined safely handled as HTTP 500");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[4] INTERNAL_SERVER_ERROR");
  }

  // 5. Chaos: throw 0
  console.log("\n📋  [5] Chaos: throw 0 (falsy number)");
  {
    const res = await request({ path: "/throw-zero", port });
    assert(res.status === 500, "[5] throw 0 handled as HTTP 500");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[5] INTERNAL_SERVER_ERROR");
  }

  // 6. Chaos: throw false
  console.log("\n📋  [6] Chaos: throw false (falsy boolean)");
  {
    const res = await request({ path: "/throw-false", port });
    assert(res.status === 500, "[6] throw false handled as HTTP 500");
    assert(res.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "[6] INTERNAL_SERVER_ERROR");
  }

  // 7. Chaos: throw circular reference object
  console.log("\n📋  [7] Chaos: throw circular reference object");
  {
    const res = await request({ path: "/throw-circular", port });
    assert(res.status === 500, "[7] Circular object does not crash serialization");
    assert(res.body.success === false, "[7] success is false");
  }

  // 8. Chaos: throw bare object (Object.create(null))
  console.log("\n📋  [8] Chaos: throw Object.create(null)");
  {
    const res = await request({ path: "/throw-bare-object", port });
    assert(res.status === 500, "[8] Prototype-less object handled safely as HTTP 500");
  }

  // 9. Chaos: throw empty Error
  console.log("\n📋  [9] Chaos: throw new Error('')");
  {
    const res = await request({ path: "/throw-empty-error", port });
    assert(res.status === 500, "[9] Empty error message handled safely");
    assert(typeof res.body.error.message === "string" && res.body.error.message.length > 0, "[9] Fallback message provided");
  }

  // 10. Third-party error with status = 403 (e.g. CSRF)
  console.log("\n📋  [10] Third-party error with .status = 403 (CSRF)");
  {
    const res = await request({ path: "/third-party-csrf", port });
    assert(res.status === 403, "[10] Third-party 403 recognized");
    assert(res.body.error.code === ErrorCode.FORBIDDEN, "[10] Mapped to FORBIDDEN");
  }

  // 11. Third-party error with statusCode = 429 (Rate limit)
  console.log("\n📋  [11] Third-party error with .statusCode = 429 (Rate limiting)");
  {
    const res = await request({ path: "/third-party-ratelimit", port });
    assert(res.status === 429, "[11] Third-party 429 recognized");
    assert(res.body.error.code === ErrorCode.RATE_LIMIT_EXCEEDED, "[11] Mapped to RATE_LIMIT_EXCEEDED");
  }

  // 12. Third-party error with status = 503 (Service unavailable)
  console.log("\n📋  [12] Third-party error with .status = 503 (Database failover)");
  {
    const res = await request({ path: "/third-party-service-unavailable", port });
    assert(res.status === 503, "[12] Third-party 503 recognized");
    assert(res.body.error.code === ErrorCode.SERVICE_UNAVAILABLE, "[12] Mapped to SERVICE_UNAVAILABLE");
  }

  await new Promise((r) => server.close(r));

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  Suite 4 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

module.exports = { run };
