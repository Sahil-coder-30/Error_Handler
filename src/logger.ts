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
import { AppError } from "./AppError.js";

export type Logger = PinoLogger;
export type LogLevel = LevelWithSilentOrString;

export interface FaultGuardLoggerOptions {
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
   * Pass `null` to remove default base fields (pid, hostname).
   */
  base?: Record<string, unknown> | null;

  /**
   * Whether to include stack traces when serializing errors.
   * Defaults to true in non-production, or controlled by options.
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

/**
 * Default list of sensitive keys automatically redacted from all JSON output.
 */
export const DEFAULT_REDACT_KEYS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "apiKey",
  "creditCard",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.creditCard",
  "*.authorization",
  "*.cookie",
  "*[*].password",
  "*[*].token",
  "*[*].secret",
  "*[*].apiKey",
  "*[*].creditCard",
  "*.*.password",
  "*.*.token",
  "*.*.secret",
  "*.*.apiKey",
  "*.*.creditCard",
];

/**
 * Creates an error serializer tailored for `AppError` and standard Node.js Errors.
 * Extracts `statusCode`, `errorCode`, `isOperational`, `details`, and `stack`.
 */
export function createAppErrorSerializer(includeStack: boolean = true) {
  return function errSerializer(err: unknown): Record<string, unknown> {
    if (!err || typeof err !== "object") {
      return { raw: err };
    }

    const stdSerialized = pino.stdSerializers.err(err as Error);
    const anyErr = err as Record<string, unknown>;
    const isApp = err instanceof AppError || typeof anyErr.errorCode === "string";

    return {
      ...stdSerialized,
      ...(typeof anyErr.statusCode === "number" && { statusCode: anyErr.statusCode }),
      ...(typeof anyErr.errorCode === "string" && { errorCode: anyErr.errorCode }),
      ...(typeof anyErr.isOperational === "boolean" && { isOperational: anyErr.isOperational }),
      ...(anyErr.details !== undefined && anyErr.details !== null && { details: anyErr.details }),
      ...(!includeStack && { stack: undefined }),
      isAppError: isApp,
    };
  };
}

/**
 * Factory to create a customized Grafana/Loki-ready Pino logger.
 *
 * @example
 * ```ts
 * import { createLogger } from 'faultguard';
 *
 * export const logger = createLogger({
 *   service: 'order-service',
 *   level: 'debug',
 * });
 * ```
 */
export function createLogger(
  options: FaultGuardLoggerOptions = {},
  destination?: pino.DestinationStream
): Logger {
  const {
    service = process.env.SERVICE_NAME || "api",
    level = (process.env.LOG_LEVEL as LogLevel) || "info",
    redact = DEFAULT_REDACT_KEYS,
    base,
    includeStackInLog = true,
    destination: optDestination,
    pinoOptions = {},
  } = options;

  const baseConfig: Record<string, unknown> = {
    service,
  };

  const finalBase =
    base === null
      ? undefined
      : {
          ...baseConfig,
          ...(base || {}),
        };

  const targetDestination = destination ?? optDestination;

  const pinoConfig: PinoLoggerOptions = {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: redact,
      censor: "[REDACTED]",
    },
    base: finalBase,
    serializers: {
      err: createAppErrorSerializer(includeStackInLog),
      error: createAppErrorSerializer(includeStackInLog),
      ...(pinoOptions.serializers || {}),
    },
    ...pinoOptions,
  };

  const rawLogger = targetDestination ? pino(pinoConfig, targetDestination) : pino(pinoConfig);
  return wrapSafeLogger(rawLogger);
}

/**
 * Wraps all log methods in safety boundaries so that hostile throwing getters,
 * proxy traps, or broken serialization never crashes the calling thread.
 */
function wrapSafeLogger(instance: Logger): Logger {
  const target = instance as any;
  const levels = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

  for (const lvl of levels) {
    const orig = target[lvl];
    target[lvl] = function safeLogMethod(this: any, ...args: unknown[]) {
      try {
        return orig.apply(this, args);
      } catch (err) {
        try {
          const errMsg = err instanceof Error ? err.message : String(err);
          const safeArgs = args.map((a) =>
            typeof a === "object" && a !== null
              ? `[Unserializable Payload: ${errMsg}]`
              : a
          );
          return orig.apply(this, safeArgs);
        } catch {
          return orig.apply(this, ["[Unserializable Log Entry]"]);
        }
      }
    };
  }

  const origChild = target.child;
  target.child = function safeChild(this: any, ...args: unknown[]) {
    const childInstance = origChild.apply(this, args);
    return wrapSafeLogger(childInstance);
  };

  return instance;
}

/**
 * Default pre-configured logger singleton.
 * Ready for immediate import and usage throughout the application.
 *
 * @example
 * ```ts
 * import { logger } from 'faultguard';
 *
 * logger.info('Server started');
 * logger.error({ err }, 'Unhandled exception');
 * ```
 */
export const logger: Logger = createLogger();
