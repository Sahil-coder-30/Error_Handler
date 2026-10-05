/**
 * @file src/errors.ts
 * @description Concrete error subclasses for every standard HTTP error scenario.
 *
 * Naming convention:  <SemanticName>Error
 * Each class is a thin wrapper that:
 *   1. Pre-fills the correct HTTP status code.
 *   2. Pre-fills a default ErrorCode that matches the OpenAPI spec.
 *   3. Accepts an optional human-readable message override and details payload.
 *
 * Usage in a service:
 *   throw new NotFoundError("User not found");
 *   throw new ValidationError("Invalid input", zodError.flatten().fieldErrors);
 */

import { AppError } from "./AppError.js";
import { ErrorCode } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// 4xx Client Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 400 Bad Request — Generic malformed request body or missing required fields.
 */
export class BadRequestError extends AppError {
  constructor(
    message = "The request could not be understood due to malformed syntax.",
    details: unknown | null = null
  ) {
    super(message, 400, ErrorCode.BAD_REQUEST, details);
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
    details: unknown,
    message = "Input validation failed. Please check the provided fields."
  ) {
    super(message, 400, ErrorCode.VALIDATION_ERROR, details);
  }
}

/**
 * 401 Unauthorized — Request lacks valid authentication credentials.
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required to access this resource.") {
    super(message, 401, ErrorCode.UNAUTHORIZED);
  }
}

/**
 * 401 Token Expired — JWT or session token has expired.
 */
export class TokenExpiredError extends AppError {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message, 401, ErrorCode.TOKEN_EXPIRED);
  }
}

/**
 * 401 Token Invalid — JWT signature invalid or token is malformed.
 */
export class TokenInvalidError extends AppError {
  constructor(message = "The provided authentication token is invalid.") {
    super(message, 401, ErrorCode.TOKEN_INVALID);
  }
}

/**
 * 403 Forbidden — Authenticated but lacks sufficient permissions.
 */
export class ForbiddenError extends AppError {
  constructor(
    message = "You do not have permission to perform this action."
  ) {
    super(message, 403, ErrorCode.FORBIDDEN);
  }
}

/**
 * 404 Not Found — Requested resource does not exist.
 */
export class NotFoundError extends AppError {
  constructor(message = "The requested resource could not be found.") {
    super(message, 404, ErrorCode.NOT_FOUND);
  }
}

/**
 * 409 Conflict — Resource already exists or state conflict (e.g. duplicate email).
 */
export class ConflictError extends AppError {
  constructor(
    message = "A conflict occurred with the current state of the resource.",
    details: unknown | null = null
  ) {
    super(message, 409, ErrorCode.CONFLICT, details);
  }
}

/**
 * 422 Unprocessable Entity — Request is syntactically valid but semantically incorrect.
 * Use for business logic violations that aren't raw input format errors.
 */
export class UnprocessableEntityError extends AppError {
  constructor(
    message = "The request was well-formed but contained semantic errors.",
    details: unknown | null = null
  ) {
    super(message, 422, ErrorCode.UNPROCESSABLE_ENTITY, details);
  }
}

/**
 * 429 Too Many Requests — Rate limit exceeded.
 */
export class RateLimitError extends AppError {
  constructor(
    message = "Too many requests. Please slow down and try again later."
  ) {
    super(message, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5xx Server Errors — isOperational: false by default
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 500 Internal Server Error — Unexpected programmer/infrastructure failure.
 *
 * `isOperational` is `false` here because this is NOT a user-facing
 * operational error. The middleware will log this at `error` level and
 * return a safe, generic message to the client (never the raw stack trace).
 */
export class InternalServerError extends AppError {
  constructor(
    message = "An unexpected internal server error occurred.",
    details: unknown | null = null
  ) {
    // isOperational = false → the middleware will mask the original message in production
    super(message, 500, ErrorCode.INTERNAL_SERVER_ERROR, details, false);
  }
}

/**
 * 503 Service Unavailable — Downstream service or database is unreachable.
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    message = "The service is temporarily unavailable. Please try again shortly."
  ) {
    super(message, 503, ErrorCode.SERVICE_UNAVAILABLE, null, false);
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
    details: unknown | null = null
  ) {
    super(message, 400, ErrorCode.CONTEXT_WINDOW_EXCEEDED, details);
  }
}

/**
 * 429 Model Rate Limit — Downstream AI model provider rate limit hit (TPM or RPM).
 */
export class ModelRateLimitError extends AppError {
  constructor(
    message = "AI model rate limit exceeded. Please retry after backoff.",
    details: unknown | null = null
  ) {
    super(message, 429, ErrorCode.MODEL_RATE_LIMIT, details);
  }
}

/**
 * 503 LLM Provider Down — Downstream LLM provider (OpenAI, Anthropic, etc.) is unreachable or degraded.
 */
export class LlmProviderDownError extends AppError {
  constructor(
    message = "The upstream AI provider is currently unreachable or experiencing an outage.",
    details: unknown | null = null
  ) {
    super(message, 503, ErrorCode.LLM_PROVIDER_DOWN, details, false);
  }
}

/**
 * 402 / 403 Insufficient Credits — Account has insufficient token quota or balance for generation.
 */
export class InsufficientCreditsError extends AppError {
  constructor(
    message = "Insufficient AI credits or balance to complete this request.",
    details: unknown | null = null
  ) {
    super(message, 402, ErrorCode.INSUFFICIENT_CREDITS, details);
  }
}

/**
 * 400 Content Filtered — Safety filters or guardrails blocked generation input/output.
 */
export class ContentFilteredError extends AppError {
  constructor(
    message = "Request was blocked by safety filters or guardrails.",
    details: unknown | null = null
  ) {
    super(message, 400, ErrorCode.CONTENT_FILTERED, details);
  }
}

/**
 * 404 Model Not Found — The requested AI model or checkpoint is unrecognized.
 */
export class ModelNotFoundError extends AppError {
  constructor(
    message = "The specified AI model could not be found.",
    details: unknown | null = null
  ) {
    super(message, 404, ErrorCode.MODEL_NOT_FOUND, details);
  }
}

