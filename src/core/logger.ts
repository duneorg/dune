/**
 * Structured logging for Dune CMS.
 *
 * Two backends:
 *   - "text"  human-readable, colored (default in dev)
 *   - "json"  NDJSON one-object-per-line (default in prod / Deno Deploy)
 *
 * Level ordering (lowest → highest): debug < info < warn < error
 * Lines below the configured minimum level are suppressed.
 *
 * Usage:
 *   import { logger } from "./logger.ts";
 *   logger.info("page.built", { route: "/blog/hello", durationMs: 12 });
 *
 *   // Child logger with bound fields (e.g. per-request correlation):
 *   const reqLog = logger.child({ requestId: generateRequestId() });
 *   reqLog.warn("auth.failed", { username: "alice" });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ANSI color codes used in text format
const COLOR: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m",  // green
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

// ── Logger interface ──────────────────────────────────────────────────────────

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Return a child logger with additional bound fields (e.g. requestId). */
  child(fields: Record<string, unknown>): Logger;
}

// ── Internal options ──────────────────────────────────────────────────────────

export interface LoggerOptions {
  format?: "text" | "json";
  level?: LogLevel;
  /** Default fields bound to every log line. */
  fields?: Record<string, unknown>;
  /**
   * Custom write function — called with the fully-formatted line (no trailing
   * newline is added). Primarily used in tests to capture output without
   * mocking global console methods.
   *
   * Defaults to writing to stderr for JSON format and stderr for text format
   * (diagnostic logs should not pollute stdout).
   */
  write?: (line: string) => void;
}

// ── Implementation ────────────────────────────────────────────────────────────

function makeLogger(opts: LoggerOptions, boundFields: Record<string, unknown>): Logger {
  const format = opts.format ?? "text";
  const minLevel = opts.level ?? "info";
  const minOrd = LEVEL_ORDER[minLevel];
  const write = opts.write ?? ((line: string) => console.error(line));

  function emit(level: LogLevel, event: string, extraFields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < minOrd) return;

    const fields: Record<string, unknown> = { ...boundFields, ...opts.fields, ...extraFields };

    if (format === "json") {
      const obj: Record<string, unknown> = {
        level,
        event,
        ts: new Date().toISOString(),
        ...fields,
      };
      write(JSON.stringify(obj));
    } else {
      // Text format: [LEVEL]  event.name    key=value ...
      const tag = `[${level.toUpperCase()}]`.padEnd(7);
      const eventPad = event.padEnd(12);
      const pairs = Object.entries(fields)
        .map(([k, v]) => {
          const str = typeof v === "string" ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`;
          return str;
        })
        .join(" ");
      const colored = `${COLOR[level]}${tag}${RESET} ${DIM}${eventPad}${RESET}${pairs ? "  " + pairs : ""}`;
      write(colored);
    }
  }

  const log: Logger = {
    debug: (event, fields) => emit("debug", event, fields),
    info:  (event, fields) => emit("info",  event, fields),
    warn:  (event, fields) => emit("warn",  event, fields),
    error: (event, fields) => emit("error", event, fields),

    child(childFields: Record<string, unknown>): Logger {
      return makeLogger(opts, { ...boundFields, ...childFields });
    },
  };

  return log;
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Create a logger.
 *
 * @param opts.format  "text" (default) | "json"
 * @param opts.level   Minimum level to emit. Default: "info"
 * @param opts.fields  Fields bound to every log line
 * @param opts.write   Custom sink for capturing output in tests
 */
export function createLogger(opts?: LoggerOptions): Logger {
  return makeLogger(opts ?? {}, {});
}

// ── Auto-configuration ────────────────────────────────────────────────────────

/**
 * Create a logger auto-configured from environment:
 *   DUNE_LOG_FORMAT=json  → JSON backend
 *                           (default when DENO_DEPLOYMENT_ID is set — Deno Deploy)
 *   DUNE_LOG_LEVEL=...    → minimum level (default "info")
 */
export function createDefaultLogger(fields?: Record<string, unknown>): Logger {
  let format: "text" | "json" = "text";
  const envFormat = Deno.env.get("DUNE_LOG_FORMAT");
  if (envFormat === "json") {
    format = "json";
  } else if (Deno.env.get("DENO_DEPLOYMENT_ID")) {
    // Deno Deploy production environment
    format = "json";
  }

  const envLevel = Deno.env.get("DUNE_LOG_LEVEL") as LogLevel | undefined;
  const level: LogLevel =
    envLevel && envLevel in LEVEL_ORDER ? envLevel : "info";

  return createLogger({ format, level, fields });
}

// ── Global singleton ──────────────────────────────────────────────────────────

/** Process-global logger. Replace with createLogger() for isolated tests. */
export let logger: Logger = createDefaultLogger();

/** Initialize the global logger (call once at startup). */
export function initLogger(opts?: { format?: "text" | "json"; level?: LogLevel }): void {
  // Resolve format: config value > DUNE_LOG_FORMAT env > Deno Deploy detection > "text"
  let format: "text" | "json" | undefined = opts?.format;
  if (!format) {
    const envFormat = Deno.env.get("DUNE_LOG_FORMAT");
    if (envFormat === "json") format = "json";
    else if (Deno.env.get("DENO_DEPLOYMENT_ID")) format = "json";
    else format = "text";
  }

  // Resolve level: config value > DUNE_LOG_LEVEL env > "info"
  let level: LogLevel | undefined = opts?.level;
  if (!level) {
    const envLevel = Deno.env.get("DUNE_LOG_LEVEL") as LogLevel | undefined;
    level = envLevel && envLevel in LEVEL_ORDER ? envLevel : "info";
  }

  logger = createLogger({ format, level });
}

// ── Request correlation helper ────────────────────────────────────────────────

/**
 * Generate a short random request ID (8 hex chars) for correlation.
 *
 * @example
 *   const reqLog = logger.child({ requestId: generateRequestId() });
 */
export function generateRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
