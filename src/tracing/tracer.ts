/**
 * Lightweight OTel-compatible tracer implementation for Dune CMS.
 *
 * Zero external dependencies. Two modes:
 *   - no-op: when config.enabled is false (all methods are safe no-ops)
 *   - active: generates real traceId/spanId, logs spans at debug level,
 *     and optionally exports to an OTLP/HTTP collector (fire-and-forget).
 */

import { logger } from "../core/logger.ts";
import type { Span, Tracer, TracingConfig } from "./types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a cryptographically-random hex string of `byteCount` bytes. */
function randomHex(byteCount: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Convert a millisecond timestamp to a nanosecond string (OTLP uses nanoseconds). */
function msToNs(ms: number): string {
  return String(ms * 1_000_000);
}

// ── No-op implementation ──────────────────────────────────────────────────────

const NO_OP_SPAN: Span = {
  setAttribute(_key, _value) {},
  setStatus(_status, _message) {},
  end() {},
};

const NO_OP_TRACER: Tracer = {
  startSpan(_name, _attributes) {
    return NO_OP_SPAN;
  },
  startActiveSpan<T>(
    _name: string,
    fnOrAttrs: ((span: Span) => T | Promise<T>) | Record<string, string | number | boolean>,
    maybeFn?: (span: Span) => T | Promise<T>,
  ): T | Promise<T> {
    const fn = typeof fnOrAttrs === "function" ? fnOrAttrs : maybeFn!;
    return fn(NO_OP_SPAN);
  },
  currentTraceId() {
    return null;
  },
};

// ── Active implementation ─────────────────────────────────────────────────────

interface SpanData {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  status: { code: "ok" | "error"; message?: string };
}

/**
 * Build the OTLP/HTTP JSON body for a single completed span.
 */
function buildOtlpPayload(span: SpanData, serviceName: string): string {
  const attrs = Object.entries(span.attributes).map(([key, value]) => ({
    key,
    value: typeof value === "string"
      ? { stringValue: value }
      : typeof value === "number"
      ? { doubleValue: value }
      : { boolValue: value },
  }));

  const statusCode = span.status.code === "ok" ? 1 : 2;
  const statusPayload: Record<string, unknown> = { code: statusCode };
  if (span.status.message !== undefined) {
    statusPayload.message = span.status.message;
  }

  return JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: span.traceId,
                spanId: span.spanId,
                name: span.name,
                startTimeUnixNano: msToNs(span.startTime),
                endTimeUnixNano: msToNs(span.endTime ?? span.startTime),
                status: statusPayload,
                attributes: attrs,
              },
            ],
          },
        ],
      },
    ],
  });
}

/**
 * Fire-and-forget OTLP export — errors are silently swallowed to avoid
 * crashing the application when the collector is unavailable.
 */
function exportSpan(span: SpanData, endpoint: string, serviceName: string): void {
  const body = buildOtlpPayload(span, serviceName);
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    // Intentionally swallowed — tracing must not affect application reliability
  });
}

function createActiveTracer(config: TracingConfig): Tracer {
  const endpoint = config.endpoint;
  const serviceName = config.serviceName ?? "dune";

  // ⚠️  KNOWN LIMITATION — not request-scoped.
  //
  // `currentTraceId` is a closure-scoped variable, not an AsyncLocalStorage
  // value. Under concurrent requests each new span assignment overwrites the
  // previous value, so `currentTraceId()` returns the ID of whichever span
  // started most recently across ALL in-flight requests, not the one
  // associated with the current request.
  //
  // Consequence: log correlation via `currentTraceId()` is best-effort only.
  // It works reliably in development (where requests are typically sequential)
  // but will be inaccurate in production under load.
  //
  // To fix properly: replace `currentTraceId` with an AsyncLocalStorage<string>
  // and run each span callback inside `als.run(spanData.traceId, fn)`.
  // This is intentionally deferred — it requires a larger refactor and the
  // current behaviour is safe (no security impact, only observability accuracy).
  let currentTraceId: string | null = null;

  function createSpanObject(name: string, attrs: Record<string, string | number | boolean>): SpanData {
    return {
      traceId: randomHex(16),
      spanId: randomHex(8),
      name,
      startTime: Date.now(),
      attributes: { ...attrs },
      status: { code: "ok" },
    };
  }

  function buildSpan(spanData: SpanData): Span {
    return {
      setAttribute(key, value) {
        spanData.attributes[key] = value;
      },
      setStatus(status, message) {
        spanData.status = { code: status, message };
      },
      end() {
        spanData.endTime = Date.now();
        const durationMs = spanData.endTime - spanData.startTime;

        // Always emit a debug log for observability even without an OTLP endpoint
        logger.debug("trace.span", {
          traceId: spanData.traceId,
          spanId: spanData.spanId,
          name: spanData.name,
          durationMs,
          ...spanData.attributes,
        });

        // Export to OTLP when an endpoint is configured (fire-and-forget)
        if (endpoint) {
          exportSpan(spanData, endpoint, serviceName);
        }
      },
    };
  }

  return {
    startSpan(name, attributes = {}) {
      const spanData = createSpanObject(name, attributes);
      currentTraceId = spanData.traceId;
      return buildSpan(spanData);
    },

    startActiveSpan<T>(
      name: string,
      fnOrAttrs: ((span: Span) => T | Promise<T>) | Record<string, string | number | boolean>,
      maybeFn?: (span: Span) => T | Promise<T>,
    ): T | Promise<T> {
      const fn = typeof fnOrAttrs === "function" ? fnOrAttrs : maybeFn!;
      const attrs = typeof fnOrAttrs === "function" ? {} : fnOrAttrs;
      const spanData = createSpanObject(name, attrs);
      currentTraceId = spanData.traceId;
      const span = buildSpan(spanData);

      let result: T | Promise<T>;
      try {
        result = fn(span);
      } catch (err) {
        span.setStatus("error", err instanceof Error ? err.message : String(err));
        span.end();
        throw err;
      }

      // Handle both sync and async fn
      if (result instanceof Promise) {
        return result.then(
          (val) => {
            span.end();
            return val;
          },
          (err: unknown) => {
            span.setStatus("error", err instanceof Error ? err.message : String(err));
            span.end();
            throw err;
          },
        ) as T | Promise<T>;
      }

      span.end();
      return result;
    },

    currentTraceId() {
      return currentTraceId;
    },
  };
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Create a Tracer from config.
 * Returns a no-op tracer when tracing is disabled (zero overhead).
 */
export function createTracer(config: TracingConfig): Tracer {
  if (!config.enabled) {
    return NO_OP_TRACER;
  }
  return createActiveTracer(config);
}
