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
 *  - `instanceof AppError` works across duplicate copies of this package
 *    (CJS + ESM loaded together, or two versions in a monorepo) through a
 *    global `Symbol.for` brand.
 */

import { ErrorCode, type ErrorCodeValue, type ErrorResponse } from "./types.js";
import { sanitizeDetails, normalizeRequestId } from "./sanitize.js";
import type { FormatErrorOptions } from "./format.js";

/** Global brand shared by every copy of faultkit loaded in the process. */
const APP_ERROR_BRAND = Symbol.for("faultkit.AppError");

const DEFAULT_GENERIC_MESSAGE = "An unexpected error occurred. Our team has been notified.";

/** Extra constructor options for `AppError` and custom subclasses. */
export interface AppErrorOptions {
  /** The underlying error that caused this one (same meaning as native `Error` `cause`). */
  cause?: unknown;
}

/** Options accepted by `AppError#toJSON`. */
export interface AppErrorJSONOptions {
  /** Distributed correlation ID to include in the envelope. */
  requestId?: string;
}

type Formatter = (err: unknown, options?: FormatErrorOptions) => ErrorResponse;

export abstract class AppError extends Error {
  /** HTTP status code to send in the response (e.g. 400, 404, 500). */
  public readonly statusCode: number;

  /**
   * Machine-readable error code. Usually a member of the `ErrorCode` const,
   * but any custom string is accepted.
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
   * Middleware uses this flag to decide whether to log at `warn` or `error`
   * level and whether to send the original message or a generic 500 message.
   */
  public readonly isOperational: boolean;

  /** The underlying error, when one was provided. Never sent to clients. */
  public declare readonly cause?: unknown;

  constructor(
    message: string,
    statusCode: number,
    errorCode: ErrorCodeValue,
    details: unknown | null = null,
    isOperational = true,
    options?: AppErrorOptions
  ) {
    super(message);

    // Restore the prototype chain — required when extending built-in classes in TypeScript.
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = new.target.name; // e.g. "NotFoundError", "BadRequestError"
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details === undefined ? null : details;
    this.isOperational = isOperational;

    if (options && typeof options === "object" && "cause" in options) {
      // Non-enumerable, like the native `cause` property.
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }

    // Capture a clean stack trace that points to the throw site, not this constructor.
    const captureStackTrace = (Error as { captureStackTrace?: (t: object, c?: unknown) => void })
      .captureStackTrace;
    if (typeof captureStackTrace === "function") {
      captureStackTrace(this, new.target);
    }
  }

  /**
   * Makes `x instanceof AppError` true for errors created by any copy of faultkit.
   * Subclass checks (`x instanceof NotFoundError`) keep normal prototype semantics.
   */
  static [Symbol.hasInstance](instance: unknown): boolean {
    try {
      if (this !== AppError) {
        return Function.prototype[Symbol.hasInstance].call(this, instance);
      }
      if (instance === null || (typeof instance !== "object" && typeof instance !== "function")) {
        return false;
      }
      return (instance as Record<symbol, unknown>)[APP_ERROR_BRAND] === true;
    } catch {
      // Hostile proxies must never crash an `instanceof` check.
      return false;
    }
  }

  /**
   * Serializes the error into the strict OpenAPI `ErrorResponse` shape.
   *
   * This is a raw serializer: it does NOT apply production masking. Use
   * `toErrorResponse(err)` or `toHttpResponse(err)` when sending errors to clients.
   *
   * @param requestIdOrOptions - A request ID string, or `{ requestId }`.
   *   Note: `JSON.stringify` passes the property key as the first argument, so
   *   prefer the object form when calling this directly.
   */
  public toJSON(requestIdOrOptions?: string | AppErrorJSONOptions): ErrorResponse {
    const rawId =
      requestIdOrOptions !== null && typeof requestIdOrOptions === "object"
        ? requestIdOrOptions.requestId
        : requestIdOrOptions;
    const requestId = normalizeRequestId(rawId);

    return {
      success: false as const,
      error: {
        code: this.errorCode,
        message: this.message,
        details: sanitizeDetails(this.details),
        ...(requestId ? { requestId } : {}),
      },
      ...(requestId ? { requestId } : {}),
    };
  }

  private static _formatter?: Formatter;

  /**
   * Internal hook used by format.ts to register the full OpenAPI formatter
   * without creating module-evaluation circular dependencies in ESM.
   * @internal
   */
  public static _registerFormatter(fn: Formatter): void {
    AppError._formatter = fn;
  }

  /**
   * Static helper to format any error (AppError, native Error, Mongoose, or unknown)
   * into a standardized OpenAPI ErrorResponse for non-HTTP environments (WebSockets, RabbitMQ, etc.).
   * Applies the same production masking as `toErrorResponse`.
   */
  public static format(err: unknown, options?: FormatErrorOptions): ErrorResponse {
    if (AppError._formatter) {
      return AppError._formatter(err, options);
    }

    // Safe zero-dependency fallback, used only if format.js was never loaded.
    const opts = options && typeof options === "object" ? options : {};
    const isProduction =
      typeof opts.isProduction === "boolean"
        ? opts.isProduction
        : typeof process !== "undefined" && process.env?.NODE_ENV === "production";
    const isApp = err instanceof AppError;
    const mask = !isApp || (isProduction && !(err as AppError).isOperational);
    const code = isApp ? (err as AppError).errorCode : ErrorCode.INTERNAL_SERVER_ERROR;
    const message = mask
      ? opts.genericServerErrorMessage || DEFAULT_GENERIC_MESSAGE
      : (err as AppError).message;
    const details = mask ? null : sanitizeDetails((err as AppError).details);
    const requestId = normalizeRequestId(opts.requestId);

    return {
      success: false as const,
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
   * Static alias for `AppError.format(err, options)`.
   */
  public static toResponse(err: unknown, options?: FormatErrorOptions): ErrorResponse {
    return AppError.format(err, options);
  }
}

// Brand every AppError (from this copy) so other copies recognize it.
Object.defineProperty(AppError.prototype, APP_ERROR_BRAND, {
  value: true,
  enumerable: false,
  writable: false,
  configurable: false,
});
