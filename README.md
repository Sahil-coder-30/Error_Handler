# faultkit

> Production-grade, OpenAPI-compliant error handling and Grafana/Loki-ready structured logging for TypeScript and Node.js.

[![CI](https://github.com/Sahil-coder-30/Error_Handler/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Sahil-coder-30/Error_Handler/actions/workflows/ci.yml)
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
import { createExpressErrorHandler, createNotFoundHandler, asyncHandler } from "faultkit/express";
import { getUser, validateCreateUser } from "./userService.js";

const app = express();
app.use(express.json());

// Routes. asyncHandler forwards rejected promises to the error handler (needed in Express 4).
app.get("/users/:id", asyncHandler(async (req, res) => {
  const user = await getUser(req.params.id);
  res.json({ success: true, data: user });
}));

// Unmatched routes return the JSON contract (404 NOT_FOUND) instead of an HTML page
app.use(createNotFoundHandler());

// Centralized error handler MUST be placed AFTER all routes
app.use(createExpressErrorHandler());

app.listen(3000);
```

### Step 3: Structured Logging
Log application events with the pre-configured Pino logger:

```typescript
import { logger } from "faultkit";

logger.info({ orderId: "ord_102" }, "Order processed successfully");

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
    "details": null,
    "requestId": "req_8492048"
  },
  "requestId": "req_8492048"
}
```

- **`code`**: Machine-readable string enum (e.g. `"BAD_REQUEST"`, `"VALIDATION_ERROR"`, `"NOT_FOUND"`).
- **`message`**: Human-readable explanation.
- **`details`**: Structured validation map (or `null`). Always JSON-safe (BigInt, Map, Set, Date and cycles are handled).
- **`requestId`**: Present only when a request ID is known (see `includeRequestId`).

### Concrete Error Classes

Every class takes `(message?, details?, options?)`, where `options` is `{ cause?: unknown }`.
The only exception is `ValidationError`, which takes `(details, message?, options?)`.

| Class | HTTP Status | Error Code (`ErrorCode.*`) | `isOperational` |
|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` | `true` |
| `ValidationError` | 400 | `VALIDATION_ERROR` | `true` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | `true` |
| `TokenExpiredError` | 401 | `TOKEN_EXPIRED` | `true` |
| `TokenInvalidError` | 401 | `TOKEN_INVALID` | `true` |
| `ForbiddenError` | 403 | `FORBIDDEN` | `true` |
| `NotFoundError` | 404 | `NOT_FOUND` | `true` |
| `ConflictError` | 409 | `CONFLICT` | `true` |
| `UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` | `true` |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | `true` |
| `InternalServerError` | 500 | `INTERNAL_SERVER_ERROR` | `false` |
| `MessageProcessingFailedError` | 500 | `MESSAGE_PROCESSING_FAILED` | `false` |
| `BadGatewayError` | 502 | `BAD_GATEWAY` | `false` |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | `false` |
| `GatewayTimeoutError` | 504 | `GATEWAY_TIMEOUT` | `false` |
| `ContextWindowExceededError` | 400 | `CONTEXT_WINDOW_EXCEEDED` | `true` |
| `ContentFilteredError` | 400 | `CONTENT_FILTERED` | `true` |
| `InsufficientCreditsError` | 402 | `INSUFFICIENT_CREDITS` | `true` |
| `ModelNotFoundError` | 404 | `MODEL_NOT_FOUND` | `true` |
| `ModelRateLimitError` | 429 | `MODEL_RATE_LIMIT` | `true` |
| `LlmProviderDownError` | 503 | `LLM_PROVIDER_DOWN` | `false` |

Wrap a low-level failure without losing it:

```typescript
throw new ServiceUnavailableError("Billing is unavailable.", null, { cause: err });
```

The `cause` is logged (message and stack) but never sent to the client.

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
| `createAppErrorSerializer(includeStack?)` | `(includeStack?: boolean \| { includeStack?: boolean }) => (err: unknown) => Record<string, unknown>` | Pino error serializer that extracts status code, error code, operational state, details, and stack. |
| `DEFAULT_REDACT_KEYS` | `string[]` | Default list of sensitive keys automatically redacted (`authorization`, `cookie`, `password`, `token`, `secret`, `apiKey`, `creditCard`). |

### Formatting Helpers

| Export | Description |
|---|---|
| `toHttpResponse(err, options?)` | Returns `{ statusCode, body, error }`. Use it in Fastify, Hono, Koa, Lambda or Next.js. |
| `toErrorResponse(err, options?)` / `formatError` | Returns only the JSON body. Use it for WebSockets and queues. |
| `coerceToAppError(err, coercer?)` | Normalizes any thrown value into an `AppError`. Never throws. |
| `errorCodeFromStatus(status)` | Maps an HTTP status to the closest `ErrorCode`. |
| `sanitizeDetails(value)` | Makes any value JSON-safe (BigInt, cycles, Map, Set, Error, hostile getters). |
| `normalizeRequestId(value)` | Validates an untrusted request ID. Returns `undefined` if unsafe. |

`options` for both formatters: `{ isProduction?, genericServerErrorMessage?, requestId?, errorCoercer? }`.

> `err.toJSON()` is a raw serializer and does NOT mask 5xx messages. Send `toHttpResponse(err).body` to clients instead.

---

## 6. Configuration Options

### `createExpressErrorHandler(options)`
Exported from `"faultkit/express"`:

```typescript
import { createExpressErrorHandler } from "faultkit/express";

app.use(
  createExpressErrorHandler({
    // Custom logger instance (defaults to FaultKit's built-in Pino logger).
    // Pino, Bunyan, Winston and console are detected automatically. Pass false to disable.
    logger: customLogger,

    // Force argument order if auto-detection is wrong: "auto" | "object-first" | "message-first"
    loggerStyle: "auto",

    // Mask non-operational messages and details (Default: NODE_ENV === "production", checked per request)
    isProduction: true,

    // Masked message sent to clients for non-operational 5xx errors in production
    // Default: "An unexpected error occurred. Our team has been notified."
    genericServerErrorMessage: "Internal server error. Please try again later.",

    // Custom error coercion hook for proprietary library errors. Must be synchronous.
    // (Mongoose, MongoDB, Prisma, Zod, Joi and http-errors are already handled.)
    errorCoercer: (err) => {
      if (err?.type === "StripeCardError") return new ConflictError("The card was declined.");
    },

    // Whether to extract and include a distributed correlation ID in logs and responses
    // Default: true
    includeRequestId: true,

    // Header name to extract correlation ID from, and to echo it in (Default: 'x-request-id')
    requestIdHeader: "x-request-id",

    // Generate a UUID when the request has no valid ID (Default: false). A function is also accepted.
    generateRequestId: true,

    // Called once per handled error, e.g. to report to Sentry. Errors thrown here are ignored.
    onError: (appError, req, originalError) => Sentry.captureException(originalError),

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

  // Extra base fields. Defaults are pid, hostname and service. null keeps only service.
  base: { env: process.env.NODE_ENV },

  // Include stack traces when serializing errors (Default: true)
  includeStackInLog: true,
});
```

An unknown `level` (for example a typo in `LOG_LEVEL`) falls back to `"info"` with a warning instead of crashing at import time. Logging never throws: hostile getters, circular data and frozen errors are handled, even after `logger.level` changes and in child loggers.

---

## 7. Framework Integrations

### Express (v4 and v5)
The Express adapter is isolated under the `"faultkit/express"` subpath export to keep non-Express applications lean:

```typescript
import express from "express";
import { createExpressErrorHandler, createNotFoundHandler } from "faultkit/express";

const app = express();
app.use(express.json());

// Routes...
// (In Express 4, pass async errors to next(err); in Express 5, unhandled promise rejections are handled automatically)

// Unmatched routes → JSON 404, then the error handler LAST
app.use(createNotFoundHandler());
app.use(createExpressErrorHandler());
```

### Fastify
`toHttpResponse` gives you the status code and the masked body in one call:

```typescript
import Fastify from "fastify";
import { toHttpResponse, logger } from "faultkit";

const fastify = Fastify();

fastify.setErrorHandler((error, request, reply) => {
  const { statusCode, body, error: appError } = toHttpResponse(error, { requestId: request.id });
  logger[statusCode >= 500 ? "error" : "warn"]({ err: appError, requestId: request.id }, "Request failed");
  reply.status(statusCode).send(body);
});
```

### AWS Lambda / Hono / Serverless
```typescript
import { toHttpResponse } from "faultkit";

export async function handler(event: any) {
  try {
    const data = await processEvent(event);
    return { statusCode: 200, body: JSON.stringify({ success: true, data }) };
  } catch (err) {
    const { statusCode, body } = toHttpResponse(err, { requestId: event.requestContext?.requestId });
    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

## 8. Frontend Integration & Best UX Patterns

Because FaultKit enforces a 100% consistent OpenAPI contract, your frontend team never has to guess response structures or write messy defensive code checking `err.response?.data?.message || err.message`. 

A single, central response interceptor can handle toast alerts, form errors, authentication routing, and support ticket tracking for your entire web or mobile application.

### The Single Universal Axios Interceptor

Set up an interceptor once in your HTTP client (`frontend/src/apiClient.ts`):

```typescript
import axios from "axios";
import { toast } from "sonner"; // or react-toastify, antd, etc.

export const api = axios.create({
  baseURL: "/api",
});

api.interceptors.response.use(
  (response) => response,
  (axiosError) => {
    const errorData = axiosError.response?.data?.error;

    // Fallback for network dropouts, CORS blocks, or server timeouts
    if (!errorData) {
      toast.error("Network or unexpected server issue. Please try again.");
      return Promise.reject(axiosError);
    }

    // 1. Toast / alert message
    // In production, FaultKit automatically masks 500 errors to user-safe copy
    toast.error(errorData.message);

    // 2. Field-specific form validation errors
    if (errorData.code === "VALIDATION_ERROR" && errorData.details) {
      // Dispatches structured validation map to forms or state stores
      window.dispatchEvent(new CustomEvent("api:validation-error", { detail: errorData.details }));
    }

    // 3. Auth redirection & session cleanup
    if (errorData.code === "UNAUTHORIZED" || errorData.code === "TOKEN_EXPIRED") {
      localStorage.removeItem("auth_token");
      window.location.href = "/login";
    }

    // 4. Incident tracking & support reference
    if (errorData.requestId) {
      console.error(`[FaultKit] Support Reference ID: ${errorData.requestId}`);
    }

    return Promise.reject(errorData);
  }
);
```

### Form Validation UX (React Hook Form / Formik)

FaultKit's `ValidationError` formats field errors as `{ fieldName: ["Error message"] }`. You can bind this directly to form state with zero string parsing:

```tsx
import { useForm } from "react-hook-form";
import { api } from "./apiClient";

export function RegisterForm() {
  const { register, handleSubmit, setError, formState: { errors } } = useForm();

  const onSubmit = async (values) => {
    try {
      await api.post("/auth/register", values);
    } catch (err: any) {
      // Bind backend validation details directly to input fields
      if (err.code === "VALIDATION_ERROR" && err.details) {
        Object.entries(err.details).forEach(([field, messages]) => {
          const msg = Array.isArray(messages) ? messages[0] : String(messages);
          setError(field, { type: "server", message: msg });
        });
      }
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("email")} placeholder="Email" />
      {errors.email && <span className="error">{errors.email.message}</span>}
      <button type="submit">Sign Up</button>
    </form>
  );
}
```

### Lightweight Native Fetch Wrapper (Next.js / TanStack Query)

If you don't use Axios, wrap native `fetch` with the same contract:

```typescript
export async function fetchWithFaultKit<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const errorPayload = body?.error || {
      code: "HTTP_ERROR",
      message: `Request failed with status ${response.status}`,
      details: null,
    };
    throw errorPayload;
  }

  return body as T;
}
```

### The Observability Loop: From UI to Grafana Loki

When an unexpected 500 error happens:
1. **User sees a clean, safe banner:** *"An unexpected error occurred. Our team has been notified. (Reference: `req_8492048`)"* with a **"Copy ID"** button.
2. **Customer Support** receives `req_8492048` from the user.
3. **Engineers search Grafana Loki:**
   ```logql
   {service="api"} |= "req_8492048"
   ```
   The exact stack trace, route, parameters, and database fault appear instantly!

---

## 9. Recommended Architecture

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

## 10. Real-World Examples

Complete, runnable examples are provided in the [`examples/`](./examples) directory:

1. **[Express Production Server](./examples/01-express-production/server.ts):** Full REST API with validation, conflict detection, request ID correlation, authentication guard, and production message masking.
2. **[Structured Logging & Tracing](./examples/02-structured-logging-tracing/logging.ts):** Advanced Pino usage, child loggers with trace IDs, credential redaction, and Loki query patterns.
3. **[Custom Domain Errors](./examples/03-domain-custom-errors/customErrors.ts):** Subclassing `AppError` to create domain-specific errors (e.g. `PaymentDeclinedError` with HTTP 402).
4. **[Framework-Agnostic Handlers](./examples/04-framework-agnostic/fastify-or-lambda.ts):** Fastify error handlers and AWS Lambda API Gateway error envelopes.
5. **[Frontend Integration & Best UX](#8-frontend-integration--best-ux-patterns):** Full guide with Axios response interceptor, native Fetch wrapper, form validation bindings, and user-facing error dialogs.

---

## 11. Error Handling & Edge Cases

### Automatic Library Error Coercion

| Thrown error | Result |
|---|---|
| Mongoose `ValidationError` | 400 `VALIDATION_ERROR`, details `{ field: [messages] }` |
| Mongoose `CastError` | 400 `BAD_REQUEST` |
| Mongoose `DocumentNotFoundError` | 404 `NOT_FOUND` |
| MongoDB duplicate key (11000 / 11001) | 409 `CONFLICT` |
| Prisma `P2002` / `P2003` | 409 `CONFLICT` |
| Prisma `P2025` | 404 `NOT_FOUND` |
| Prisma `P2000` | 400 `BAD_REQUEST` |
| `ZodError`, Joi `ValidationError` | 400 `VALIDATION_ERROR`, details `{ field: [messages] }` |
| Any error with `.status` / `.statusCode` (http-errors, body-parser) | Same status, mapped code (`PAYLOAD_TOO_LARGE`, `METHOD_NOT_ALLOWED`, ...) |
| `AppError` from another copy of faultkit (CJS + ESM, monorepos) | Kept as is, `instanceof AppError` still works |
| Anything else | 500 `INTERNAL_SERVER_ERROR` |

For errors with an HTTP status, 4xx is **operational** (message kept) and 5xx is not (masked in production). An http-errors `expose: false` flag is respected.

Every coerced error keeps the **original stack trace and `cause`**, so logs point at the real throw site.

An `AppError` with an invalid status (`NaN`, `Infinity`, a string, or outside 400-599) becomes a non-operational 500.

### Request ID Safety
Client-supplied request IDs are trimmed and validated. IDs longer than 256 characters, or containing spaces, quotes, angle brackets or control characters (CRLF), are dropped. Numeric IDs (such as `pino-http`'s default `req.id`) are converted to strings.

### Adversarial Throws
JavaScript allows throwing non-Error primitives:
- `throw "Something went wrong"`
- `throw null`
- `throw undefined`
- Circular reference objects

FaultKit safely intercepts all non-Error throws, coerces them to `InternalServerError` (HTTP 500), prevents process crashes, and returns a sanitized JSON response.

### Streaming Responses & `res.headersSent`
If response headers were already sent to the client (for example during an SSE stream or file download), FaultKit logs the error at `error` level and then delegates to the default Express handler (`next(err)`), which closes the connection, to avoid `ERR_HTTP_HEADERS_SENT`.

---

## 12. Security Considerations

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

The Express handler logs the request path **without the query string**, because query strings often carry tokens.

---

## 13. Testing

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

# Run the v1.2 regression suite
npm run test:fixes

# Typecheck TypeScript tests and examples
npm run test:types

# Run adversarial and stress suites
npm run test:adversarial
npm run test:stress
```

---

## 14. Common Mistakes & Anti-Patterns

| Anti-Pattern | Correct Pattern | Why |
|---|---|---|
| `import { createExpressErrorHandler } from "faultkit"` | `import { createExpressErrorHandler } from "faultkit/express"` | Express middleware is isolated behind a dedicated subpath to avoid pulling Express types into non-Express services. |
| `new ValidationError("User invalid", errors)` | `new ValidationError(errors, "User invalid")` | `ValidationError` requires `details` as the first argument and `message` as optional second argument. |
| `app.use(createExpressErrorHandler())` registered before routes | Mount `createExpressErrorHandler()` after all routes | Express routes registered after the error middleware will bypass the error handler. |
| `logger.error(err.message)` | `logger.error({ err }, "Context message")` | Passing `{ err }` invokes FaultKit's Pino serializer, extracting status, code, details, and stack trace. |
| `new AppError("msg", 400, "BAD_REQUEST")` | `new BadRequestError("msg")` | `AppError` is an abstract class; use concrete subclasses or create your own subclass. |
| `reply.send(err.toJSON())` for any error | `reply.send(toHttpResponse(err).body)` | `toJSON()` does not mask 5xx messages in production. |
| `errorCoercer: async (err) => ...` | A synchronous `errorCoercer` | A returned Promise is ignored. |
| Expecting custom 500 error messages in production | Rely on `warn`/`error` server-side logs | Production message masking deliberately sanitizes 5xx responses for security. |

---

## 15. Migration & Versioning

- **Version 1.0.0:** Production-ready release supporting Node.js `>= 18.0.0`.
- **Version 1.2.0:** Bug-fix and hardening release, no breaking changes to the response contract.
  - Coerced errors keep the original stack trace and `cause`.
  - `instanceof AppError` works across duplicate package copies (CJS + ESM).
  - Built-in Prisma, Zod, Joi and Mongoose `DocumentNotFoundError` coercion; more status codes mapped.
  - `toHttpResponse`, `createNotFoundHandler`, `asyncHandler`, `GatewayTimeoutError`, `BadGatewayError`, `MessageProcessingFailedError`.
  - Every error class accepts `details` and `{ cause }`.
  - Express: `isProduction`, `generateRequestId`, `onError`, `loggerStyle`, `logger: false`; Winston detection; `includeStackInLog: false` now really hides stacks; request IDs are validated.
  - Logger: invalid `LOG_LEVEL` no longer crashes; safety survives level changes; custom `serializers` no longer drop the AppError serializer; default `base` now includes `pid` and `hostname`.
  - `details` serialization: shared objects are no longer marked `[Circular]`; `JSON.stringify(appError)` with BigInt details no longer throws.
  - Development mode now shows 500 `details` in Express responses too (matching `toErrorResponse`). Production still hides them.
  - Types resolve under `moduleResolution: "node"` (`typesVersions`).
- **Dual Module Compatibility:** Ships dual CJS and ESM builds with complete TypeScript declaration maps (`.d.ts`).
- **Semantic Versioning:** Breaking changes to the OpenAPI response contract or class signatures will trigger major version increments.

---

## 16. AI-Agent Native Integration

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

## 17. Troubleshooting

### Issue: `Cannot find module 'faultkit/express'`
**Fix:** Upgrade to faultkit `>= 1.2.0` (types now resolve under `"node"`, `"node16"`, `"nodenext"` and `"bundler"`), and make sure you are running Node.js `>= 18.0.0`.

### Issue: `UnhandledPromiseRejection` in Express 4
**Fix:** In Express 4, async errors must be forwarded with `next(err)`. Wrap the route with `asyncHandler`:
```typescript
import { asyncHandler } from "faultkit/express";

app.get("/items", asyncHandler(async (req, res) => {
  const items = await fetchItems();
  res.json({ success: true, data: items });
}));
```
(In Express 5, unhandled promise rejections are handled automatically by Express).

### Issue: Unmatched routes return an HTML "Cannot GET" page
**Fix:** Mount `createNotFoundHandler()` after all routes and before `createExpressErrorHandler()`.

### Issue: Error handler not triggering
**Fix:** Verify that `app.use(createExpressErrorHandler())` is mounted **after** all route declarations and that your custom middleware doesn't swallow errors in an empty `catch` block.

---

## 18. Contributing

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

## 19. License

MIT © [Sahil Sharma](LICENSE)
