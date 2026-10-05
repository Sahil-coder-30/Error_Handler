/**
 * @file tests/adversarial/05_custom_codes_and_status_attacks.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 5: CUSTOM ERROR CODES & HTTP STATUS ATTACKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Attacks custom error codes and HTTP status code boundaries:
 * 1. AI & LLM custom codes (CONTEXT_WINDOW_EXCEEDED, etc.)
 * 2. Malicious, empty, whitespace, and extreme custom codes
 * 3. Standard HTTP status codes (400, 401, 403, 404, 409, 422, 429, 500, 503)
 * 4. Boundary and invalid HTTP statuses on AppError subclasses:
 *    - 0, 1, 99 (< 100)
 *    - 200, 204 (2xx success codes on error!)
 *    - 400.5 (floating point status codes)
 *    - 1000 (> 999 out of HTTP range)
 *    - Negative numbers (-1, -500)
 *    - NaN, Infinity
 *    -> These MUST NOT crash the Express middleware with unhandled RangeError!
 */

"use strict";

const http = require("node:http");
const express = require("express");
const {
  AppError,
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
  console.log("\n🔥 [ADVERSARIAL SUITE 5] Custom Error Codes & HTTP Status Attacks");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. AI & LLM Custom Codes ───────────────────────────────────────────────
  console.log("\n📋 [1] AI / LLM Domain Error Codes");
  {
    const aiCodes = [
      "CONTEXT_WINDOW_EXCEEDED",
      "MODEL_RATE_LIMIT",
      "LLM_PROVIDER_DOWN",
      "INSUFFICIENT_CREDITS",
      "TOOL_TIMEOUT",
      "VECTOR_DB_UNAVAILABLE",
      "EMBEDDING_FAILED",
      "RAG_CONTEXT_MISSING",
    ];

    for (const code of aiCodes) {
      class CustomAiError extends AppError {
        constructor() {
          super(`AI error: ${code}`, 503, code, null, true);
        }
      }
      const err = new CustomAiError();
      const resp = toErrorResponse(err);
      assert(resp.error.code === code, `Custom AI code '${code}' preserved in envelope`);
      assert(resp.success === false, `Envelope success is false for '${code}'`);
    }
  }

  // ── 2. Malicious and Malformed Error Codes ──────────────────────────────────
  console.log("\n📋 [2] Malformed & Hostile Custom Error Codes");
  {
    const hostileCodes = [
      { code: "", desc: "empty string" },
      { code: "   ", desc: "whitespace string" },
      { code: "A".repeat(5000), desc: "5000-char string" },
      { code: "lower_snake_case", desc: "lowercase code" },
      { code: "12345", desc: "numeric string code" },
      { code: "<script>alert('xss')</script>", desc: "XSS payload code" },
      { code: "ERROR\r\nINJECT: true", desc: "CRLF in code" },
      { code: "エラー_コード", desc: "Unicode code" },
    ];

    for (const { code, desc } of hostileCodes) {
      class HostileCodeError extends AppError {
        constructor() {
          super("Hostile code test", 400, code, null, true);
        }
      }
      const err = new HostileCodeError();
      let formatted;
      let didThrow = false;
      try {
        formatted = toErrorResponse(err);
      } catch {
        didThrow = true;
      }
      assert(!didThrow, `toErrorResponse does not crash on ${desc}`);
      assert(formatted.success === false, `Success is false for ${desc}`);
      assert(formatted.error.code === code, `Code preserved for ${desc}`);
    }
  }

  // ── 3. HTTP Status Boundary Values in Express (BUG DETECTION) ──────────────
  console.log("\n📋 [3] HTTP Status Code Boundary Values in AppError Subclasses");
  {
    const app = express();
    const silentLogger = { warn: () => {}, error: () => {} };

    // Custom AppError with status = 1000 (> 999)
    class OutOfRangeStatusError extends AppError {
      constructor() {
        super("Out of range status", 1000, "OUT_OF_RANGE", null, false);
      }
    }

    // Custom AppError with negative status = -1
    class NegativeStatusError extends AppError {
      constructor() {
        super("Negative status", -1, "NEGATIVE_STATUS", null, false);
      }
    }

    // Custom AppError with floating point status = 400.5
    class FloatStatusError extends AppError {
      constructor() {
        super("Float status", 400.5, "FLOAT_STATUS", null, true);
      }
    }

    // Custom AppError with 200 OK (Error claiming 200 status!)
    class FalseOkError extends AppError {
      constructor() {
        super("Error with 200 OK", 200, "FALSE_OK", null, true);
      }
    }

    // Custom AppError with status = 0
    class ZeroStatusError extends AppError {
      constructor() {
        super("Zero status", 0, "ZERO_STATUS", null, false);
      }
    }

    app.get("/status-1000", () => { throw new OutOfRangeStatusError(); });
    app.get("/status-neg", () => { throw new NegativeStatusError(); });
    app.get("/status-float", () => { throw new FloatStatusError(); });
    app.get("/status-200", () => { throw new FalseOkError(); });
    app.get("/status-zero", () => { throw new ZeroStatusError(); });

    app.use(createExpressErrorHandler({ logger: silentLogger }));

    // 3a: Status 1000 must be safely clamped (e.g. to 500) and NEVER crash Express
    let res1000;
    let crashed1000 = false;
    try {
      res1000 = await request(app, "/status-1000");
    } catch (err) {
      crashed1000 = true;
    }
    assert(
      !crashed1000 && res1000 && res1000.status >= 400 && res1000.status <= 599,
      "Status 1000 MUST be safely clamped to valid HTTP status (e.g. 500) without crashing Express with RangeError",
      crashed1000 ? "Express crashed with RangeError: Invalid status code: 1000" : `Status was ${res1000 && res1000.status}`
    );

    // 3b: Negative status must be safely clamped
    let resNeg;
    let crashedNeg = false;
    try {
      resNeg = await request(app, "/status-neg");
    } catch {
      crashedNeg = true;
    }
    assert(
      !crashedNeg && resNeg && resNeg.status >= 400 && resNeg.status <= 599,
      "Status -1 MUST be safely clamped without crashing Express with RangeError",
      crashedNeg ? "Express crashed with RangeError: Invalid status code: -1" : `Status was ${resNeg && resNeg.status}`
    );

    // 3c: Floating point status 400.5 must be truncated / clamped to integer
    let resFloat;
    let crashedFloat = false;
    try {
      resFloat = await request(app, "/status-float");
    } catch {
      crashedFloat = true;
    }
    assert(
      !crashedFloat && resFloat && Number.isInteger(resFloat.status),
      "Status 400.5 MUST be rounded or integer clamped without crashing Express with RangeError",
      crashedFloat ? "Express crashed with RangeError: Invalid status code: 400.5" : `Status was ${resFloat && resFloat.status}`
    );

    // 3d: Error with status 200 OK must NEVER return HTTP 200 for an error!
    let res200;
    try {
      res200 = await request(app, "/status-200");
    } catch {}
    assert(
      res200 && res200.status !== 200 && res200.status >= 400,
      "AppError with statusCode: 200 MUST NOT return HTTP 200 for an error response (must coerce to 500)",
      `Actual status returned: ${res200 && res200.status}`
    );

    // 3e: Status 0 must not crash
    let resZero;
    let crashedZero = false;
    try {
      resZero = await request(app, "/status-zero");
    } catch {
      crashedZero = true;
    }
    assert(
      !crashedZero && resZero && resZero.status >= 400 && resZero.status <= 599,
      "Status 0 MUST be safely clamped without crashing Express with RangeError",
      crashedZero ? "Express crashed with RangeError: Invalid status code: 0" : `Status was ${resZero && resZero.status}`
    );
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 5 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
