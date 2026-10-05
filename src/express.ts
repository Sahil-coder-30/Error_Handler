/**
 * @file src/express.ts
 * @description Express-specific error handling middleware factory.
 *
 * This file is the ONLY place in the package that depends on Express types.
 * It is exported via its own entry point (`faultkit/express`)
 * so that non-Express consumers never pay the cost of this import.
 *
 * Key features:
 *  1. Coerces unknown thrown values, native Errors, Mongoose ValidationErrors,
 *     MongoDB duplicate key errors (11000), and custom ORM exceptions safely.
 *  2. Supports custom `errorCoercer` hook for domain/library error mapping.
 *  3. Distinguishes operational errors (4xx logged at warn) from programmer crashes (5xx logged at error).
 *  4. Distributed tracing: extracts and propagates `requestId` in logs, headers, and response body.
 *  5. Never leaks stack traces or sensitive internal details to the client in production.
 *  6. Logger injection with crash-resilient fallback boundary.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { AppError } from "./AppError.js";
import { ErrorCode, type ErrorResponse, type ErrorCoercer } from "./types.js";
import { logger as defaultLogger } from "./logger.js";
import { coerceToAppError } from "./coerce.js";

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A logger interface compatible with FaultKit's built-in Pino logger,
 * standard `console`, `winston`, or custom loggers.
 */
export interface ErrorHandlerLogger {
  warn: (arg1: any, ...args: any[]) => void;
  error: (arg1: any, ...args: any[]) => void;
}

export interface ErrorHandlerOptions {
  /**
   * Injected logger. Defaults to FaultKit's built-in Grafana/Loki-optimized Pino logger.
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

  /**
   * Custom error coercion hook to map Mongoose, Prisma, or proprietary library errors.
   * Runs before default error normalization.
   */
  errorCoercer?: ErrorCoercer;

  /**
   * Whether to extract and include a distributed correlation/request ID in logs and responses.
   * Defaults to `true`.
   */
  includeRequestId?: boolean;

  /**
   * Request header name to extract correlation ID from.
   * Defaults to `'x-request-id'`.
   */
  requestIdHeader?: string;

  /**
   * Custom function to extract or generate the request ID from the Express request.
   * Defaults to `req.id || req.headers[requestIdHeader] || req.headers['x-correlation-id']`.
   */
  getRequestId?: (req: Request) => string | undefined;
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
 * import { createExpressErrorHandler } from 'faultkit/express';
 *
 * const app = express();
 * app.use(createExpressErrorHandler({
 *   errorCoercer: (err) => {
 *     if (isPrismaError(err)) return new ConflictError("Database constraint violated");
 *   }
 * }));
 * ```
 */
export function createExpressErrorHandler(
  options: ErrorHandlerOptions = {}
): ErrorRequestHandler {
  const {
    logger = defaultLogger,
    includeStackInLog = process.env.NODE_ENV !== "production",
    genericServerErrorMessage = "An unexpected error occurred. Our team has been notified.",
    errorCoercer,
    includeRequestId = true,
    requestIdHeader = "x-request-id",
    getRequestId,
  } = options;

  // Express identifies a global error handler by its 4-argument signature: (err, req, res, next).
  return function globalErrorHandler(
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // ── Express Safeguard: If headers were already sent, delegate to default handler
    if (res.headersSent) {
      return next(err);
    }

    // ── Step 1: Normalize the thrown value into an AppError ──────────────────
    const appError: AppError = coerceToAppError(err, errorCoercer);

    // ── Step 2: Distributed Request / Correlation ID ─────────────────────────
    let requestId: string | undefined;
    if (includeRequestId) {
      if (typeof getRequestId === "function") {
        try {
          requestId = getRequestId(req);
        } catch {
          // ignore extractor errors
        }
      }
      if (!requestId && req) {
        const anyReq = req as unknown as Record<string, unknown>;
        requestId =
          (typeof anyReq.id === "string" ? anyReq.id : undefined) ||
          (typeof anyReq.requestId === "string" ? anyReq.requestId : undefined) ||
          (typeof anyReq.correlationId === "string" ? anyReq.correlationId : undefined);

        if (!requestId && req.headers) {
          const headerVal =
            req.headers[requestIdHeader.toLowerCase()] ||
            req.headers["x-correlation-id"];
          if (typeof headerVal === "string") {
            requestId = headerVal;
          } else if (Array.isArray(headerVal) && headerVal[0]) {
            requestId = headerVal[0];
          }
        }
      }

      // Propagate correlation ID in outgoing response headers if not already set
      if (requestId && !res.headersSent && typeof res.setHeader === "function") {
        try {
          res.setHeader(requestIdHeader, requestId);
        } catch {
          // safe boundary
        }
      }
    }

    // ── Step 3: Log with appropriate severity & correlation context ──────────
    const logMeta = {
      statusCode: appError.statusCode,
      errorCode: appError.errorCode,
      isOperational: appError.isOperational,
      details: appError.details,
      path: req ? req.originalUrl || req.url : undefined,
      method: req ? req.method : undefined,
      ...(requestId ? { requestId } : {}),
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

    // ── Step 4: Build the strict OpenAPI-compliant response ──────────────────
    const isProduction = process.env.NODE_ENV === "production";

    /**
     * For non-operational errors in production, hide the real message to
     * prevent leaking implementation details. In development, show it.
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
        ...(requestId ? { requestId } : {}),
      },
      ...(requestId ? { requestId } : {}),
    };

    // ── Step 5: Send the response ────────────────────────────────────────────
    res.status(appError.statusCode).json(responseBody);
  };
}
