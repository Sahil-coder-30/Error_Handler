/**
 * @file examples/04-framework-agnostic/fastify-or-lambda.ts
 * @description Using FaultKit with non-Express frameworks (Fastify, Hono, AWS Lambda).
 * Shows how core error classes and toJSON() work anywhere without Express dependencies.
 */

import {
  AppError,
  NotFoundError,
  ValidationError,
  type ErrorResponse,
} from "faultkit";

// ── Pattern 1: Fastify Error Handler ──────────────────────────────────────────
export function fastifyErrorHandler(error: unknown, _request: any, reply: any) {
  if (error instanceof AppError) {
    // AppError has built-in toJSON() producing OpenAPI { success: false, error: { ... } }
    reply.status(error.statusCode).send(error.toJSON());
    return;
  }

  // Fallback for native errors
  const fallback: ErrorResponse = {
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      details: null,
    },
  };
  reply.status(500).send(fallback);
}

// ── Pattern 2: AWS Lambda API Gateway Handler ─────────────────────────────────
export async function lambdaHandler(event: { pathParameters?: { id?: string } }) {
  try {
    const id = event.pathParameters?.id;
    if (!id) {
      throw new ValidationError({ id: ["Parameter 'id' is required"] });
    }

    if (id === "unknown") {
      throw new NotFoundError(`Entity '${id}' not found`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, data: { id } }),
    };
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
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal server error",
          details: null,
        },
      }),
    };
  }
}
