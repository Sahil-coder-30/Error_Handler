/**
 * @file examples/04-framework-agnostic/fastify-or-lambda.ts
 * @description Using FaultKit with non-Express frameworks (Fastify, Hono, AWS Lambda).
 * Shows how toHttpResponse() gives the same status + OpenAPI body anywhere,
 * with production masking, without Express dependencies.
 */

import { NotFoundError, ValidationError, toHttpResponse, logger } from "faultkit";

// ── Pattern 1: Fastify Error Handler ──────────────────────────────────────────
export function fastifyErrorHandler(error: unknown, request: any, reply: any) {
  // Handles AppError, native errors, Mongoose, Prisma, Zod and unknown throws.
  // Non-operational messages are masked when NODE_ENV=production.
  const { statusCode, body, error: appError } = toHttpResponse(error, { requestId: request.id });

  if (statusCode >= 500) logger.error({ err: appError, requestId: request.id }, "Request failed");
  else logger.warn({ err: appError, requestId: request.id }, "Request rejected");

  reply.status(statusCode).send(body);
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
    const { statusCode, body } = toHttpResponse(err);
    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }
}
