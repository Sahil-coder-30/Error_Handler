---
name: faultkit
description: Use when implementing, refactoring, or debugging backend error handling, HTTP status codes, OpenAPI error responses, Express error middleware, or Pino structured logging. Trigger on mentions of 'custom error', 'handle error', 'AppError', 'validation error', 'NotFoundError', 'createExpressErrorHandler', 'faultguard', or 'faultkit'.
---

# FaultKit Skill

FaultKit provides framework-agnostic, OpenAPI-compliant error handling and cloud-native structured logging (Pino/Loki) for TypeScript and Node.js backends.

---

## When to use this skill

Trigger this skill whenever the user or task involves:
- Implementing, reviewing, or refactoring error handling in a Node.js or TypeScript service.
- Creating custom application error classes or throwing HTTP errors (400, 401, 403, 404, 409, 422, 429, 500, 503).
- Setting up or fixing centralized Express error handling middleware (`createExpressErrorHandler`).
- Structuring API error responses to guarantee an OpenAPI-compliant contract: `{ success: false, error: { code, message, details } }`.
- Configuring structured JSON logging with Pino, request correlation IDs (`requestId`), or Grafana Loki ingestion.
- Masking sensitive internal server error details in production while preserving stack traces in logs.
- Redacting credentials (passwords, tokens, cookies, API keys) from application logs.

## When NOT to use this skill

- Frontend-only code (React, Vue, Svelte) — FaultKit is a backend runtime library.
- GraphQL APIs where errors must follow GraphQL execution spec (`errors: [{ message, locations, path }]`).
- gRPC services where responses require gRPC status codes rather than HTTP status codes.
- Simple standalone scripts where `console.error` and `process.exit(1)` are sufficient.

---

## Agent Decision Tree

Use this decision logic when choosing APIs and integration patterns:

```
What is the task?
├── 1. Throwing an error in domain or service logic?
│   ├── Input validation failure (Zod, Joi, class-validator, manual)?
│   │   └── USE: ValidationError(details, message?) [CRITICAL: details is 1st argument!]
│   ├── Requested record / resource does not exist?
│   │   └── USE: NotFoundError(message?)
│   ├── Authentication failure?
│   │   ├── JWT / session expired? ──> USE: TokenExpiredError(message?)
│   │   ├── Malformed or invalid signature? ──> USE: TokenInvalidError(message?)
│   │   └── Missing credentials? ──> USE: UnauthorizedError(message?)
│   ├── Authenticated but lacks required role or permission?
│   │   └── USE: ForbiddenError(message?)
│   ├── State conflict, duplicate key, or unique constraint violation?
│   │   └── USE: ConflictError(message?, details?)
│   ├── Syntactically malformed request or missing body?
│   │   └── USE: BadRequestError(message?, details?)
│   ├── Syntactically valid but semantic business rule violated?
│   │   └── USE: UnprocessableEntityError(message?, details?)
│   ├── Rate limit threshold exceeded?
│   │   └── USE: RateLimitError(message?)
│   ├── Downstream database or microservice unreachable?
│   │   └── USE: ServiceUnavailableError(message?)
│   ├── Unexpected system fault or programmer bug?
│   │   └── USE: InternalServerError(message?, details?)
│   └── Specialized business domain error?
│       └── EXTEND: AppError with custom statusCode and errorCode
│
├── 2. Configuring HTTP error middleware?
│   ├── Express service?
│   │   └── USE: createExpressErrorHandler(options) from "faultkit/express"
│   │       ├── MOUNT: as the absolute last middleware (after all routes)
│   │       └── ENSURE: 4-argument signature (err, req, res, next)
│   └── Fastify / Hono / AWS Lambda?
│       └── USE: err.toJSON() on AppError instances from "faultkit"
│
├── 3. Logging events or tracing requests?
│   ├── Zero-config application logging? ──> USE: logger from "faultkit"
│   ├── Request correlation / tracing? ──> USE: logger.child({ requestId })
│   ├── Microservice-specific configuration? ──> USE: createLogger(options) from "faultkit"
│   └── Logging caught error? ──> USE: logger.error({ err }, "context message")
│
└── 4. Initializing agent configuration in a workspace?
    └── RUN: npx faultkit init --help
```

### Absolute Rules (NEVER & PREFER)

- **NEVER** instantiate `AppError` directly (`new AppError(...)`). It is an abstract class. Choose a concrete subclass or extend it.
- **NEVER** swap parameter order in `ValidationError`. It takes `(details, message?)`, NOT `(message, details)`.
- **NEVER** import `createExpressErrorHandler` from `"faultkit"`. Import from the subpath export `"faultkit/express"`.
- **NEVER** mount `createExpressErrorHandler()` before routes. Express error handlers only catch errors from routes registered before them.
- **NEVER** create an Express error middleware with fewer than 4 arguments `(err, req, res, next)`. Express uses `fn.length === 4` to identify error handlers.
- **NEVER** put passwords, tokens, or PII into `details` for 4xx errors. When `isOperational` is `true`, `details` is serialized directly into the client JSON response.
- **PREFER** `logger.error({ err }, "msg")` over `logger.error(err.message)`. FaultKit's Pino serializer extracts `statusCode`, `errorCode`, `isOperational`, `details`, and `stack` from `{ err }`.
- **PREFER** specific error subclasses (`TokenExpiredError`, `ForbiddenError`, `ConflictError`) over generic `BadRequestError` or `InternalServerError`.

---

## API Reference & Signatures

All error classes extend `AppError` and are imported from `"faultkit"`.

| Class | HTTP Status | Error Code (`ErrorCode.*`) | Constructor Signature | `isOperational` |
|---|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` | `(message?: string, details?: unknown)` | `true` |
| `ValidationError` | 400 | `VALIDATION_ERROR` | `(details: unknown, message?: string)` | `true` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | `(message?: string)` | `true` |
| `TokenExpiredError` | 401 | `TOKEN_EXPIRED` | `(message?: string)` | `true` |
| `TokenInvalidError` | 401 | `TOKEN_INVALID` | `(message?: string)` | `true` |
| `ForbiddenError` | 403 | `FORBIDDEN` | `(message?: string)` | `true` |
| `NotFoundError` | 404 | `NOT_FOUND` | `(message?: string)` | `true` |
| `ConflictError` | 409 | `CONFLICT` | `(message?: string, details?: unknown)` | `true` |
| `UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` | `(message?: string, details?: unknown)` | `true` |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | `(message?: string)` | `true` |
| `InternalServerError` | 500 | `INTERNAL_SERVER_ERROR` | `(message?: string, details?: unknown)` | `false` |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | `(message?: string)` | `false` |

> ⚠️ **CRITICAL SIGNATURE TRAP:**
> `ValidationError` takes `(details, message)` — details is FIRST:
> ```typescript
> // CORRECT:
> throw new ValidationError(result.error.flatten().fieldErrors, "Validation failed");
> 
> // WRONG:
> throw new ValidationError("Validation failed", result.error.flatten().fieldErrors);
> ```

### Logger & Observability Reference

FaultKit provides a zero-config, pre-hardened Pino logger optimized for cloud log aggregators (Grafana Loki, Datadog, AWS CloudWatch).

Available from root `"faultkit"` or subpath export `"faultkit/logger"`:

| Export | Type | Description |
|---|---|---|
| `logger` | `Logger` (Pino) | Ready-to-use singleton configured with ISO-8601 timestamps, AppError serializer, and credential redaction. |
| `createLogger(options)` | `(options?: FaultKitLoggerOptions) => Logger` | Factory to instantiate custom service loggers with microservice name, custom log levels, and custom redact keys. |
| `createAppErrorSerializer()` | `(options?) => (err: unknown) => Record<string, unknown>` | Custom Pino error serializer that extracts `statusCode`, `errorCode`, `isOperational`, `details`, and `stack`. |
| `DEFAULT_REDACT_KEYS` | `string[]` | Default array of sensitive fields automatically redacted (`authorization`, `cookie`, `password`, `token`, etc.). |

#### `FaultKitLoggerOptions`
```typescript
interface FaultKitLoggerOptions {
  service?: string;            // Service name for Loki filtering (default: process.env.SERVICE_NAME || 'api')
  level?: LogLevel;            // 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent' (default: 'info')
  redact?: string[];           // Property paths to sanitize (default: DEFAULT_REDACT_KEYS)
  base?: Record<string, any>;  // Base fields merged into every log entry
  includeStackInLog?: boolean; // Whether to serialize stack traces (default: true)
  destination?: DestinationStream; // Custom writable output stream
}
```

---

## Guaranteed OpenAPI Response Envelope

Every error response strictly matches this schema:

```json
{
  "success": false,
  "error": {
    "code": "STRING_ENUM",
    "message": "Safe human-readable message",
    "details": null
  }
}
```

### Production Security Invariant
In production (`NODE_ENV === "production"`):
- **4xx Operational Errors:** Real message and structured `details` are sent to the client.
- **5xx Non-Operational Errors:** The message is masked with `genericServerErrorMessage` ("An unexpected error occurred. Our team has been notified.") and `details` is set to `null`. Stack traces are NEVER returned over HTTP.

---

## Implementation Recipes

### Recipe 1: Service Layer Validation & Errors
```typescript
import { NotFoundError, ValidationError, ConflictError } from "faultkit";

export async function registerUser(input: { email: string; name: string }) {
  if (!input.email || !input.email.includes("@")) {
    throw new ValidationError({ email: ["Valid email required"] }, "Invalid user input");
  }

  const existing = await db.users.findByEmail(input.email);
  if (existing) {
    throw new ConflictError("Email already in use", { field: "email" });
  }

  return await db.users.create(input);
}
```

### Recipe 2: Express 4 & Express 5 Middleware Setup
```typescript
import express from "express";
import { NotFoundError } from "faultkit";
import { createExpressErrorHandler } from "faultkit/express";

const app = express();
app.use(express.json());

// Routes...
app.get("/api/users/:id", async (req, res, next) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) throw new NotFoundError(`User ${req.params.id} not found`);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err); // In Express 4, pass async errors to next()
  }
});

// 404 Catch-All Route (Optional, before error handler)
app.use((req, res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
});

// Mount Centralized Error Handler (MUST BE LAST)
app.use(createExpressErrorHandler({
  genericServerErrorMessage: "An unexpected error occurred. Please contact support.",
  includeStackInLog: process.env.NODE_ENV !== "production",
}));
```

### Recipe 3: Structured Logging & Request Correlation
```typescript
import { logger, createLogger } from "faultkit";

// 1. Correlate requests with child logger
app.use((req, res, next) => {
  req.log = logger.child({
    requestId: req.headers["x-request-id"] || crypto.randomUUID(),
    path: req.originalUrl,
  });
  next();
});

// 2. Log errors with { err } for full AppError serialization in Grafana Loki
try {
  await processPayment();
} catch (err) {
  logger.error({ err }, "Payment processing failed");
}
```

### Recipe 4: Custom Domain Errors
```typescript
import { AppError, type ErrorCodeValue } from "faultkit";

export class InsufficientFundsError extends AppError {
  constructor(available: number, required: number) {
    super(
      `Insufficient balance. Available: ${available}, required: ${required}`,
      422,
      "INSUFFICIENT_FUNDS" as unknown as ErrorCodeValue,
      { available, required },
      true // isOperational = true
    );
  }
}
```

---

## Anti-Patterns Checklist

| Anti-Pattern | Correct Pattern | Reason |
|---|---|---|
| `import { createExpressErrorHandler } from "faultkit"` | `import { createExpressErrorHandler } from "faultkit/express"` | Keeps core bundle zero-dependency for non-Express consumers |
| `new ValidationError("Bad input", errors)` | `new ValidationError(errors, "Bad input")` | `ValidationError` requires `details` as the first argument |
| `app.use(createExpressErrorHandler())` before routes | Mount `createExpressErrorHandler()` after all routes | Routes mounted after error handler bypass error handling |
| `logger.error(err.message)` | `logger.error({ err }, "Context message")` | Serializer requires `{ err }` object to extract status and code |
| `new AppError("msg", 400, "BAD_REQUEST")` | `new BadRequestError("msg")` | `AppError` is abstract; use concrete subclasses |
| Expecting custom 500 messages in production clients | Rely on server-side logs | Production masking prevents credential and stack trace leaks |

---

## CLI Tooling

FaultKit includes a safe, zero-dependency CLI. Run with `--help` first:
- `npx faultkit init --help` — Configure AI agent skills (.agents, Cursor, Copilot, Claude).
- `npx faultkit info` — Inspect OpenAPI contract and exported subpaths.
- `npx faultkit --version` — Print installed version (`1.0.0`).
