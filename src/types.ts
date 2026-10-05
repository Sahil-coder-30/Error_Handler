/**
 * @file src/types.ts
 * @description Shared type contracts for the error-handler package.
 *              This is the single source of truth for the OpenAPI error schema.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error Code Enum
// ─────────────────────────────────────────────────────────────────────────────

/**
 * String-based enum of all error codes surfaced in API responses.
 *
 * Using a const object + type union pattern (not TypeScript `enum`) to ensure
 * the values are tree-shakeable and work correctly in both CJS and ESM contexts.
 */
export const ErrorCode = {
  // 400
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",

  // 401
  UNAUTHORIZED: "UNAUTHORIZED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",

  // 403
  FORBIDDEN: "FORBIDDEN",

  // 404
  NOT_FOUND: "NOT_FOUND",

  // 409
  CONFLICT: "CONFLICT",

  // 422
  UNPROCESSABLE_ENTITY: "UNPROCESSABLE_ENTITY",

  // 429
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",

  // 500
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

/**
 * Union type of all valid error code string literals.
 * Alias: `ErrorCodeValue` is the string-union type; `ErrorCode` is the const object.
 */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI-Compliant Error Response Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The inner `error` object within the response body.
 * This MUST match your OpenAPI spec definition exactly.
 */
export interface ErrorPayload {
  /** Machine-readable code for programmatic handling by the frontend. */
  code: ErrorCodeValue;
  /** Human-readable message, safe to display. */
  message: string;
  /**
   * Structured validation details (e.g. Zod field errors, Mongoose errors).
   * null when no additional context is available.
   */
  details: unknown | null;
}

/**
 * The top-level API response envelope for all errors.
 * Guaranteed shape for every non-2xx response.
 */
export interface ErrorResponse {
  success: false;
  error: ErrorPayload;
}
