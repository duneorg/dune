/**
 * Distributed tracing module for Dune CMS.
 *
 * Usage:
 *   import { tracer } from "../tracing/mod.ts";
 *   await tracer.startActiveSpan("my.operation", async (span) => {
 *     span.setAttribute("key", "value");
 *     // ... do work ...
 *   });
 *
 * The global `tracer` is a no-op until `initTracer()` is called at bootstrap.
 */

export { createTracer } from "./tracer.ts";
export type { Span, Tracer, TracingConfig } from "./types.ts";

import { createTracer } from "./tracer.ts";
import type { Tracer, TracingConfig } from "./types.ts";

/** Process-global tracer singleton. No-op by default until initTracer() is called. */
export let tracer: Tracer = createTracer({ enabled: false });

/**
 * Initialize the global tracer (call once at startup, typically in bootstrap).
 * Replaces the default no-op tracer with an active or configured tracer.
 */
export function initTracer(config: TracingConfig): void {
  tracer = createTracer(config);
}
