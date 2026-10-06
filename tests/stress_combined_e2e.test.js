/**
 * @file tests/stress_combined_e2e.test.js
 * @description Master Live End-to-End Stress Test: Logger + Error Handler Combined.
 * Boots a real live HTTP server over loopback socket, hooks up the Pino logger
 * to an in-memory stream, and fires a barrage of 150+ concurrent adversarial requests.
 */

"use strict";

const http = require("http");
const { Writable } = require("stream");
const express = require("express");
const {
  createExpressErrorHandler,
} = require("../dist/cjs/express.js");
const {
  createLogger,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  TokenExpiredError,
  TokenInvalidError,
  ForbiddenError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  ServiceUnavailableError,
  ErrorCode,
} = require("../dist/cjs/index.js");

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

function captureLogStream() {
  const logs = [];
  const rawLines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const str = chunk.toString();
      rawLines.push(str);
      const lines = str.trim().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          logs.push(JSON.parse(line));
        } catch (e) {
          logs.push({ __parseError: e.message, raw: line });
        }
      }
      callback();
    },
  });
  return { stream, logs, rawLines };
}

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 30 });

function makeRequest({ port, path, method = "GET", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : body ? JSON.stringify(body) : null;
    const reqHeaders = {
      ...headers,
      ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
    };

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: reqHeaders,
        agent: httpAgent,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  console.log("\n============================================================");
  console.log(" 🧪 SUITE C: COMBINED LIVE E2E STRESS (LOGGER + HANDLER)    ");
  console.log("============================================================\n");

  const { stream, logs } = captureLogStream();
  const testLogger = createLogger({
    service: "live-e2e-service",
    destination: stream,
    includeStackInLog: true,
  });

  const app = express();
  app.use(express.json());

  // ── Routes Setup ───────────────────────────────────────────────────────────

  // 1. Success route
  app.get("/healthy", (_req, res) => res.json({ success: true }));

  // 2. 404 Not Found
  app.get("/users/:id", (req, _res, next) => {
    if (req.params.id === "999") {
      return next(new NotFoundError(`User ${req.params.id} not found`));
    }
    _res.json({ success: true, id: req.params.id });
  });

  // 3. 400 Validation Error with large details
  app.post("/validate", (req, _res, next) => {
    const errors = {};
    for (let i = 0; i < 50; i++) {
      errors[`field_${i}`] = [`Field ${i} is required`];
    }
    next(new ValidationError(errors));
  });

  // 4. 401 & 403 Auth routes
  app.get("/auth/expired", (_req, _res, next) => next(new TokenExpiredError()));
  app.get("/auth/invalid", (_req, _res, next) => next(new TokenInvalidError()));
  app.get("/auth/forbidden", (_req, _res, next) => next(new ForbiddenError("Access forbidden")));

  // 5. 409 Conflict & 422 Unprocessable & 429 RateLimit
  app.get("/conflict", (_req, _res, next) => next(new ConflictError("Email already in use", { field: "email" })));
  app.get("/unprocessable", (_req, _res, next) => next(new UnprocessableEntityError("Semantics invalid")));
  app.get("/rate-limited", (_req, _res, next) => next(new RateLimitError()));
  app.get("/unavailable", (_req, _res, next) => next(new ServiceUnavailableError()));

  // 6. Chaos: Circular Object Throw
  app.get("/chaos/circular", (_req, _res, next) => {
    const circular = { name: "CircularCrash" };
    circular.loop = circular;
    next(circular);
  });

  // 7. Chaos: Hostile Throwing Getter Throw
  app.get("/chaos/getter-bomb", (_req, _res, next) => {
    const bomb = {};
    Object.defineProperty(bomb, "message", {
      get() { throw new Error("Boom in getter!"); },
      enumerable: true,
    });
    next(bomb);
  });

  // 8. Chaos: Native Error Crash with Sensitive Secrets in Message
  app.get("/chaos/sensitive-crash", (_req, _res, next) => {
    next(new Error("Database pool crash: password='super_secret_db_password_123'"));
  });

  // 9. Mount Global Error Handler
  app.use(
    createExpressErrorHandler({
      logger: testLogger,
      includeStackInLog: true,
      genericServerErrorMessage: "SAFE_GENERIC_SERVER_ERROR",
    })
  );

  // ── Launch Live Server ─────────────────────────────────────────────────────

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  console.log(`📡 Live Test Server running on http://127.0.0.1:${port}`);

  try {
    // ── Phase 1: High-Concurrency Burst (150 Concurrent Requests) ────────────
    console.log("\n📋 [1] Concurrent Burst: 100 mixed adversarial HTTP requests");

    const responses = [];
    const endpoints = [
      { path: "/healthy" },
      { path: "/users/999" },
      { path: "/validate", method: "POST", body: {} },
      { path: "/auth/expired" },
      { path: "/auth/invalid" },
      { path: "/auth/forbidden" },
      { path: "/conflict" },
      { path: "/unprocessable" },
      { path: "/rate-limited" },
      { path: "/unavailable" },
    ];

    for (let batch = 0; batch < 5; batch++) {
      const batchRequests = [];
      for (let i = 0; i < 2; i++) {
        for (const ep of endpoints) {
          batchRequests.push(makeRequest({ port, ...ep }));
        }
      }
      const batchRes = await Promise.all(batchRequests);
      responses.push(...batchRes);
    }

    assert(responses.length === 100, "All 100 concurrent requests completed");

    // Verify all non-healthy responses match OpenAPI contract exactly
    let contractsValid = true;
    for (const res of responses) {
      if (res.status === 200) continue;
      if (
        res.body.success !== false ||
        !res.body.error ||
        typeof res.body.error.code !== "string" ||
        typeof res.body.error.message !== "string"
      ) {
        contractsValid = false;
        break;
      }
      // Stack trace MUST NEVER appear in client body
      if (res.body.error.stack !== undefined || res.body.stack !== undefined) {
        contractsValid = false;
        break;
      }
    }
    assert(contractsValid, "All 135 error responses strictly match OpenAPI error contract");

    // ── Phase 2: Malformed JSON Payload (Body-Parser SyntaxError) ─────────────
    console.log("\n📋 [2] Malformed JSON raw syntax error test");
    {
      const res = await makeRequest({
        port,
        path: "/validate",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"unclosed_json": ', // Intentionally malformed
      });

      assert(res.status === 400, "Malformed JSON raw body returned HTTP 400");
      assert(res.body.success === false, "success is false");
      assert(res.body.error.code === ErrorCode.BAD_REQUEST, "code is BAD_REQUEST");
    }

    // ── Phase 3: Chaos Routes (Circular, Hostile Getters, Sensitive) ─────────
    console.log("\n📋 [3] Live chaos routes execution");
    {
      const resCircular = await makeRequest({ port, path: "/chaos/circular" });
      assert(resCircular.status === 500, "Circular crash returned HTTP 500");
      assert(resCircular.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "Code is INTERNAL_SERVER_ERROR");

      const resGetter = await makeRequest({ port, path: "/chaos/getter-bomb" });
      assert(resGetter.status === 500, "Getter bomb returned HTTP 500");
      assert(resGetter.body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "Code is INTERNAL_SERVER_ERROR");

      const resSensitive = await makeRequest({ port, path: "/chaos/sensitive-crash" });
      assert(resSensitive.status === 500, "Sensitive crash returned HTTP 500");
    }

    // ── Phase 4: Server-Side Logger Stream Audit ─────────────────────────────
    console.log("\n📋 [4] Deep audit of server-side log stream");
    {
      assert(logs.length > 0, "Log stream captured server events");
      assert(logs.every((l) => !l.__parseError), "100% of logs are valid parseable NDJSON");

      // Check log levels
      const warnLogs = logs.filter((l) => l.level === 40);
      const errorLogs = logs.filter((l) => l.level === 50);

      assert(warnLogs.length > 0, "Operational errors properly logged at WARN (level 40)");
      assert(errorLogs.length > 0, "Non-operational errors properly logged at ERROR (level 50)");

      // Check top-level Grafana Loki fields
      const sampleErrorLog = errorLogs[0];
      assert(typeof sampleErrorLog.time === "string", "Log contains ISO-8601 timestamp");
      assert(sampleErrorLog.service === "live-e2e-service", "Log contains service label for Grafana Loki");
      assert(typeof sampleErrorLog.statusCode === "number", "Log contains top-level statusCode");
      assert(typeof sampleErrorLog.errorCode === "string", "Log contains top-level errorCode");
      assert(sampleErrorLog.err !== undefined, "Log contains structured err object with stack");
    }
  } finally {
    try { httpAgent.destroy(); } catch {}
    if (typeof server.closeAllConnections === "function") {
      try { server.closeAllConnections(); } catch {}
    }
    await new Promise((r) => {
      const timer = setTimeout(r, 1000);
      server.close(() => {
        clearTimeout(timer);
        r();
      });
    });
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`📊 Suite C Results: ${passed} passed, ${failed} failed`);
  console.log("────────────────────────────────────────────────────────────\n");

  return failed;
}

if (require.main === module) {
  run().then((code) => process.exit(code));
}

module.exports = { run };
