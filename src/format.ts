/**
 * @file src/format.ts
 * @description Lightweight, transport-agnostic error formatting utilities.
 * Generates identical, OpenAPI-compliant error response shapes for non-HTTP contexts:
 * WebSockets (Socket.io), Message Queues (RabbitMQ, BullMQ, Kafka), gRPC, and Lambdas.
 */

import { coerceToAppError } from "./coerce.js";
import type { ErrorResponse, ErrorCoercer } from "./types.js";

export interface FormatErrorOptions {
  /**
   * Whether to apply production error masking (hiding internal messages for 5xx).
   * Defaults to `process.env.NODE_ENV === "production"`.
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
   */
  requestId?: string;

  /**
   * Custom error coercion hook to map Mongoose, Prisma, or proprietary errors before formatting.
   */
  errorCoercer?: ErrorCoercer;
}

const DEFAULT_GENERIC_MESSAGE =
  "An unexpected error occurred. Our team has been notified.";

/**
 * Converts any thrown value or Error into a guaranteed OpenAPI-compliant `ErrorResponse` envelope.
 * Completely transport-agnostic: ideal for Socket.io events, message queues, and serverless handlers.
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
export function toErrorResponse(
  err: unknown,
  options: FormatErrorOptions = {}
): ErrorResponse {
  const {
    isProduction = process.env.NODE_ENV === "production",
    genericServerErrorMessage = DEFAULT_GENERIC_MESSAGE,
    requestId,
    errorCoercer,
  } = options;

  const appError = coerceToAppError(err, errorCoercer);

  const shouldMask = isProduction && !appError.isOperational;
  const message = shouldMask ? genericServerErrorMessage : appError.message;
  const details = shouldMask ? null : (appError.details ?? null);

  const response: ErrorResponse = {
    success: false,
    error: {
      code: appError.errorCode,
      message,
      details,
      ...(requestId ? { requestId } : {}),
    },
    ...(requestId ? { requestId } : {}),
  };

  return response;
}

/**
 * Functional alias for `toErrorResponse`.
 */
export const formatError = toErrorResponse;
