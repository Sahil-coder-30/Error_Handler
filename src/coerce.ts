/**
 * @file src/coerce.ts
 * @description Centralized, battle-hardened error normalization and coercion.
 * Normalizes Mongoose, MongoDB, Prisma, third-party library, and hostile throws
 * into typed AppError instances before response formatting and logging.
 */

import { AppError } from "./AppError.js";
import {
  BadRequestError,
  ValidationError,
  ConflictError,
  InternalServerError,
} from "./errors.js";
import { ErrorCode, type ErrorCoercer, type ErrorCodeValue } from "./types.js";

/**
 * Coerces any unknown thrown value (native Error, Mongoose ValidationError,
 * MongoDB duplicate key, string, primitive, or third-party error) into an AppError.
 *
 * @param err - The raw caught error or thrown value
 * @param customCoercer - Optional user-supplied coercion hook (runs first)
 * @returns A guaranteed AppError instance with status, code, and operational flags
 */
export function coerceToAppError(err: unknown, customCoercer?: ErrorCoercer): AppError {
  // ── 0. Custom Coercion Hook (User-defined mapper) ──────────────────────────
  if (typeof customCoercer === "function") {
    try {
      const customResult = customCoercer(err);
      if (customResult instanceof AppError) {
        return customResult;
      }
      if (customResult !== undefined && customResult !== null && customResult !== err) {
        // If the hook modified or returned a new error, use it for further coercion
        err = customResult;
      }
    } catch {
      // Coercer must never crash the pipeline; fallback to standard coercion
    }
  }

  // ── 1. Happy Path: Already an AppError ────────────────────────────────────
  if (err instanceof AppError) {
    if (typeof err.statusCode === "number" && (err.statusCode < 400 || err.statusCode > 599)) {
      return new InternalServerError(err.message, err.details);
    }
    if (typeof err.statusCode === "number" && !Number.isInteger(err.statusCode)) {
      (err as any).statusCode = Math.floor(err.statusCode);
    }
    return err;
  }

  // ── 2. Native Error / Error Object ───────────────────────────────────────
  if (err instanceof Error || (err && typeof err === "object")) {
    try {
      const anyErr = err as Record<string, unknown>;

      // ── 2a. Mongoose / Schema Validation Error ─────────────────────────────
      let errName: unknown;
      try { errName = anyErr.name; } catch { /* getter trap */ }

      if (errName === "ValidationError") {
        let rawErrors: unknown;
        try { rawErrors = anyErr.errors; } catch { /* getter trap */ }

        if (rawErrors && typeof rawErrors === "object") {
          const fieldErrors: Record<string, string[]> = {};
          for (const [field, val] of Object.entries(rawErrors as Record<string, unknown>)) {
            if (val && typeof val === "object") {
              const valObj = val as Record<string, unknown>;
              fieldErrors[field] = [String(valObj.message || `Validation failed on '${field}'`)];
            } else {
              fieldErrors[field] = [String(val)];
            }
          }

          let msg = "Validation failed";
          try {
            if (typeof anyErr.message === "string" && anyErr.message.length > 0) {
              msg = anyErr.message;
            }
          } catch { /* getter trap */ }

          return new ValidationError(fieldErrors, msg);
        }
      }

      // ── 2b. MongoDB / Mongoose Duplicate Key Error (Code 11000 / 11001) ─────
      let errCode: unknown;
      try { errCode = anyErr.code; } catch { /* getter trap */ }

      const isDuplicateKey =
        errCode === 11000 ||
        errCode === "11000" ||
        errCode === 11001 ||
        errCode === "11001";

      if (isDuplicateKey) {
        let keyPattern: Record<string, unknown> | undefined;
        try {
          keyPattern = (anyErr.keyValue || anyErr.keyPattern) as Record<string, unknown> | undefined;
        } catch { /* getter trap */ }

        const fieldNames = keyPattern && typeof keyPattern === "object" && !Array.isArray(keyPattern)
          ? Object.keys(keyPattern).join(", ")
          : "record";

        const msg = `Duplicate key error: A record with this ${fieldNames} already exists.`;
        return new ConflictError(msg, keyPattern || null);
      }

      // ── 2c. Mongoose CastError (e.g. Invalid ObjectId format) ───────────────
      if (errName === "CastError") {
        let path = "identifier";
        let value: unknown;
        try {
          if (typeof anyErr.path === "string") path = anyErr.path;
          value = anyErr.value;
        } catch { /* getter trap */ }

        return new BadRequestError(`Invalid format for '${path}'.`, { path, value });
      }

      // ── 2d. Third-Party Library with HTTP Status Attached ───────────────────
      let rawStatus: unknown;
      try {
        rawStatus = anyErr.statusCode ?? anyErr.status;
      } catch { /* getter trap */ }

      if (typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599) {
        const isClientError = rawStatus < 500;
        let resolvedCode: ErrorCodeValue = ErrorCode.INTERNAL_SERVER_ERROR;

        if (rawStatus === 400) resolvedCode = ErrorCode.BAD_REQUEST;
        else if (rawStatus === 401) resolvedCode = ErrorCode.UNAUTHORIZED;
        else if (rawStatus === 403) resolvedCode = ErrorCode.FORBIDDEN;
        else if (rawStatus === 404) resolvedCode = ErrorCode.NOT_FOUND;
        else if (rawStatus === 409) resolvedCode = ErrorCode.CONFLICT;
        else if (rawStatus === 422) resolvedCode = ErrorCode.UNPROCESSABLE_ENTITY;
        else if (rawStatus === 429) resolvedCode = ErrorCode.RATE_LIMIT_EXCEEDED;
        else if (rawStatus === 503) resolvedCode = ErrorCode.SERVICE_UNAVAILABLE;
        else if (rawStatus === 504) resolvedCode = ErrorCode.GATEWAY_TIMEOUT;
        else if (isClientError) resolvedCode = ErrorCode.BAD_REQUEST;

        const fallbackName = isClientError ? "BadRequestError" : "InternalServerError";
        const fallbackMsg = isClientError ? "Bad Request" : "An unexpected internal server error occurred.";

        let errMessage = fallbackMsg;
        try {
          if (typeof anyErr.message === "string" && anyErr.message.length > 0) {
            errMessage = anyErr.message;
          }
        } catch { /* getter trap */ }

        let errStack: string | undefined;
        try {
          if (typeof anyErr.stack === "string") errStack = anyErr.stack;
        } catch { /* getter trap */ }

        let errDetails: unknown = null;
        try {
          if (anyErr.details !== undefined) errDetails = anyErr.details;
        } catch { /* getter trap */ }

        return Object.assign(
          Object.create(AppError.prototype),
          {
            name: typeof errName === "string" ? errName : fallbackName,
            message: errMessage,
            statusCode: rawStatus,
            errorCode: resolvedCode,
            details: errDetails,
            isOperational: isClientError,
            stack: errStack,
          }
        ) as AppError;
      }

      // ── 2e. Standard Native Error without Status (500 crash) ────────────────
      let message = "An unexpected internal server error occurred.";
      try {
        if (typeof anyErr.message === "string" && anyErr.message.length > 0) {
          message = anyErr.message;
        }
      } catch { /* getter trap */ }

      return new InternalServerError(message);
    } catch {
      // Throwing getter / proxy trap intercepted safely
      return new InternalServerError("An unexpected error occurred.");
    }
  }

  // ── 3. Exotic or Non-Object Thrown Values (strings, booleans, null, etc.) ─
  let message = "An unknown error occurred.";
  try {
    if (typeof err === "string" && err.trim().length > 0) {
      message = err;
    }
  } catch { /* safe boundary */ }

  return new InternalServerError(message);
}
