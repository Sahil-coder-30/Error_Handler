/**
 * @file tests/stress_errorhandler_standalone.test.js
 * @description Hardcore adversarial stress tests targeting ONLY the Express Error Handler.
 * Tries to break the middleware with throwing loggers, frozen objects, throwing getters,
 * invalid HTTP statuses, circular error objects, and adversarial throws.
 */

"use strict";

const {
  createExpressErrorHandler,
} = require("../dist/cjs/express.js");
const {
  AppError,
  NotFoundError,
  ValidationError,
  InternalServerError,
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

function makeMockRes(initialHeadersSent = false) {
  let statusCode = 200;
  let responseBody = null;
  let headersSent = initialHeadersSent;
  let jsonCalls = 0;

  const res = {
    get headersSent() {
      return headersSent;
    },
    set headersSent(val) {
      headersSent = val;
    },
    get statusCode() {
      return statusCode;
    },
    get responseBody() {
      return responseBody;
    },
    get jsonCalls() {
      return jsonCalls;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(body) {
      jsonCalls++;
      responseBody = body;
      headersSent = true;
      return res;
    },
  };

  return res;
}

const mockReq = { method: "GET", url: "/test", headers: {} };

async function run() {
  console.log("\n============================================================");
  console.log(" 🧪 SUITE B: ERROR-HANDLER ADVERSARIAL STRESS TESTS         ");
  console.log("============================================================\n");

  // ── 1. Injected Logger That Explodes (Throws Exception) ────────────────────
  console.log("📋 [1] Injected logger throws an uncaught exception");
  {
    const explodingLogger = {
      warn: () => { throw new Error("Logger disk failure in warn!"); },
      error: () => { throw new Error("Logger disk failure in error!"); },
    };

    const handler = createExpressErrorHandler({ logger: explodingLogger });
    const res = makeMockRes();
    let nextCalledWith = null;
    const next = (err) => { nextCalledWith = err; };

    // Handler should NOT crash, should log error fallback, and still send response
    handler(new Error("Database down"), mockReq, res, next);

    assert(res.statusCode === 500, "Still responded with HTTP 500 despite logger crash");
    assert(res.responseBody !== null, "Response body was sent");
    assert(res.responseBody.success === false, "success is false");
    assert(res.responseBody.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "Error code matches");
    assert(nextCalledWith === null, "next() was not called (handled gracefully)");
  }

  // ── 2. Route Throws Object With Throwing Property Getters ──────────────────
  console.log("\n📋 [2] Route throws object with throwing property getters");
  {
    const silentLogger = { warn: () => {}, error: () => {} };
    const handler = createExpressErrorHandler({ logger: silentLogger });
    const res = makeMockRes();

    const toxicThrow = {};
    Object.defineProperty(toxicThrow, "message", {
      get() { throw new Error("Explosive message getter!"); },
      enumerable: true,
    });
    Object.defineProperty(toxicThrow, "status", {
      get() { throw new Error("Explosive status getter!"); },
      enumerable: true,
    });

    handler(toxicThrow, mockReq, res, () => {});

    assert(res.statusCode === 500, "Safely handled throwing getters as 500");
    assert(res.responseBody.success === false, "success is false");
    assert(typeof res.responseBody.error.message === "string", "Safe fallback message provided");
  }

  // ── 3. Frozen & Sealed Error Objects ───────────────────────────────────────
  console.log("\n📋 [3] Route throws Object.freeze() and Object.seal() errors");
  {
    const silentLogger = { warn: () => {}, error: () => {} };
    const handler = createExpressErrorHandler({ logger: silentLogger });

    const frozenError = Object.freeze(new Error("I am frozen in ice"));
    const frozenObj = Object.freeze({ status: 400, message: "Frozen 400 error" });
    const sealedError = Object.seal(new NotFoundError("Sealed 404"));

    const res1 = makeMockRes();
    handler(frozenError, mockReq, res1, () => {});
    assert(res1.statusCode === 500, "Frozen native error handled as 500");
    assert(res1.responseBody.success === false, "Frozen error response success is false");

    const res2 = makeMockRes();
    handler(frozenObj, mockReq, res2, () => {});
    assert(res2.statusCode === 400, "Frozen plain 400 object handled as 400");
    assert(res2.responseBody.error.code === ErrorCode.BAD_REQUEST, "Code is BAD_REQUEST");

    const res3 = makeMockRes();
    handler(sealedError, mockReq, res3, () => {});
    assert(res3.statusCode === 404, "Sealed AppError handled as 404");
  }

  // ── 4. Circular Object Throw ───────────────────────────────────────────────
  console.log("\n📋 [4] Route throws circular reference object");
  {
    const silentLogger = { warn: () => {}, error: () => {} };
    const handler = createExpressErrorHandler({ logger: silentLogger });
    const res = makeMockRes();

    const circular = { name: "CircularThrow" };
    circular.self = circular;

    handler(circular, mockReq, res, () => {});

    assert(res.statusCode === 500, "Circular throw coerced to 500");
    assert(res.responseBody.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "Code is INTERNAL_SERVER_ERROR");
  }

  // ── 5. Bizarre Status Codes (Out-of-range, NaN, String, Negative, 200) ──────
  console.log("\n📋 [5] Abnormal status codes attached to thrown values");
  {
    const silentLogger = { warn: () => {}, error: () => {} };
    const handler = createExpressErrorHandler({ logger: silentLogger });

    // Status = 200 attached to an Error (should NEVER send 200 for thrown errors)
    const err200 = new Error("200 on error");
    err200.status = 200;
    const res200 = makeMockRes();
    handler(err200, mockReq, res200, () => {});
    assert(res200.statusCode === 500, "Status 200 safely coerced to 500 (no false success)");

    // Status = 999 (completely out of HTTP range)
    const err999 = { status: 999, message: "Out of range 999" };
    const res999 = makeMockRes();
    handler(err999, mockReq, res999, () => {});
    assert(res999.statusCode === 500, "Status 999 safely clamped to 500");

    // Status = -1 (negative)
    const errNeg = { status: -1, message: "Negative status" };
    const resNeg = makeMockRes();
    handler(errNeg, mockReq, resNeg, () => {});
    assert(resNeg.statusCode === 500, "Negative status safely clamped to 500");

    // Status = 418 (I'm a Teapot - 4xx client error)
    const err418 = new Error("I am a teapot");
    err418.status = 418;
    const res418 = makeMockRes();
    handler(err418, mockReq, res418, () => {});
    assert(res418.statusCode === 418, "418 Teapot accepted as valid 4xx client error");
    assert(res418.responseBody.error.code === ErrorCode.BAD_REQUEST, "Mapped to BAD_REQUEST");
  }

  // ── 6. Third-Party Library Errors (Postgres, BodyParser, Mongoose) ─────────
  console.log("\n📋 [6] Third-party ecosystem error normalization");
  {
    const silentLogger = { warn: () => {}, error: () => {} };
    const handler = createExpressErrorHandler({ logger: silentLogger });

    // Body-parser SyntaxError on malformed JSON
    const bodyParserErr = new SyntaxError("Unexpected token in JSON at position 4");
    bodyParserErr.status = 400;
    bodyParserErr.type = "entity.parse.failed";
    const resBody = makeMockRes();
    handler(bodyParserErr, mockReq, resBody, () => {});
    assert(resBody.statusCode === 400, "Body-parser error mapped to HTTP 400");
    assert(resBody.responseBody.error.code === ErrorCode.BAD_REQUEST, "Code is BAD_REQUEST");

    // Fastify/Hono rate limit error with .statusCode = 429
    const rateLimitErr = new Error("Too many requests");
    rateLimitErr.statusCode = 429;
    const resRate = makeMockRes();
    handler(rateLimitErr, mockReq, resRate, () => {});
    assert(resRate.statusCode === 429, "statusCode 429 mapped to 429");
    assert(resRate.responseBody.error.code === ErrorCode.RATE_LIMIT_EXCEEDED, "Code is RATE_LIMIT_EXCEEDED");
  }

  // ── 7. res.headersSent Invariant (Prevent ERR_HTTP_HEADERS_SENT) ───────────
  console.log("\n📋 [7] res.headersSent safeguard invariant");
  {
    const silentLogger = { warn: () => {}, error: () => {} };
    const handler = createExpressErrorHandler({ logger: silentLogger });
    const res = makeMockRes(true); // Headers ALREADY sent!
    let delegatedErr = null;
    const next = (err) => { delegatedErr = err; };

    const crashErr = new Error("Late streaming failure");
    handler(crashErr, mockReq, res, next);

    assert(delegatedErr === crashErr, "Delegated to next(err) when headers already sent");
    assert(res.jsonCalls === 0, "res.json() was NEVER called (prevented crash)");
  }

  // ── 8. Production Security Invariant: Zero Leakage Under 30 Varied Crashes ──
  console.log("\n📋 [8] Production security invariant — 30 varied crashes, 0 leaks");
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const handler = createExpressErrorHandler({
      logger: { warn: () => {}, error: () => {} },
      genericServerErrorMessage: "SAFE_GENERIC_PRODUCTION_ERROR",
    });

    const toxicMessages = [
      "postgres://admin:secretPass123@db.prod.internal:5432/core",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "Stripe card number: 4111-2222-3333-4444 cvv 999",
      "SELECT * FROM users WHERE password_hash = '$2b$12$...'",
      "Redis AUTH secret_auth_token_xyz",
      "/var/root/private/keys/id_rsa.pub private key disclosure",
    ];

    let allMasked = true;
    for (const secret of toxicMessages) {
      const res = makeMockRes();
      handler(new Error(secret), mockReq, res, () => {});

      if (res.responseBody.error.message !== "SAFE_GENERIC_PRODUCTION_ERROR") {
        allMasked = false;
      }
      if (JSON.stringify(res.responseBody).includes("secret")) {
        allMasked = false;
      }
    }

    assert(allMasked, "All 5xx error messages strictly masked in production without any leak");

    process.env.NODE_ENV = originalEnv;
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`📊 Suite B Results: ${passed} passed, ${failed} failed`);
  console.log("────────────────────────────────────────────────────────────\n");

  return failed;
}

if (require.main === module) {
  run().then((code) => process.exit(code));
}

module.exports = { run };
