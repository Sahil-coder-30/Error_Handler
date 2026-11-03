/**
 * @file src/coerce.ts
 * @description Centralized, battle-hardened error normalization and coercion.
 * Normalizes Mongoose, MongoDB, Prisma, Zod, Joi, http-errors style errors,
 * errors from other copies of faultkit, and hostile throws into typed AppError
 * instances before response formatting and logging.
 *
 * Every coerced error keeps the ORIGINAL stack trace (and the original `cause`),
 * so logs always point at the real throw site.
 */

import { AppError } from "./AppError.js";
import {
  BadRequestError,
  ValidationError,
  ConflictError,
  NotFoundError,
  InternalServerError,
} from "./errors.js";
import { ErrorCode, type ErrorCoercer, type ErrorCodeValue } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status code helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TO_CODE: Readonly<Record<number, ErrorCodeValue>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  402: ErrorCode.PAYMENT_REQUIRED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  405: ErrorCode.METHOD_NOT_ALLOWED,
  408: ErrorCode.REQUEST_TIMEOUT,
  409: ErrorCode.CONFLICT,
  410: ErrorCode.GONE,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  422: ErrorCode.UNPROCESSABLE_ENTITY,
  429: ErrorCode.RATE_LIMIT_EXCEEDED,
  500: ErrorCode.INTERNAL_SERVER_ERROR,
  501: ErrorCode.NOT_IMPLEMENTED,
  502: ErrorCode.BAD_GATEWAY,
  503: ErrorCode.SERVICE_UNAVAILABLE,
  504: ErrorCode.GATEWAY_TIMEOUT,
};

/**
 * Maps an HTTP status code to the closest standard `ErrorCode`.
 * Unknown 4xx statuses map to `BAD_REQUEST`, everything else to `INTERNAL_SERVER_ERROR`.
 */
export function errorCodeFromStatus(status: number): ErrorCodeValue {
  const known = STATUS_TO_CODE[status];
  if (known) return known;
  return status >= 400 && status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_SERVER_ERROR;
}

/**
 * Returns a valid integer HTTP error status (400-599) or `undefined`.
 * Accepts numbers and numeric strings such as `"404"`.
 */
export function toErrorStatus(raw: unknown): number | undefined {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^\s*\d{3}\s*$/.test(raw)) n = Number(raw);
  else return undefined;
  if (!Number.isFinite(n)) return undefined;
  n = Math.floor(n);
  return n >= 400 && n <= 599 ? n : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Concrete AppError used for errors whose status/code come from a third party. */
class CoercedError extends AppError {
  constructor(
    message: string,
    statusCode: number,
    errorCode: ErrorCodeValue,
    details: unknown,
    isOperational: boolean,
    name?: string
  ) {
    super(message, statusCode, errorCode, details, isOperational);
    if (name) this.name = name;
  }
}

/** Reads a property without letting a throwing getter or proxy trap escape. */
function get(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function defineHidden(target: object, key: string, value: unknown): void {
  try {
    Object.defineProperty(target, key, {
      value,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  } catch {
    /* frozen / non-extensible target: keep what we have */
  }
}

/**
 * Copies the original stack trace and `cause` onto the coerced error, so logs
 * point at the real throw site instead of this module.
 */
function adoptOrigin<T extends AppError>(target: T, source: unknown): T {
  if (source === null || typeof source !== "object") return target;
  const stack = get(source, "stack");
  if (typeof stack === "string" && stack.length > 0) defineHidden(target, "stack", stack);
  const cause = get(source, "cause");
  if (cause !== undefined && cause !== source) defineHidden(target, "cause", cause);
  return target;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof get(value, "then") === "function"
  );
}

let warnedAsyncCoercer = false;

/** Builds a `{ field: [messages] }` map from `{ path, message }` issue lists (Zod, Joi). */
function issuesToFieldErrors(issues: unknown[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const rawPath = get(issue, "path");
    const field = Array.isArray(rawPath)
      ? rawPath.map((p) => String(p)).join(".")
      : typeof rawPath === "string"
        ? rawPath
        : "";
    const key = field.length > 0 ? field : "_root";
    const message = nonEmptyString(get(issue, "message")) ?? "Invalid value";
    (fieldErrors[key] ??= []).push(message);
  }
  return fieldErrors;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerces any unknown thrown value (native Error, Mongoose ValidationError,
 * MongoDB duplicate key, Prisma, Zod, Joi, string, primitive, or third-party error)
 * into an AppError.
 *
 * This function never throws.
 *
 * @param err - The raw caught error or thrown value
 * @param customCoercer - Optional user-supplied coercion hook (runs first, must be synchronous)
 * @returns A guaranteed AppError instance with status, code, and operational flags
 */
export function coerceToAppError(err: unknown, customCoercer?: ErrorCoercer): AppError {
  try {
    return coerce(err, customCoercer);
  } catch {
    return new InternalServerError("An unexpected error occurred.");
  }
}

function coerce(input: unknown, customCoercer?: ErrorCoercer): AppError {
  let err = input;

  // ── 0. Custom Coercion Hook (User-defined mapper) ──────────────────────────
  if (typeof customCoercer === "function") {
    try {
      const customResult = customCoercer(err);
      if (isThenable(customResult)) {
        // Async coercers are not supported: ignore the result, but never leave
        // a rejected promise unhandled.
        try {
          customResult.then(undefined, () => undefined);
        } catch {
          /* hostile thenable */
        }
        if (!warnedAsyncCoercer && typeof process !== "undefined" && typeof process.emitWarning === "function") {
          warnedAsyncCoercer = true;
          process.emitWarning(
            "faultkit: errorCoercer returned a Promise. Coercers must be synchronous; the result was ignored.",
            "FaultKitWarning"
          );
        }
      } else if (customResult !== undefined && customResult !== null && customResult !== err) {
        err = customResult;
      }
    } catch {
      // Coercer must never crash the pipeline; fall back to standard coercion
    }
  }

  // ── 1. Already an AppError (from any copy of faultkit) ─────────────────────
  if (err instanceof AppError) {
    return normalizeAppError(err);
  }

  // ── 2. Objects and Errors ──────────────────────────────────────────────────
  if (err !== null && (typeof err === "object" || typeof err === "function")) {
    return coerceObject(err as object);
  }

  // ── 3. Primitive thrown values (strings, numbers, booleans, null, ...) ────
  const message = typeof err === "string" && err.trim().length > 0 ? err : "An unknown error occurred.";
  return new InternalServerError(message);
}

/** Makes sure an AppError has a usable HTTP error status. */
function normalizeAppError(err: AppError): AppError {
  const rawStatus = get(err, "statusCode");
  if (typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599) {
    return err;
  }

  const status = toErrorStatus(rawStatus);
  if (status !== undefined && typeof rawStatus === "number") {
    // Finite non-integer status (e.g. 404.5): round down.
    try {
      (err as { statusCode: number }).statusCode = status;
      return err;
    } catch {
      /* frozen: fall through and wrap */
    }
  }

  // NaN, Infinity, strings, out-of-range values: this is a programmer error.
  const message = nonEmptyString(get(err, "message")) ?? "An unexpected internal server error occurred.";
  return adoptOrigin(new InternalServerError(message, get(err, "details") ?? null), err);
}

function coerceObject(obj: object): AppError {
  const name = get(obj, "name");
  const code = get(obj, "code");
  const message = nonEmptyString(get(obj, "message"));
  const status = toErrorStatus(get(obj, "statusCode") ?? get(obj, "status"));

  // ── 2a. AppError-shaped object from an older / foreign copy of faultkit ───
  const foreignCode = nonEmptyString(get(obj, "errorCode"));
  if (foreignCode && status !== undefined) {
    const op = get(obj, "isOperational");
    return adoptOrigin(
      new CoercedError(
        message ?? (status < 500 ? "Bad Request" : "An unexpected internal server error occurred."),
        status,
        foreignCode,
        get(obj, "details") ?? null,
        typeof op === "boolean" ? op : status < 500,
        typeof name === "string" ? name : undefined
      ),
      obj
    );
  }

  // ── 2b. Zod (v3 / v4) ──────────────────────────────────────────────────────
  if (name === "ZodError") {
    const issues = get(obj, "issues");
    if (Array.isArray(issues)) {
      return adoptOrigin(new ValidationError(issuesToFieldErrors(issues)), obj);
    }
  }

  // ── 2c. Joi (details: [{ message, path }]) ─────────────────────────────────
  const joiDetails = get(obj, "details");
  if (name === "ValidationError" && (get(obj, "isJoi") === true || Array.isArray(joiDetails))) {
    if (Array.isArray(joiDetails)) {
      return adoptOrigin(
        new ValidationError(issuesToFieldErrors(joiDetails), message ?? "Validation failed"),
        obj
      );
    }
  }

  // ── 2d. Mongoose ValidationError ({ errors: { field: { message } } }) ──────
  if (name === "ValidationError") {
    const rawErrors = get(obj, "errors");
    if (rawErrors && typeof rawErrors === "object") {
      const fieldErrors: Record<string, string[]> = {};
      for (const field of Object.keys(rawErrors)) {
        const val = get(rawErrors, field);
        if (val && typeof val === "object") {
          fieldErrors[field] = [nonEmptyString(get(val, "message")) ?? `Validation failed on '${field}'`];
        } else {
          fieldErrors[field] = [String(val)];
        }
      }
      return adoptOrigin(new ValidationError(fieldErrors, message ?? "Validation failed"), obj);
    }
  }

  // ── 2e. MongoDB / Mongoose Duplicate Key Error (11000 / 11001) ─────────────
  if (code === 11000 || code === "11000" || code === 11001 || code === "11001") {
    const keyValue = get(obj, "keyValue");
    const keyPattern = get(obj, "keyPattern");
    const keys = isPlainRecord(keyValue) ? keyValue : isPlainRecord(keyPattern) ? keyPattern : undefined;
    const fieldNames = keys && Object.keys(keys).length > 0 ? Object.keys(keys).join(", ") : "record";
    return adoptOrigin(
      new ConflictError(`Duplicate key error: A record with this ${fieldNames} already exists.`, keys ?? null),
      obj
    );
  }

  // ── 2f. Mongoose CastError (e.g. invalid ObjectId) ─────────────────────────
  if (name === "CastError") {
    const path = nonEmptyString(get(obj, "path")) ?? "identifier";
    return adoptOrigin(
      new BadRequestError(`Invalid format for '${path}'.`, { path, value: get(obj, "value") }),
      obj
    );
  }

  // ── 2g. Mongoose DocumentNotFoundError ─────────────────────────────────────
  if (name === "DocumentNotFoundError") {
    return adoptOrigin(new NotFoundError("The requested document could not be found."), obj);
  }

  // ── 2h. Prisma known request errors ────────────────────────────────────────
  if (
    typeof code === "string" &&
    /^P\d{4}$/.test(code) &&
    (name === "PrismaClientKnownRequestError" || get(obj, "clientVersion") !== undefined)
  ) {
    const prismaError = coercePrisma(code, get(obj, "meta"));
    if (prismaError) return adoptOrigin(prismaError, obj);
  }

  // ── 2i. Third-party error with an HTTP status (http-errors, body-parser, ...) ─
  if (status !== undefined) {
    const expose = get(obj, "expose");
    const isOperational = typeof expose === "boolean" ? expose : status < 500;
    const fallbackMsg = status < 500 ? "Bad Request" : "An unexpected internal server error occurred.";
    const fallbackName = status < 500 ? "BadRequestError" : "InternalServerError";
    const rawDetails = get(obj, "details");
    return adoptOrigin(
      new CoercedError(
        message ?? fallbackMsg,
        status,
        errorCodeFromStatus(status),
        rawDetails === undefined ? null : rawDetails,
        isOperational,
        typeof name === "string" && name.length > 0 ? name : fallbackName
      ),
      obj
    );
  }

  // ── 2j. Anything else: an unexpected crash (500) ───────────────────────────
  return adoptOrigin(
    new InternalServerError(message ?? "An unexpected internal server error occurred."),
    obj
  );
}

function coercePrisma(code: string, meta: unknown): AppError | undefined {
  const target = get(meta, "target");
  const fields = Array.isArray(target)
    ? target.map((t) => String(t))
    : typeof target === "string"
      ? [target]
      : [];

  switch (code) {
    case "P2002": {
      const label = fields.length > 0 ? fields.join(", ") : "record";
      return new ConflictError(
        `Duplicate key error: A record with this ${label} already exists.`,
        fields.length > 0 ? { fields } : null
      );
    }
    case "P2025":
      return new NotFoundError("The requested record could not be found.");
    case "P2003": {
      const field = nonEmptyString(get(meta, "field_name"));
      return new ConflictError(
        "The operation violates a related-record (foreign key) constraint.",
        field ? { field } : null
      );
    }
    case "P2000": {
      const column = nonEmptyString(get(meta, "column_name"));
      return new BadRequestError(
        "The provided value is too long for the field.",
        column ? { field: column } : null
      );
    }
    default:
      return undefined;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
