/**
 * @file tests/express.test.ts
 * @description Integration test for the Express error middleware factory.
 *
 * Simulates what Express would do when an error is passed to next(err).
 * Uses mock req/res objects — no running HTTP server needed.
 *
 * Run with:  npx ts-node tests/express.test.ts
 */

import { createExpressErrorHandler } from "../src/express.js";
import { NotFoundError, ValidationError, ErrorCode } from "../src/index.js";
import type { Request, Response, NextFunction } from "express";

// ── Mock Express objects ──────────────────────────────────────────────────────

function makeMockRes(): {
  mock: Response;
  statusCode: number | null;
  body: unknown;
} {
  const result: { statusCode: number | null; body: unknown } = {
    statusCode: null,
    body: null,
  };

  const mock = {
    status(code: number) {
      result.statusCode = code;
      return mock;
    },
    json(body: unknown) {
      result.body = body;
      return mock;
    },
  } as unknown as Response;

  return { mock, ...result, get statusCode() { return result.statusCode; }, get body() { return result.body; } };
}

const mockReq = {} as Request;
const mockNext = (() => {}) as NextFunction;

// ── Minimal test runner ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`  ✅  ${testName}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${testName}`);
    failed++;
  }
}

function describe(suite: string, fn: () => void): void {
  console.log(`\n📦 ${suite}`);
  fn();
}

// ── Test Suites ───────────────────────────────────────────────────────────────

// Silence logger during tests
const silentLogger = { warn: () => {}, error: () => {} };

describe("createExpressErrorHandler — AppError passthrough", () => {
  const handler = createExpressErrorHandler({ logger: silentLogger });
  const res = makeMockRes();

  handler(new NotFoundError("Post not found"), mockReq, res.mock, mockNext);

  assert(res.statusCode === 404, "Sets correct HTTP status code");

  const body = res.body as { success: boolean; error: { code: string; message: string; details: unknown } };
  assert(body.success === false, "success is false");
  assert(body.error.code === ErrorCode.NOT_FOUND, "errorCode matches");
  assert(body.error.message === "Post not found", "message passes through");
  assert(body.error.details === null, "details is null when not provided");
});

describe("createExpressErrorHandler — ValidationError with details", () => {
  const handler = createExpressErrorHandler({ logger: silentLogger });
  const res = makeMockRes();
  const fieldErrors = { username: ["Too short"], email: ["Invalid format"] };

  handler(new ValidationError(fieldErrors), mockReq, res.mock, mockNext);

  assert(res.statusCode === 400, "Sets 400 for ValidationError");

  const body = res.body as { success: boolean; error: { code: string; details: unknown } };
  assert(body.error.code === ErrorCode.VALIDATION_ERROR, "errorCode is VALIDATION_ERROR");
  assert(JSON.stringify(body.error.details) === JSON.stringify(fieldErrors), "field errors in response");
});

describe("createExpressErrorHandler — native Error coercion", () => {
  const handler = createExpressErrorHandler({ logger: silentLogger });
  const res = makeMockRes();

  handler(new Error("DB connection failed"), mockReq, res.mock, mockNext);

  assert(res.statusCode === 500, "Native Error coerced to 500");

  const body = res.body as { success: boolean; error: { code: string; details: unknown } };
  assert(body.success === false, "success is false");
  assert(body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "errorCode is INTERNAL_SERVER_ERROR");
  // In non-production (test env), message passes through
  assert(body.error.details === null, "details is null for non-operational errors");
});

describe("createExpressErrorHandler — unknown thrown value", () => {
  const handler = createExpressErrorHandler({ logger: silentLogger });
  const res = makeMockRes();

  handler("something went wrong", mockReq, res.mock, mockNext);

  assert(res.statusCode === 500, "String throw coerced to 500");
  const body = res.body as { error: { code: string } };
  assert(body.error.code === ErrorCode.INTERNAL_SERVER_ERROR, "errorCode is INTERNAL_SERVER_ERROR");
});

describe("createExpressErrorHandler — production message masking", () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const handler = createExpressErrorHandler({
    logger: silentLogger,
    genericServerErrorMessage: "Something went wrong on our end.",
  });
  const res = makeMockRes();

  handler(new Error("Stripe API key invalid"), mockReq, res.mock, mockNext);

  const body = res.body as { error: { message: string } };
  assert(
    body.error.message === "Something went wrong on our end.",
    "Internal error message masked in production"
  );

  process.env.NODE_ENV = originalEnv;
});

describe("createExpressErrorHandler — logger injection", () => {
  const logs: string[] = [];
  const captureLogger = {
    warn: (msg: string) => logs.push(`WARN: ${msg}`),
    error: (msg: string) => logs.push(`ERROR: ${msg}`),
  };

  const handler = createExpressErrorHandler({ logger: captureLogger });
  const res = makeMockRes();

  handler(new NotFoundError("Item not found"), mockReq, res.mock, mockNext);

  assert(logs.some((l) => l.startsWith("WARN:")), "4xx logged at WARN level");
  logs.length = 0;

  handler(new Error("Unexpected crash"), mockReq, res.mock, mockNext);
  assert(logs.some((l) => l.startsWith("ERROR:")), "5xx logged at ERROR level");
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log("\n────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("────────────────────────────────────────\n");

if (failed > 0) {
  process.exit(1);
}
