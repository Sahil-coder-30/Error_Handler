# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] - 2026-11-12

### Changed

- Rewrote the README as a standard npm package README. No code changes.

## [1.2.0] - 2026-11-12

Bug-fix and hardening release. No breaking changes to the response contract.

### Fixed

- Coerced errors keep the original stack trace and `cause`.
- `instanceof AppError` works across duplicate package copies (CJS and ESM).
- An invalid `LOG_LEVEL` no longer crashes the app at import time.
- Logger crash safety survives `logger.level` changes. Custom serializers no longer drop the `AppError` serializer.
- Express: `logger: null` no longer crashes, Winston is detected, `includeStackInLog: false` really hides stacks, request IDs are validated, and a numeric `req.id` is used.
- `sanitizeDetails` no longer marks shared objects as `[Circular]`. `JSON.stringify(appError)` with BigInt details no longer throws.
- Types resolve under `moduleResolution: "node"`.

### Added

- Prisma, Zod, Joi and Mongoose `DocumentNotFoundError` coercion. More statuses mapped to `ErrorCode`.
- `toHttpResponse`, `createNotFoundHandler`, `asyncHandler`, `GatewayTimeoutError`, `BadGatewayError` and `MessageProcessingFailedError`.
- Every error class accepts `details` and `{ cause }`.

### Changed

- Dev mode Express responses now include 500 `details`. Production still hides them.
- Default log lines include `pid` and `hostname`.
- 413 maps to `PAYLOAD_TOO_LARGE` instead of `BAD_REQUEST`.

## [1.1.0] - 2026-10-06

### Added

- Mongoose coercion, distributed `requestId` support and non-HTTP formatters.
- First-class AI error classes and AI error codes.
- Logger and observability API reference.
- GitHub Actions CI and npm publish workflows.

## [1.0.1] - 2026-10-05

### Fixed

- Normalized `bin` paths in `package.json` for a clean npm publish.

## [1.0.0] - 2026-10-05

### Added

- First release: typed error classes, the OpenAPI-style JSON error contract, Express middleware, Pino structured logging, the `faultkit` CLI and agent skills.

[Unreleased]: https://github.com/Sahil-coder-30/faultkit/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/Sahil-coder-30/faultkit/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Sahil-coder-30/faultkit/releases/tag/v1.2.0
[1.1.0]: https://www.npmjs.com/package/faultkit/v/1.1.0
[1.0.1]: https://www.npmjs.com/package/faultkit/v/1.0.1
[1.0.0]: https://www.npmjs.com/package/faultkit/v/1.0.0
