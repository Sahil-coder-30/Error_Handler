/**
 * @file tests/adversarial/04_non_http_and_esm_transport.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 4: NON-HTTP CONTEXTS & ESM TRANSPORT ATTACKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates error envelope consistency across:
 * 1. WebSockets / Socket.io event & ack handlers
 * 2. RabbitMQ / BullMQ / Queue workers
 * 3. Event emitters & streaming failures
 * 4. Isolation: Transport-specific objects (socket, channel, msg) must never leak
 * 5. ESM execution of AppError.format() and AppError.toResponse()
 *    (Detects ReferenceError: require is not defined in ESM!)
 */

"use strict";

const { execSync } = require("node:child_process");
const path = require("node:path");
const {
  AppError,
  BadRequestError,
  ValidationError,
  InternalServerError,
  ErrorCode,
  toErrorResponse,
  formatError,
} = require("../../dist/cjs/index.js");

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

async function run() {
  console.log("\n🔥 [ADVERSARIAL SUITE 4] Non-HTTP Contexts & ESM Transport Attacks");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. WebSockets / Socket.io Event Simulation ──────────────────────────────
  console.log("\n📋 [1] WebSockets / Socket.io Event & Ack Errors");
  {
    // Mock socket object with circular references and transport state
    const mockSocket = {
      id: "socket_sess_12345",
      handshake: { auth: { token: "secret_ws_token" } },
      emitted: [],
      emit(event, data) {
        this.emitted.push({ event, data });
      },
    };
    // Circular reference typical in socket objects
    mockSocket.client = { socket: mockSocket };

    // Scenario 1a: Event throws ValidationError
    try {
      throw new ValidationError({ query: ["Prompt cannot be empty"] }, "Invalid prompt");
    } catch (err) {
      const envelope = toErrorResponse(err, { requestId: "ws-req-001" });
      mockSocket.emit("error:event", envelope);
    }

    assert(mockSocket.emitted.length === 1, "Socket emitted error event");
    const sent = mockSocket.emitted[0].data;
    assert(sent.success === false, "Envelope success is false");
    assert(sent.error.code === ErrorCode.VALIDATION_ERROR, "Error code is VALIDATION_ERROR");
    assert(sent.requestId === "ws-req-001", "Top-level requestId attached");
    assert(sent.error.requestId === "ws-req-001", "error.requestId attached");

    // Ensure mockSocket internals did not leak into response
    assert(sent.error.details && sent.error.details.query, "Validation details preserved");
    assert(!JSON.stringify(sent).includes("secret_ws_token"), "Socket auth token never leaked into envelope");
  }

  // ── 2. Message Queue (RabbitMQ / BullMQ) Worker Simulation ─────────────────
  console.log("\n📋 [2] Message Queue Worker Failures");
  {
    const mockAmqpMsg = {
      fields: { deliveryTag: 42, routingKey: "orders.create" },
      properties: { correlationId: "corr-queue-99", messageId: "msg-123" },
      content: Buffer.from(JSON.stringify({ orderId: "ord_1" })),
    };

    let deadLetterPayload = null;

    try {
      throw new Error("Payment gateway DNS lookup failed: EAI_AGAIN");
    } catch (err) {
      deadLetterPayload = formatError(err, {
        isProduction: true,
        requestId: mockAmqpMsg.properties.correlationId,
      });
    }

    assert(deadLetterPayload.success === false, "Dead letter payload success is false");
    assert(deadLetterPayload.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "Dead letter error code is 500");
    assert(
      deadLetterPayload.error.message === "An unexpected error occurred. Our team has been notified.",
      "Internal network crash message masked in production"
    );
    assert(deadLetterPayload.requestId === "corr-queue-99", "Queue correlationId used as requestId");
  }

  // ── 3. Transport Invariance: Express vs Non-HTTP ────────────────────────────
  console.log("\n📋 [3] Transport Invariance (Format identical across transports)");
  {
    const sampleError = new BadRequestError("Missing organization slug", { field: "slug" });
    const reqId = "req-invariance-1";

    const nonHttpEnvelope = toErrorResponse(sampleError, { requestId: reqId });
    const directJson = sampleError.toJSON(reqId);

    assert(
      JSON.stringify(nonHttpEnvelope) === JSON.stringify(directJson),
      "toErrorResponse matches AppError.toJSON() output exactly"
    );
  }

  // ── 4. ESM Execution of AppError.format() & toResponse() ───────────────────
  console.log("\n📋 [4] ESM Execution of AppError.format() and AppError.toResponse()");
  {
    // In native ESM, dist/esm/AppError.js line 51 does: const { toErrorResponse } = require("./format.js");
    // This MUST NOT throw "ReferenceError: require is not defined"!
    const esmTestScript = `
      import { AppError, BadRequestError } from "./dist/esm/index.js";
      try {
        const res = AppError.format(new BadRequestError("ESM static test"), { requestId: "esm-1" });
        if (res.success !== false || res.error.code !== "BAD_REQUEST") {
          process.exit(2);
        }
        const res2 = AppError.toResponse(new Error("Native ESM error"));
        if (res2.success !== false) {
          process.exit(3);
        }
        process.exit(0);
      } catch (err) {
        console.error(err);
        process.exit(1);
      }
    `;

    let esmExitCode = 0;
    let esmStderr = "";
    try {
      execSync(`node --input-type=module -e '${esmTestScript}'`, {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      esmExitCode = err.status || 1;
      esmStderr = err.stderr ? err.stderr.toString() : err.message;
    }

    assert(
      esmExitCode === 0,
      "AppError.format() in native ESM MUST NOT crash with ReferenceError: require is not defined",
      `Exit code: ${esmExitCode}, Stderr: ${esmStderr.trim().split("\n")[0]}`
    );
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 4 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
