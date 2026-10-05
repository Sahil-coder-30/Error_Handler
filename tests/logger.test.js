/**
 * @file tests/logger.test.js
 * @description Test suite for the built-in Grafana/Loki-ready Pino logger.
 */

"use strict";

const { Writable } = require("stream");
const {
  logger: defaultLogger,
  createLogger,
  NotFoundError,
  ValidationError,
  InternalServerError,
} = require("../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../dist/cjs/express.js");

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
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      try {
        logs.push(JSON.parse(chunk.toString()));
      } catch {
        logs.push(chunk.toString());
      }
      callback();
    },
  });
  return { stream, logs };
}

function run() {
  console.log("\n🌲 Testing FaultGuard Built-in Pino Logger (Grafana / Loki Ready)");
  console.log("─────────────────────────────────────────────────────────────\n");

  // ── Test 1: Basic Logging Output ───────────────────────────────────────────
  console.log("📋 [1] Standard JSON logging format");
  {
    const { stream, logs } = captureLogStream();
    const testLogger = createLogger({
      service: "users-microservice",
      pinoOptions: {},
    });
    // Redirect stream to memory for assertions
    const customLogger = createLogger({
      service: "users-microservice",
      destination: stream,
    });

    customLogger.info("Server started successfully");

    assert(logs.length === 1, "Log entry was written");
    const entry = logs[0];
    assert(entry.level === 30, "Info level is 30");
    assert(entry.service === "users-microservice", "Service name matches");
    assert(typeof entry.time === "string", "Timestamp is ISO string for Grafana/Loki");
    assert(entry.msg === "Server started successfully", "Log message preserved");
  }

  // ── Test 2: Child Logger Context Tracking ──────────────────────────────────
  console.log("\n📋 [2] Child logger context propagation (traceId, requestId)");
  {
    const { stream, logs } = captureLogStream();
    const baseLogger = createLogger({
      service: "billing-service",
      destination: stream,
    });

    const child = baseLogger.child({
      requestId: "req-abc-123",
      userId: "usr-456",
    });

    child.info("Processing checkout");

    assert(logs.length === 1, "Child log entry written");
    const entry = logs[0];
    assert(entry.requestId === "req-abc-123", "requestId propagated");
    assert(entry.userId === "usr-456", "userId propagated");
    assert(entry.service === "billing-service", "Service name retained");
    assert(entry.msg === "Processing checkout", "Message matches");
  }

  // ── Test 3: AppError Serialization ─────────────────────────────────────────
  console.log("\n📋 [3] AppError serialization (statusCode, errorCode, details)");
  {
    const { stream, logs } = captureLogStream();
    const testLogger = createLogger({
      service: "api",
      destination: stream,
    });

    const validationErr = new ValidationError({ email: ["Invalid format"] });
    testLogger.warn({ err: validationErr }, "Validation failure occurred");

    assert(logs.length === 1, "Log entry written");
    const entry = logs[0];
    assert(entry.level === 40, "Level is 40 (WARN)");
    assert(entry.err !== undefined, "Serialized err object present");
    assert(entry.err.statusCode === 400, "err.statusCode is 400");
    assert(entry.err.errorCode === "VALIDATION_ERROR", "err.errorCode is VALIDATION_ERROR");
    assert(entry.err.isOperational === true, "err.isOperational is true");
    assert(entry.err.details.email[0] === "Invalid format", "err.details contains field errors");
    assert(entry.err.isAppError === true, "isAppError flag is true");
  }

  // ── Test 4: Sensitive Data Redaction ───────────────────────────────────────
  console.log("\n📋 [4] Automatic sensitive credential redaction");
  {
    const { stream, logs } = captureLogStream();
    const testLogger = createLogger({
      service: "auth-service",
      destination: stream,
    });

    testLogger.info({
      user: "alice",
      password: "secretpassword123",
      token: "jwt.token.abc",
      apiKey: "sk_live_xyz",
    }, "User login attempt");

    assert(logs.length === 1, "Log written");
    const entry = logs[0];
    assert(entry.password === "[REDACTED]", "Password was redacted");
    assert(entry.token === "[REDACTED]", "Token was redacted");
    assert(entry.apiKey === "[REDACTED]", "API key was redacted");
    assert(entry.user === "alice", "Non-sensitive data preserved");
  }

  // ── Test 5: createExpressErrorHandler Integration with Default Logger ───────
  console.log("\n📋 [5] createExpressErrorHandler dispatches to Pino logger with top-level fields");
  {
    const { stream, logs } = captureLogStream();
    const testLogger = createLogger({
      service: "test-api",
      destination: stream,
    });

    const handler = createExpressErrorHandler({ logger: testLogger });
    const mockReq = {};
    const mockRes = {
      headersSent: false,
      status() { return this; },
      json() { return this; },
    };
    const mockNext = () => {};

    // Trigger a 404 Operational error
    handler(new NotFoundError("Item not found"), mockReq, mockRes, mockNext);

    assert(logs.length === 1, "Error handler logged the error");
    const log404 = logs[0];
    assert(log404.level === 40, "404 logged at WARN (level 40)");
    assert(log404.statusCode === 404, "Top-level statusCode is 404");
    assert(log404.errorCode === "NOT_FOUND", "Top-level errorCode is NOT_FOUND");
    assert(log404.isOperational === true, "Top-level isOperational is true");
    assert(log404.msg.includes("Item not found"), "Log message contains error description");

    // Trigger a 500 Non-Operational error
    handler(new Error("Database disconnected"), mockReq, mockRes, mockNext);

    assert(logs.length === 2, "500 error logged");
    const log500 = logs[1];
    assert(log500.level === 50, "500 logged at ERROR (level 50)");
    assert(log500.statusCode === 500, "Top-level statusCode is 500");
    assert(log500.errorCode === "INTERNAL_SERVER_ERROR", "Top-level errorCode is INTERNAL_SERVER_ERROR");
    assert(log500.isOperational === false, "isOperational is false for native error crash");
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊  Logger Test Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return failed;
}

if (require.main === module) {
  const code = run();
  process.exit(code);
}

module.exports = { run };
