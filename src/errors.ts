/**
 * @file src/errors.ts
 * @description Concrete error subclasses for every standard HTTP error scenario.
 *
 * Naming convention:  <SemanticName>Error
 * Each class is a thin wrapper that:
 *   1. Pre-fills the correct HTTP status code.
 *   2. Pre-fills a default ErrorCode that matches the OpenAPI spec.
 *   3. Accepts an optional message override, a details payload, and `{ cause }` options.
 *
 * Signatures (all arguments optional unless noted):
 *   new XxxError(message?, details?, options?)
 *   new ValidationError(details, message?, options?)   // details first
 *
 * Usage in a service:
 *   throw new NotFoundError("User not found");
 *   throw new ValidationError(zodError.flatten().fieldErrors, "Invalid input");
 *   throw new ServiceUnavailableError("Billing is down", null, { cause: err });
 */

import { AppError, type AppErrorOptions } from "./AppError.js";
import { ErrorCode } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// 4xx Client Errors — isOperational: true
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 400 Bad Request — Generic malformed request body or missing required fields.
 */
export class BadRequestError extends AppError {
  constructor(
    message = "The request could not be understood due to malformed syntax.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 400, ErrorCode.BAD_REQUEST, details, true, options);
  }
}

/**
 * 400 Validation Error — Input schema violation (e.g. Zod, Joi, class-validator).
 * Use `details` to pass the structured field-error map from your schema library.
 *
 * Example:
 *   const result = schema.safeParse(req.body);
 *   if (!result.success) throw new ValidationError(result.error.flatten().fieldErrors);
 */
export class ValidationError extends AppError {
  constructor(
    details: unknown = null,
    message = "Input validation failed. Please check the provided fields.",
    options?: AppErrorOptions
  ) {
    super(message, 400, ErrorCode.VALIDATION_ERROR, details, true, options);
  }
}

/**
 * 401 Unauthorized — Request lacks valid authentication credentials.
 */
export class UnauthorizedError extends AppError {
  constructor(
    message = "Authentication is required to access this resource.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 401, ErrorCode.UNAUTHORIZED, details, true, options);
  }
}

/**
 * 401 Token Expired — JWT or session token has expired.
 */
export class TokenExpiredError extends AppError {
  constructor(
    message = "Your session has expired. Please sign in again.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 401, ErrorCode.TOKEN_EXPIRED, details, true, options);
  }
}

/**
 * 401 Token Invalid — JWT signature invalid or token is malformed.
 */
export class TokenInvalidError extends AppError {
  constructor(
    message = "The provided authentication token is invalid.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 401, ErrorCode.TOKEN_INVALID, details, true, options);
  }
}

/**
 * 403 Forbidden — Authenticated but lacks sufficient permissions.
 */
export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to perform this action.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 403, ErrorCode.FORBIDDEN, details, true, options);
  }
}

/**
 * 404 Not Found — Requested resource does not exist.
 */
export class NotFoundError extends AppError {
  constructor(
    message = "The requested resource could not be found.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 404, ErrorCode.NOT_FOUND, details, true, options);
  }
}

/**
 * 409 Conflict — Resource already exists or state conflict (e.g. duplicate email).
 */
export class ConflictError extends AppError {
  constructor(
    message = "A conflict occurred with the current state of the resource.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 409, ErrorCode.CONFLICT, details, true, options);
  }
}

/**
 * 422 Unprocessable Entity — Request is syntactically valid but semantically incorrect.
 * Use for business logic violations that aren't raw input format errors.
 */
export class UnprocessableEntityError extends AppError {
  constructor(
    message = "The request was well-formed but contained semantic errors.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 422, ErrorCode.UNPROCESSABLE_ENTITY, details, true, options);
  }
}

/**
 * 429 Too Many Requests — Rate limit exceeded.
 * Tip: pass `{ retryAfterSeconds }` as details so clients know when to retry.
 */
export class RateLimitError extends AppError {
  constructor(
    message = "Too many requests. Please slow down and try again later.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 429, ErrorCode.RATE_LIMIT_EXCEEDED, details, true, options);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5xx Server Errors — isOperational: false (message masked in production)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 500 Internal Server Error — Unexpected programmer/infrastructure failure.
 *
 * `isOperational` is `false` here because this is NOT a user-facing
 * operational error. The middleware will log this at `error` level and
 * return a safe, generic message to the client in production (never the raw stack trace).
 */
export class InternalServerError extends AppError {
  constructor(
    message = "An unexpected internal server error occurred.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 500, ErrorCode.INTERNAL_SERVER_ERROR, details, false, options);
  }
}

/**
 * 500 Message Processing Failed — A queue / event consumer could not process a message.
 */
export class MessageProcessingFailedError extends AppError {
  constructor(
    message = "The message could not be processed.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 500, ErrorCode.MESSAGE_PROCESSING_FAILED, details, false, options);
  }
}

/**
 * 502 Bad Gateway — An upstream service returned an invalid response.
 */
export class BadGatewayError extends AppError {
  constructor(
    message = "An upstream service returned an invalid response.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 502, ErrorCode.BAD_GATEWAY, details, false, options);
  }
}

/**
 * 503 Service Unavailable — Downstream service or database is unreachable.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = "The service is temporarily unavailable. Please try again shortly.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 503, ErrorCode.SERVICE_UNAVAILABLE, details, false, options);
  }
}

/**
 * 504 Gateway Timeout — An upstream service did not respond in time.
 */
export class GatewayTimeoutError extends AppError {
  constructor(
    message = "An upstream service did not respond in time.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 504, ErrorCode.GATEWAY_TIMEOUT, details, false, options);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI & LLM Orchestration Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 400 Context Window Exceeded — The prompt or token count exceeds model limits.
 */
export class ContextWindowExceededError extends AppError {
  constructor(
    message = "The token context window limit for this model has been exceeded.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 400, ErrorCode.CONTEXT_WINDOW_EXCEEDED, details, true, options);
  }
}

/**
 * 429 Model Rate Limit — Downstream AI model provider rate limit hit (TPM or RPM).
 */
export class ModelRateLimitError extends AppError {
  constructor(
    message = "AI model rate limit exceeded. Please retry after backoff.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 429, ErrorCode.MODEL_RATE_LIMIT, details, true, options);
  }
}

/**
 * 503 LLM Provider Down — Downstream LLM provider (OpenAI, Anthropic, etc.) is unreachable or degraded.
 */
export class LlmProviderDownError extends AppError {
  constructor(
    message = "The upstream AI provider is currently unreachable or experiencing an outage.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 503, ErrorCode.LLM_PROVIDER_DOWN, details, false, options);
  }
}

/**
 * 402 Insufficient Credits — Account has insufficient token quota or balance for generation.
 */
export class InsufficientCreditsError extends AppError {
  constructor(
    message = "Insufficient AI credits or balance to complete this request.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 402, ErrorCode.INSUFFICIENT_CREDITS, details, true, options);
  }
}

/**
 * 400 Content Filtered — Safety filters or guardrails blocked generation input/output.
 */
export class ContentFilteredError extends AppError {
  constructor(
    message = "Request was blocked by safety filters or guardrails.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 400, ErrorCode.CONTENT_FILTERED, details, true, options);
  }
}

/**
 * 404 Model Not Found — The requested AI model or checkpoint is unrecognized.
 */
export class ModelNotFoundError extends AppError {
  constructor(
    message = "The specified AI model could not be found.",
    details: unknown | null = null,
    options?: AppErrorOptions
  ) {
    super(message, 404, ErrorCode.MODEL_NOT_FOUND, details, true, options);
  }
}
