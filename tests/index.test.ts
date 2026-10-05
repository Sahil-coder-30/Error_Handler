/**
 * @file tests/index.test.ts
 * @description Zero-dependency integration tests for the error-handler package.
 *
 * Run with:  npx ts-node tests/index.test.ts
 *
 * These tests verify:
 *  1. instanceof checks work correctly (prototype chain restored).
 *  2. toJSON() output matches the OpenAPI envelope exactly.
 *  3. Default messages are sane.
 *  4. Custom messages / details pass through correctly.
 *  5. isOperational flag is set correctly per class.
 */

import {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  TokenExpiredError,
  TokenInvalidError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
  ServiceUnavailableError,
  ErrorCode,
} from "../src/index.js";

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

function assertDeepEqual(actual: unknown, expected: unknown, testName: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), testName);
}

function describe(suite: string, fn: () => void): void {
  console.log(`\n📦 ${suite}`);
  fn();
}

// ── Test Suites ───────────────────────────────────────────────────────────────

describe("AppError — abstract base", () => {
  const err = new NotFoundError("Resource X not found");

  assert(err instanceof AppError, "NotFoundError instanceof AppError");
  assert(err instanceof Error, "NotFoundError instanceof Error");
  assert(err instanceof NotFoundError, "NotFoundError instanceof NotFoundError");
  assert(err.name === "NotFoundError", "name is set to the concrete class name");
  assert(err.statusCode === 404, "statusCode is 404");
  assert(err.errorCode === ErrorCode.NOT_FOUND, "errorCode is NOT_FOUND");
  assert(err.isOperational === true, "isOperational is true for 4xx");
  assert(err.details === null, "details defaults to null");
  assert(typeof err.stack === "string", "stack trace is captured");
});

describe("toJSON() — OpenAPI envelope", () => {
  const err = new BadRequestError("Missing required field `email`.");
  const json = err.toJSON();

  assertDeepEqual(json, {
    success: false,
    error: {
      code: ErrorCode.BAD_REQUEST,
      message: "Missing required field `email`.",
      details: null,
    },
  }, "toJSON() matches exact OpenAPI envelope shape");

  assert(json.success === false, "success is strictly false (not falsy)");
});

describe("ValidationError — details passthrough", () => {
  const fieldErrors = { email: ["Invalid email format"], age: ["Must be a number"] };
  const err = new ValidationError(fieldErrors);

  assert(err.statusCode === 400, "statusCode is 400");
  assert(err.errorCode === ErrorCode.VALIDATION_ERROR, "errorCode is VALIDATION_ERROR");
  assertDeepEqual(err.details, fieldErrors, "field errors passed through as details");

  const json = err.toJSON();
  assertDeepEqual(json.error.details, fieldErrors, "details serialized in toJSON()");
});

describe("UnauthorizedError variants", () => {
  const unauth = new UnauthorizedError();
  assert(unauth.statusCode === 401, "UnauthorizedError → 401");
  assert(unauth.errorCode === ErrorCode.UNAUTHORIZED, "UnauthorizedError errorCode");

  const expired = new TokenExpiredError();
  assert(expired.statusCode === 401, "TokenExpiredError → 401");
  assert(expired.errorCode === ErrorCode.TOKEN_EXPIRED, "TokenExpiredError errorCode");

  const invalid = new TokenInvalidError();
  assert(invalid.statusCode === 401, "TokenInvalidError → 401");
  assert(invalid.errorCode === ErrorCode.TOKEN_INVALID, "TokenInvalidError errorCode");
});

describe("ForbiddenError", () => {
  const err = new ForbiddenError();
  assert(err.statusCode === 403, "statusCode is 403");
  assert(err.errorCode === ErrorCode.FORBIDDEN, "errorCode is FORBIDDEN");
  assert(err.isOperational === true, "isOperational is true");
});

describe("ConflictError", () => {
  const err = new ConflictError("Email already registered.", { field: "email" });
  assert(err.statusCode === 409, "statusCode is 409");
  assert(err.errorCode === ErrorCode.CONFLICT, "errorCode is CONFLICT");
  assertDeepEqual(err.details, { field: "email" }, "details passed through");
});

describe("UnprocessableEntityError", () => {
  const err = new UnprocessableEntityError("Cannot publish a draft with no content.");
  assert(err.statusCode === 422, "statusCode is 422");
  assert(err.errorCode === ErrorCode.UNPROCESSABLE_ENTITY, "errorCode is UNPROCESSABLE_ENTITY");
});

describe("RateLimitError", () => {
  const err = new RateLimitError();
  assert(err.statusCode === 429, "statusCode is 429");
  assert(err.errorCode === ErrorCode.RATE_LIMIT_EXCEEDED, "errorCode is RATE_LIMIT_EXCEEDED");
});

describe("5xx errors — isOperational: false", () => {
  const internal = new InternalServerError();
  assert(internal.statusCode === 500, "InternalServerError → 500");
  assert(internal.isOperational === false, "InternalServerError isOperational is false");
  assert(internal.errorCode === ErrorCode.INTERNAL_SERVER_ERROR, "errorCode is INTERNAL_SERVER_ERROR");

  const unavailable = new ServiceUnavailableError();
  assert(unavailable.statusCode === 503, "ServiceUnavailableError → 503");
  assert(unavailable.isOperational === false, "ServiceUnavailableError isOperational is false");
});

describe("Custom message override", () => {
  const err = new NotFoundError("User with ID 42 was not found.");
  assert(err.message === "User with ID 42 was not found.", "Custom message is set");
  assert(err.toJSON().error.message === "User with ID 42 was not found.", "Custom message in toJSON");
});

describe("ErrorCode exhaustiveness", () => {
  const allCodes = Object.values(ErrorCode);
  assert(allCodes.length >= 12, `At least 12 error codes defined (found ${allCodes.length})`);
  assert(allCodes.every((c) => typeof c === "string"), "All error codes are strings");
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log("\n────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("────────────────────────────────────────\n");

if (failed > 0) {
  process.exit(1);
}
