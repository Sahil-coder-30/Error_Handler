<div align="center">

<img src="https://raw.githubusercontent.com/Sahil-coder-30/faultkit/main/assets/logo.svg" alt="faultkit logo" width="128" height="128">

# faultkit

**Typed errors, one JSON error contract, and safe structured logging for Node.js and TypeScript.**

[![CI](https://github.com/Sahil-coder-30/faultkit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Sahil-coder-30/faultkit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/faultkit.svg)](https://www.npmjs.com/package/faultkit)
[![npm downloads](https://img.shields.io/npm/dm/faultkit.svg)](https://www.npmjs.com/package/faultkit)
[![types](https://img.shields.io/npm/types/faultkit.svg)](https://www.npmjs.com/package/faultkit)
[![node](https://img.shields.io/node/v/faultkit.svg)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/faultkit.svg)](LICENSE)

</div>

---

## Why faultkit

Most APIs end up with a different error shape in every route, stack traces leaking in production, and logs nobody can search. faultkit fixes that with one small package:

- **One response contract.** Every error becomes `{ success: false, error: { code, message, details } }`, so clients switch on `error.code` instead of parsing strings.
- **Typed error classes.** `throw new NotFoundError()` anywhere in your domain code. No HTTP imports needed.
- **Safe in production.** Unexpected (5xx) errors are masked for clients and logged in full for you.
- **Knows your libraries.** Mongoose, MongoDB, Prisma, Zod, Joi and `http-errors` errors are mapped to the right status automatically.
- **Structured logging included.** A pre-configured [Pino](https://getpino.io) logger with ISO timestamps, secret redaction and an error serializer, ready for Grafana Loki, Datadog or CloudWatch.
- **Works everywhere.** Express middleware included. Fastify, Hono, Koa, Lambda, Next.js, Socket.io and message queues through framework-agnostic helpers.
- **Dual CJS and ESM** builds with full TypeScript types.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [The error contract](#the-error-contract)
- [Error classes](#error-classes)
- [Express](#express)
- [Other frameworks and transports](#other-frameworks-and-transports)
- [Automatic error mapping](#automatic-error-mapping)
- [Logging](#logging)
- [Production safety](#production-safety)
- [Custom errors](#custom-errors)
- [Handling errors on the client](#handling-errors-on-the-client)
- [API reference](#api-reference)
- [TypeScript and module support](#typescript-and-module-support)
- [AI coding agents](#ai-coding-agents)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npm install faultkit
```

Express is an optional peer dependency. Install it only if you use `faultkit/express`:

```bash
npm install express
```

**Requirements:** Node.js 18 or newer. Express 4 or 5 for the Express middleware.

## Quick start

**1. Throw typed errors in your domain code.**

```ts
import { NotFoundError, ValidationError } from "faultkit";

export async function getUser(id: string) {
  const user = await db.users.findById(id);
  if (!user) throw new NotFoundError(`User '${id}' was not found.`);
  return user;
}

export function validateSignup(input: { email?: string }) {
  if (!input.email) {
    // ValidationError takes details FIRST, then an optional message
    throw new ValidationError({ email: ["Email is required."] });
  }
}
```

**2. Mount the error handler in Express.**

```ts
import express from "express";
import { createExpressErrorHandler, createNotFoundHandler, asyncHandler } from "faultkit/express";

const app = express();
app.use(express.json());

app.get("/users/:id", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getUser(req.params.id) });
}));

app.use(createNotFoundHandler());      // unmatched routes → JSON 404
app.use(createExpressErrorHandler());  // must be the last middleware

app.listen(3000);
```

**3. Get a consistent response.**

```http
HTTP/1.1 404 Not Found
x-request-id: 3f2b8c1e-9a4d-4c55-8f0e-1a2b3c4d5e6f

{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "User 'usr_42' was not found.",
    "details": null,
    "requestId": "3f2b8c1e-9a4d-4c55-8f0e-1a2b3c4d5e6f"
  },
  "requestId": "3f2b8c1e-9a4d-4c55-8f0e-1a2b3c4d5e6f"
}
```

The request ID appears when the request carries one (`x-request-id`, `x-correlation-id`, `req.id`) or when you enable `generateRequestId`.

## The error contract

Every error response has this shape:

```ts
interface ErrorResponse {
  success: false;
  error: {
    code: string;          // machine-readable, e.g. "VALIDATION_ERROR"
    message: string;       // human-readable, safe to display
    details: unknown;      // structured context, or null
    requestId?: string;    // correlation ID, when known
  };
  requestId?: string;      // same ID, at the top level
}
```

- `details` is always JSON-safe. BigInt, `Map`, `Set`, `Date`, nested `Error` objects and circular references are handled.
- Validation errors use `{ field: [messages] }` in `details`, so forms can bind them directly.
- All standard codes are available as `ErrorCode.*` with autocompletion. Any custom string is also accepted.

## Error classes

Every class takes `(message?, details?, options?)`. The one exception is `ValidationError`, which takes `(details, message?, options?)`. `options` is `{ cause?: unknown }`.

| Class | Status | `ErrorCode` | Operational |
|---|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` | yes |
| `ValidationError` | 400 | `VALIDATION_ERROR` | yes |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` | yes |
| `TokenExpiredError` | 401 | `TOKEN_EXPIRED` | yes |
| `TokenInvalidError` | 401 | `TOKEN_INVALID` | yes |
| `ForbiddenError` | 403 | `FORBIDDEN` | yes |
| `NotFoundError` | 404 | `NOT_FOUND` | yes |
| `ConflictError` | 409 | `CONFLICT` | yes |
| `UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` | yes |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | yes |
| `InternalServerError` | 500 | `INTERNAL_SERVER_ERROR` | no |
| `MessageProcessingFailedError` | 500 | `MESSAGE_PROCESSING_FAILED` | no |
| `BadGatewayError` | 502 | `BAD_GATEWAY` | no |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | no |
| `GatewayTimeoutError` | 504 | `GATEWAY_TIMEOUT` | no |

**AI and LLM errors**

| Class | Status | `ErrorCode` | Operational |
|---|---|---|---|
| `ContextWindowExceededError` | 400 | `CONTEXT_WINDOW_EXCEEDED` | yes |
| `ContentFilteredError` | 400 | `CONTENT_FILTERED` | yes |
| `InsufficientCreditsError` | 402 | `INSUFFICIENT_CREDITS` | yes |
| `ModelNotFoundError` | 404 | `MODEL_NOT_FOUND` | yes |
| `ModelRateLimitError` | 429 | `MODEL_RATE_LIMIT` | yes |
| `LlmProviderDownError` | 503 | `LLM_PROVIDER_DOWN` | no |

**Operational** errors are expected (bad input, missing record). Their message and details are sent to the client and they are logged at `warn`. **Non-operational** errors are bugs or outages. They are logged at `error`, and in production the client only sees a generic message.

Keep the original failure when you wrap it. The `cause` is logged but never sent to the client:

```ts
try {
  await billing.charge(order);
} catch (err) {
  throw new ServiceUnavailableError("Billing is unavailable.", null, { cause: err });
}
```

## Express

```ts
import { createExpressErrorHandler } from "faultkit/express";

app.use(createExpressErrorHandler({
  genericServerErrorMessage: "Something went wrong. Please try again.",
  generateRequestId: true,
  onError: (appError, req, originalError) => Sentry.captureException(originalError),
}));
```

| Option | Default | Description |
|---|---|---|
| `logger` | built-in Pino logger | Any logger with `warn` and `error` (Pino, Bunyan, Winston, `console`). `false` disables logging. |
| `loggerStyle` | `"auto"` | `"object-first"` (Pino, Bunyan) or `"message-first"` (Winston, `console`). Auto-detected. |
| `isProduction` | `NODE_ENV === "production"` | Mask non-operational messages and details. Checked per request. |
| `genericServerErrorMessage` | `"An unexpected error occurred. Our team has been notified."` | Message sent for masked errors. |
| `includeStackInLog` | `NODE_ENV !== "production"` | Include stack traces in logs. Never sent to clients. |
| `errorCoercer` | none | Synchronous `(err) => AppError \| unknown` hook for your own library errors. Runs first. |
| `includeRequestId` | `true` | Read a correlation ID and add it to logs, the response body and the response header. |
| `requestIdHeader` | `"x-request-id"` | Header to read the ID from and echo it in. `x-correlation-id` is also read. |
| `getRequestId` | none | `(req) => string \| number \| undefined` custom extractor. |
| `generateRequestId` | `false` | `true` for a UUID, or `(req) => string`, when the request has no valid ID. |
| `onError` | none | Called once per error after logging, e.g. to report to Sentry. Errors thrown here are ignored. |

Helpers from `faultkit/express`:

| Helper | Use it for |
|---|---|
| `createNotFoundHandler(options?)` | Returning a JSON 404 for unmatched routes instead of Express's HTML page. Accepts `{ message }`. |
| `asyncHandler(fn)` | Forwarding rejected promises to the error handler in Express 4. Harmless in Express 5. |

If headers were already sent (for example during a stream), the error is still logged and then passed to Express, which closes the connection.

## Other frameworks and transports

Use `toHttpResponse` when you need a status code, and `toErrorResponse` when you only need the body. Both apply the same mapping and production masking as the Express handler, and neither ever throws.

**Fastify**

```ts
import { toHttpResponse, logger } from "faultkit";

fastify.setErrorHandler((error, request, reply) => {
  const { statusCode, body, error: appError } = toHttpResponse(error, { requestId: request.id });
  logger[statusCode >= 500 ? "error" : "warn"]({ err: appError }, "Request failed");
  reply.status(statusCode).send(body);
});
```

**AWS Lambda, Hono, Next.js route handlers**

```ts
import { toHttpResponse } from "faultkit";

export async function handler(event) {
  try {
    return { statusCode: 200, body: JSON.stringify({ success: true, data: await run(event) }) };
  } catch (err) {
    const { statusCode, body } = toHttpResponse(err);
    return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }
}
```

**Socket.io and message queues**

```ts
import { toErrorResponse, logger } from "faultkit";

socket.on("agent:invoke", async (data) => {
  try {
    await runAgent(data);
  } catch (err) {
    socket.emit("agent:error", toErrorResponse(err, { requestId: data.requestId }));
  }
});

channel.consume("payments", async (msg) => {
  try {
    await processPayment(JSON.parse(msg.content.toString()));
    channel.ack(msg);
  } catch (err) {
    logger.error({ err, envelope: toErrorResponse(err) }, "Payment processing failed");
    channel.nack(msg, false, false);
  }
});
```

Options for both: `{ isProduction?, genericServerErrorMessage?, requestId?, errorCoercer? }`.

## Automatic error mapping

Anything thrown is normalized into an `AppError`, so you rarely need try/catch just to translate errors.

| Thrown | Result |
|---|---|
| Mongoose `ValidationError` | 400 `VALIDATION_ERROR`, details `{ field: [messages] }` |
| Mongoose `CastError` | 400 `BAD_REQUEST` |
| Mongoose `DocumentNotFoundError` | 404 `NOT_FOUND` |
| MongoDB duplicate key (`11000`, `11001`) | 409 `CONFLICT` |
| Prisma `P2002`, `P2003` | 409 `CONFLICT` |
| Prisma `P2025` | 404 `NOT_FOUND` |
| Prisma `P2000` | 400 `BAD_REQUEST` |
| `ZodError`, Joi `ValidationError` | 400 `VALIDATION_ERROR`, details `{ field: [messages] }` |
| Errors with `status` or `statusCode` (`http-errors`, `body-parser`) | Same status with a mapped code, e.g. `PAYLOAD_TOO_LARGE`, `METHOD_NOT_ALLOWED` |
| Anything else (`TypeError`, strings, `null`, ...) | 500 `INTERNAL_SERVER_ERROR` |

- Mapped errors keep the **original stack trace and `cause`**, so logs point at the real throw site.
- An `AppError` with an invalid status (`NaN`, a string, outside 400 to 599) becomes a non-operational 500.
- `instanceof AppError` works even when two copies of faultkit are loaded (CJS and ESM together, or a monorepo).
- An `http-errors` error with `expose: false` is treated as non-operational.

Add your own mappings with a synchronous `errorCoercer`:

```ts
createExpressErrorHandler({
  errorCoercer: (err) => {
    if (err?.type === "StripeCardError") return new ConflictError("The card was declined.");
  },
});
```

## Logging

```ts
import { logger } from "faultkit";            // or "faultkit/logger"

logger.info({ orderId: "ord_102" }, "Order processed");
logger.error({ err }, "Payment capture failed");  // pass errors as { err }

const reqLog = logger.child({ requestId });       // correlate a request
```

Output is one JSON line per entry (shortened here):

```json
{"level":50,"time":"2026-01-01T12:00:00.000Z","pid":4242,"hostname":"api-7d9f","service":"api","err":{"type":"NotFoundError","message":"User 'usr_42' was not found.","stack":"...","statusCode":404,"errorCode":"NOT_FOUND","isOperational":true,"isAppError":true},"msg":"Lookup failed"}
```

Create a logger per service with `createLogger`:

```ts
import { createLogger } from "faultkit";

export const logger = createLogger({
  service: "billing-service",
  level: "debug",
  base: { env: process.env.NODE_ENV },
});
```

| Option | Default | Description |
|---|---|---|
| `service` | `SERVICE_NAME` env or `"api"` | Added to every entry for filtering. |
| `level` | `LOG_LEVEL` env or `"info"` | An unknown level falls back to `"info"` with a warning instead of crashing. |
| `redact` | `DEFAULT_REDACT_KEYS` | Property paths replaced with `"[REDACTED]"`. |
| `base` | `{ pid, hostname, service }` | Extra fields for every entry. `null` keeps only `service`. |
| `includeStackInLog` | `true` | Include stack traces in serialized errors. |
| `destination` | stdout | Any Pino destination stream. |
| `pinoOptions` | `{}` | Raw Pino options. Your `serializers` and `hooks` are merged, not replaced. |

Logging never throws. Throwing getters, circular data and frozen errors are contained, including in child loggers and after `logger.level` changes.

## Production safety

When `NODE_ENV === "production"` (or `isProduction: true`):

| | Operational (4xx) | Non-operational (5xx, unknown) |
|---|---|---|
| `message` sent to client | Original message | `genericServerErrorMessage` |
| `details` sent to client | Sanitized details | `null` |
| Stack trace sent to client | Never | Never |
| Server log | `warn`, full error | `error`, full error with stack and cause |

Other safeguards:

- **Redaction.** `authorization`, `cookie`, `password`, `token`, `accessToken`, `refreshToken`, `secret`, `apiKey`, `creditCard` and common variants are redacted in logs, up to three levels deep. See `DEFAULT_REDACT_KEYS`.
- **Request IDs are validated.** Client-supplied IDs longer than 256 characters, or containing spaces, quotes, angle brackets or control characters (CRLF), are dropped. Numeric IDs, such as `pino-http`'s default `req.id`, become strings.
- **Query strings are not logged.** The Express handler logs the request path only, since query strings often carry tokens.
- **Never put secrets in `details`** of operational errors. Those details are sent to the client.

## Custom errors

Extend `AppError` for domain-specific errors:

```ts
import { AppError, type AppErrorOptions } from "faultkit";

export class PaymentDeclinedError extends AppError {
  constructor(details: { transactionId: string } | null = null, options?: AppErrorOptions) {
    super(
      "The payment was declined.",
      402,                // HTTP status
      "PAYMENT_DECLINED", // any string code
      details,
      true,               // operational: safe to show the client
      options,            // { cause }
    );
  }
}
```

`AppError` is abstract. Always throw a subclass.

## Handling errors on the client

Because the shape never changes, one interceptor covers the whole app:

```ts
api.interceptors.response.use(undefined, (axiosError) => {
  const error = axiosError.response?.data?.error;
  if (!error) {
    toast.error("Network error. Please try again.");
    return Promise.reject(axiosError);
  }

  toast.error(error.message);

  if (error.code === "VALIDATION_ERROR" && error.details) {
    for (const [field, messages] of Object.entries(error.details)) {
      form.setError(field, { message: (messages as string[])[0] });
    }
  }
  if (error.code === "UNAUTHORIZED" || error.code === "TOKEN_EXPIRED") {
    window.location.href = "/login";
  }

  return Promise.reject(error);
});
```

Show `error.requestId` to users as a support reference. Your team can then find the full error in the logs, for example with `{service="api"} |= "<requestId>"` in Grafana Loki.

## API reference

**`faultkit`**

| Export | Description |
|---|---|
| `AppError` | Abstract base class: `statusCode`, `errorCode`, `details`, `isOperational`, `cause`, `toJSON()`. |
| Error classes | See [Error classes](#error-classes). |
| `ErrorCode` | All standard error codes. |
| `toHttpResponse(err, options?)` | `{ statusCode, body, error }` for any framework. |
| `toErrorResponse(err, options?)` | The response body only. Alias: `formatError`. |
| `AppError.format(err, options?)` | Static form of `toErrorResponse`. Alias: `AppError.toResponse`. |
| `coerceToAppError(err, coercer?)` | Normalize any thrown value into an `AppError`. |
| `errorCodeFromStatus(status)` | Closest `ErrorCode` for an HTTP status. |
| `toErrorStatus(value)` | A valid 400 to 599 status, or `undefined`. |
| `sanitizeDetails(value)` | Make any value JSON-safe. |
| `normalizeRequestId(value)` | Validate an untrusted request ID. |
| `logger`, `createLogger(options?)` | Pino logger and factory. |
| `createAppErrorSerializer(includeStack?)` | The Pino `err` serializer used by the logger. |
| `DEFAULT_REDACT_KEYS` | Default redaction paths. |
| Types | `ErrorResponse`, `ErrorPayload`, `ErrorCodeValue`, `StandardErrorCode`, `ErrorCoercer`, `FormatErrorOptions`, `HttpErrorResponse`, `AppErrorOptions`, `Logger`, `LogLevel`, `FaultKitLoggerOptions`. |

**`faultkit/express`**: `createExpressErrorHandler`, `createNotFoundHandler`, `asyncHandler`, and the types `ErrorHandlerOptions`, `ErrorHandlerLogger`, `LoggerStyle`, `NotFoundHandlerOptions`.

**`faultkit/logger`**: `logger`, `createLogger`, `createAppErrorSerializer`, `DEFAULT_REDACT_KEYS` and logger types.

> `err.toJSON()` serializes an error without production masking. To respond to clients, use `toHttpResponse(err).body` or `toErrorResponse(err)`.

## TypeScript and module support

- Ships CommonJS (`require`) and ES module (`import`) builds with type declarations.
- Types resolve under `moduleResolution` set to `node`, `node16`, `nodenext` and `bundler`.
- The Express middleware lives in `faultkit/express`, so non-Express projects never load Express types.

## AI coding agents

faultkit ships an agent skill so coding agents (Claude Code, Cursor, GitHub Copilot, Antigravity) use the package correctly:

```bash
npx faultkit init                  # auto-detects your setup
npx faultkit init --target all     # agents, cursor, copilot, claude
npx faultkit init --dry-run        # preview without writing
```

Existing files are never overwritten without `--force`. In shared files such as `CLAUDE.md`, only the FaultKit block is added or updated. Run `npx faultkit --help` for all commands.

## Examples

| Example | Shows |
|---|---|
| [Express production server](./examples/01-express-production/server.ts) | Validation, conflicts, auth, request IDs, not-found handling, masking |
| [Structured logging and tracing](./examples/02-structured-logging-tracing/logging.ts) | Child loggers, trace IDs, redaction |
| [Custom domain errors](./examples/03-domain-custom-errors/customErrors.ts) | Extending `AppError` |
| [Fastify and Lambda](./examples/04-framework-agnostic/fastify-or-lambda.ts) | `toHttpResponse` outside Express |

## Contributing

Issues and pull requests are welcome. Read the [contributing guide](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md) first. To report a security issue, follow the [security policy](SECURITY.md).

```bash
npm ci
npm run typecheck
npm run build
npm test                  # unit, CLI, end-to-end and regression suites
npm run test:types        # typecheck TypeScript tests and examples
npm run test:adversarial  # hostile-input and fuzz suites
npm run test:stress       # load and concurrency suites
```

Release notes are in the [changelog](CHANGELOG.md) and on [GitHub Releases](https://github.com/Sahil-coder-30/faultkit/releases). The project follows semantic versioning: breaking changes to the response contract or class signatures bump the major version.

## License

[MIT](LICENSE) © Sahil Sharma
