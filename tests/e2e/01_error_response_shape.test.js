/**
 * @file tests/e2e/01_error_response_shape.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * E2E TEST SUITE 1 — "OpenAPI Contract Compliance"
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURPOSE:
 *   Proves that EVERY error response from the Express app — regardless of
 *   the error type thrown — always returns the exact OpenAPI envelope shape:
 *
 *     { success: false, error: { code: string, message: string, details: any } }
 *
 *   This is the contract your frontend client depends on for type-safe state
 *   management. If this suite fails, your frontend's error boundary breaks.
 *
 * WHAT IS TESTED:
 *   - 404 Not Found          → correct status + envelope + custom message
 *   - 400 Validation Error   → field-level details passed through
 *   - 401 Unauthorized       → correct code and message
 *   - 401 Token Expired      → distinct TOKEN_EXPIRED code (not UNAUTHORIZED)
 *   - 403 Forbidden          → correct status and code
 *   - 409 Conflict           → details object preserved in response
 *   - 429 Rate Limited       → correct status and code
 *   - 200 Healthy            → success: true (sanity check)
 *
 * HOW IT WORKS:
 *   Spins up a real HTTP server on a random OS-assigned port,
 *   makes actual HTTP requests using Node's built-in `http` module,
 *   asserts the full response: status code + body structure + field values.
 *   No mocks. No stubs. No external test runner.
 */

"use strict";

const http = require("http");
const { createTestServer } = require("./server.js");
const { ErrorCode } = require("../../dist/cjs/index.js");

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper — wraps Node's http.request in a Promise
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ method?: string, path: string, body?: object, port: number }} opts
 * @returns {Promise<{ status: number, body: any }>}
 */
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
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
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
    console.error(`  ❌  FAILED: ${testName}${context ? `\n      ${context}` : ""}`);
    failed++;
  }
}

/**
 * Validates the OpenAPI error envelope shape contract.
 * Call this on every error response body.
 */
function assertEnvelopeShape(body, testPrefix) {
  assert(body.success === false, `${testPrefix} → success is false`);
  assert(typeof body.error === "object" && body.error !== null, `${testPrefix} → error object exists`);
  assert(typeof body.error.code === "string", `${testPrefix} → error.code is a string`);
  assert(typeof body.error.message === "string", `${testPrefix} → error.message is a string`);
  assert("details" in body.error, `${testPrefix} → error.details key exists`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main — spin up server, run tests, shut down
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  const app = createTestServer();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  console.log(`\n🚀  E2E Suite 1 — OpenAPI Contract Compliance (port ${port})`);
  console.log("─────────────────────────────────────────────────────────────\n");

  // ── Test 1: 200 Healthy (sanity) ────────────────────────────────────────────
  console.log("📋  [1] Healthy route (sanity check)");
  {
    const res = await request({ path: "/healthy", port });
    assert(res.status === 200, "GET /healthy → HTTP 200");
    assert(res.body.success === true, "GET /healthy → success: true");
  }

  // ── Test 2: 404 Not Found ────────────────────────────────────────────────────
  console.log("\n📋  [2] 404 Not Found — custom message");
  {
    const res = await request({ path: "/users/999", port });
    assert(res.status === 404, "GET /users/999 → HTTP 404");
    assertEnvelopeShape(res.body, "NotFoundError");
    assert(res.body.error.code === ErrorCode.NOT_FOUND, "error.code === NOT_FOUND");
    assert(
      res.body.error.message === "User with ID 999 was not found.",
      "Custom message preserved in response",
      `Actual: "${res.body.error.message}"`
    );
    assert(res.body.error.details === null, "details is null");
  }

  // ── Test 3: 400 Validation Error — both fields missing ───────────────────────
  console.log("\n📋  [3] 400 Validation Error — multi-field errors in details");
  {
    const res = await request({
      method: "POST",
      path: "/users",
      body: {}, // intentionally missing email and name
      port,
    });
    assert(res.status === 400, "POST /users (empty body) → HTTP 400");
    assertEnvelopeShape(res.body, "ValidationError");
    assert(res.body.error.code === ErrorCode.VALIDATION_ERROR, "error.code === VALIDATION_ERROR");
    assert(
      Array.isArray(res.body.error.details.email),
      "details.email is an array",
      `Actual details: ${JSON.stringify(res.body.error.details)}`
    );
    assert(
      Array.isArray(res.body.error.details.name),
      "details.name is an array"
    );
    assert(
      res.body.error.details.email[0] === "Email is required.",
      "details.email[0] message correct"
    );
  }

  // ── Test 4: 400 Validation — partial (only email missing) ────────────────────
  console.log("\n📋  [4] 400 Validation Error — partial fields");
  {
    const res = await request({
      method: "POST",
      path: "/users",
      body: { name: "Alice" }, // email missing
      port,
    });
    assert(res.status === 400, "POST /users (missing email) → HTTP 400");
    assert(res.body.error.details.email !== undefined, "details.email present");
    assert(res.body.error.details.name === undefined, "details.name absent (field was valid)");
  }

  // ── Test 5: 401 Unauthorized ──────────────────────────────────────────────────
  console.log("\n📋  [5] 401 Unauthorized");
  {
    const res = await request({
      method: "POST",
      path: "/login",
      body: { scenario: "no-credentials" },
      port,
    });
    assert(res.status === 401, "POST /login (no-credentials) → HTTP 401");
    assertEnvelopeShape(res.body, "UnauthorizedError");
    assert(res.body.error.code === ErrorCode.UNAUTHORIZED, "error.code === UNAUTHORIZED");
  }

  // ── Test 6: 401 Token Expired — DIFFERENT code than UNAUTHORIZED ──────────────
  console.log("\n📋  [6] 401 Token Expired — distinct error code");
  {
    const res = await request({
      method: "POST",
      path: "/login",
      body: { scenario: "expired-token" },
      port,
    });
    assert(res.status === 401, "POST /login (expired-token) → HTTP 401");
    assertEnvelopeShape(res.body, "TokenExpiredError");
    assert(
      res.body.error.code === ErrorCode.TOKEN_EXPIRED,
      "error.code === TOKEN_EXPIRED (not UNAUTHORIZED!)",
      `Actual: ${res.body.error.code}`
    );
  }

  // ── Test 7: 403 Forbidden ─────────────────────────────────────────────────────
  console.log("\n📋  [7] 403 Forbidden");
  {
    const res = await request({ path: "/admin", port });
    assert(res.status === 403, "GET /admin → HTTP 403");
    assertEnvelopeShape(res.body, "ForbiddenError");
    assert(res.body.error.code === ErrorCode.FORBIDDEN, "error.code === FORBIDDEN");
    assert(
      res.body.error.message === "Admin access requires elevated privileges.",
      "Custom forbidden message preserved"
    );
  }

  // ── Test 8: 409 Conflict — details with field context ────────────────────────
  console.log("\n📋  [8] 409 Conflict — details contain field context");
  {
    const res = await request({
      method: "POST",
      path: "/register",
      body: { email: "alice@example.com" },
      port,
    });
    assert(res.status === 409, "POST /register → HTTP 409");
    assertEnvelopeShape(res.body, "ConflictError");
    assert(res.body.error.code === ErrorCode.CONFLICT, "error.code === CONFLICT");
    assert(
      res.body.error.message.includes("alice@example.com"),
      "Dynamic email in message",
      `Actual: "${res.body.error.message}"`
    );
    assert(res.body.error.details?.field === "email", "details.field === 'email'");
  }

  // ── Test 9: 429 Rate Limit ────────────────────────────────────────────────────
  console.log("\n📋  [9] 429 Rate Limit Exceeded");
  {
    const res = await request({ path: "/rate-limited", port });
    assert(res.status === 429, "GET /rate-limited → HTTP 429");
    assertEnvelopeShape(res.body, "RateLimitError");
    assert(res.body.error.code === ErrorCode.RATE_LIMIT_EXCEEDED, "error.code === RATE_LIMIT_EXCEEDED");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  await new Promise((resolve) => server.close(resolve));

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  Suite 1 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

module.exports = { run };
