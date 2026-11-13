# Contributing to faultkit

Thanks for helping. Bug reports, fixes, docs and new framework examples are all welcome.

## Ground rules

- Be kind. This project follows the [code of conduct](CODE_OF_CONDUCT.md).
- Report security issues privately. See the [security policy](SECURITY.md). Do not open a public issue.
- For a large change, open an issue first so we can agree on the approach before you write code.

## Setup

You need Node.js 22 or newer (CI runs 22, 24 and 26).

```bash
git clone https://github.com/Sahil-coder-30/faultkit.git
cd faultkit
npm ci
```

## Checks

Run these before you open a pull request. CI runs the same steps.

```bash
npm run typecheck         # TypeScript, no emit
npm run build             # CJS, ESM and type declarations
npm run test:types        # typecheck tests and examples
npm test                  # unit, CLI, end-to-end and regression suites
npm run test:adversarial  # hostile-input and fuzz suites
```

`npm run test:stress` runs the load suites. Run it when you touch the logger or the Express handler.

## Project layout

| Path | What lives there |
|---|---|
| `src/` | Library source (error classes, coercion, formatting, logger, Express handler) |
| `bin/` | The `faultkit` and `faultguard` CLIs |
| `tests/` | Unit, CLI, end-to-end, regression, adversarial and stress suites |
| `examples/` | Runnable integration examples, typechecked in CI |
| `skills/` | Agent skills shipped with the package |

## Making a change

1. Fork the repo and create a branch from `main`.
2. Make the change. Add or update a test that fails without it.
3. Update the README if public behavior changes.
4. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
5. Open a pull request and fill in the template.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
fix: keep the original stack when coercing Prisma errors
feat: add a Hono adapter example
docs: explain the 413 mapping
```

## Compatibility

The JSON error contract `{ success: false, error: { code, message, details } }` is public API. Any change that alters it, removes an export, or changes a class signature is a breaking change and needs a major version.

## Releases

Maintainers release by bumping the version in `package.json`, moving the `Unreleased` notes into a new version section in the changelog, and publishing a GitHub Release. The publish workflow then ships the package to npm.
