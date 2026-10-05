/**
 * @file examples/01-express-production/server.ts
 * @description Production-grade Express backend example using FaultGuard.
 * Demonstrates:
 *  - Centralized OpenAPI-compliant error middleware
 *  - Request ID tracing with Pino child loggers
 *  - Validation, domain errors, and unexpected crash handling
 *  - Automatic sensitive credential redaction
 *  - Production message masking
 */

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  logger,
} from "faultguard";
import { createExpressErrorHandler } from "faultguard/express";

// Extend Express Request type to include our correlated child logger
declare global {
  namespace Express {
    interface Request {
      log: typeof logger;
      id: string;
    }
  }
}

const app = express();

// 1. Parse JSON bodies (Malformed JSON automatically returns 400 BAD_REQUEST via FaultGuard)
app.use(express.json());

// 2. Request Tracing Middleware
// Generates or forwards a correlation ID and binds a child logger to req.log
app.use((req: Request, _res: Response, next: NextFunction) => {
  const reqId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  req.id = reqId;
  req.log = logger.child({
    requestId: reqId,
    method: req.method,
    path: req.originalUrl,
  });

  req.log.info("Incoming HTTP request");
  next();
});

// Mock database for demonstration
interface User {
  id: string;
  email: string;
  role: "user" | "admin";
}

const usersDb = new Map<string, User>([
  ["usr_1", { id: "usr_1", email: "alice@example.com", role: "admin" }],
]);

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/users/:id — Demonstrates NotFoundError
app.get("/api/users/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = usersDb.get(req.params.id);
    if (!user) {
      // 404 Not Found
      throw new NotFoundError(`User with ID '${req.params.id}' was not found.`);
    }

    req.log.info({ userId: user.id }, "User retrieved successfully");
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

// POST /api/users — Demonstrates ValidationError and ConflictError
app.post("/api/users", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body || {};

    // Input validation check
    const errors: Record<string, string[]> = {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      errors.email = ["A valid email address is required."];
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      errors.password = ["Password must be at least 8 characters long."];
    }

    if (Object.keys(errors).length > 0) {
      // CRITICAL: ValidationError takes (details, message?) — details is FIRST!
      throw new ValidationError(errors, "User registration payload failed validation.");
    }

    // Check for unique conflict
    const existing = Array.from(usersDb.values()).find((u) => u.email === email);
    if (existing) {
      // 409 Conflict
      throw new ConflictError(`Email '${email}' is already registered.`, { field: "email" });
    }

    const newUser: User = {
      id: `usr_${Date.now()}`,
      email,
      role: "user",
    };
    usersDb.set(newUser.id, newUser);

    // Notice: password is automatically redacted by FaultGuard logger if logged!
    req.log.info({ user: newUser, password }, "User created");

    res.status(201).json({ success: true, data: newUser });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/metrics — Demonstrates UnauthorizedError and ForbiddenError
app.get("/api/admin/metrics", (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      // 401 Unauthorized
      throw new UnauthorizedError("Authorization header is missing.");
    }

    if (authHeader !== "Bearer admin-secret-token") {
      // 403 Forbidden
      throw new ForbiddenError("Insufficient permissions to access administrative metrics.");
    }

    res.json({ success: true, metrics: { memoryUsage: process.memoryUsage() } });
  } catch (err) {
    next(err);
  }
});

// GET /api/crash — Demonstrates unexpected 500 exception handling
app.get("/api/crash", () => {
  // Unexpected runtime programmer bug
  throw new Error("Unhandled database connection timeout on pool socket #4");
});

// 404 Catch-All Route Handler
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(new NotFoundError(`Endpoint '${req.method} ${req.originalUrl}' does not exist.`));
});

// ── Global Error Handler (MUST BE LAST) ───────────────────────────────────────
// In production (NODE_ENV=production):
// - 4xx errors return their real message and details
// - 5xx errors return genericServerErrorMessage; internal message is logged safely
app.use(
  createExpressErrorHandler({
    genericServerErrorMessage: "An internal server error occurred. Our team has been notified.",
    includeStackInLog: process.env.NODE_ENV !== "production",
  })
);

export default app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "FaultGuard production example server listening");
  });
}
