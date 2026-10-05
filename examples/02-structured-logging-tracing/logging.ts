/**
 * @file examples/02-structured-logging-tracing/logging.ts
 * @description Advanced structured logging, Grafana Loki output, and child loggers.
 */

import {
  createLogger,
  logger,
  ValidationError,
  InternalServerError,
} from "faultkit";

// 1. Create a customized microservice logger
export const paymentLogger = createLogger({
  service: "payment-service",
  level: "debug",
  // Additional sensitive fields specific to this service
  redact: ["req.headers.authorization", "password", "token", "creditCard", "cvv"],
});

// 2. Child logger with distributed trace correlation
const traceLogger = paymentLogger.child({
  traceId: "trace-98471-abc",
  spanId: "span-0012",
  merchantId: "merch_5521",
});

traceLogger.info("Initiating payment capture flow");

// 3. Serializing an AppError
// Note: Pass `{ err }` as the first argument so FaultKit's Pino serializer
// extracts statusCode, errorCode, isOperational, and details automatically.
const validationError = new ValidationError(
  { amount: ["Amount must be greater than 0"] },
  "Invalid payment capture request"
);

traceLogger.warn({ err: validationError }, "Payment validation failed");

// 4. Serializing an unexpected 500 error
const crashError = new InternalServerError("Payment gateway connection reset by peer");
traceLogger.error({ err: crashError }, "Critical payment failure");

// 5. Automatic redaction demonstration
traceLogger.info(
  {
    customer: "John Doe",
    creditCard: "4111-2222-3333-4444", // Will be output as "[REDACTED]"
    cvv: "123",                         // Will be output as "[REDACTED]"
    amount: 99.5,
  },
  "Transaction submitted"
);
