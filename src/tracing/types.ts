/**
 * Distributed tracing type definitions for Dune CMS.
 *
 * Intentionally minimal — no npm/@opentelemetry dependencies.
 * The Tracer interface is compatible with the OTel API shape so
 * callers can be migrated to a full SDK later without API changes.
 */

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: "ok" | "error", message?: string): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span;
  startActiveSpan<T>(
    name: string,
    fnOrAttrs: ((span: Span) => T | Promise<T>) | Record<string, string | number | boolean>,
    maybeFn?: (span: Span) => T | Promise<T>,
  ): T | Promise<T>;
  /** Current trace ID (hex string) or null if no active trace. */
  currentTraceId(): string | null;
}

export interface TracingConfig {
  enabled: boolean;
  /** OTLP HTTP endpoint, e.g. http://localhost:4318/v1/traces */
  endpoint?: string;
  /** Service name for the resource attribute. Defaults to "dune". */
  serviceName?: string;
}
