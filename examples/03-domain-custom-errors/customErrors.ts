/**
 * @file examples/03-domain-custom-errors/customErrors.ts
 * @description How to extend AppError to build domain-specific error hierarchies.
 */

import { AppError, type ErrorCodeValue } from "faultguard";

/**
 * 402 Payment Required / Payment Declined
 */
export class PaymentDeclinedError extends AppError {
  constructor(
    message = "Payment transaction was declined by the issuing bank.",
    details: { transactionId?: string; reasonCode?: string } | null = null
  ) {
    super(
      message,
      402, // HTTP 402 Payment Required
      "PAYMENT_DECLINED" as unknown as ErrorCodeValue,
      details,
      true // isOperational = true: expected business outcome
    );
  }
}

/**
 * 422 Insufficient Balance
 */
export class InsufficientBalanceError extends AppError {
  constructor(
    available: number,
    required: number,
    currency = "USD"
  ) {
    super(
      `Insufficient account balance. Available: ${available} ${currency}, required: ${required} ${currency}.`,
      422,
      "INSUFFICIENT_FUNDS" as unknown as ErrorCodeValue,
      { available, required, currency },
      true
    );
  }
}

// Usage demonstration
try {
  throw new InsufficientBalanceError(25.0, 100.0, "EUR");
} catch (err) {
  if (err instanceof AppError) {
    console.log("Status Code:", err.statusCode);
    console.log("Error Code:", err.errorCode);
    console.log("OpenAPI JSON:", JSON.stringify(err.toJSON(), null, 2));
  }
}
