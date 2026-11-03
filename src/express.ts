/**
 * @file src/express.ts
 * @description Express-specific error handling middleware and helpers.
 *
 * This file is the ONLY place in the package that depends on Express types.
 * It is exported via its own entry point (`faultkit/express`)
 * so that non-Express consumers never pay the cost of this import.
 *
 * Key features:
 *  1. Coerces unknown thrown values, native Errors, Mongoose, MongoDB, Prisma,
 *     Zod, Joi and http-errors style exceptions safely.
 *  2. Supports custom `errorCoercer` hook for domain/library error mapping.
 *  3. Distinguishes operational errors (4xx logged at warn) from programmer crashes (5xx logged at error).
 *  4. Distributed tracing: extracts (or generates) a validated `requestId` and
 *     propagates it in logs, headers, and the response body.
 *  5. Never leaks stack traces or sensitive internal details to the client in production.
 *  6. Logger injection (Pino, Bunyan, Winston, console) with a crash-resilient fallback boundary.
 *  7. `createNotFoundHandler()` so unmatched routes return the same JSON contract.
 *  8. `asyncHandler()` so Express 4 async routes forward rejections to the error handler.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction, ErrorRequestHandler, RequestHandler } from "express";
import type { AppError } from "./AppError.js";
import type { ErrorCoercer } from "./types.js";
import { NotFoundError } from "./errors.js";
import { logger as defaultLogger } from "./logger.js";
import { toHttpResponse } from "./format.js";
import { normalizeRequestId } from "./sanitize.js";

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A logger interface compatible with FaultKit's built-in Pino logger,
 * standard `console`, `winston`, `bunyan`, or custom loggers.
 */
export interface ErrorHandlerLogger {
  warn: (arg1: any, ...args: any[]) => void;
  error: (arg1: any, ...args: any[]) => void;
}

/**
 * How log arguments are ordered:
 *  - `"object-first"`: `logger.error({ err, ...meta }, message)` (Pino, Bunyan)
 *  - `"message-first"`: `logger.error(message, { err, ...meta })` (console, Winston)
 *  - `"auto"`: detect from the logger (default)
 */
export type LoggerStyle = "auto" | "object-first" | "message-first";

export interface ErrorHandlerOptions {
  /**
   * Injected logger. Defaults to FaultKit's built-in Grafana/Loki-optimized Pino logger.
   * You can also supply custom Pino, Winston, Bunyan, or console instances.
   * Pass `false` to disable logging.
   */
  logger?: ErrorHandlerLogger | false | null;

  /**
   * Argument order used when calling the logger. Defaults to `"auto"`.
   */
  loggerStyle?: LoggerStyle;

  /**
   * Whether to include the stack trace in the server-side log output.
   * Never included in the HTTP response body.
   * Defaults to `process.env.NODE_ENV !== 'production'`.
   */
  includeStackInLog?: boolean;

  /**
   * Whether to mask non-operational error messages and details in responses.
   * Defaults to `process.env.NODE_ENV === 'production'` (checked per request).
   */
  isProduction?: boolean;

  /**
   * The generic message returned for non-operational (5xx programmer) errors in production.
   * Prevents leaking internal implementation details to API consumers.
   */
  genericServerErrorMessage?: string;

  /**
   * Custom error coercion hook to map Mongoose, Prisma, or proprietary library errors.
   * Runs before default error normalization. Must be synchronous.
   */
  errorCoercer?: ErrorCoercer;

  /**
   * Whether to extract and include a distributed correlation/request ID in logs and responses.
   * Defaults to `true`.
   */
  includeRequestId?: boolean;

  /**
   * Request header name to extract the correlation ID from, and the response
   * header it is echoed in. Defaults to `'x-request-id'`.
   */
  requestIdHeader?: string;

  /**
   * Custom function to extract the request ID from the Express request.
   * Defaults to `req.id || req.requestId || req.correlationId || req.headers[requestIdHeader] || req.headers['x-correlation-id']`.
   */
  getRequestId?: (req: Request) => string | number | undefined;

  /**
   * Generate a request ID when the request has none.
   * `true` uses `crypto.randomUUID()`; a function lets you build your own.
   * Defaults to `false`.
   */
  generateRequestId?: boolean | ((req: Request) => string);

  /**
   * Called once per handled error, after logging (e.g. to report to Sentry).
   * Errors thrown by this hook are caught and ignored.
   */
  onError?: (error: AppError, req: Request, originalError: unknown) => void;
}

const DEFAULT_GENERIC_MESSAGE = "An unexpected error occurred. Our team has been notified.";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function read(obj: unknown, key: string): unknown {
  try {
    return obj !== null && obj !== undefined ? (obj as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
}

function detectStyle(logger: unknown, style: LoggerStyle | undefined): "object-first" | "message-first" {
  if (style === "object-first" || style === "message-first") return style;
  // Winston exposes `transports` and `format`; it expects the message first.
  if (read(logger, "transports") !== undefined && read(logger, "format") !== undefined) {
    return "message-first";
  }
  // Pino and Bunyan expose `child()` and take a merge object first.
  return typeof read(logger, "child") === "function" ? "object-first" : "message-first";
}

/** Request path without the query string (query strings often carry tokens). */
function requestPath(req: Request | undefined): string | undefined {
  const raw = read(req, "originalUrl") ?? read(req, "url");
  if (typeof raw !== "string") return undefined;
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
}

function extractRequestId(
  req: Request | undefined,
  header: string,
  getRequestId: ErrorHandlerOptions["getRequestId"],
  generateRequestId: ErrorHandlerOptions["generateRequestId"]
): string | undefined {
  if (typeof getRequestId === "function") {
    try {
      const custom = normalizeRequestId(getRequestId(req as Request));
      if (custom) return custom;
    } catch {
      /* ignore extractor errors */
    }
  }

  if (req) {
    for (const key of ["id", "requestId", "correlationId"]) {
      const id = normalizeRequestId(read(req, key));
      if (id) return id;
    }

    const headers = read(req, "headers") as Record<string, unknown> | undefined;
    if (headers && typeof headers === "object") {
      for (const name of [header.toLowerCase(), "x-correlation-id"]) {
        const value = read(headers, name);
        const id = normalizeRequestId(Array.isArray(value) ? value[0] : value);
        if (id) return id;
      }
    }
  }

  if (generateRequestId) {
    try {
      const generated =
        typeof generateRequestId === "function" ? generateRequestId(req as Request) : randomUUID();
      return normalizeRequestId(generated);
    } catch {
      /* ignore generator errors */
    }
  }

  return undefined;
}

/** Builds the error object passed to the logger, honoring `includeStackInLog`. */
function errorForLog(appError: AppError, includeStack: boolean): unknown {
  if (includeStack) return appError;
  return {
    type: appError.name,
    name: appError.name,
    message: appError.message,
    statusCode: appError.statusCode,
    errorCode: appError.errorCode,
    isOperational: appError.isOperational,
    ...(appError.details !== null && appError.details !== undefined ? { details: appError.details } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a production-ready Express global error handling middleware.
 *
 * Must be registered as the LAST middleware in your Express app — after all
 * routes and other middleware.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createExpressErrorHandler, createNotFoundHandler } from 'faultkit/express';
 *
 * const app = express();
 * // ...routes
 * app.use(createNotFoundHandler());
 * app.use(createExpressErrorHandler({
 *   errorCoercer: (err) => {
 *     if (isStripeError(err)) return new BadRequestError(err.message);
 *   }
 * }));
 * ```
 */
export function createExpressErrorHandler(options?: ErrorHandlerOptions | null): ErrorRequestHandler {
  const opts: ErrorHandlerOptions = options && typeof options === "object" ? options : {};
  const {
    includeStackInLog = process.env.NODE_ENV !== "production",
    genericServerErrorMessage = DEFAULT_GENERIC_MESSAGE,
    errorCoercer,
    includeRequestId = true,
    getRequestId,
    generateRequestId = false,
    onError,
  } = opts;

  const logger: ErrorHandlerLogger | false =
    opts.logger === false ? false : opts.logger ? opts.logger : defaultLogger;
  const style = logger ? detectStyle(logger, opts.loggerStyle) : "message-first";
  const requestIdHeader =
    typeof opts.requestIdHeader === "string" && opts.requestIdHeader.trim().length > 0
      ? opts.requestIdHeader.trim()
      : "x-request-id";

  function log(level: "warn" | "error", message: string, payload: Record<string, unknown>): void {
    if (!logger) return;
    try {
      const fn = logger[level];
      if (typeof fn !== "function") return;
      if (style === "object-first") fn.call(logger, payload, message);
      else fn.call(logger, message, payload);
    } catch (loggingErr) {
      try {
        console.error("[FaultKit] Logger invocation failed:", loggingErr);
      } catch {
        /* nothing left to do */
      }
    }
  }

  // Express identifies a global error handler by its 4-argument signature: (err, req, res, next).
  return function globalErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
    const forward = (value: unknown): void => {
      if (typeof next === "function") next(value);
    };

    // ── Step 1: Normalize into status + body (never throws) ──────────────────
    const requestId = includeRequestId
      ? extractRequestId(req, requestIdHeader, getRequestId, generateRequestId)
      : undefined;

    const { statusCode, body, error: appError } = toHttpResponse(err, {
      errorCoercer,
      genericServerErrorMessage,
      isProduction: typeof opts.isProduction === "boolean" ? opts.isProduction : undefined,
      requestId,
    });

    // ── Step 2: Log with appropriate severity & correlation context ──────────
    const headersAlreadySent = Boolean(read(res, "headersSent")) || Boolean(read(res, "writableEnded"));
    const logPayload: Record<string, unknown> = {
      err: errorForLog(appError, includeStackInLog),
      statusCode: appError.statusCode,
      errorCode: appError.errorCode,
      isOperational: appError.isOperational,
      details: appError.details,
      path: requestPath(req),
      method: read(req, "method"),
      ...(requestId ? { requestId } : {}),
      ...(includeStackInLog && appError.stack ? { stack: appError.stack } : {}),
      ...(headersAlreadySent ? { headersSent: true } : {}),
    };
    const logMessage = `[AppError] ${appError.name}: ${appError.message}`;
    const critical = !appError.isOperational || statusCode >= 500 || headersAlreadySent;
    log(critical ? "error" : "warn", logMessage, logPayload);

    if (typeof onError === "function") {
      try {
        onError(appError, req, err);
      } catch {
        /* reporting hooks must never break the response */
      }
    }

    // ── Step 3: If a response is already streaming, let Express close it ─────
    if (headersAlreadySent || !res) {
      forward(err);
      return;
    }

    // ── Step 4: Send the response ────────────────────────────────────────────
    if (requestId) {
      try {
        res.setHeader(requestIdHeader, requestId);
      } catch {
        /* invalid header name or already sent */
      }
    }

    try {
      res.status(statusCode).json(body);
    } catch {
      try {
        res.status(statusCode).json({
          success: false,
          error: { code: body.error.code, message: body.error.message, details: null },
        });
      } catch {
        forward(appError);
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for routes
// ─────────────────────────────────────────────────────────────────────────────

export interface NotFoundHandlerOptions {
  /** Custom message, or a function that builds one from the request. */
  message?: string | ((req: Request) => string);
}

/**
 * Catch-all middleware for unmatched routes. Mount it after all routes and
 * before `createExpressErrorHandler()`, so a missing route returns the JSON
 * contract instead of Express's default HTML page.
 *
 * @example
 * ```ts
 * app.use(createNotFoundHandler());
 * app.use(createExpressErrorHandler());
 * ```
 */
export function createNotFoundHandler(options?: NotFoundHandlerOptions | null): RequestHandler {
  const opts = options && typeof options === "object" ? options : {};
  return function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
    let message: string | undefined;
    try {
      message = typeof opts.message === "function" ? opts.message(req) : opts.message;
    } catch {
      message = undefined;
    }
    if (typeof message !== "string" || message.length === 0) {
      const method = read(req, "method");
      message = `Route ${typeof method === "string" ? method : "GET"} ${requestPath(req) ?? "/"} not found.`;
    }
    next(new NotFoundError(message));
  };
}

/**
 * Wraps an async route handler so a rejected promise (or a sync throw) is
 * forwarded to `next(err)`. Needed in Express 4; harmless in Express 5.
 *
 * @example
 * ```ts
 * app.get("/users/:id", asyncHandler(async (req, res) => {
 *   res.json(await getUser(req.params.id));
 * }));
 * ```
 */
export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  fn: (req: Req, res: Res, next: NextFunction) => unknown
): (req: Req, res: Res, next: NextFunction) => void {
  return function asyncRoute(req: Req, res: Res, next: NextFunction): void {
    try {
      const result = fn(req, res, next);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        (result as PromiseLike<unknown>).then(undefined, (err: unknown) =>
          next(err === undefined || err === null ? new Error("Async route rejected without a reason") : err)
        );
      }
    } catch (err) {
      next(err);
    }
  };
}
