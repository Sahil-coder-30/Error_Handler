/**
 * @file tests/e2e/server.js
 * @description Shared Express test server used by all E2E tests.
 *
 * This file intentionally uses CommonJS (.js) so it can be required directly
 * by Node without any build step. It imports from the compiled dist/cjs output
 * — exactly how a real consuming project would use this package.
 *
 * Routes map:
 *   GET  /users/:id        → throws NotFoundError  (operational, 404)
 *   POST /users            → throws ValidationError (operational, 400)
 *   POST /login            → throws UnauthorizedError / TokenExpiredError
 *   GET  /admin            → throws ForbiddenError  (operational, 403)
 *   POST /register         → throws ConflictError   (operational, 409)
 *   GET  /crash            → throws a native Error  (non-operational, 500)
 *   GET  /unknown-throw    → throws a plain string  (non-operational, 500)
 *   GET  /rate-limited     → throws RateLimitError  (operational, 429)
 *   GET  /healthy          → returns 200 OK (sanity check)
 */

"use strict";

const express = require("express");
const {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  TokenExpiredError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  InternalServerError,
} = require("../../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../../dist/cjs/express.js");

function createTestServer(loggerOverride) {
  const app = express();
  app.use(express.json());

  // ── Healthy ──────────────────────────────────────────────────────────────────
  app.get("/healthy", (_req, res) => {
    res.status(200).json({ success: true, message: "OK" });
  });

  // ── 404 Not Found ─────────────────────────────────────────────────────────────
  app.get("/users/:id", (req, _res, next) => {
    // Simulate a DB lookup miss
    if (req.params.id === "999") {
      return next(new NotFoundError(`User with ID ${req.params.id} was not found.`));
    }
    _res.json({ success: true, data: { id: req.params.id, name: "Alice" } });
  });

  // ── 400 Validation Error ──────────────────────────────────────────────────────
  app.post("/users", (req, _res, next) => {
    const errors = {};
    if (!req.body.email) errors.email = ["Email is required."];
    if (!req.body.name) errors.name = ["Name is required."];
    if (Object.keys(errors).length > 0) {
      return next(new ValidationError(errors));
    }
    _res.status(201).json({ success: true, data: req.body });
  });

  // ── 401 Unauthorized / Token Expired ─────────────────────────────────────────
  app.post("/login", (req, _res, next) => {
    const { scenario } = req.body;
    if (scenario === "no-credentials") return next(new UnauthorizedError());
    if (scenario === "expired-token") return next(new TokenExpiredError());
    _res.json({ success: true, token: "mock-jwt-token" });
  });

  // ── 403 Forbidden ─────────────────────────────────────────────────────────────
  app.get("/admin", (_req, _res, next) => {
    next(new ForbiddenError("Admin access requires elevated privileges."));
  });

  // ── 409 Conflict ─────────────────────────────────────────────────────────────
  app.post("/register", (req, _res, next) => {
    // Simulate email already exists
    next(new ConflictError(`Email '${req.body.email}' is already registered.`, {
      field: "email",
    }));
  });

  // ── 429 Rate Limit ────────────────────────────────────────────────────────────
  app.get("/rate-limited", (_req, _res, next) => {
    next(new RateLimitError());
  });

  // ── 500 Native Error (non-operational) ───────────────────────────────────────
  app.get("/crash", (_req, _res, next) => {
    // Simulates an unexpected DB driver / infra crash
    next(new Error("ECONNREFUSED: Redis connection refused at 127.0.0.1:6379"));
  });

  // ── 500 Unknown throw (non-operational) ──────────────────────────────────────
  app.get("/unknown-throw", (_req, _res, next) => {
    // Worst case: someone throws a non-Error value
    next("FATAL: memory corruption detected");
  });

  // ── 500 via InternalServerError class ────────────────────────────────────────
  app.get("/internal", (_req, _res, next) => {
    next(new InternalServerError("Payment gateway unreachable."));
  });

  // ── Global Error Handler (MUST be last) ──────────────────────────────────────
  const logger = loggerOverride ?? {
    warn: () => {},   // silence during tests
    error: () => {},
  };
  app.use(createExpressErrorHandler({ logger }));

  return app;
}

module.exports = { createTestServer };
