/**
 * dune serve — Production server (no file watching).
 *
 * Fresh owns the server and request lifecycle. Dune's content routing, admin
 * panel, plugin hooks, and static file serving are registered as Fresh routes
 * and middleware via createDuneApp(). Island bundles are built once at startup
 * with the Fresh Builder and attached to the same app instance.
 *
 * Multi-site mode delegates to MultisiteManager when config/sites.yaml is
 * present at the installation root.
 *
 * Graceful shutdown:
 *   - SIGTERM / SIGINT stop accepting new connections via AbortController.
 *   - The /health/ready probe returns 503 immediately so load balancers drain
 *     traffic before the process exits.
 *   - The server waits for existing connections to close (Deno.serve semantics).
 *   - A 30-second safety-net poll ensures we exit even if Deno holds connections
 *     open longer than expected (e.g. keep-alive sockets).
 *   - The drain deadline can be tuned via DUNE_SHUTDOWN_TIMEOUT_MS env var.
 */

import { join, resolve } from "@std/path";
import { Builder } from "jsr:@fresh/core@^2/dev";
import { logger } from "../core/logger.ts";
import { bootstrap } from "./bootstrap.ts";
import { createDuneApp } from "./fresh-app.ts";
import { collectThemeIslands, collectContentIslands } from "../themes/loader.ts";
import { isValidPluginIslandSpecifier } from "../plugins/loader.ts";
import { getDuneAdminIslands } from "../admin/mount.ts";
import { materializeRemoteIslands } from "./remote-islands.ts";
import { scanJobs, JobScheduler, warnIfMultiprocess } from "../jobs/mod.ts";
import { createEmailClient, createEmailProvider } from "../email/mod.ts";
import { checkLockfileStaleness } from "./lockfile.ts";

export interface ServeOptions {
  port?: number;
  debug?: boolean;
  /**
   * When true, treat a stale lockfile as a hard error (exit 1 with a clear
   * message) rather than a warning. Use in production deployments to catch
   * lockfile drift before the server starts.
   */
  frozen?: boolean;
}

// ---------------------------------------------------------------------------
// Graceful-shutdown helpers
// ---------------------------------------------------------------------------

/**
 * Wire SIGTERM and SIGINT to the provided shutdown callback.
 * Returns a cleanup function that removes the listeners (used in tests).
 *
 * SIGINT is not available on Windows — the registration is wrapped in a
 * try/catch so the rest of the shutdown logic still works on that platform.
 */
function registerSignalHandlers(onShutdown: (signal: string) => void): () => void {
  const sigterm = () => onShutdown("SIGTERM");
  const sigint  = () => onShutdown("SIGINT");

  Deno.addSignalListener("SIGTERM", sigterm);
  try {
    Deno.addSignalListener("SIGINT", sigint);
  } catch {
    // SIGINT unavailable (Windows)
  }

  return () => {
    try { Deno.removeSignalListener("SIGTERM", sigterm); } catch { /* ok */ }
    try { Deno.removeSignalListener("SIGINT",  sigint);  } catch { /* ok */ }
  };
}

/**
 * Wait up to `deadlineMs` for `getInFlight()` to reach 0, polling every
 * 50 ms. Logs a warning if the deadline expires with requests still in flight.
 *
 * The drain deadline defaults to 30 s but can be overridden at runtime:
 *   DUNE_SHUTDOWN_TIMEOUT_MS=5000 dune serve
 */
async function drainInFlight(
  getInFlight: () => number,
  deadlineMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (getInFlight() > 0 && Date.now() - start < deadlineMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const remaining = getInFlight();
  if (remaining > 0) {
    console.warn(
      `[dune] shutdown: ${remaining} request(s) still in flight after ${deadlineMs}ms, exiting anyway`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function serveCommand(root: string, options: ServeOptions = {}) {
  const { port = 3000, debug = false, frozen = false } = options;

  // Resolve root to an absolute path immediately.  The CLI may pass a relative
  // path and we Deno.chdir() later, which would invalidate relative paths.
  root = resolve(root);

  // ── Lockfile staleness check ─────────────────────────────────────────────
  if (await checkLockfileStaleness(root)) {
    if (frozen) {
      console.error(
        `  ✗ deno.lock is incomplete for the current deno.json.\n` +
        `    Run \`dune lockfile sync\` and commit the result before deploying.`,
      );
      Deno.exit(1);
    }
    console.log(
      `  ⚠  deno.lock may be incomplete. Run \`dune lockfile sync\` before deploying.\n`,
    );
  }

  const drainDeadlineMs = parseInt(
    Deno.env.get("DUNE_SHUTDOWN_TIMEOUT_MS") ?? "30000",
    10,
  ) || 30_000;

  // ── Multi-site detection ────────────────────────────────────────────────────
  // If config/sites.yaml exists at the root, delegate to MultisiteManager.
  // The stat() is isolated in its own try/catch so that any error thrown during
  // multi-site initialisation is NOT silently caught and treated as "not multi-site".
  let isMultisite = false;
  try { await Deno.stat(join(root, "config", "sites.yaml")); isMultisite = true; } catch { /* ok */ }

  if (isMultisite) {
    console.log("🏜️  Dune — starting multi-site production server...\n");
    const { MultisiteManager } = await import("../multisite/mod.ts");
    const manager = new MultisiteManager();
    await manager.init(root, { port, debug, dev: false });
    console.log(`  🌐 http://localhost:${port} (${manager.siteCount()} sites)\n`);

    // ── Graceful shutdown (multi-site) ──────────────────────────────────────
    const ac = new AbortController();
    let shuttingDown = false;
    let inFlight = 0;

    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n[dune] received ${signal}, draining connections...`);
      ac.abort();
    };

    const cleanup = registerSignalHandlers(shutdown);

    const server = Deno.serve(
      {
        port,
        signal: ac.signal,
        onListen: ({ port: p }) =>
          console.log(`  🌐 http://localhost:${p} (${manager.siteCount()} sites)\n`),
      },
      async (req) => {
        inFlight++;
        try {
          return await manager.handle(req);
        } finally {
          inFlight--;
        }
      },
    );

    await server.finished;
    await drainInFlight(() => inFlight, drainDeadlineMs);
    cleanup();
    console.log("[dune] shutdown complete");
    return;
  }

  // ── Single site ──────────────────────────────────────────────────────────────
  console.log("🏜️  Dune — starting production server...\n");

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, config, pluginPublicRoutes, storage } = ctx;
  const adminPrefix = config.admin?.path ?? "/admin";

  // Expose the configured runtimeDir to ConsoleEmailProvider so its dev-email
  // directory aligns with the admin preview route regardless of runtimeDir customisation.
  const runtimeDirForEmail = config.admin?.runtimeDir ?? ".dune/admin";
  if (Deno.env.get("DUNE_ENV") === "dev") {
    Deno.env.set("DUNE_DEV_EMAIL_DIR", join(resolve(root), runtimeDirForEmail, "dev-email"));
  }

  // ── Background jobs ─────────────────────────────────────────────────────────
  // Pass config.site.jobs so only explicitly declared files are loaded.
  // When the key is absent, scanJobs falls back to auto-discovery with a
  // deprecation warning (backward compat for existing deployments).
  const declaredJobs = (config.site as { jobs?: string[] }).jobs;
  const jobDefs = await scanJobs(root, declaredJobs);
  const workers = Number(Deno.env.get("DUNE_WORKERS") ?? "1");
  warnIfMultiprocess(jobDefs.length, workers);

  const runtimeDir = config.admin?.runtimeDir ?? ".dune/admin";
  const jobStateDir = `${runtimeDir}/jobs`;
  const jobLogger = {
    info: (event: string, data?: Record<string, unknown>) => logger.info(event, data),
    warn: (event: string, data?: Record<string, unknown>) => logger.warn(event, data),
    error: (event: string, data?: Record<string, unknown>) => logger.error(event, data),
  };
  const emailCfg = (config as { site?: { email?: Record<string, unknown> } }).site?.email ?? {};
  const emailProvider = createEmailProvider(emailCfg as Parameters<typeof createEmailProvider>[0]);
  const emailFrom = (emailCfg as { from?: string }).from ?? `noreply@${new URL(config.site.url).hostname}`;
  const emailClient = createEmailClient({ provider: emailProvider, from: emailFrom, storage });

  const jobContext = { content: engine, config, storage, logger: jobLogger, email: emailClient };
  const jobScheduler = new JobScheduler({
    definitions: jobDefs,
    context: jobContext,
    stateDir: jobStateDir,
    storage,
  });

  if (jobDefs.length > 0) {
    jobScheduler.start();
    console.log(`  ⏰ ${jobDefs.length} job(s) scheduled`);
    // Wire ctx.jobs into hook context so plugins can trigger jobs from hooks
    ctx.hooks.setJobContext({ run: (name) => jobScheduler.run(name) });
  }
  const feedEnabled = config.site.feed?.enabled !== false;

  // Collect island paths from plugin public routes so they're included in the bundle.
  // Validate before handing to Builder so a plugin can't name a path with
  // `..` that escapes the workspace root (HIGH-19).
  const pluginIslandSpecifiers = (pluginPublicRoutes ?? [])
    .map((r) => r.island)
    .filter((p): p is string => {
      if (!isValidPluginIslandSpecifier(p)) {
        if (p !== undefined) {
          logger.warn("plugin.island.rejected", { path: p });
        }
        return false;
      }
      return true;
    });

  // Collect island paths from the active theme chain (auto-discovery).
  const themeIslandPaths = await collectThemeIslands(
    engine.themes.theme,
    engine.themes.rootDir,
  );

  // Collect island paths imported by TSX content pages (auto-discovery).
  const contentIslandPaths = await collectContentIslands(
    engine.pages,
    root,
    engine.config.system.content.dir,
  );

  // Fresh's esbuild deno plugin (WasmWorkspace) auto-detects the import map by
  // walking up from Deno.cwd() — it ignores esbuild's absWorkingDir entirely.
  // When running from local source (file:// URL), chdir to the dune package
  // root so WasmWorkspace finds dune's deno.json with all preact entries.
  // When running from JSR (https:// URL), import.meta.url has no local path —
  // skip the chdir and let WasmWorkspace use the site's own deno.json instead.
  // root is already absolute, so the chdir cannot invalidate any paths.
  if (import.meta.url.startsWith("file://")) {
    const duneRoot = new URL("../../", import.meta.url).pathname;
    Deno.chdir(duneRoot);
  }

  // Admin routes and islands come from the generated manifest (see
  // src/admin/manifest.gen.ts) — never from directory crawling, which cannot
  // work when Dune runs from JSR (https:// import.meta.url, no local files).
  // Point the Builder's crawl dirs at a path that does not exist so it
  // discovers nothing; every island is registered explicitly below.
  const noCrawlDir = join(root, ".dune", "__no-fs-crawl__");
  // Remote specifiers (https:// when Dune runs from JSR, jsr:/npm: plugin
  // islands) are materialized as local wrapper modules: Fresh's build cache
  // only accepts file paths (its maybeToFileUrl throws on URLs).
  const allIslandSpecifiers = await materializeRemoteIslands([
    ...getDuneAdminIslands(),
    ...pluginIslandSpecifiers,
    ...themeIslandPaths,
    ...contentIslandPaths,
  ], root);
  const builder = new Builder({
    root,
    islandDir: noCrawlDir,
    routeDir: noCrawlDir,
  });

  // Builder's constructor has no `islandSpecifiers` option — register them
  // explicitly via registerIsland() after construction.
  for (const spec of allIslandSpecifiers) {
    builder.registerIsland(spec);
  }
  const applySnapshot = await builder.build({ mode: "production", snapshot: "memory" });

  // Assemble the Fresh app with all Dune routes as middleware.
  // adminContext is set inside createDuneApp (by mountPlugins → plugin-admin's mount()).
  const { app, setShuttingDown } = await createDuneApp(ctx, { root, port, debug, dev: false });

  // Expose job scheduler to admin routes — must happen after createDuneApp so
  // that ctx.adminContext is populated by @dune/plugin-admin's mount() hook.
  if (jobDefs.length > 0 && ctx.adminContext) {
    (ctx.adminContext as import("../admin/context.ts").AdminContext & {
      jobScheduler?: JobScheduler;
    }).jobScheduler = jobScheduler;
  }

  // Attach the island build cache so staticFiles() can serve /_fresh/js/* chunks.
  applySnapshot(app);

  console.log(`  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🗺️  Sitemap generated`);
  if (feedEnabled) console.log(`  📡 RSS + Atom feeds generated`);
  console.log(`  🔐 Admin panel: http://localhost:${port}${adminPrefix}/`);
  console.log(`  🌐 http://localhost:${port}\n`);

  // ── Graceful shutdown (single site) ──────────────────────────────────────
  const ac = new AbortController();
  let shuttingDown = false;
  let inFlight = 0;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Signal the readiness probe immediately so load balancers drain traffic
    // before the process exits.
    setShuttingDown(true);
    jobScheduler.stop();
    console.log(`\n[dune] received ${signal}, draining connections...`);
    ac.abort();
  };

  const cleanup = registerSignalHandlers(shutdown);

  const handler = app.handler();
  const server = Deno.serve(
    { port, signal: ac.signal },
    async (req) => {
      inFlight++;
      try {
        return await handler(req);
      } finally {
        inFlight--;
      }
    },
  );

  await server.finished;

  // Safety-net drain poll — in normal operation inFlight is already 0 here
  // because Deno.serve() waits for active requests to complete before resolving
  // `server.finished`. The loop guards against edge cases (e.g. long-lived
  // keep-alive connections that Deno closed before the handler returned).
  await drainInFlight(() => inFlight, drainDeadlineMs);

  // The AuditLogger writes each entry directly to disk via Deno.writeTextFile
  // (append: true) — there is no in-memory write buffer to flush.  No explicit
  // flush step is required here.

  cleanup();
  console.log("[dune] shutdown complete");
}
