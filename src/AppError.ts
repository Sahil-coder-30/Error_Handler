/**
 * @file src/AppError.ts
 * @description The abstract base class for all custom application errors.
 *
 * Design decisions:
 *  - Extends native `Error` for full compatibility with try/catch, instanceof,
 *    and Node.js crash reporters.
 *  - Abstract to prevent direct instantiation — forces use of concrete subclasses
 *    with semantically meaningful names.
 *  - Framework-agnostic: zero imports from Express or any HTTP library.
 *  - `Error.captureStackTrace` is called conditionally because it is a V8-only
 *    API (Node.js / Chrome). It is gracefully skipped in non-V8 runtimes.
 */

import { ErrorCode, type ErrorCodeValue } from "./types.js";

export abstract class AppError extends Error {
  /** HTTP status code to send in the response (e.g. 400, 404, 500). */
  public readonly statusCode: number;

  /**
   * Machine-readable error code. Must be a member of the `ErrorCode` const.
   * This is what your frontend switches on for programmatic handling.
   */
  public readonly errorCode: ErrorCodeValue;

  /**
   * Optional structured payload for validation errors or additional context.
   * For example, a Zod parse error result or Mongoose validation error paths.
   *
   * Typed as `unknown` to keep the core class free of any schema-library
   * dependency. Cast to the concrete shape in the consumer layer.
   */
  public readonly details: unknown | null;

  /**
   * Marks this error as an operational error (expected, user-facing) vs.
   * a programmer error (unexpected, requires crash reporting).
   *
   * Middleware can use this flag to decide whether to log at `warn` or `error`
   * level and whether to send the original message or a generic 500 message.
   */
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    errorCode: ErrorCodeValue,
    details: unknown | null = null,
    isOperational = true
  ) {
    super(message);

    // Restore the prototype chain — required when extending built-in classes in TypeScript.
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = new.target.name; // e.g. "NotFoundError", "BadRequestError"
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = isOperational;

    // Capture a clean stack trace that points to the throw site, not this constructor.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }

  /**
   * Serializes the error into the strict OpenAPI `ErrorResponse` shape.
   * Accepts an optional distributed requestId.
   */
  public toJSON(requestId?: string) {
    return {
      success: false as const,
      error: {
        code: this.errorCode,
        message: this.message,
        details: this.details,
        ...(requestId ? { requestId } : {}),
      },
      ...(requestId ? { requestId } : {}),
    };
  }

  private static _formatter?: (err: unknown, options?: any) => import("./types.js").ErrorResponse;

  /**
   * Internal hook used by format.ts to register the full OpenAPI formatter
   * without creating module-evaluation circular dependencies in ESM.
   */
  public static _registerFormatter(fn: (err: unknown, options?: any) => import("./types.js").ErrorResponse) {
    AppError._formatter = fn;
  }

  /**
   * Static helper to format any error (AppError, native Error, Mongoose, or unknown)
   * into a standardized OpenAPI ErrorResponse for non-HTTP environments (WebSockets, RabbitMQ, etc.).
   */
  public static format(
    err: unknown,
    options?: import("./format.js").FormatErrorOptions
  ): import("./types.js").ErrorResponse {
    if (AppError._formatter) {
      return AppError._formatter(err, options);
    }

    // Try CommonJS require if available in environment
    if (typeof require === "function") {
      try {
        const { toErrorResponse } = require("./format.js");
        return toErrorResponse(err, options);
      } catch {
        // continue to fallback
      }
    }

    // Safe zero-dependency fallback if format.js has not registered
    const isApp = err instanceof AppError;
    const code = isApp ? err.errorCode : ErrorCode.INTERNAL_SERVER_ERROR;
    const msg = isApp ? err.message : "An unexpected error occurred.";
    const details = isApp ? (err.details ?? null) : null;
    const reqId = options?.requestId;

    return {
      success: false as const,
      error: {
        code,
        message: msg,
        details,
        ...(reqId ? { requestId: reqId } : {}),
      },
      ...(reqId ? { requestId: reqId } : {}),
    };
  }

  /**
   * Static alias for `AppError.format(err, options)`.
   */
  public static toResponse(
    err: unknown,
    options?: import("./format.js").FormatErrorOptions
  ): import("./types.js").ErrorResponse {
    return AppError.format(err, options);
  }
}
