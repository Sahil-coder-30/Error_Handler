/**
 * @file tests/adversarial/12_type_level.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 12: TYPESCRIPT COMPILE-TIME TYPE TESTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates TypeScript compiler guarantees:
 * 1. AppError cannot be directly instantiated (abstract class)
 * 2. Readonly properties cannot be mutated
 * 3. ErrorCodeValue accepts open union of standard codes and arbitrary custom strings
 * 4. ValidationError requires details as first argument
 * 5. createExpressErrorHandler options typing
 */

import {
  AppError,
  BadRequestError,
  ValidationError,
  NotFoundError,
  ErrorCode,
  type ErrorCodeValue,
  type StandardErrorCode,
  type ErrorResponse,
  type ErrorCoercer,
} from "../../src/index.js";
import {
  createExpressErrorHandler,
  type ErrorHandlerOptions,
} from "../../src/express.js";

// ── 1. Abstract Base Class Guard ─────────────────────────────────────────────
// @ts-expect-error Cannot create an instance of an abstract class.
const illegalInstantiation = new AppError("Direct base", 500, ErrorCode.INTERNAL_SERVER_ERROR);

// ── 2. Readonly Invariant Guards ─────────────────────────────────────────────
const notFound = new NotFoundError("Not found");
// @ts-expect-error Cannot assign to 'statusCode' because it is a read-only property.
notFound.statusCode = 500;
// @ts-expect-error Cannot assign to 'errorCode' because it is a read-only property.
notFound.errorCode = "ANOTHER_CODE";
// @ts-expect-error Cannot assign to 'isOperational' because it is a read-only property.
notFound.isOperational = false;

// ── 3. Open Union String Autocompletion & Custom Codes ────────────────────────
// Standard enum value assigned to ErrorCodeValue
const validStandardCode: ErrorCodeValue = ErrorCode.RATE_LIMIT_EXCEEDED;

// Arbitrary custom string literal assigned WITHOUT 'as any' or 'as unknown'
const validCustomCode: ErrorCodeValue = "MY_CUSTOM_DISTRIBUTED_TX_TIMEOUT";

// ── 4. ValidationError Signature Guard ───────────────────────────────────────
// Details is required as first argument
const validValidation = new ValidationError({ email: ["Invalid"] }, "Custom message");

// ── 5. ErrorHandler Options Type Contract ────────────────────────────────────
const validOptions: ErrorHandlerOptions = {
  includeStackInLog: false,
  genericServerErrorMessage: "Custom safe message",
  includeRequestId: true,
  requestIdHeader: "x-correlation-id",
  getRequestId: (req) => req.headers["x-custom-trace"] as string,
  errorCoercer: (err: unknown) => {
    if (err && typeof err === "object" && "isPrisma" in err) {
      return new BadRequestError("Database format error");
    }
    return err;
  },
};

const handler = createExpressErrorHandler(validOptions);

// Export dummy value to ensure file is treated as a module
export const typeCheckPassed = true;
