/**
 * @file src/index.ts
 * @description Main public entry point for the framework-agnostic core.
 *
 * Intentionally does NOT export Express utilities — those live in `src/express.ts`
 * and are accessed via the `faultkit/express` sub-path export.
 *
 * This keeps non-Express consumers (Fastify, Hono, Lambda, etc.) from pulling
 * in any Express types or peer dependency references.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  ErrorCodeValue,
  StandardErrorCode,
  ErrorPayload,
  ErrorResponse,
  ErrorCoercer,
} from "./types.js";
export { ErrorCode } from "./types.js";

// ── Abstract Base ─────────────────────────────────────────────────────────────
export { AppError } from "./AppError.js";

// ── Concrete Error Classes ────────────────────────────────────────────────────
export {
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
} from "./errors.js";

// ── Normalization & Formatting (WebSockets, RabbitMQ, Lambdas) ────────────────
export { coerceToAppError } from "./coerce.js";
export { toErrorResponse, formatError, type FormatErrorOptions } from "./format.js";

// ── Observability & Logging ───────────────────────────────────────────────────
export {
  logger,
  createLogger,
  createAppErrorSerializer,
  DEFAULT_REDACT_KEYS,
  type Logger,
  type LogLevel,
  type FaultKitLoggerOptions,
  type FaultGuardLoggerOptions,
} from "./logger.js";
