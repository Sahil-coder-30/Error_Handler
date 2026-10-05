/**
 * @file tests/stress_logger_standalone.test.js
 * @description Hardcore adversarial stress tests targeting ONLY the Logger.
 * Attempts to break the logger with circular references, hostile getters,
 * BigInts, Symbols, massive payloads, memory stress, and corrupted errors.
 */

"use strict";

const { Writable } = require("stream");
const {
  logger: defaultLogger,
  createLogger,
  createAppErrorSerializer,
  NotFoundError,
  ValidationError,
  InternalServerError,
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

async function run() {
  console.log("\n============================================================");
  console.log(" 🧪 SUITE A: LOGGER-ONLY ADVERSARIAL & CHAOS STRESS TESTS   ");
  console.log("============================================================\n");

  // ── 1. Circular Reference Bomb ─────────────────────────────────────────────
  console.log("📋 [1] Circular reference handling");
  {
    const { stream, logs } = captureLogStream();
    const logger = createLogger({ service: "chaos-service", destination: stream });

    const objA = { name: "A" };
    const objB = { name: "B" };
    objA.b = objB;
    objB.a = objA; // Direct circular loop

    const deepCircular = { level: 1 };
    let cur = deepCircular;
    for (let i = 2; i <= 20; i++) {
      cur.next = { level: i };
      cur = cur.next;
    }
    cur.loop = deepCircular; // Deep loop back to root

    logger.info({ loop1: objA, loop2: deepCircular }, "Circular reference test");

    assert(logs.length === 1, "Logger survived circular reference without crashing");
    assert(!logs[0].__parseError, "Output produced valid parseable JSON");
    assert(logs[0].msg === "Circular reference test", "Message preserved");
  }

  // ── 2. Hostile Throwing Getters & Proxy Traps ──────────────────────────────
  console.log("\n📋 [2] Hostile throwing getters and proxy traps");
  {
    const { stream, logs } = captureLogStream();
    const logger = createLogger({ service: "chaos-service", destination: stream });

    const explosiveObj = {};
    Object.defineProperty(explosiveObj, "boom", {
      get() { throw new Error("Malicious getter exploded!"); },
      enumerable: true,
    });

    const hostileProxy = new Proxy({ safe: "hello" }, {
      get(target, prop) {
        if (prop === "trap") throw new Error("Malicious proxy trap exploded!");
        return target[prop];
      },
      ownKeys() {
        return ["safe", "trap"];
      },
      getOwnPropertyDescriptor(target, prop) {
        return { enumerable: true, configurable: true };
      },
    });

    logger.info({ explosive: explosiveObj, proxy: hostileProxy }, "Hostile object test");

    assert(logs.length === 1, "Logger survived throwing getters without uncaught crash");
    assert(!logs[0].__parseError, "JSON remains valid despite throwing getters");
  }

  // ── 3. Exotic Primitives (BigInt, Symbol, Functions, NaN, Infinity) ────────
  console.log("\n📋 [3] Exotic JavaScript primitives");
  {
    const { stream, logs } = captureLogStream();
    const logger = createLogger({ service: "chaos-service", destination: stream });

    const exoticPayload = {
      bigIntMax: 9007199254740991n,
      bigIntNegative: -42n,
      sym: Symbol("testSymbol"),
      fn: function doSomething() {},
      arrowFn: () => "evil",
      nan: NaN,
      inf: Infinity,
      negInf: -Infinity,
      negZero: -0,
      nullProto: Object.create(null),
    };
    exoticPayload.nullProto.key = "valueInNullProto";

    logger.info(exoticPayload, "Exotic primitives log");

    assert(logs.length === 1, "Exotic primitives logged without crash");
    assert(!logs[0].__parseError, "Valid JSON produced from exotic types");
    assert(logs[0].bigIntMax === 9007199254740991, "BigInt properly serialized");
  }

  // ── 4. Corrupted & Non-Standard Error Objects in Serializer ─────────────────
  console.log("\n📋 [4] Corrupted & non-standard error serialization");
  {
    const { stream, logs } = captureLogStream();
    const logger = createLogger({ service: "chaos-service", destination: stream });

    // AggregateError with nested errors
    const aggErr = new AggregateError([
      new NotFoundError("Nested 404"),
      new InternalServerError("Nested 500"),
    ], "Aggregate failure");

    // Error with corrupted non-standard properties
    const corruptedErr = new Error("Corrupted properties");
    corruptedErr.statusCode = "INVALID_NOT_A_NUMBER"; // Non-numeric statusCode
    corruptedErr.errorCode = 12345;                    // Non-string errorCode
    corruptedErr.isOperational = "truthyString";      // Non-boolean isOperational
    const circularDetails = {};
    circularDetails.self = circularDetails;
    corruptedErr.details = circularDetails;

    // Error whose .message is an object instead of string
    const weirdMsgErr = new Error();
    weirdMsgErr.message = { custom: "object message" };

    // Error with no prototype
    const protoLessErr = Object.assign(Object.create(null), {
      name: "CustomError",
      message: "No prototype",
      stack: "Fake stack",
    });

    logger.error({ err: aggErr }, "AggregateError test");
    logger.error({ err: corruptedErr }, "CorruptedErr test");
    logger.error({ err: weirdMsgErr }, "WeirdMsgErr test");
    logger.error({ err: protoLessErr }, "ProtoLessErr test");

    assert(logs.length === 4, "All 4 corrupted error variations logged");
    assert(logs.every((l) => !l.__parseError), "All logs parsed as valid JSON");
    assert(logs[1].err !== undefined, "Corrupted error serialized without throw");
  }

  // ── 5. Deep Child Logger Chaining & Key Collision ──────────────────────────
  console.log("\n📋 [5] Deep child logger chaining & parent overrides");
  {
    const { stream, logs } = captureLogStream();
    let current = createLogger({ service: "root-service", destination: stream });

    // Chain 10 child loggers deep, overriding properties
    for (let i = 1; i <= 10; i++) {
      current = current.child({
        [`depth_${i}`]: i,
        iteration: i, // Overrides parent's iteration each time
      });
    }

    current.info("Deep child execution");

    assert(logs.length === 1, "Deep child logger logged successfully");
    const entry = logs[0];
    assert(entry.depth_1 === 1, "First ancestor field retained");
    assert(entry.depth_10 === 10, "10th child field retained");
    assert(entry.iteration === 10, "Iteration overridden by deepest child");
    assert(entry.service === "root-service", "Root service name retained");
  }

  // ── 6. Redaction Under Stress (Arrays, Nested Paths, Mixed Cases) ───────────
  console.log("\n📋 [6] Comprehensive credential redaction under stress");
  {
    const { stream, logs } = captureLogStream();
    const logger = createLogger({ service: "security-service", destination: stream });

    logger.info({
      auth: {
        token: "secret-token-123",
        password: "super-secret-password",
      },
      headers: {
        authorization: "Bearer secret-jwt-token",
        cookie: "session_id=secret-session-id",
      },
      accounts: [
        { id: 1, password: "user1-password", apiKey: "key-1" },
        { id: 2, password: "user2-password", creditCard: "4111-1111" },
      ],
      safeField: "public-value",
    }, "Redaction audit");

    assert(logs.length === 1, "Redaction log entry written");
    const entry = logs[0];
    assert(entry.auth.token === "[REDACTED]", "auth.token redacted");
    assert(entry.auth.password === "[REDACTED]", "auth.password redacted");
    assert(entry.headers.authorization === "[REDACTED]", "headers.authorization redacted");
    assert(entry.headers.cookie === "[REDACTED]", "headers.cookie redacted");
    assert(entry.accounts[0].password === "[REDACTED]", "Array element password redacted");
    assert(entry.accounts[1].creditCard === "[REDACTED]", "Array element creditCard redacted");
    assert(entry.safeField === "public-value", "Non-sensitive data preserved");
  }

  // ── 7. Massive Payload & High Concurrency Throughput (3,000 logs) ──────────
  console.log("\n📋 [7] Massive payload & rapid burst throughput (3,000 logs)");
  {
    const { stream, logs } = captureLogStream();
    const logger = createLogger({ service: "burst-service", destination: stream });

    // Massive 1MB payload string
    const bigString = "A".repeat(1024 * 512); // 512KB string
    logger.info({ payload: bigString }, "Massive payload logged");

    // Rapid burst of 3,000 logs
    const burstCount = 3000;
    for (let i = 0; i < burstCount; i++) {
      logger.info({ seq: i, timestamp: Date.now() }, `Burst log ${i}`);
    }

    assert(logs.length === burstCount + 1, `All ${burstCount + 1} logs successfully written and parsed`);
    assert(logs[0].payload.length === 1024 * 512, "Large payload verified intact");
    assert(logs[burstCount].seq === burstCount - 1, "Last burst sequence verified intact");
  }

  console.log("\n────────────────────────────────────────────────────────────");
  console.log(`📊 Suite A Results: ${passed} passed, ${failed} failed`);
  console.log("────────────────────────────────────────────────────────────\n");

  return failed;
}

if (require.main === module) {
  run().then((code) => process.exit(code));
}

module.exports = { run };
