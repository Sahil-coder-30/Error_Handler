/**
 * @file src/express.ts
 * @description Express-specific error handling middleware factory.
 *
 * This file is the ONLY place in the package that depends on Express types.
 * It is exported via its own entry point (`faultguard/express`)
 * so that non-Express consumers never pay the cost of this import.
 *
 * Key behaviours:
 *  1. Coerces unknown thrown values (strings, plain objects, native Errors) into
 *     a safe AppError-compatible shape before responding.
 *  2. Distinguishes operational errors (expected) from programmer errors (unexpected).
 *     - Operational: uses the error's own message and code.
 *     - Non-operational / unknown: logs the raw error, returns a safe generic 500.
 *  3. Never leaks stack traces or internal details to the client in production.
 *  4. Logger is injected via the factory options — keeps the package dependency-free.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { AppError } from "./AppError.js";
import { ErrorCode, type ErrorResponse } from "./types.js";
import { logger as defaultLogger } from "./logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A logger interface compatible with FaultGuard's built-in Pino logger,
 * standard `console`, `winston`, or custom loggers.
 */
export interface ErrorHandlerLogger {
  warn: (arg1: any, ...args: any[]) => void;
  error: (arg1: any, ...args: any[]) => void;
}

export interface ErrorHandlerOptions {
  /**
   * Injected logger. Defaults to FaultGuard's built-in Grafana/Loki-optimized Pino logger.
   * You can also supply custom Pino, Winston, or console instances.
   */
  logger?: ErrorHandlerLogger;

  /**
   * Set to `true` in development to include the stack trace in the
   * server-side log output. Never included in the HTTP response body.
   * Defaults to `process.env.NODE_ENV !== 'production'`.
   */
  includeStackInLog?: boolean;

  /**
   * The generic message returned for non-operational (5xx programmer) errors.
   * Prevents leaking internal implementation details to API consumers.
   */
  genericServerErrorMessage?: string;
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
 * import { createExpressErrorHandler } from 'faultguard/express';
 * import pino from 'pino';
 *
 * const app = express();
 * const logger = pino();
 *
 * app.use(createExpressErrorHandler({ logger }));
 * ```
 */
export function createExpressErrorHandler(
  options: ErrorHandlerOptions = {}
): ErrorRequestHandler {
  const {
    logger = defaultLogger,
    includeStackInLog = process.env.NODE_ENV !== "production",
    genericServerErrorMessage = "An unexpected error occurred. Our team has been notified.",
  } = options;

  // Express identifies a global error handler by its 4-argument signature: (err, req, res, next).
  // The `_next` parameter is intentionally unused but MUST be declared for Express to recognize
  // this as an error handler.
  return function globalErrorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // ── Express Safeguard: If headers were already sent, delegate to default handler
    if (res.headersSent) {
      return next(err);
    }

    // ── Step 1: Normalize the thrown value into an AppError ──────────────────

    let appError: AppError;

    if (err instanceof AppError) {
      // Happy path: one of our typed errors was thrown.
      appError = err;
    } else if (err instanceof Error) {
      // Check if a third-party library or Express middleware attached a status code
      // (e.g. body-parser SyntaxError on malformed JSON sets err.status = 400).
      const anyErr = err as unknown as { status?: unknown; statusCode?: unknown; code?: unknown };
      const rawStatus = anyErr.statusCode ?? anyErr.status;
      const parsedStatus = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599
        ? rawStatus
        : 500;

      const isClientError = parsedStatus >= 400 && parsedStatus < 500;

      // Map HTTP status to appropriate ErrorCode
      let resolvedCode: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.INTERNAL_SERVER_ERROR;
      if (parsedStatus === 400) resolvedCode = ErrorCode.BAD_REQUEST;
      else if (parsedStatus === 401) resolvedCode = ErrorCode.UNAUTHORIZED;
      else if (parsedStatus === 403) resolvedCode = ErrorCode.FORBIDDEN;
      else if (parsedStatus === 404) resolvedCode = ErrorCode.NOT_FOUND;
      else if (parsedStatus === 409) resolvedCode = ErrorCode.CONFLICT;
      else if (parsedStatus === 422) resolvedCode = ErrorCode.UNPROCESSABLE_ENTITY;
      else if (parsedStatus === 429) resolvedCode = ErrorCode.RATE_LIMIT_EXCEEDED;
      else if (parsedStatus === 503) resolvedCode = ErrorCode.SERVICE_UNAVAILABLE;
      else if (isClientError) resolvedCode = ErrorCode.BAD_REQUEST;

      const wrappedError = Object.assign(
        Object.create(AppError.prototype),
        {
          name: err.name || (isClientError ? "BadRequestError" : "InternalServerError"),
          message: err.message || (isClientError ? "Bad Request" : "An unexpected internal server error occurred."),
          statusCode: parsedStatus,
          errorCode: resolvedCode,
          details: null,
          isOperational: isClientError, // 4xx from libraries are operational; 5xx are crashes
          stack: err.stack,
        }
      ) as AppError;
      appError = wrappedError;
    } else {
      // A completely unknown value was thrown (e.g. `throw "something"`, `throw null`, or `throw { status: 400, message: "custom" }`).
      let message = "An unknown error occurred.";
      let parsedStatus = 500;
      let isOperational = false;
      let resolvedCode: (typeof ErrorCode)[keyof typeof ErrorCode] = ErrorCode.INTERNAL_SERVER_ERROR;

      try {
        if (typeof err === "string") {
          message = err.length > 0 ? err : "An unknown error occurred.";
        } else if (err && typeof err === "object") {
          const anyErr = err as Record<string, unknown>;
          if (typeof anyErr.message === "string" && anyErr.message.length > 0) {
            message = anyErr.message;
          }
          const rawStatus = anyErr.statusCode ?? anyErr.status;
          if (typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599) {
            parsedStatus = rawStatus;
            isOperational = rawStatus < 500;
            if (rawStatus === 400) resolvedCode = ErrorCode.BAD_REQUEST;
            else if (rawStatus === 401) resolvedCode = ErrorCode.UNAUTHORIZED;
            else if (rawStatus === 403) resolvedCode = ErrorCode.FORBIDDEN;
            else if (rawStatus === 404) resolvedCode = ErrorCode.NOT_FOUND;
            else if (rawStatus === 409) resolvedCode = ErrorCode.CONFLICT;
            else if (rawStatus === 422) resolvedCode = ErrorCode.UNPROCESSABLE_ENTITY;
            else if (rawStatus === 429) resolvedCode = ErrorCode.RATE_LIMIT_EXCEEDED;
            else if (rawStatus === 503) resolvedCode = ErrorCode.SERVICE_UNAVAILABLE;
            else if (isOperational) resolvedCode = ErrorCode.BAD_REQUEST;
          }
        }
      } catch {
        message = "An unreadable error was thrown.";
      }

      const wrappedError = Object.assign(
        Object.create(AppError.prototype),
        {
          name: isOperational ? "BadRequestError" : "InternalServerError",
          message,
          statusCode: parsedStatus,
          errorCode: resolvedCode,
          details: null,
          isOperational,
          stack: undefined,
        }
      ) as AppError;
      appError = wrappedError;
    }

    // ── Step 2: Log with appropriate severity ────────────────────────────────

    const logMeta = {
      statusCode: appError.statusCode,
      errorCode: appError.errorCode,
      isOperational: appError.isOperational,
      details: appError.details,
      ...(includeStackInLog && { stack: appError.stack }),
    };

    const logMessage = `[AppError] ${appError.name}: ${appError.message}`;
    const logPayload = { err: appError, ...logMeta };
    const isPino = typeof (logger as { child?: unknown }).child === "function";

    try {
      if (!appError.isOperational || appError.statusCode >= 500) {
        // 500s and programmer errors are CRITICAL — always log at error level.
        if (isPino) {
          logger.error(logPayload, logMessage);
        } else {
          logger.error(logMessage, logPayload);
        }
      } else {
        // Operational 4xx errors are expected — log at warn level to reduce noise.
        if (isPino) {
          logger.warn(logPayload, logMessage);
        } else {
          logger.warn(logMessage, logPayload);
        }
      }
    } catch (loggingErr) {
      console.error("[FaultKit] Logger invocation failed:", loggingErr);
    }

    // ── Step 3: Build the strict OpenAPI-compliant response ──────────────────

    const isProduction = process.env.NODE_ENV === "production";

    /**
     * For non-operational errors in production, we hide the real message to
     * prevent leaking implementation details. In development, we show it to
     * make debugging easier.
     */
    const clientMessage =
      appError.isOperational || !isProduction
        ? appError.message
        : genericServerErrorMessage;

    const responseBody: ErrorResponse = {
      success: false,
      error: {
        code: appError.errorCode,
        message: clientMessage,
        details: appError.isOperational ? appError.details : null,
      },
    };

    // ── Step 4: Send the response ─────────────────────────────────────────────

    res.status(appError.statusCode).json(responseBody);
  };
}
