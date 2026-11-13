# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.2.x | Yes |
| < 1.2 | No |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through [GitHub private vulnerability reporting](https://github.com/Sahil-coder-30/faultkit/security/advisories/new).

Include:

- The affected version.
- Steps or a small code sample that reproduces the issue.
- The impact you expect (for example, a stack trace or secret leaking into a response or a log).

## What to expect

- An acknowledgement within 3 working days.
- A fix or a mitigation plan within 14 days for confirmed issues.
- Credit in the release notes, unless you prefer to stay anonymous.

## Scope

In scope: anything that makes faultkit leak internal details to clients, fail to redact secrets in logs, crash on hostile input, or run code it should not.

Out of scope: issues in your own application code or in third-party dependencies that do not affect faultkit's behavior.
