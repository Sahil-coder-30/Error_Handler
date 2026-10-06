/**
 * @file tests/features_v1_1.test.js
 * @description Comprehensive test suite for v1.1.0 capabilities:
 * 1. Mongoose & Native Error Coercion (ValidationError, code 11000, CastError, custom errorCoercer)
 * 2. Distributed requestId / Correlation ID propagation (headers, logs, response body)
 * 3. Non-HTTP Contexts (toErrorResponse, formatError, AppError.format, Socket.io, RabbitMQ)
 * 4. Domain-Specific AI Error Codes & custom code string union
 */

"use strict";

const http = require("node:http");
const express = require("express");
const {
  AppError,
  ValidationError,
  ConflictError,
  BadRequestError,
  InternalServerError,
  ErrorCode,
  coerceToAppError,
  toErrorResponse,
  formatError,
} = require("../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../dist/cjs/express.js");

let passed = 0;
let failed = 0;

function assert(condition, name, details = "") {
  if (condition) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${name}${details ? ` (${details})` : ""}`);
    failed++;
  }
}

function request({ method = "GET", path, port, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      { method, headers },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(raw),
            });
          } catch {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: raw,
            });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  console.log("\n============================================================");
  console.log(" 🧪 SUITE: PRODUCTION ADVANCED FEATURES (v1.1)");
  console.log("============================================================\n");

  // ─────────────────────────────────────────────────────────────────────────
  // GAP 1: Mongoose & Native Error Coercion + Custom errorCoercer
  // ─────────────────────────────────────────────────────────────────────────
  console.log("📋 [1] Mongoose & MongoDB native error coercion");
  {
    // 1a. Mongoose ValidationError
    const mongooseValidationErr = {
      name: "ValidationError",
      message: "User validation failed: email: Path `email` is invalid, age: Age must be >= 18",
      errors: {
        email: { message: "Path `email` is invalid", path: "email" },
        age: { message: "Age must be >= 18", path: "age" },
      },
    };

    const coercedVal = coerceToAppError(mongooseValidationErr);
    assert(coercedVal instanceof ValidationError, "Mongoose ValidationError coerced to ValidationError");
    assert(coercedVal.statusCode === 400, "Mongoose ValidationError maps to HTTP 400");
    assert(coercedVal.errorCode === ErrorCode.VALIDATION_ERROR, "Error code is VALIDATION_ERROR");
    assert(coercedVal.isOperational === true, "isOperational is true");
    assert(coercedVal.details && coercedVal.details.email, "details contains email field error");
    assert(coercedVal.details && coercedVal.details.age, "details contains age field error");

    // 1b. MongoDB Duplicate Key (Code 11000)
    const mongoDuplicateErr = {
      name: "MongoServerError",
      code: 11000,
      keyValue: { email: "user@example.com" },
    };

    const coercedDup = coerceToAppError(mongoDuplicateErr);
    assert(coercedDup instanceof ConflictError, "MongoDB 11000 coerced to ConflictError");
    assert(coercedDup.statusCode === 409, "MongoDB 11000 maps to HTTP 409");
    assert(coercedDup.errorCode === ErrorCode.CONFLICT, "Error code is CONFLICT");
    assert(coercedDup.details && coercedDup.details.email === "user@example.com", "details preserves duplicate keyValue");

    // 1c. Mongoose CastError (invalid ObjectId)
    const mongooseCastErr = {
      name: "CastError",
      path: "userId",
      value: "invalid-id-xyz",
    };

    const coercedCast = coerceToAppError(mongooseCastErr);
    assert(coercedCast instanceof BadRequestError, "Mongoose CastError coerced to BadRequestError");
    assert(coercedCast.statusCode === 400, "Mongoose CastError maps to HTTP 400");
    assert(coercedCast.errorCode === ErrorCode.BAD_REQUEST, "Error code is BAD_REQUEST");

    // 1d. Custom errorCoercer Hook (e.g. Prisma P2002 error)
    const prismaErr = {
      code: "P2002",
      meta: { target: ["username"] },
      message: "Unique constraint failed on the fields: (`username`)",
    };

    const customCoercer = (err) => {
      if (err && err.code === "P2002") {
        return new ConflictError("Username is already taken.", { field: "username" });
      }
      return err;
    };

    const coercedPrisma = coerceToAppError(prismaErr, customCoercer);
    assert(coercedPrisma instanceof ConflictError, "custom errorCoercer transformed Prisma error");
    assert(coercedPrisma.statusCode === 409, "Prisma P2002 mapped to 409");
    assert(coercedPrisma.message === "Username is already taken.", "Custom errorCoercer message preserved");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GAP 2: Distributed requestId / Correlation ID in Express
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n📋 [2] Distributed requestId propagation in Express");
  {
    const app = express();
    let loggedRequestId = null;

    const mockLogger = {
      warn: (arg1, arg2) => {
        const payload = (arg1 && typeof arg1 === "object") ? arg1 : arg2;
        loggedRequestId = payload ? payload.requestId : null;
      },
      error: (arg1, arg2) => {
        const payload = (arg1 && typeof arg1 === "object") ? arg1 : arg2;
        loggedRequestId = payload ? payload.requestId : null;
      },
    };

    app.get("/test-request-id", () => {
      throw new BadRequestError("Invalid account status");
    });

    app.get("/test-mongoose-route", () => {
      throw {
        name: "MongoServerError",
        code: 11000,
        keyValue: { organization: "acme-corp" },
      };
    });

    app.use(createExpressErrorHandler({
      logger: mockLogger,
      includeRequestId: true,
      requestIdHeader: "x-request-id",
    }));

    const server = app.listen(0);
    const port = server.address().port;

    try {
      // 2a. Request with x-request-id header
      const res1 = await request({
        path: "/test-request-id",
        port,
        headers: { "x-request-id": "req-trace-abc-123" },
      });

      assert(res1.status === 400, "Returned HTTP 400");
      assert(res1.body.error.requestId === "req-trace-abc-123", "error.requestId contains incoming correlation ID");
      assert(res1.body.requestId === "req-trace-abc-123", "Top-level requestId contains correlation ID");
      assert(res1.headers["x-request-id"] === "req-trace-abc-123", "Outgoing x-request-id header set on response");
      assert(loggedRequestId === "req-trace-abc-123", "Logger received correlated requestId in log payload");

      // 2b. Mongoose route through Express handler with x-correlation-id fallback
      const res2 = await request({
        path: "/test-mongoose-route",
        port,
        headers: { "x-correlation-id": "corr-xyz-789" },
      });

      assert(res2.status === 409, "Mongoose 11000 in Express returned 409 Conflict");
      assert(res2.body.error.code === "CONFLICT", "Error code is CONFLICT");
    } finally {
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
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GAP 3: Non-HTTP Contexts (Socket.io & RabbitMQ)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n📋 [3] Non-HTTP error formatting (WebSockets & RabbitMQ)");
  {
    // 3a. Socket.io event error formatting
    const socketPayload = {
      prompt: "Generate code",
      requestId: "socket-req-99",
    };

    let emittedEvent = null;
    let emittedData = null;
    const mockSocket = {
      emit: (evt, data) => {
        emittedEvent = evt;
        emittedData = data;
      },
    };

    try {
      throw new ValidationError({ prompt: ["Prompt exceeds allowed tokens"] }, "Prompt invalid");
    } catch (err) {
      mockSocket.emit("agent:error", toErrorResponse(err, { requestId: socketPayload.requestId }));
    }

    assert(emittedEvent === "agent:error", "Socket.io emitted agent:error event");
    assert(emittedData.success === false, "Socket.io response success is false");
    assert(emittedData.error.code === "VALIDATION_ERROR", "Socket.io error code is VALIDATION_ERROR");
    assert(emittedData.error.requestId === "socket-req-99", "Socket.io error has requestId");
    assert(emittedData.requestId === "socket-req-99", "Socket.io top-level requestId matches");

    // 3b. RabbitMQ Consumer error formatting
    const rawQueueMessage = {
      id: "msg-queue-001",
      type: "SEND_NOTIFICATION",
      payload: null,
    };

    let queueAck = false;
    let deadLetterPayload = null;

    try {
      // Simulate missing recipient crash
      throw new Error("SMTP connection failed: host unreachable");
    } catch (err) {
      deadLetterPayload = formatError(err, {
        isProduction: true,
        requestId: rawQueueMessage.id,
      });
      queueAck = true;
    }

    assert(queueAck === true, "Queue acknowledged / handled safely");
    assert(deadLetterPayload.success === false, "Dead letter payload success is false");
    assert(deadLetterPayload.error.code === "INTERNAL_SERVER_ERROR", "Code is INTERNAL_SERVER_ERROR");
    assert(
      deadLetterPayload.error.message === "An unexpected error occurred. Our team has been notified.",
      "Native error message masked in production non-HTTP mode"
    );
    assert(deadLetterPayload.requestId === "msg-queue-001", "Queue message ID attached as requestId");

    // 3c. AppError.format static method
    const staticFormatted = AppError.format(new BadRequestError("Static test"), { requestId: "req-static-1" });
    assert(staticFormatted.success === false, "AppError.format produced valid response");
    assert(staticFormatted.error.code === "BAD_REQUEST", "AppError.format code is BAD_REQUEST");
    assert(staticFormatted.requestId === "req-static-1", "AppError.format included requestId");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GAP 4: Domain-Specific AI Error Codes & open string union
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n📋 [4] Domain-specific AI error codes & open string union");
  {
    // 4a. Built-in AI Error Codes
    assert(ErrorCode.CONTEXT_WINDOW_EXCEEDED === "CONTEXT_WINDOW_EXCEEDED", "ErrorCode has CONTEXT_WINDOW_EXCEEDED");
    assert(ErrorCode.MODEL_RATE_LIMIT === "MODEL_RATE_LIMIT", "ErrorCode has MODEL_RATE_LIMIT");
    assert(ErrorCode.LLM_PROVIDER_DOWN === "LLM_PROVIDER_DOWN", "ErrorCode has LLM_PROVIDER_DOWN");
    assert(ErrorCode.INSUFFICIENT_CREDITS === "INSUFFICIENT_CREDITS", "ErrorCode has INSUFFICIENT_CREDITS");
    assert(ErrorCode.GATEWAY_TIMEOUT === "GATEWAY_TIMEOUT", "ErrorCode has GATEWAY_TIMEOUT");
    assert(ErrorCode.MESSAGE_PROCESSING_FAILED === "MESSAGE_PROCESSING_FAILED", "ErrorCode has MESSAGE_PROCESSING_FAILED");

    // 4b. Custom class with AI Error Code
    class ContextWindowExceededError extends AppError {
      constructor(tokens, maxTokens) {
        super(
          `Context window of ${maxTokens} exceeded (received ${tokens} tokens)`,
          400,
          ErrorCode.CONTEXT_WINDOW_EXCEEDED,
          { tokens, maxTokens },
          true
        );
      }
    }

    const aiErr = new ContextWindowExceededError(8192, 4096);
    assert(aiErr.statusCode === 400, "ContextWindowExceededError status is 400");
    assert(aiErr.errorCode === "CONTEXT_WINDOW_EXCEEDED", "errorCode is CONTEXT_WINDOW_EXCEEDED");
    const aiJson = aiErr.toJSON("ai-req-42");
    assert(aiJson.error.code === "CONTEXT_WINDOW_EXCEEDED", "toJSON preserves AI error code");
    assert(aiJson.error.requestId === "ai-req-42", "toJSON attaches requestId");

    // 4c. Custom string code without enum modification
    class CustomOrchestratorError extends AppError {
      constructor(customCode) {
        super("Custom agent halt", 422, customCode, null, true);
      }
    }

    const customErr = new CustomOrchestratorError("AGENT_LOOP_DETECTED");
    assert(customErr.errorCode === "AGENT_LOOP_DETECTED", "Arbitrary custom error code accepted without cast");
    assert(customErr.statusCode === 422, "Status code preserved");
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`📊  Suite Results: ${passed} passed, ${failed} failed`);
  console.log("────────────────────────────────────────────────────────────\n");

  return failed;
}

if (require.main === module) {
  run().then((code) => process.exit(code === 0 ? 0 : 1));
}

module.exports = { run };
