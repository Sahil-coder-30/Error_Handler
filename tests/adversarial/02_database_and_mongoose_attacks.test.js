/**
 * @file tests/adversarial/02_database_and_mongoose_attacks.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 2: DATABASE & MONGOOSE ERROR ATTACKS
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests database error coercion:
 * 1. Mongoose ValidationError with varied shapes
 * 2. Mongoose CastError (including sensitive value handling)
 * 3. MongoDB code 11000 duplicate key with malformed/missing keyValue
 * 4. Non-11000 MongoServerError (AuthFailed, ExceededTimeLimit, NetworkError)
 *    -> These MUST NOT be falsely coerced into 409 Conflict!
 * 5. Database connection and driver crashes
 */

"use strict";

const {
  AppError,
  ValidationError,
  ConflictError,
  BadRequestError,
  InternalServerError,
  ErrorCode,
  coerceToAppError,
  toErrorResponse,
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
  console.log("\n🔥 [ADVERSARIAL SUITE 2] Database & Mongoose Error Attacks");
  console.log("─────────────────────────────────────────────────────────────");

  // ── 1. Mongoose ValidationError Edge Cases ─────────────────────────────────
  console.log("\n📋 [1] Mongoose ValidationError edge cases");
  {
    // 1a. Empty errors map
    const emptyValidation = {
      name: "ValidationError",
      message: "Validation failed with no sub-errors",
      errors: {},
    };
    const coercedEmpty = coerceToAppError(emptyValidation);
    assert(coercedEmpty instanceof ValidationError, "Empty errors map coerced to ValidationError");
    assert(coercedEmpty.statusCode === 400, "Empty errors map maps to 400");
    assert(coercedEmpty.errorCode === ErrorCode.VALIDATION_ERROR, "Error code is VALIDATION_ERROR");

    // 1b. ValidationError where errors is NOT an object (e.g. null, array, string)
    const malformedErrors = {
      name: "ValidationError",
      message: "Malformed validation",
      errors: null,
    };
    const coercedMalformed = coerceToAppError(malformedErrors);
    assert(coercedMalformed instanceof AppError, "Malformed errors coerced to AppError");
    // If errors is null, does it crash? No, but let's verify what it becomes

    // 1c. Deeply nested validation errors (e.g. nested subdocuments)
    const nestedValidation = {
      name: "ValidationError",
      message: "User.profile.address.zipcode: invalid zip format",
      errors: {
        "profile.address.zipcode": {
          message: "Invalid zip format",
          path: "profile.address.zipcode",
          value: "123",
        },
      },
    };
    const coercedNested = coerceToAppError(nestedValidation);
    assert(coercedNested instanceof ValidationError, "Nested validation paths handled");
    assert(coercedNested.details["profile.address.zipcode"] !== undefined, "Preserves nested path in details");

    // 1d. Throwing getter in errors property
    const getterValidation = {
      name: "ValidationError",
      get errors() {
        throw new Error("errors getter exploded");
      },
    };
    let threw = false;
    let coercedGetter;
    try {
      coercedGetter = coerceToAppError(getterValidation);
    } catch {
      threw = true;
    }
    assert(!threw, "Throwing getter in errors does not crash coerceToAppError");
    assert(coercedGetter instanceof AppError, "Throwing errors getter falls back to AppError");
  }

  // ── 2. Mongoose CastError Edge Cases ───────────────────────────────────────
  console.log("\n📋 [2] Mongoose CastError edge cases");
  {
    // 2a. CastError with missing path and value
    const emptyCast = {
      name: "CastError",
    };
    const coercedEmptyCast = coerceToAppError(emptyCast);
    assert(coercedEmptyCast instanceof BadRequestError, "Empty CastError maps to BadRequestError");
    assert(coercedEmptyCast.statusCode === 400, "Empty CastError status is 400");

    // 2b. CastError where value contains sensitive input (e.g. password)
    const sensitiveCast = {
      name: "CastError",
      path: "password",
      value: "super_secret_password_123",
    };
    const coercedSensitiveCast = coerceToAppError(sensitiveCast);
    assert(coercedSensitiveCast.statusCode === 400, "Sensitive CastError maps to 400");
  }

  // ── 3. MongoDB Code 11000 Duplicate Key Edge Cases ─────────────────────────
  console.log("\n📋 [3] MongoDB Duplicate Key (Code 11000) Edge Cases");
  {
    // 3a. Duplicate key with keyPattern instead of keyValue
    const keyPatternOnly = {
      name: "MongoServerError",
      code: 11000,
      keyPattern: { username: 1, tenantId: 1 },
    };
    const coercedPattern = coerceToAppError(keyPatternOnly);
    assert(coercedPattern instanceof ConflictError, "keyPattern only coerced to ConflictError");
    assert(coercedPattern.statusCode === 409, "keyPattern duplicate key maps to 409");
    assert(coercedPattern.message.includes("username"), "Message includes field from keyPattern");

    // 3b. Duplicate key with neither keyValue nor keyPattern
    const bareDuplicate = {
      name: "MongoServerError",
      code: 11000,
    };
    const coercedBare = coerceToAppError(bareDuplicate);
    assert(coercedBare instanceof ConflictError, "Bare 11000 coerced to ConflictError");
    assert(coercedBare.statusCode === 409, "Bare 11000 maps to 409");
    assert(coercedBare.details === null, "details is null when keyValue missing");

    // 3c. Duplicate key with string code "11000"
    const stringCodeDup = {
      code: "11000",
      keyValue: { email: "test@example.com" },
    };
    const coercedStringCode = coerceToAppError(stringCodeDup);
    assert(coercedStringCode instanceof ConflictError, "String code '11000' coerced to ConflictError");
    assert(coercedStringCode.statusCode === 409, "String code '11000' maps to 409");
  }

  // ── 4. Non-11000 MongoServerError Attacks (BUG DETECTION) ───────────────────
  console.log("\n📋 [4] Non-11000 MongoServerError Attacks");
  {
    // 4a. MongoServerError with code 18 (AuthenticationFailed)
    // A database authentication failure is an internal server error (500)
    // It MUST NOT be falsely coerced to 409 Conflict with "Duplicate key error" message!
    const authFailedError = {
      name: "MongoServerError",
      code: 18,
      codeName: "AuthenticationFailed",
      message: "Authentication failed on database admin with user root",
    };

    const coercedAuth = coerceToAppError(authFailedError);
    assert(
      coercedAuth.statusCode === 500,
      "MongoServerError with code 18 (AuthenticationFailed) MUST map to HTTP 500 (NOT 409 Conflict)",
      `Actual statusCode: ${coercedAuth.statusCode}, name: ${coercedAuth.name}, message: "${coercedAuth.message}"`
    );
    assert(
      coercedAuth.errorCode === ErrorCode.INTERNAL_SERVER_ERROR,
      "MongoServerError AuthFailed errorCode MUST be INTERNAL_SERVER_ERROR",
      `Actual errorCode: ${coercedAuth.errorCode}`
    );
    assert(
      !coercedAuth.message.includes("Duplicate key error"),
      "MongoServerError AuthFailed MUST NOT report 'Duplicate key error'",
      `Actual message: "${coercedAuth.message}"`
    );

    // 4b. MongoServerError with code 50 (ExceededTimeLimit)
    const timeoutError = {
      name: "MongoServerError",
      code: 50,
      codeName: "ExceededTimeLimit",
      message: "operation exceeded time limit",
    };

    const coercedTimeout = coerceToAppError(timeoutError);
    assert(
      coercedTimeout.statusCode === 500 || coercedTimeout.statusCode === 504,
      "MongoServerError with code 50 (Timeout) MUST NOT map to 409 Conflict",
      `Actual statusCode: ${coercedTimeout.statusCode}`
    );
    assert(
      !coercedTimeout.message.includes("Duplicate key error"),
      "MongoServerError Timeout MUST NOT report 'Duplicate key error'",
      `Actual message: "${coercedTimeout.message}"`
    );

    // 4c. MongoServerError with code 13 (Unauthorized)
    const unauthorizedDbError = {
      name: "MongoServerError",
      code: 13,
      codeName: "Unauthorized",
      message: "not authorized on testDb to execute command",
    };

    const coercedDbUnauth = coerceToAppError(unauthorizedDbError);
    assert(
      coercedDbUnauth.statusCode === 500,
      "MongoServerError code 13 (DB permission denied) MUST map to HTTP 500 (NOT 409 Conflict)",
      `Actual statusCode: ${coercedDbUnauth.statusCode}`
    );

    // 4d. MongoNetworkError / Connection Failures
    const networkError = new Error("failed to connect to server [localhost:27017] on first connect");
    networkError.name = "MongoNetworkError";
    const coercedNetwork = coerceToAppError(networkError);
    assert(coercedNetwork.statusCode === 500, "MongoNetworkError maps to HTTP 500");
    assert(coercedNetwork.errorCode === ErrorCode.INTERNAL_SERVER_ERROR, "MongoNetworkError is INTERNAL_SERVER_ERROR");
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 2 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
