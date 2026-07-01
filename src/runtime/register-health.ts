import type { App } from "fresh";
import type { PageCache } from "../cache/mod.ts";
import type { BootstrapResult } from "./bootstrap.ts";

export interface HealthRouteOptions {
  config: BootstrapResult["config"];
  engine: BootstrapResult["engine"];
  pageCache: PageCache | null;
  startTime: number;
}

/** Register /health, /health/live, /health/ready. Returns setShuttingDown for graceful drain. */
export function registerHealthRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  opts: HealthRouteOptions,
): { setShuttingDown: (value: boolean) => void } {
  const { config, engine, pageCache, startTime } = opts;
  let shuttingDown = false;

  // Constant-time comparison prevents timing-side-channel probing of /health?token=.
  // Refs: claudedocs/security-audit-2026-05.md LOW-3 (CWE-200).
  function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  app.get("/health", (fc) => {
    const detailed = fc.url.searchParams.get("detailed") === "true";
    const token = fc.url.searchParams.get("token");
    const configured = config.system?.health_token;
    const tokenOk =
      typeof configured === "string" &&
      configured.length > 0 &&
      typeof token === "string" &&
      token.length === configured.length &&
      timingSafeEqual(token, configured);

    if (detailed && tokenOk) {
      return Response.json({
        status: "ok",
        uptime: Math.floor((Date.now() - startTime) / 1000),
        pages: engine.pages.length,
        cache: pageCache ? pageCache.stats() : null,
      }, { headers: { "Cache-Control": "no-cache" } });
    }
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-cache" } });
  });

  app.get("/health/live", () =>
    Response.json({ status: "alive" }, { headers: { "Cache-Control": "no-cache" } })
  );

  app.get("/health/ready", () => {
    if (shuttingDown) {
      return Response.json(
        { status: "shutting_down" },
        { status: 503, headers: { "Cache-Control": "no-cache" } },
      );
    }
    const ready = Array.isArray(engine.pages);
    return Response.json(
      { status: ready ? "ready" : "not_ready", pages: engine.pages.length },
      { status: ready ? 200 : 503, headers: { "Cache-Control": "no-cache" } },
    );
  });

  return { setShuttingDown: (v: boolean) => { shuttingDown = v; } };
}
