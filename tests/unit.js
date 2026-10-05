/**
 * @file tests/unit.js
 * @description Fast unit tests for compiled CJS output.
 */

"use strict";

const {
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
  ContextWindowExceededError,
  ModelRateLimitError,
  LlmProviderDownError,
  InsufficientCreditsError,
  ContentFilteredError,
  ModelNotFoundError,
  ErrorCode,
} = require("../dist/cjs/index.js");

const { createExpressErrorHandler } = require("../dist/cjs/express.js");

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    console.log("  ✅ " + name);
    passed++;
  } else {
    console.error("  ❌ FAILED: " + name);
    failed++;
  }
}

console.log("\n🧪 Running Unit Tests on Compiled CJS Output...");

// 1. Prototype inheritance & instanceof
const nfe = new NotFoundError("Not found test");
assert(nfe instanceof AppError, "NotFoundError instanceof AppError");
assert(nfe instanceof Error, "NotFoundError instanceof Error");
assert(nfe instanceof NotFoundError, "NotFoundError instanceof NotFoundError");
assert(nfe.name === "NotFoundError", "name is NotFoundError");
assert(nfe.statusCode === 404, "statusCode is 404");
assert(nfe.errorCode === ErrorCode.NOT_FOUND, "errorCode is NOT_FOUND");
assert(nfe.isOperational === true, "isOperational is true");
assert(nfe.details === null, "details is null by default");
assert(typeof nfe.stack === "string", "stack trace captured");

// 2. toJSON contract compliance
const json = new BadRequestError("Missing field").toJSON();
assert(json.success === false, "toJSON() success is false");
assert(json.error.code === ErrorCode.BAD_REQUEST, "toJSON() code matches");
assert(json.error.message === "Missing field", "toJSON() message matches");
assert(json.error.details === null, "toJSON() details matches");

// 3. ValidationError details
const ve = new ValidationError({ email: ["invalid"] });
assert(ve.statusCode === 400, "ValidationError statusCode 400");
assert(ve.errorCode === ErrorCode.VALIDATION_ERROR, "ValidationError errorCode");
assert(JSON.stringify(ve.details) === JSON.stringify({ email: ["invalid"] }), "details preserved");

// 4. Status codes coverage
assert(new UnauthorizedError().statusCode === 401, "401 Unauthorized");
assert(new TokenExpiredError().statusCode === 401, "401 TokenExpired");
assert(new TokenInvalidError().statusCode === 401, "401 TokenInvalid");
assert(new ForbiddenError().statusCode === 403, "403 Forbidden");
assert(new ConflictError().statusCode === 409, "409 Conflict");
assert(new UnprocessableEntityError().statusCode === 422, "422 Unprocessable");
assert(new RateLimitError().statusCode === 429, "429 RateLimit");
assert(new InternalServerError().statusCode === 500, "500 InternalServerError");
assert(new ServiceUnavailableError().statusCode === 503, "503 ServiceUnavailable");

// 5. Operational vs Non-operational flags
assert(new InternalServerError().isOperational === false, "500 isOperational is false");
assert(new ServiceUnavailableError().isOperational === false, "503 isOperational is false");
assert(new LlmProviderDownError().isOperational === false, "503 LlmProviderDownError isOperational is false");

// 6. AI & LLM Error Classes
assert(new ContextWindowExceededError().statusCode === 400, "ContextWindowExceededError status is 400");
assert(new ContextWindowExceededError().errorCode === ErrorCode.CONTEXT_WINDOW_EXCEEDED, "ContextWindowExceededError code matches");
assert(new ModelRateLimitError().statusCode === 429, "ModelRateLimitError status is 429");
assert(new ModelRateLimitError().errorCode === ErrorCode.MODEL_RATE_LIMIT, "ModelRateLimitError code matches");
assert(new LlmProviderDownError().statusCode === 503, "LlmProviderDownError status is 503");
assert(new InsufficientCreditsError().statusCode === 402, "InsufficientCreditsError status is 402");
assert(new ContentFilteredError().statusCode === 400, "ContentFilteredError status is 400");
assert(new ModelNotFoundError().statusCode === 404, "ModelNotFoundError status is 404");

// 7. ErrorCode completeness
const codes = Object.values(ErrorCode);
assert(codes.length >= 18, "ErrorCode enum has all required keys including AI codes");
assert(codes.every((c) => typeof c === "string"), "All codes are strings");

// 7. Express middleware factory initialization
const middleware = createExpressErrorHandler({
  logger: { warn: () => {}, error: () => {} },
});
assert(typeof middleware === "function", "createExpressErrorHandler returns function");
assert(middleware.length === 4, "middleware has 4 arguments (err, req, res, next)");

console.log("\n────────────────────────────────────────");
console.log(`Unit Results: ${passed} passed, ${failed} failed`);
console.log("────────────────────────────────────────\n");

if (failed > 0) process.exit(1);
