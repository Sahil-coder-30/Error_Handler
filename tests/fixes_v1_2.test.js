/**
 * @file tests/fixes_v1_2.test.js
 * @description Regression suite for the v1.2.0 bug fixes and additions:
 * 1. Coerced errors keep the original stack trace and cause
 * 2. AppError status validation (NaN, Infinity, strings, floats)
 * 3. Cross-copy instanceof (dual CJS/ESM package hazard) and foreign AppError shapes
 * 4. Zod, Joi, Prisma, Mongoose DocumentNotFound coercion
 * 5. Third-party status mapping (new codes, numeric strings, http-errors `expose`)
 * 6. sanitizeDetails (shared refs, Map/Set, Error, Date, depth, hostile getters)
 * 7. toJSON safety, null options, async coercers, request ID validation
 * 8. toHttpResponse
 * 9. Logger: bad level, level change safety, serializer merge, base fields, frozen errors
 * 10. Express: null logger, winston style, includeStackInLog, numeric req.id,
 *     generateRequestId, onError, headersSent logging, not-found handler, asyncHandler
 */

"use strict";

const http = require("node:http");
const { Writable } = require("node:stream");
const express = require("express");
const fk = require("../dist/cjs/index.js");
const {
  createExpressErrorHandler,
  createNotFoundHandler,
  asyncHandler,
} = require("../dist/cjs/express.js");

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

function captureLogger(options = {}) {
  const lines = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
      cb();
    },
  });
  return { logger: fk.createLogger(options, dest), lines };
}

function recorder() {
  const calls = [];
  return {
    calls,
    pino: {
      child() {
        return this;
      },
      warn: (...a) => calls.push({ level: "warn", args: a }),
      error: (...a) => calls.push({ level: "error", args: a }),
    },
    winston: {
      transports: [],
      format: {},
      child() {
        return this;
      },
      warn: (...a) => calls.push({ level: "warn", args: a }),
      error: (...a) => calls.push({ level: "error", args: a }),
    },
  };
}

async function hit(app, path, headers = {}) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${port}${path}`, { headers }, (res) => {
        let raw = "";
        // A response cut off mid-stream emits 'error' / 'aborted' instead of 'end'.
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("aborted")));
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* keep text */
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

async function run() {
  console.log("\n📦  v1.2.0 Bug-Fix Regression Suite");
  console.log("────────────────────────────────────────────────────────────");

  // ── 1. Stack + cause preservation ─────────────────────────────────────────
  console.log("\n📋 [1] Original stack trace and cause are preserved");
  {
    function originalThrowSite() {
      return null.boom;
    }
    let native;
    try {
      originalThrowSite();
    } catch (e) {
      native = e;
    }
    const coerced = fk.coerceToAppError(native);
    assert(coerced.stack.includes("originalThrowSite"), "Native error stack points at the real throw site");
    assert(coerced.stack.startsWith("TypeError"), "Stack keeps the original error type");

    const root = new Error("socket closed");
    const wrapped = new Error("query failed", { cause: root });
    assert(fk.coerceToAppError(wrapped).cause === root, "Original cause is carried over");

    const own = new fk.ServiceUnavailableError("db down", null, { cause: root });
    assert(own.cause === root, "AppError subclasses accept { cause }");
    assert(!Object.keys(own).includes("cause"), "cause is non-enumerable");
    assert(fk.toErrorResponse(own).error.details === null, "cause never reaches the response");

    const mongo = Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyValue: { email: "a@b.c" } });
    assert(fk.coerceToAppError(mongo).stack === mongo.stack, "Duplicate-key coercion keeps the Mongo stack");
  }

  // ── 2. AppError status validation ─────────────────────────────────────────
  console.log("\n📋 [2] Invalid AppError status codes become 500 (non-operational)");
  for (const bad of [NaN, Infinity, -Infinity, "404", 200, 99, 600]) {
    class BadStatus extends fk.AppError {
      constructor() {
        super("bad status", bad, "SOME_CODE", null, true);
      }
    }
    const out = fk.coerceToAppError(new BadStatus());
    assert(out.statusCode === 500 && out.isOperational === false, `status ${String(bad)} → 500 non-operational`);
    const res = fk.toErrorResponse(new BadStatus(), { isProduction: true });
    assert(res.error.message !== "bad status", `status ${String(bad)} message masked in production`);
  }
  {
    class FloatStatus extends fk.AppError {
      constructor() {
        super("float", 404.9, "NOT_FOUND");
      }
    }
    assert(fk.coerceToAppError(new FloatStatus()).statusCode === 404, "Float status 404.9 rounds down to 404");
  }

  // ── 3. Cross-copy AppError ────────────────────────────────────────────────
  console.log("\n📋 [3] Errors from other faultkit copies keep their code");
  {
    const brand = Symbol.for("faultkit.AppError");
    const foreign = Object.assign(Object.create(Error.prototype), {
      name: "ValidationError",
      message: "bad email",
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
      details: { email: ["bad"] },
      isOperational: true,
    });
    Object.defineProperty(foreign, brand, { value: true });
    assert(foreign instanceof fk.AppError, "Branded object passes instanceof AppError");
    assert(!(foreign instanceof fk.NotFoundError), "Subclass instanceof keeps prototype semantics");

    const legacy = Object.assign(new Error("legacy"), {
      statusCode: 409,
      errorCode: "CONFLICT",
      isOperational: true,
      details: { id: 1 },
    });
    const res = fk.toErrorResponse(legacy);
    assert(res.error.code === "CONFLICT", "Unbranded AppError-shaped error keeps its errorCode");
    assert(res.error.details && res.error.details.id === 1, "…and its details");

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        getPrototypeOf() {
          throw new Error("trap");
        },
      }
    );
    let threw = false;
    try {
      void (hostile instanceof fk.AppError);
    } catch {
      threw = true;
    }
    assert(!threw, "instanceof AppError never throws on hostile proxies");
  }

  // ── 4. Library coercion ───────────────────────────────────────────────────
  console.log("\n📋 [4] Zod, Joi, Prisma and Mongoose coercion");
  {
    const zod = Object.assign(new Error("[...]"), {
      name: "ZodError",
      issues: [
        { path: ["email"], message: "Required" },
        { path: ["address", "zip"], message: "Too short" },
        { path: [], message: "Bad object" },
      ],
    });
    const z = fk.coerceToAppError(zod);
    assert(z.statusCode === 400 && z.errorCode === "VALIDATION_ERROR", "ZodError → 400 VALIDATION_ERROR");
    assert(z.details.email[0] === "Required", "Zod field errors use { field: [messages] }");
    assert(z.details["address.zip"][0] === "Too short", "Nested Zod paths are dot-joined");
    assert(z.details._root[0] === "Bad object", "Root-level Zod issues go to _root");

    const joi = Object.assign(new Error('"name" is required'), {
      name: "ValidationError",
      isJoi: true,
      details: [{ message: '"name" is required', path: ["name"] }],
    });
    const j = fk.coerceToAppError(joi);
    assert(j.errorCode === "VALIDATION_ERROR" && j.details.name[0] === '"name" is required', "Joi → VALIDATION_ERROR");

    const prisma = (code, meta) =>
      Object.assign(new Error("prisma"), { name: "PrismaClientKnownRequestError", code, meta, clientVersion: "5.0.0" });
    const p2002 = fk.coerceToAppError(prisma("P2002", { target: ["email"] }));
    assert(p2002.statusCode === 409 && p2002.details.fields[0] === "email", "Prisma P2002 → 409 CONFLICT");
    assert(fk.coerceToAppError(prisma("P2025")).statusCode === 404, "Prisma P2025 → 404 NOT_FOUND");
    assert(fk.coerceToAppError(prisma("P2003", { field_name: "userId" })).statusCode === 409, "Prisma P2003 → 409");
    assert(fk.coerceToAppError(prisma("P2000", { column_name: "bio" })).statusCode === 400, "Prisma P2000 → 400");
    assert(fk.coerceToAppError(prisma("P1001")).statusCode === 500, "Unknown Prisma codes → 500");

    const docNotFound = Object.assign(new Error("No document found"), { name: "DocumentNotFoundError" });
    assert(fk.coerceToAppError(docNotFound).statusCode === 404, "Mongoose DocumentNotFoundError → 404");
  }

  // ── 5. Third-party status mapping ─────────────────────────────────────────
  console.log("\n📋 [5] Third-party HTTP status mapping");
  {
    const cases = [
      [402, "PAYMENT_REQUIRED"],
      [405, "METHOD_NOT_ALLOWED"],
      [408, "REQUEST_TIMEOUT"],
      [410, "GONE"],
      [413, "PAYLOAD_TOO_LARGE"],
      [415, "UNSUPPORTED_MEDIA_TYPE"],
      [418, "BAD_REQUEST"],
      [501, "NOT_IMPLEMENTED"],
      [502, "BAD_GATEWAY"],
      [507, "INTERNAL_SERVER_ERROR"],
    ];
    for (const [status, code] of cases) {
      const e = Object.assign(new Error("lib"), { status });
      assert(fk.coerceToAppError(e).errorCode === code, `status ${status} → ${code}`);
    }
    assert(fk.coerceToAppError({ statusCode: "404", message: "x" }).statusCode === 404, "Numeric string status accepted");
    const hidden = Object.assign(new Error("secret internals"), { status: 400, expose: false });
    assert(fk.coerceToAppError(hidden).isOperational === false, "http-errors expose:false → non-operational");
    assert(fk.errorCodeFromStatus(404) === "NOT_FOUND", "errorCodeFromStatus is exported");
    assert(fk.toErrorStatus(200) === undefined && fk.toErrorStatus("503") === 503, "toErrorStatus validates");
  }

  // ── 6. sanitizeDetails ────────────────────────────────────────────────────
  console.log("\n📋 [6] sanitizeDetails");
  {
    const shared = { v: 1 };
    const out = fk.sanitizeDetails({ a: shared, b: shared });
    assert(out.b && out.b.v === 1, "Shared (non-circular) references are not marked [Circular]");

    const circ = { name: "loop" };
    circ.self = circ;
    assert(fk.sanitizeDetails(circ).self === "[Circular]", "Real cycles become [Circular]");

    const rich = fk.sanitizeDetails({
      big: 10n,
      when: new Date("2026-01-01T00:00:00.000Z"),
      map: new Map([["k", 1]]),
      set: new Set([1, 2]),
      err: new Error("inner"),
      nan: NaN,
      fn: () => 1,
      arr: [undefined, 1],
    });
    assert(rich.big === "10", "BigInt → string");
    assert(rich.when === "2026-01-01T00:00:00.000Z", "Date → ISO string");
    assert(rich.map.k === 1, "Map → object");
    assert(Array.isArray(rich.set) && rich.set.length === 2, "Set → array");
    assert(rich.err.message === "inner" && rich.err.stack === undefined, "Error → { name, message } without stack");
    assert(rich.nan === null, "NaN → null");
    assert(!("fn" in rich), "Functions dropped");
    assert(rich.arr[0] === null, "undefined in arrays → null");

    const hostile = {};
    Object.defineProperty(hostile, "x", {
      enumerable: true,
      get() {
        throw new Error("trap");
      },
    });
    assert(fk.sanitizeDetails({ ok: 1, hostile }).hostile.x === "[Unreadable]", "Throwing getters are contained");

    let deep = {};
    const top = deep;
    for (let i = 0; i < 50; i++) deep = deep.n = {};
    assert(JSON.stringify(fk.sanitizeDetails(top)).includes("[Max Depth Exceeded]"), "Depth is limited");
  }

  // ── 7. toJSON, options, async coercer, request IDs ────────────────────────
  console.log("\n📋 [7] toJSON, null options, async coercers and request IDs");
  {
    let threw = false;
    try {
      JSON.stringify(new fk.ValidationError({ n: 10n }));
    } catch {
      threw = true;
    }
    assert(!threw, "JSON.stringify(AppError) with BigInt details does not throw");
    assert(new fk.NotFoundError().toJSON({ requestId: "req-1" }).requestId === "req-1", "toJSON({ requestId }) works");
    assert(new fk.NotFoundError().toJSON("req-2").requestId === "req-2", "toJSON(string) still works");

    let nullThrew = false;
    try {
      fk.toErrorResponse(new Error("x"), null);
      fk.toHttpResponse(new Error("x"), null);
      fk.createLogger(null, new Writable({ write: (_c, _e, cb) => cb() }));
      createExpressErrorHandler(null);
      createNotFoundHandler(null);
    } catch {
      nullThrew = true;
    }
    assert(!nullThrew, "null options never crash");

    const asyncRes = fk.toErrorResponse(new fk.NotFoundError("nf"), {
      errorCoercer: async () => {
        throw new Error("async boom");
      },
    });
    assert(asyncRes.error.code === "NOT_FOUND", "Async coercer result is ignored (original error kept)");

    assert(fk.normalizeRequestId("  abc-123  ") === "abc-123", "Request ID trimmed");
    assert(fk.normalizeRequestId(42) === "42", "Numeric request ID → string");
    assert(fk.normalizeRequestId("a".repeat(257)) === undefined, "Oversized request ID rejected");
    assert(fk.normalizeRequestId("x\r\nSet-Cookie: a=b") === undefined, "CRLF request ID rejected");
    assert(fk.normalizeRequestId("<script>") === undefined, "Markup request ID rejected");
    assert(
      fk.normalizeRequestId("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01") !== undefined,
      "W3C traceparent accepted"
    );
    assert(fk.toErrorResponse(new Error("x"), { requestId: "bad id" }).requestId === undefined, "Unsafe requestId dropped");
  }

  // ── 8. toHttpResponse ─────────────────────────────────────────────────────
  console.log("\n📋 [8] toHttpResponse");
  {
    const a = fk.toHttpResponse(new fk.NotFoundError("missing"), { requestId: "r1" });
    assert(a.statusCode === 404 && a.body.error.code === "NOT_FOUND" && a.body.requestId === "r1", "AppError → 404 + body");
    const b = fk.toHttpResponse(new Error("db password=hunter2"), { isProduction: true });
    assert(b.statusCode === 500 && !b.body.error.message.includes("hunter2"), "Production masks native errors");
    assert(b.error instanceof fk.AppError, "Returns the normalized AppError for logging");
    const c = fk.toHttpResponse(new fk.InternalServerError("dbg", { q: 1 }), { isProduction: false });
    assert(c.body.error.details.q === 1, "Development keeps 500 details");
    const d = fk.toHttpResponse(new fk.InternalServerError("dbg", { q: 1 }), { isProduction: true });
    assert(d.body.error.details === null, "Production hides 500 details");
    assert(new fk.GatewayTimeoutError().statusCode === 504, "GatewayTimeoutError is 504");
    assert(new fk.BadGatewayError().statusCode === 502, "BadGatewayError is 502");
    assert(new fk.MessageProcessingFailedError().errorCode === "MESSAGE_PROCESSING_FAILED", "MessageProcessingFailedError");
    assert(new fk.RateLimitError("slow", { retryAfterSeconds: 5 }).details.retryAfterSeconds === 5, "RateLimitError accepts details");
  }

  // ── 9. Logger ─────────────────────────────────────────────────────────────
  console.log("\n📋 [9] Logger robustness");
  {
    let threw = false;
    try {
      captureLogger({ level: "verbose" });
      captureLogger({ level: "DEBUG" });
    } catch {
      threw = true;
    }
    assert(!threw, "Unknown or upper-case level does not crash createLogger");
    assert(captureLogger({ level: "DEBUG" }).logger.level === "debug", "Level is normalized to lower case");

    const { logger, lines } = captureLogger();
    logger.level = "debug";
    const hostile = {};
    Object.defineProperty(hostile, "x", {
      enumerable: true,
      get() {
        throw new Error("trap");
      },
    });
    let logThrew = false;
    try {
      logger.debug(hostile, "after level change");
      logger.child({ a: 1 }).child({ b: 2 }).info(hostile, "grandchild");
    } catch {
      logThrew = true;
    }
    assert(!logThrew, "Logging stays crash-proof after level change and in grandchildren");
    assert(lines.some((l) => l.msg === "after level change" && l.logSerializationError), "Fallback line keeps the message");

    const custom = captureLogger({ pinoOptions: { serializers: { foo: (v) => `foo:${v}` } } });
    custom.logger.error({ err: new fk.NotFoundError("x"), foo: 1 }, "m");
    assert(custom.lines[0].err.isAppError === true, "Custom serializers do not drop the AppError serializer");
    assert(custom.lines[0].foo === "foo:1", "Custom serializer still applied");

    const def = captureLogger();
    def.logger.info("hi");
    assert(typeof def.lines[0].pid === "number" && def.lines[0].service, "Default base has pid, hostname and service");
    const noBase = captureLogger({ base: null });
    noBase.logger.info("hi");
    assert(noBase.lines[0].pid === undefined && noBase.lines[0].service, "base:null drops pid/hostname, keeps service");

    const frozen = captureLogger();
    frozen.logger.error({ err: Object.freeze(new fk.NotFoundError("frozen")) }, "frozen");
    assert(frozen.lines[0].err && frozen.lines[0].err.message === "frozen", "Frozen errors are still serialized");

    const noStack = captureLogger({ includeStackInLog: false });
    noStack.logger.error({ err: new Error("x") }, "m");
    assert(noStack.lines[0].err.stack === undefined, "includeStackInLog:false removes stacks");
  }

  // ── 10. Express ───────────────────────────────────────────────────────────
  console.log("\n📋 [10] Express handler and helpers");
  {
    const crash = () => {
      throw new Error("crash");
    };

    let app = express();
    app.get("/x", crash);
    app.use(createExpressErrorHandler({ logger: null }));
    const nullLogger = await hit(app, "/x");
    assert(nullLogger.status === 500 && nullLogger.body.success === false, "logger:null falls back to default logger");

    const w = recorder();
    app = express();
    app.get("/x", () => {
      throw new fk.NotFoundError("nf");
    });
    app.use(createExpressErrorHandler({ logger: w.winston }));
    await hit(app, "/x");
    assert(typeof w.calls[0].args[0] === "string", "Winston-style loggers get the message first");

    const p = recorder();
    app = express();
    app.get("/x", crash);
    app.use(createExpressErrorHandler({ logger: p.pino, includeStackInLog: false }));
    await hit(app, "/x?token=secret");
    const payload = p.calls[0].args[0];
    assert(payload.err.stack === undefined && payload.stack === undefined, "includeStackInLog:false keeps stacks out of logs");
    assert(payload.path === "/x", "Logged path drops the query string");

    app = express();
    app.use((req, _res, next) => {
      req.id = 7;
      next();
    });
    app.get("/x", crash);
    app.use(createExpressErrorHandler({ logger: false }));
    const numeric = await hit(app, "/x");
    assert(numeric.body.requestId === "7" && numeric.headers["x-request-id"] === "7", "Numeric req.id (pino-http) is used");

    app = express();
    app.get("/x", crash);
    app.use(createExpressErrorHandler({ logger: false, generateRequestId: true }));
    const generated = await hit(app, "/x", { "x-request-id": "bad id with spaces" });
    assert(/^[0-9a-f-]{36}$/.test(generated.body.requestId), "Invalid header replaced by a generated UUID");

    let reported = null;
    app = express();
    app.get("/x", crash);
    app.use(
      createExpressErrorHandler({
        logger: false,
        isProduction: true,
        onError: (e) => {
          reported = e;
          throw new Error("reporter down");
        },
      })
    );
    const prod = await hit(app, "/x");
    assert(reported && reported.message === "crash", "onError receives the normalized error");
    assert(prod.status === 500 && prod.body.error.message !== "crash", "isProduction option masks; throwing onError is safe");

    const s = recorder();
    app = express();
    app.get("/stream", (_req, res, next) => {
      res.write("partial");
      next(new Error("mid-stream"));
    });
    app.use(createExpressErrorHandler({ logger: s.pino }));
    await hit(app, "/stream").catch(() => null);
    assert(s.calls.length === 1 && s.calls[0].level === "error", "Errors after headers are sent are still logged");

    app = express();
    app.get("/ok", (_req, res) => res.json({ ok: true }));
    app.use(createNotFoundHandler());
    app.use(createExpressErrorHandler({ logger: false }));
    const missing = await hit(app, "/nope?x=1");
    assert(missing.status === 404 && missing.body.error.code === "NOT_FOUND", "Unmatched route → JSON 404");
    assert(missing.body.error.message === "Route GET /nope not found.", "Not-found message omits the query string");

    app = express();
    app.get(
      "/async",
      asyncHandler(async () => {
        throw new fk.ConflictError("async conflict");
      })
    );
    app.get(
      "/async-empty",
      asyncHandler(() => Promise.reject(undefined))
    );
    app.use(createExpressErrorHandler({ logger: false }));
    const asyncRes = await hit(app, "/async");
    assert(asyncRes.status === 409 && asyncRes.body.error.code === "CONFLICT", "asyncHandler forwards rejections");
    const emptyRes = await hit(app, "/async-empty");
    assert(emptyRes.status === 500, "asyncHandler turns an empty rejection into a 500 instead of hanging");
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
