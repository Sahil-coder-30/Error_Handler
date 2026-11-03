/**
 * @file src/sanitize.ts
 * @description Dependency-free helpers that turn untrusted values into data that is
 *              always safe to send over the wire or write to a log.
 *
 * Kept in its own module (with zero internal imports) so that `AppError`,
 * `format`, and `express` can all share it without circular imports.
 */

const MAX_DEPTH = 20;

/**
 * Converts any value into a JSON-safe structure.
 *
 * Guarantees:
 *  - Never throws (throwing getters, hostile proxies and broken `toJSON` methods are contained).
 *  - `BigInt` values become strings.
 *  - Real circular references become `"[Circular]"`. A shared object that appears
 *    twice (but is not its own ancestor) is serialized both times.
 *  - `Error` values become `{ name, message }` (never the stack).
 *  - `Map` becomes a plain object, `Set` becomes an array.
 *  - `Date` and other values with `toJSON` use their own JSON form.
 *  - Functions, symbols and `undefined` follow `JSON.stringify` rules
 *    (dropped from objects, `null` inside arrays).
 *  - Nesting deeper than 20 levels becomes `"[Max Depth Exceeded]"`.
 *
 * `null` or `undefined` at the top level returns `null`.
 */
export function sanitizeDetails(details: unknown): unknown {
  if (details === null || details === undefined) return null;
  try {
    const result = sanitizeValue(details, new Set<object>(), 0);
    return result === undefined ? null : result;
  } catch {
    return "[Unserializable Details]";
  }
}

function sanitizeValue(value: unknown, ancestors: Set<object>, depth: number): unknown {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
  }

  if (value === null) return null;
  const obj = value as object;

  if (ancestors.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Max Depth Exceeded]";

  ancestors.add(obj);
  try {
    // Errors: expose only the safe, human-readable parts.
    if (obj instanceof Error) {
      return {
        name: safeString(readProp(obj, "name"), "Error"),
        message: safeString(readProp(obj, "message"), ""),
      };
    }

    // Values that define their own JSON form (Date, Buffer, Decimal, ObjectId, ...).
    const toJSON = readProp(obj, "toJSON");
    if (typeof toJSON === "function") {
      let json: unknown;
      try {
        json = (toJSON as (key: string) => unknown).call(obj, "");
      } catch {
        return "[Unserializable]";
      }
      if (json === obj) return "[Unserializable]";
      return sanitizeValue(json, ancestors, depth + 1);
    }

    if (Array.isArray(obj)) {
      const out: unknown[] = [];
      for (let i = 0; i < obj.length; i++) {
        const item = sanitizeValue(readProp(obj, i), ancestors, depth + 1);
        out.push(item === undefined ? null : item);
      }
      return out;
    }

    if (obj instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of obj) {
        const item = sanitizeValue(v, ancestors, depth + 1);
        if (item !== undefined) out[safeString(k, "[key]")] = item;
      }
      return out;
    }

    if (obj instanceof Set) {
      const out: unknown[] = [];
      for (const v of obj) {
        const item = sanitizeValue(v, ancestors, depth + 1);
        out.push(item === undefined ? null : item);
      }
      return out;
    }

    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const item = sanitizeValue(readProp(obj, key), ancestors, depth + 1);
      if (item !== undefined) out[key] = item;
    }
    return out;
  } catch {
    return "[Unserializable]";
  } finally {
    ancestors.delete(obj);
  }
}

/** Reads a property without letting a throwing getter escape. */
function readProp(obj: object, key: PropertyKey): unknown {
  try {
    return (obj as Record<PropertyKey, unknown>)[key];
  } catch {
    return "[Unreadable]";
  }
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Request / Correlation IDs
// ─────────────────────────────────────────────────────────────────────────────

/** Longest request ID accepted. Longer values are rejected, not truncated. */
export const MAX_REQUEST_ID_LENGTH = 256;

/**
 * Characters allowed in a request ID. Covers UUID, ULID, nanoid, base64,
 * W3C `traceparent` and AWS `X-Amzn-Trace-Id` formats, while blocking
 * whitespace, quotes, angle brackets and control characters.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9\-_.:;,=+/@~#]+$/;

/**
 * Normalizes an untrusted request ID.
 *
 * - Strings are trimmed and must match a safe character set and length limit.
 * - Finite numbers (for example `pino-http`'s default numeric `req.id`) become strings.
 * - Anything else returns `undefined`.
 */
export function normalizeRequestId(value: unknown): string | undefined {
  let id: string;
  if (typeof value === "string") {
    id = value.trim();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    id = String(value);
  } else {
    return undefined;
  }
  if (id.length === 0 || id.length > MAX_REQUEST_ID_LENGTH) return undefined;
  if (!REQUEST_ID_PATTERN.test(id)) return undefined;
  return id;
}
