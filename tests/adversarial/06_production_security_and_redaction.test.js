/**
 * @file tests/adversarial/06_production_security_and_redaction.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERSARIAL SUITE 6: PRODUCTION SECURITY & SENSITIVE DATA REDACTION
 * ─────────────────────────────────────────────────────────────────────────────
 * Attacks production masking and logger redaction boundaries:
 * 1. Secrets in 5xx native and custom errors (stack traces, DB strings, API keys)
 * 2. Secrets in logger output (authorization, cookie, token, password, apiKey)
 * 3. Case variations in sensitive keys:
 *    - password vs PASSWORD vs Password
 *    - authorization vs Authorization
 *    - apiKey vs api_key
 *    - token vs accessToken vs refreshToken
 * 4. Database internals leaking (MongoDB URI, AWS keys, SQL queries)
 */

"use strict";

const { Writable } = require("node:stream");
const http = require("node:http");
const express = require("express");
const {
  InternalServerError,
  BadRequestError,
  createLogger,
  toErrorResponse,
} = require("../../dist/cjs/index.js");
const { createExpressErrorHandler } = require("../../dist/cjs/express.js");

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, context = "") {
  if (condition) {
    console.log(`  ✅  ${testName}`);
    passed++;
  } else {
    console.error(`  ❌  FAILED: ${testName}${context ? `\n      Context: ${context}` : ""}`);
    failed++;
    failures.push({ testName, context });
  }
}

function captureLogStream() {
  const logs = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      try {
        logs.push(JSON.parse(chunk.toString()));
      } catch {
        logs.push(chunk.toString());
      }
      callback();
    },
  });
  return { stream, logs };
}

async function request(app, path) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
            } catch {
              resolve({ status: res.statusCode, body: raw, raw });
            }
          });
        })
        .on("error", reject);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function run() {
  console.log("\n🔥 [ADVERSARIAL SUITE 6] Production Security & Sensitive Data Redaction");
  console.log("─────────────────────────────────────────────────────────────");

  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    // ── 1. Production HTTP Response Masking (5xx) ───────────────────────────
    console.log("\n📋 [1] Production HTTP Response Masking of Secrets in 5xx");
    {
      const app = express();
      const silentLogger = { warn: () => {}, error: () => {} };

      const secrets = [
        "mongodb+srv://admin:P@ssw0rd123@cluster.mongodb.net/prod?retryWrites=true",
        "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        "sk-proj-999999999999999999999999999999999999999999999999",
        "/Users/superadmin/workspace/secret_config.json",
        "SELECT * FROM users WHERE password_hash = '$2b$12$e8...'",
      ];

      secrets.forEach((secret, idx) => {
        app.get(`/leak-${idx}`, () => {
          throw new Error(`Database connection failed: ${secret}`);
        });
      });

      app.use(createExpressErrorHandler({ logger: silentLogger }));

      for (let idx = 0; idx < secrets.length; idx++) {
        const secret = secrets[idx];
        const res = await request(app, `/leak-${idx}`);
        assert(res.status === 500, `Route /leak-${idx} returns HTTP 500`);
        assert(!res.raw.includes(secret), `Production response MUST NOT contain secret '${secret.slice(0, 15)}...'`);
        assert(res.body.error.details === null, `Production 5xx details is strictly null`);
        assert(!res.raw.includes("stack"), `Production response MUST NOT contain stack trace`);
      }
    }

    // ── 2. Logger Redaction of Standard Sensitive Fields ────────────────────
    console.log("\n📋 [2] Logger Redaction of Standard Sensitive Keys");
    {
      const { stream, logs } = captureLogStream();
      const testLogger = createLogger({ destination: stream });

      testLogger.info({
        password: "SuperSecretPassword123",
        token: "jwt_ey123456789",
        apiKey: "api_key_secret_value",
        secret: "app_encryption_secret",
        creditCard: "4532-1234-5678-9012",
      }, "User session context");

      assert(logs.length === 1, "Log written");
      const entry = logs[0];
      assert(entry.password === "[REDACTED]", "password is redacted");
      assert(entry.token === "[REDACTED]", "token is redacted");
      assert(entry.apiKey === "[REDACTED]", "apiKey is redacted");
      assert(entry.secret === "[REDACTED]", "secret is redacted");
      assert(entry.creditCard === "[REDACTED]", "creditCard is redacted");
    }

    // ── 3. Logger Redaction Case Variations & Missing Keys (BUG / RISK) ─────
    console.log("\n📋 [3] Logger Redaction of Key Variations (api_key, accessToken, Password, Authorization)");
    {
      const { stream, logs } = captureLogStream();
      const testLogger = createLogger({ destination: stream });

      testLogger.info({
        api_key: "snake_case_secret_key",
        accessToken: "access_token_secret_value",
        refreshToken: "refresh_token_secret_value",
        Password: "CapitalizedPassword123",
        PASSWORD: "ALL_CAPS_PASSWORD_123",
        Authorization: "Bearer sensitive_bearer_token",
      }, "Varied case credentials payload");

      assert(logs.length === 1, "Log written for case variations");
      const entry = logs[0];

      // Test whether standard variations are protected
      assert(
        entry.api_key === "[REDACTED]",
        "api_key (snake_case) SHOULD be redacted by default logger",
        `Actual value logged: "${entry.api_key}"`
      );

      assert(
        entry.accessToken === "[REDACTED]",
        "accessToken SHOULD be redacted by default logger",
        `Actual value logged: "${entry.accessToken}"`
      );

      assert(
        entry.refreshToken === "[REDACTED]",
        "refreshToken SHOULD be redacted by default logger",
        `Actual value logged: "${entry.refreshToken}"`
      );

      assert(
        entry.Password === "[REDACTED]" || entry.PASSWORD === "[REDACTED]",
        "Case variations of Password/PASSWORD SHOULD be redacted by default logger",
        `Actual Password: "${entry.Password}", PASSWORD: "${entry.PASSWORD}"`
      );

      assert(
        entry.Authorization === "[REDACTED]",
        "Authorization header (Capital A) SHOULD be redacted by default logger",
        `Actual Authorization: "${entry.Authorization}"`
      );
    }
  } finally {
    process.env.NODE_ENV = origEnv;
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`📊 Suite 6 Results: ${passed} passed, ${failed} failed`);
  console.log("─────────────────────────────────────────────────────────────\n");

  return { passed, failed, failures };
}

if (require.main === module) {
  run().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}

module.exports = { run };
