/**
 * @file src/types.ts
 * @description Shared type contracts for the faultkit package.
 *              This is the single source of truth for the OpenAPI error schema.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error Code Enum & Custom Code Support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * String-based enum of standard HTTP, microservice, and AI error codes surfaced in API responses.
 *
 * Using a const object + type union pattern (not TypeScript `enum`) to ensure
 * the values are tree-shakeable, autocompletable, and work correctly in both CJS and ESM contexts.
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

  // 500 / 502 / 503 / 504 (Distributed Systems & Microservices)
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  GATEWAY_TIMEOUT: "GATEWAY_TIMEOUT",
  MESSAGE_PROCESSING_FAILED: "MESSAGE_PROCESSING_FAILED",

  // AI & LLM Orchestration
  CONTEXT_WINDOW_EXCEEDED: "CONTEXT_WINDOW_EXCEEDED",
  MODEL_RATE_LIMIT: "MODEL_RATE_LIMIT",
  LLM_PROVIDER_DOWN: "LLM_PROVIDER_DOWN",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
  CONTENT_FILTERED: "CONTENT_FILTERED",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
} as const;

/**
 * Union type of all standard built-in error code string literals.
 */
export type StandardErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Union type allowing all standard built-in error codes with IDE autocompletion,
 * while seamlessly accepting ANY custom domain or service-specific string without
 * requiring TypeScript type assertions (`as unknown as ErrorCodeValue`).
 */
export type ErrorCodeValue = StandardErrorCode | (string & {});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI-Compliant Error Response Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The inner `error` object within the response body.
 * This MUST match your OpenAPI spec definition exactly.
 */
export interface ErrorPayload {
  /** Machine-readable code for programmatic handling by frontend and services. */
  code: ErrorCodeValue;
  /** Human-readable message, safe to display. */
  message: string;
  /**
   * Structured validation details (e.g. Zod field errors, Mongoose validation errors).
   * null when no additional context is available.
   */
  details: unknown | null;
  /**
   * Distributed request correlation ID (e.g. 'x-request-id') for cross-service tracing.
   */
  requestId?: string;
}

/**
 * The top-level API response envelope for all errors.
 * Guaranteed shape for every non-2xx response.
 */
export interface ErrorResponse {
  success: false;
  error: ErrorPayload;
  /**
   * Top-level correlation ID mirroring `error.requestId` for convenient tracing.
   */
  requestId?: string;
}

/**
 * Custom error coercion hook signature.
 * Allows consumers to transform proprietary database, ORM, or 3rd-party library errors
 * (e.g. Mongoose, Prisma, Stripe, Axios) before fallback normalization.
 */
export type ErrorCoercer = (err: unknown) => unknown;
