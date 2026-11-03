/**
 * @file src/format.ts
 * @description Lightweight, transport-agnostic error formatting utilities.
 * Generates identical, OpenAPI-compliant error response shapes for any transport:
 * HTTP frameworks (Express, Fastify, Hono, Koa), WebSockets (Socket.io),
 * Message Queues (RabbitMQ, BullMQ, Kafka), gRPC, and serverless handlers.
 */

import { AppError } from "./AppError.js";
import { coerceToAppError } from "./coerce.js";
import { sanitizeDetails, normalizeRequestId } from "./sanitize.js";
import type { ErrorResponse, ErrorCoercer } from "./types.js";

export { sanitizeDetails } from "./sanitize.js";

export interface FormatErrorOptions {
  /**
   * Whether to apply production error masking (hiding internal messages for
   * non-operational errors). Defaults to `process.env.NODE_ENV === "production"`.
   */
  isProduction?: boolean;

  /**
   * The generic fallback message for non-operational errors in production.
   * Defaults to "An unexpected error occurred. Our team has been notified."
   */
  genericServerErrorMessage?: string;

  /**
   * Distributed correlation / request ID (e.g. from socket handshake or queue metadata).
   * Included in both `error.requestId` and top-level `requestId`.
   * Numbers are converted to strings. Unsafe values (control characters, spaces,
   * quotes, longer than 256 chars) are dropped.
   */
  requestId?: string | number;

  /**
   * Custom error coercion hook to map Mongoose, Prisma, or proprietary errors before formatting.
   * Must be synchronous.
   */
  errorCoercer?: ErrorCoercer;
}

/** Result of `toHttpResponse`: everything an HTTP framework needs to reply. */
export interface HttpErrorResponse {
  /** A valid HTTP error status (400-599). */
  statusCode: number;
  /** The OpenAPI-compliant JSON body. */
  body: ErrorResponse;
  /** The normalized error, for logging. Never send this to the client. */
  error: AppError;
}

const DEFAULT_GENERIC_MESSAGE = "An unexpected error occurred. Our team has been notified.";

function resolveIsProduction(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
}

/** Clamps any status value to a valid integer HTTP error status (defaults to 500). */
function safeHttpStatus(status: unknown): number {
  if (typeof status === "number" && Number.isFinite(status)) {
    const rounded = Math.floor(status);
    if (rounded >= 400 && rounded <= 599) return rounded;
  }
  return 500;
}

/** Builds the response body for an already-coerced AppError. */
function buildBody(
  appError: AppError,
  isProduction: boolean,
  genericMessage: string,
  requestId: string | undefined
): ErrorResponse {
  const shouldMask = isProduction && !appError.isOperational;

  let message: string;
  if (shouldMask) {
    message = genericMessage;
  } else {
    const raw = appError.message;
    message = typeof raw === "string" ? raw : String(raw);
  }

  const details = shouldMask ? null : sanitizeDetails(appError.details);
  // Developer-supplied string codes are kept verbatim; non-strings break the contract.
  const code = typeof appError.errorCode === "string" ? appError.errorCode : "INTERNAL_SERVER_ERROR";

  return {
    success: false,
    error: {
      code,
      message,
      details,
      ...(requestId ? { requestId } : {}),
    },
    ...(requestId ? { requestId } : {}),
  };
}

/**
 * Converts any thrown value or Error into a guaranteed HTTP status + OpenAPI body.
 * Use it from any framework that is not Express (Fastify, Hono, Koa, Lambda, Next.js).
 * Never throws.
 *
 * @example
 * ```ts
 * fastify.setErrorHandler((err, request, reply) => {
 *   const { statusCode, body } = toHttpResponse(err, { requestId: request.id });
 *   reply.status(statusCode).send(body);
 * });
 * ```
 */
export function toHttpResponse(err: unknown, options?: FormatErrorOptions | null): HttpErrorResponse {
  const opts: FormatErrorOptions = options && typeof options === "object" ? options : {};
  const appError = coerceToAppError(err, opts.errorCoercer);
  const genericMessage =
    typeof opts.genericServerErrorMessage === "string" && opts.genericServerErrorMessage.length > 0
      ? opts.genericServerErrorMessage
      : DEFAULT_GENERIC_MESSAGE;

  let body: ErrorResponse;
  try {
    body = buildBody(appError, resolveIsProduction(opts.isProduction), genericMessage, normalizeRequestId(opts.requestId));
  } catch {
    body = {
      success: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: genericMessage, details: null },
    };
  }

  return { statusCode: safeHttpStatus(appError.statusCode), body, error: appError };
}

/**
 * Converts any thrown value or Error into a guaranteed OpenAPI-compliant `ErrorResponse` envelope.
 * Completely transport-agnostic: ideal for Socket.io events, message queues, and serverless handlers.
 * Never throws.
 *
 * @param err - Any error, exception, or thrown value
 * @param options - Formatting configuration (requestId, errorCoercer, isProduction, etc.)
 * @returns A standardized `{ success: false, error: { code, message, details, requestId? }, requestId? }` object
 *
 * @example
 * ```ts
 * // In Socket.io event:
 * socket.on("prompt", async (data) => {
 *   try {
 *     await handlePrompt(data);
 *   } catch (err) {
 *     socket.emit("agent:error", toErrorResponse(err, { requestId: data.requestId }));
 *   }
 * });
 * ```
 */
export function toErrorResponse(err: unknown, options?: FormatErrorOptions | null): ErrorResponse {
  return toHttpResponse(err, options).body;
}

/**
 * Functional alias for `toErrorResponse`.
 */
export const formatError = toErrorResponse;

// Register full formatter on AppError static dispatch (for ESM and non-HTTP callers)
AppError._registerFormatter(toErrorResponse);
