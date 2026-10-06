# faultkit

> Production-grade, OpenAPI-compliant error handling and Grafana/Loki-ready structured logging for TypeScript and Node.js.

[![CI](https://github.com/Sahil-coder-30/Error_Handler/actions/workflows/ci.yml/badge.svg)](https://github.com/Sahil-coder-30/Error_Handler/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/faultkit.svg)](https://www.npmjs.com/package/faultkit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)

---

## 1. What FaultKit Solves

In modern backend services, error handling is frequently fragmented:
- Controllers return inconsistent response shapes (`{ error: "..." }`, `{ message: "..." }`, or raw HTML error pages).
- Frontend clients struggle with brittle string-matching instead of switching on machine-readable error codes.
- Uncaught exceptions leak database credentials, file paths, or raw stack traces to end users.
- Server logs lack request correlation IDs, fail to redact secrets, or aren't formatted for ingestion by log aggregators like Grafana Loki.

**FaultKit** unifies error handling and observability into a single, cohesive foundation:
1. **Guaranteed OpenAPI Contract:** Every error response strictly matches `{ success: false, error: { code, message, details } }`.
2. **Operational vs. Non-Operational Separation:** Differentiates expected client mistakes (4xx, logged at `warn`) from unexpected crashes (5xx, logged at `error`, masked in production).
3. **Production Safety:** Sensitive error messages and stack traces are automatically masked in production HTTP responses.
4. **Cloud-Native Logging:** Ships with a pre-configured Pino logger producing single-line ISO-8601 JSON for Grafana Loki, Datadog, and CloudWatch.
5. **AI-Agent Native:** Includes built-in Agent Skills and a zero-config setup CLI (`npx faultkit init`) for autonomous AI coding agents.

---

## 2. Why It Exists

Most error handling libraries either couple you tightly to a specific web framework or require dozens of lines of repetitive boilerplate across every route. FaultKit separates pure domain logic from transport concerns:

- **Core domain code** throws typed errors extending `AppError` without importing Express or HTTP dependencies.
- **Transport middleware** (`faultkit/express`) intercepts errors, normalizes unexpected exceptions, dispatches structured logs, and formats client-safe responses.
- **Observability** (`faultkit/logger` or root) automatically extracts status codes, error codes, validation details, and stack traces into structured JSON logs.

---

## 3. Installation

```bash
npm install faultkit
```

### Optional Peer Dependency: Express
If you are building an Express application, ensure `express` (v4 or v5) is installed:

```bash
npm install express
```

### Configure AI Coding Agents (Optional)
Equip your AI coding agent (Antigravity, Cursor, Copilot, or Claude) with FaultKit architectural guidelines:

```bash
npx faultkit init
```

---

## 4. Quick Start

### Step 1: Throw Errors Anywhere in Service or Domain Logic
Throw typed errors in your domain layer without any HTTP coupling:

```typescript
import { NotFoundError, ValidationError, ConflictError } from "faultkit";

// 404 Not Found
export async function getUser(userId: string) {
  const user = await database.users.findById(userId);
  if (!user) {
    throw new NotFoundError(`User with ID '${userId}' was not found.`);
  }
  return user;
}

// 400 Validation Error
// NOTE: details is the FIRST argument, message is optional SECOND argument
export function validateCreateUser(input: Record<string, unknown>) {
  if (!input.email) {
    throw new ValidationError({ email: ["Email is required."] }, "Validation failed.");
  }
}
```

### Step 2: Mount the Global Error Handler in Express
Mount `createExpressErrorHandler()` as the **last middleware** in your Express application:

```typescript
import express from "express";
import { createExpressErrorHandler } from "faultkit/express";
import { getUser, validateCreateUser } from "./userService.js";

const app = express();
app.use(express.json());

// Routes
app.get("/users/:id", async (req, res, next) => {
  try {
    const user = await getUser(req.params.id);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

// Centralized error handler MUST be placed AFTER all routes
app.use(createExpressErrorHandler());

app.listen(3000);
```

### Step 3: Structured Logging
Log application events with the pre-configured Pino logger:

```typescript
import { logger } from "faultkit";

logger.info("Order processed successfully", { orderId: "ord_102" });

// Always pass { err } so FaultKit automatically extracts status and error codes
logger.error({ err }, "Payment capture failed");
```

---

## 5. Core API Reference

### OpenAPI Error Response Contract
Every non-2xx response emitted by FaultKit middleware adheres to this exact contract:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "User with ID 'usr_123' was not found.",
    "details": null
  }
}
```

- **`code`**: Machine-readable string enum (e.g. `"BAD_REQUEST"`, `"VALIDATION_ERROR"`, `"NOT_FOUND"`).
- **`message`**: Human-readable explanation.
- **`details`**: Structured validation map (or `null`).

### Concrete Error Classes

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

> ⚠️ **Important Signature Notice for `ValidationError`:**
> `ValidationError` accepts `details` as its **first** parameter and `message` as its **second** parameter:
> ```typescript
> throw new ValidationError(zodErrors, "Validation failed");
> ```

### Built-in Logger & Observability API
FaultKit exports a battle-tested, pre-hardened Pino logger pre-configured with ISO-8601 timestamps, automatic credential redaction, and `AppError` serialization:

```typescript
import { logger, createLogger, createAppErrorSerializer, DEFAULT_REDACT_KEYS } from "faultkit";
// Also accessible via direct subpath export:
// import { logger } from "faultkit/logger";
```

| Export | Type | Description |
|---|---|---|
| `logger` | `Logger` (Pino) | Ready-to-use singleton logger with ISO-8601 formatting, credential redaction, and Loki tags. |
| `createLogger(options)` | `(options?: FaultKitLoggerOptions) => Logger` | Factory function to create custom microservice loggers. |
| `createAppErrorSerializer()` | `(options?) => (err: unknown) => Record<string, unknown>` | Pino error serializer that extracts status code, error code, operational state, details, and stack. |
| `DEFAULT_REDACT_KEYS` | `string[]` | Default list of sensitive keys automatically redacted (`authorization`, `cookie`, `password`, `token`, `secret`, `apiKey`, `creditCard`). |

---

## 6. Configuration Options

### `createExpressErrorHandler(options)`
Exported from `"faultkit/express"`:

```typescript
import { createExpressErrorHandler } from "faultkit/express";

app.use(
  createExpressErrorHandler({
    // Custom logger instance (defaults to FaultKit's built-in Pino logger)
    logger: customLogger,

    // Masked message sent to clients for non-operational 5xx errors in production
    // Default: "An unexpected error occurred. Our team has been notified."
    genericServerErrorMessage: "Internal server error. Please try again later.",

    // Custom error coercion hook to map Mongoose, Prisma, or proprietary library errors
    errorCoercer: (err) => {
      if (err?.code === "P2002") return new ConflictError("Database record already exists.");
    },

    // Whether to extract and include a distributed correlation ID in logs and responses
    // Default: true
    includeRequestId: true,

    // Header name to extract correlation ID from (Default: 'x-request-id')
    requestIdHeader: "x-request-id",

    // Whether to print stack traces in server-side logs
    // Default: process.env.NODE_ENV !== "production"
    includeStackInLog: true,
  })
);
```

### `createLogger(options)`
Exported from `"faultkit"` (or `"faultkit/logger"`):

```typescript
import { createLogger } from "faultkit";

const logger = createLogger({
  // Service name for Loki / Datadog filtering (Default: process.env.SERVICE_NAME || 'api')
  service: "billing-service",

  // Log level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  level: "info",

  // Custom property paths to redact (defaults to DEFAULT_REDACT_KEYS)
  redact: ["req.headers.authorization", "password", "token", "creditCard"],

  // Custom base properties or null to remove pid/hostname
  base: { env: process.env.NODE_ENV },

  // Include stack traces when serializing errors (Default: true)
  includeStackInLog: true,
});
```

---

## 7. Framework Integrations

### Express (v4 and v5)
The Express adapter is isolated under the `"faultkit/express"` subpath export to keep non-Express applications lean:

```typescript
import express from "express";
import { createExpressErrorHandler } from "faultkit/express";

const app = express();
app.use(express.json());

// Routes...
// (In Express 4, pass async errors to next(err); in Express 5, unhandled promise rejections are handled automatically)

// Mount error handler LAST
app.use(createExpressErrorHandler());
```

### Fastify
Use FaultKit error classes and the built-in `.toJSON()` serialization:

```typescript
import Fastify from "fastify";
import { AppError } from "faultkit";

const fastify = Fastify();

fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send(error.toJSON());
    return;
  }
  reply.status(500).send({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      details: null,
    },
  });
});
```

### AWS Lambda / Hono / Serverless
```typescript
import { AppError } from "faultkit";

export async function handler(event: any) {
  try {
    const data = await processEvent(event);
    return { statusCode: 200, body: JSON.stringify({ success: true, data }) };
  } catch (err) {
    if (err instanceof AppError) {
      return {
        statusCode: err.statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(err.toJSON()),
      };
    }
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "Server error", details: null },
      }),
    };
  }
}
```

### WebSockets & Realtime Streaming (Socket.io)
When streaming LLM tokens or bidirectional events over WebSockets, use `toErrorResponse` to emit identical error envelopes:

```typescript
import { toErrorResponse } from "faultkit";

io.on("connection", (socket) => {
  socket.on("agent:invoke", async (data) => {
    try {
      await runAgentPipeline(data);
    } catch (err) {
      // Emits { success: false, error: { code, message, details, requestId }, requestId }
      socket.emit("agent:error", toErrorResponse(err, {
        requestId: data.requestId || socket.id,
      }));
    }
  });
});
```

### Message Queues (RabbitMQ, BullMQ, Kafka)
When asynchronous workers consume queue messages, format errors consistently for dead-letter queues and Loki alerts:

```typescript
import { formatError, logger } from "faultkit";

channel.consume("payment_webhooks", async (msg) => {
  try {
    await processPayment(JSON.parse(msg.content.toString()));
    channel.ack(msg);
  } catch (err) {
    const errorEnvelope = formatError(err, {
      requestId: msg.properties.correlationId,
      isProduction: process.env.NODE_ENV === "production",
    });

    logger.error({ err, errorEnvelope }, "Payment webhook processing failed");
    channel.nack(msg, false, false); // route to DLQ
  }
});
```

---

## 8. Recommended Architecture

For scalable microservices and monorepos, organize your error flow across distinct layers:

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Request                         │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Controller / Route Layer                  │
│   • Parses request                                          │
│   • Invokes domain service                                  │
│   • Forwards errors to next(err)                            │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Domain / Service Logic Layer                │
│   • Framework-agnostic                                      │
│   • Throws typed AppError subclasses                        │
│   • (NotFoundError, ValidationError, ConflictError)         │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            Centralized Error Middleware (Express)           │
│   • Normalizes thrown values into AppError                  │
│   • Checks isOperational flag                               │
│   • Dispatches structured logs via Pino (warn vs error)     │
│   • Masks non-operational messages in production            │
│   • Sends OpenAPI-compliant response envelope               │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Real-World Examples

Complete, runnable examples are provided in the [`examples/`](./examples) directory:

1. **[Express Production Server](./examples/01-express-production/server.ts):** Full REST API with validation, conflict detection, request ID correlation, authentication guard, and production message masking.
2. **[Structured Logging & Tracing](./examples/02-structured-logging-tracing/logging.ts):** Advanced Pino usage, child loggers with trace IDs, credential redaction, and Loki query patterns.
3. **[Custom Domain Errors](./examples/03-domain-custom-errors/customErrors.ts):** Subclassing `AppError` to create domain-specific errors (e.g. `PaymentDeclinedError` with HTTP 402).
4. **[Framework-Agnostic Handlers](./examples/04-framework-agnostic/fastify-or-lambda.ts):** Fastify error handlers and AWS Lambda API Gateway error envelopes.

---

## 10. Error Handling & Edge Cases

### Automatic 3rd-Party Error Coercion
If a third-party library throws an error with a `.status` or `.statusCode` property (such as `body-parser` throwing a syntax error on malformed JSON with status 400), FaultKit automatically:
- Maps the status code to the appropriate `ErrorCode` (e.g. `BAD_REQUEST`).
- Treats 4xx library errors as **operational** (preserves message).
- Maps 5xx library errors to `INTERNAL_SERVER_ERROR` with operational safety flags.

### Adversarial Throws
JavaScript allows throwing non-Error primitives:
- `throw "Something went wrong"`
- `throw null`
- `throw undefined`
- Circular reference objects

FaultKit safely intercepts all non-Error throws, coerces them to `InternalServerError` (HTTP 500), prevents process crashes, and returns a sanitized JSON response.

### Streaming Responses & `res.headersSent`
If response headers were already sent to the client (for example during an SSE stream or file download), FaultKit detects `res.headersSent` and delegates to the default Express handler (`next(err)`) to avoid triggering `ERR_HTTP_HEADERS_SENT`.

---

## 11. Security Considerations

### 1. Production Error Masking
In development (`NODE_ENV !== "production"`), FaultKit returns the actual error message for easy debugging. In production (`NODE_ENV === "production"`), any non-operational error (500 crashes or native exceptions) has its message replaced with `genericServerErrorMessage` and `details` coerced to `null`. This prevents leaking database connection strings, file paths, or internal logic.

### 2. Automatic Sensitive Data Redaction
FaultKit's logger automatically redacts sensitive parameters using `DEFAULT_REDACT_KEYS`:
- `req.headers.authorization`
- `req.headers.cookie`
- `authorization`
- `password`, `*.password`
- `token`, `*.token`
- `secret`, `*.secret`
- `apiKey`, `*.apiKey`
- `creditCard`, `*.creditCard`

Redacted values appear in logs as `"[REDACTED]"`.

---

## 12. Testing

### Unit Testing Error Serialization
```typescript
import { NotFoundError, ErrorCode } from "faultkit";

test("NotFoundError produces OpenAPI envelope", () => {
  const err = new NotFoundError("User missing");
  expect(err.statusCode).toBe(404);
  expect(err.toJSON()).toEqual({
    success: false,
    error: {
      code: ErrorCode.NOT_FOUND,
      message: "User missing",
      details: null,
    },
  });
});
```

### Running Test Suites
```bash
# Run unit, CLI, and all E2E test suites
npm test

# Run unit tests only
npm run test:unit

# Run CLI integration tests
npm run test:cli

# Run E2E and chaos test suites
npm run test:e2e
```

---

## 13. Common Mistakes & Anti-Patterns

| Anti-Pattern | Correct Pattern | Why |
|---|---|---|
| `import { createExpressErrorHandler } from "faultkit"` | `import { createExpressErrorHandler } from "faultkit/express"` | Express middleware is isolated behind a dedicated subpath to avoid pulling Express types into non-Express services. |
| `new ValidationError("User invalid", errors)` | `new ValidationError(errors, "User invalid")` | `ValidationError` requires `details` as the first argument and `message` as optional second argument. |
| `app.use(createExpressErrorHandler())` registered before routes | Mount `createExpressErrorHandler()` after all routes | Express routes registered after the error middleware will bypass the error handler. |
| `logger.error(err.message)` | `logger.error({ err }, "Context message")` | Passing `{ err }` invokes FaultKit's Pino serializer, extracting status, code, details, and stack trace. |
| `new AppError("msg", 400, "BAD_REQUEST")` | `new BadRequestError("msg")` | `AppError` is an abstract class; use concrete subclasses or create your own subclass. |
| Expecting custom 500 error messages in production | Rely on `warn`/`error` server-side logs | Production message masking deliberately sanitizes 5xx responses for security. |

---

## 14. Migration & Versioning

- **Version 1.0.0:** Production-ready release supporting Node.js `>= 18.0.0`.
- **Dual Module Compatibility:** Ships dual CJS and ESM builds with complete TypeScript declaration maps (`.d.ts`).
- **Semantic Versioning:** Breaking changes to the OpenAPI response contract or class signatures will trigger major version increments.

---

## 15. AI-Agent Native Integration

FaultKit is designed from the ground up for autonomous AI coding agents (Antigravity, Cursor, Copilot, Claude Code).

### Automatic Agent Setup via CLI
To configure your project so coding agents follow FaultKit best practices:

```bash
npx faultkit init
```

Supported targets:
- `agents`: Installs `.agents/skills/faultkit/SKILL.md` (Antigravity / Agent Skills standard)
- `cursor`: Generates `.cursor/rules/faultkit.mdc`
- `copilot`: Configures `.github/copilot-instructions.md`
- `claude`: Configures `CLAUDE.md`
- `all`: Installs all configurations

### Agent Decision Rules
When coding agents evaluate backend logic:
1. **Validation Failures:** If schema validation fails, use `ValidationError(details, message)`.
2. **Missing Entity:** If a database query yields null, use `NotFoundError(message)`.
3. **State Conflict:** If an index or constraint collision occurs, use `ConflictError(message, details)`.
4. **Auth Expiry:** If a JWT expired, use `TokenExpiredError(message)`.
5. **Express Placement:** Always mount `createExpressErrorHandler()` after all route handlers.

---

## 16. Troubleshooting

### Issue: `Cannot find module 'faultkit/express'`
**Fix:** Ensure your `tsconfig.json` has `"moduleResolution": "NodeNext"` or `"Bundler"`, or ensure you are running Node.js `>= 18.0.0`.

### Issue: `UnhandledPromiseRejection` in Express 4
**Fix:** In Express 4, async errors must be caught and forwarded with `next(err)`:
```typescript
app.get("/items", async (req, res, next) => {
  try {
    const items = await fetchItems();
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});
```
(In Express 5, unhandled promise rejections are handled automatically by Express).

### Issue: Error handler not triggering
**Fix:** Verify that `app.use(createExpressErrorHandler())` is mounted **after** all route declarations and that your custom middleware doesn't swallow errors in an empty `catch` block.

---

## 17. Contributing

Contributions are welcome! Please ensure all tests and type checks pass:

```bash
# Typecheck
npm run typecheck

# Run test suites
npm test

# Build packages
npm run build
```

---

## 18. License

MIT © [Sahil Sharma](LICENSE)
