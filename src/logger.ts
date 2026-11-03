/**
 * @file src/logger.ts
 * @description Enterprise-grade, Grafana/Loki-optimized structured logger powered by Pino.
 *
 * Provides:
 *  1. `logger`: Pre-configured singleton ready to use in any route, service, or job.
 *  2. `createLogger(options)`: Factory for custom microservice configurations.
 *  3. Built-in `AppError` serializer: Automatically captures HTTP status codes,
 *     error codes, operational flags, validation details, and stack traces.
 *  4. Native Grafana/Loki compatibility: Outputs single-line ISO-8601 JSON to stdout.
 *  5. Sensitive data redaction: Hides passwords, tokens, and authorization headers.
 */

import pino, {
  type Logger as PinoLogger,
  type LoggerOptions as PinoLoggerOptions,
  type LevelWithSilentOrString,
} from "pino";
import { hostname } from "node:os";
import { AppError } from "./AppError.js";

export type Logger = PinoLogger;
export type LogLevel = LevelWithSilentOrString;

export interface FaultKitLoggerOptions {
  /**
   * Name of the application or microservice (e.g. 'users-api', 'payment-service').
   * Included in all log entries for easy filtering in Grafana Loki.
   * Defaults to `process.env.SERVICE_NAME` or 'api'.
   */
  service?: string;

  /**
   * Minimum logging level ('fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent').
   * Defaults to `process.env.LOG_LEVEL` or 'info'.
   */
  level?: LogLevel;

  /**
   * Array of property paths to redact from logs to avoid leaking credentials.
   * Defaults to common sensitive fields (authorization headers, passwords, secrets).
   */
  redact?: string[];

  /**
   * Extra base properties to merge into every log entry.
   * By default every entry carries `pid`, `hostname` and `service`.
   * Pass `null` to remove `pid` and `hostname` (keeps `service`).
   */
  base?: Record<string, unknown> | null;

  /**
   * Whether to include stack traces when serializing errors.
   * Defaults to `true`.
   */
  includeStackInLog?: boolean;

  /**
   * Additional raw Pino logger options for advanced customization.
   */
  pinoOptions?: PinoLoggerOptions;

  /**
   * Custom output destination stream (e.g. custom writable stream, file stream).
   */
  destination?: pino.DestinationStream;
}

/** Backward-compatible alias for FaultKitLoggerOptions */
export type FaultGuardLoggerOptions = FaultKitLoggerOptions;

/**
 * Default list of sensitive keys automatically redacted from all JSON output.
 */
export const DEFAULT_REDACT_KEYS = [
  "req.headers.authorization",
  "req.headers.Authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.Authorization",
  "headers.cookie",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "password",
  "Password",
  "PASSWORD",
  "token",
  "Token",
  "TOKEN",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "secret",
  "Secret",
  "apiKey",
  "api_key",
  "creditCard",
  "*.password",
  "*.Password",
  "*.PASSWORD",
  "*.token",
  "*.accessToken",
  "*.access_token",
  "*.refreshToken",
  "*.refresh_token",
  "*.secret",
  "*.apiKey",
  "*.api_key",
  "*.creditCard",
  "*.authorization",
  "*.Authorization",
  "*.cookie",
  "*[*].password",
  "*[*].Password",
  "*[*].PASSWORD",
  "*[*].token",
  "*[*].accessToken",
  "*[*].access_token",
  "*[*].refreshToken",
  "*[*].refresh_token",
  "*[*].secret",
  "*[*].apiKey",
  "*[*].api_key",
  "*[*].creditCard",
  "*[*].authorization",
  "*[*].Authorization",
  "*.*.password",
  "*.*.Password",
  "*.*.PASSWORD",
  "*.*.token",
  "*.*.accessToken",
  "*.*.access_token",
  "*.*.refreshToken",
  "*.*.refresh_token",
  "*.*.secret",
  "*.*.apiKey",
  "*.*.api_key",
  "*.*.creditCard",
  "*.*.authorization",
  "*.*.Authorization",
];

const STANDARD_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

/**
 * Returns a level pino will accept. Unknown levels (for example a typo in the
 * `LOG_LEVEL` env var) fall back to `"info"` with a process warning, instead
 * of crashing the app at import time.
 */
function resolveLevel(level: unknown, customLevels: unknown, onlyCustom: boolean): string {
  const custom =
    customLevels && typeof customLevels === "object" ? Object.keys(customLevels as object) : [];
  const fallback = onlyCustom && custom.length > 0 ? custom[0] : "info";
  if (typeof level === "string") {
    const trimmed = level.trim();
    if (custom.includes(trimmed)) return trimmed;
    const normalized = trimmed.toLowerCase();
    if (custom.includes(normalized)) return normalized;
    if (!onlyCustom && STANDARD_LEVELS.has(normalized)) return normalized;
  }
  if (level !== undefined && level !== "") {
    try {
      process.emitWarning(
        `faultkit: unknown log level ${JSON.stringify(String(level))}; falling back to "${fallback}".`,
        "FaultKitWarning"
      );
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

function safeRead(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return "[Unreadable Property]";
  }
}

/**
 * Creates an error serializer tailored for `AppError` and standard Node.js Errors.
 * Extracts `statusCode`, `errorCode`, `isOperational`, `details`, and `stack`.
 * Never throws: frozen errors and throwing getters are serialized field by field.
 *
 * @param includeStackOrOptions - `false` (or `{ includeStack: false }`) to drop stack traces.
 */
export function createAppErrorSerializer(
  includeStackOrOptions: boolean | { includeStack?: boolean } = true
) {
  const includeStack =
    typeof includeStackOrOptions === "object" && includeStackOrOptions !== null
      ? includeStackOrOptions.includeStack !== false
      : includeStackOrOptions !== false;

  return function errSerializer(err: unknown): Record<string, unknown> {
    if (!err || typeof err !== "object") {
      return { raw: err };
    }

    let base: Record<string, unknown>;
    try {
      base = { ...(pino.stdSerializers.err(err as Error) as unknown as Record<string, unknown>) };
    } catch {
      // Frozen or hostile errors: build the basics by hand.
      const name = safeRead(err, "name");
      const message = safeRead(err, "message");
      const stack = safeRead(err, "stack");
      base = {
        type: typeof name === "string" ? name : "Error",
        message: typeof message === "string" ? message : "[Unreadable Message]",
        ...(typeof stack === "string" ? { stack } : {}),
      };
    }

    const statusCode = safeRead(err, "statusCode");
    const errorCode = safeRead(err, "errorCode");
    const isOperational = safeRead(err, "isOperational");
    const details = safeRead(err, "details");
    const isApp = err instanceof AppError || typeof errorCode === "string";

    const out: Record<string, unknown> = {
      ...base,
      ...(typeof statusCode === "number" ? { statusCode } : {}),
      ...(typeof errorCode === "string" ? { errorCode } : {}),
      ...(typeof isOperational === "boolean" ? { isOperational } : {}),
      ...(details !== undefined && details !== null ? { details } : {}),
      isAppError: isApp,
    };
    if (!includeStack) delete out.stack;
    return out;
  };
}

type LogMethodHook = NonNullable<NonNullable<PinoLoggerOptions["hooks"]>["logMethod"]>;

/**
 * pino `logMethod` hook that makes every log call crash-proof. It runs for
 * every level, every child logger, and survives `logger.level` changes.
 */
function createSafeLogMethod(userHook?: LogMethodHook): LogMethodHook {
  return function safeLogMethod(this: PinoLogger, inputArgs: Parameters<LogMethodHook>[0], method, level) {
    try {
      if (typeof userHook === "function") {
        return userHook.call(this, inputArgs, method, level);
      }
      return method.apply(this, inputArgs as Parameters<typeof method>);
    } catch (err) {
      let reason = "unknown error";
      try {
        reason = err instanceof Error ? err.message : String(err);
      } catch {
        /* ignore */
      }
      const firstString = (inputArgs as unknown[]).find((a) => typeof a === "string");
      try {
        return method.call(
          this,
          { logSerializationError: reason } as never,
          (typeof firstString === "string" ? firstString : "[Unserializable Log Entry]") as never
        );
      } catch {
        try {
          return method.call(this, "[Unserializable Log Entry]" as never);
        } catch {
          return undefined;
        }
      }
    }
  } as LogMethodHook;
}

/**
 * Factory to create a customized Grafana/Loki-ready Pino logger.
 *
 * @example
 * ```ts
 * import { createLogger } from 'faultkit';
 *
 * export const logger = createLogger({
 *   service: 'order-service',
 *   level: 'debug',
 * });
 * ```
 */
export function createLogger(
  options?: FaultKitLoggerOptions | null,
  destination?: pino.DestinationStream
): Logger {
  const opts: FaultKitLoggerOptions = options && typeof options === "object" ? options : {};
  const {
    service = process.env.SERVICE_NAME || "api",
    redact = DEFAULT_REDACT_KEYS,
    base,
    includeStackInLog = true,
    destination: optDestination,
  } = opts;
  const pinoOptions: PinoLoggerOptions =
    opts.pinoOptions && typeof opts.pinoOptions === "object" ? opts.pinoOptions : {};

  const level = resolveLevel(
    opts.level ?? pinoOptions.level ?? process.env.LOG_LEVEL,
    pinoOptions.customLevels,
    pinoOptions.useOnlyCustomLevels === true
  );

  // Defaults match pino (pid + hostname) plus the service label.
  // `base: null` keeps only the service label.
  const finalBase: Record<string, unknown> =
    base === null
      ? { service }
      : {
          pid: process.pid,
          hostname: safeHostname(),
          service,
          ...(base && typeof base === "object" ? base : {}),
        };

  const targetDestination = destination ?? optDestination;
  const errSerializer = createAppErrorSerializer(includeStackInLog);

  const pinoConfig: PinoLoggerOptions = {
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: Array.isArray(redact) ? redact : DEFAULT_REDACT_KEYS,
      censor: "[REDACTED]",
    },
    base: finalBase,
    // Raw pino options may override the defaults above...
    ...pinoOptions,
    // ...but these are always merged, never replaced.
    level,
    serializers: {
      err: errSerializer,
      error: errSerializer,
      ...(pinoOptions.serializers || {}),
    },
    hooks: {
      ...(pinoOptions.hooks || {}),
      logMethod: createSafeLogMethod(pinoOptions.hooks?.logMethod),
    },
  };

  const rawLogger = targetDestination ? pino(pinoConfig, targetDestination) : pino(pinoConfig);
  return wrapSafeChild(rawLogger);
}

function safeHostname(): string | undefined {
  try {
    return hostname();
  } catch {
    return undefined;
  }
}

/**
 * Makes `child()` crash-proof. Pino children inherit from their parent via the
 * prototype chain, so wrapping the root once covers every descendant.
 * Log methods are protected by the `logMethod` hook instead.
 */
function wrapSafeChild(instance: Logger): Logger {
  const target = instance as unknown as Record<string, unknown>;
  const origChild = target.child as (this: Logger, ...args: unknown[]) => Logger;

  target.child = function safeChild(this: Logger, ...args: unknown[]): Logger {
    try {
      return origChild.apply(this, args);
    } catch {
      try {
        const safeArgs = args.map((a) => {
          if (typeof a !== "object" || a === null) return a;
          const clean: Record<string, unknown> = {};
          let keys: string[] = [];
          try {
            keys = Object.keys(a);
          } catch {
            /* hostile proxy */
          }
          for (const k of keys) {
            const v = safeRead(a, k);
            clean[k] = typeof v === "bigint" ? v.toString() : v;
          }
          return clean;
        });
        return origChild.apply(this, safeArgs);
      } catch {
        return this;
      }
    }
  };

  return instance;
}

/**
 * Default pre-configured logger singleton.
 * Ready for immediate import and usage throughout the application.
 *
 * @example
 * ```ts
 * import { logger } from 'faultkit';
 *
 * logger.info('Server started');
 * logger.error({ err }, 'Unhandled exception');
 * ```
 */
export const logger: Logger = createLogger();
