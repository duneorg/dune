import { join, resolve, isAbsolute } from "@std/path";
import { Builder } from "jsr:@fresh/core@^2/dev";
import { bootstrap } from "../runtime/bootstrap.ts";
import { createDuneApp } from "../runtime/server.ts";
import { materializeRemoteIslands } from "../cli/remote-islands.ts";
import { isValidPluginIslandSpecifier } from "../plugins/loader.ts";
import type { SiteEntry } from "../config/types.ts";
import type { InitializedSite } from "./types.ts";
import { logger } from "../core/logger.ts";
import { resolveContentDirPath } from "../content/content-root.ts";
import { copySocketAddr, rememberSocketAddr } from "../security/rate-limit.ts";

import { loadMultisiteConfig } from "./config.ts";
export { loadMultisiteConfig };

/**
 * MultisiteManager — bootstraps N sites from a config/sites.yaml file
 * and dispatches incoming requests to the correct site based on hostname
 * or path-prefix routing.
 *
 * Routing priority (per PRD §multi-site):
 *   1. Exact `Host` header match against `entry.hostname`
 *   2. Longest `entry.pathPrefix` match against `req.url.pathname`
 *   3. Default fallback site (first `default: true`, or first entry)
 */
export class MultisiteManager {
  private sites: InitializedSite[] = [];
  private defaultSite: InitializedSite | null = null;

  /**
   * Initialize all sites from `{installRoot}/config/sites.yaml`.
   * In dev mode, sets up per-site file watchers.
   */
  async init(
    installRoot: string,
    options: { port: number; debug?: boolean; dev?: boolean },
  ): Promise<void> {
    const { port, debug = false, dev = false } = options;

    const cfg = await loadMultisiteConfig(installRoot);
    if (!cfg) {
      throw new Error(
        `[dune/multisite] config/sites.yaml not found in ${installRoot}`,
      );
    }

    const configDir = join(installRoot, "config");

    // Build admin island bundles once — shared across all sites (islands are
    // package-level, not site-specific). Admin routes and islands come from
    // the generated manifest (src/admin/manifest.gen.ts) — never from
    // directory crawling, which cannot work when Dune runs from JSR
    // (https:// import.meta.url, no local files).
    const firstSiteRoot = isAbsolute(cfg.sites[0].root)
      ? cfg.sites[0].root
      : resolve(configDir, cfg.sites[0].root);
    const noCrawlDir = join(firstSiteRoot, ".dune", "__no-fs-crawl__");

    // Fresh's esbuild deno plugin (WasmWorkspace) detects the import map by
    // walking up from Deno.cwd() — it ignores esbuild's absWorkingDir entirely.
    // When running from local source (file:// URL), chdir to the dune package
    // root so WasmWorkspace finds dune's deno.json with all preact entries.
    // When running from JSR (https:// URL), skip — site's own deno.json is used.
    // All paths are already absolute at this point, so the chdir is safe.
    if (import.meta.url.startsWith("file://")) {
      const duneRoot = new URL("../../", import.meta.url).pathname;
      Deno.chdir(duneRoot);
    }


    const booted: { entry: SiteEntry; siteRoot: string; ctx: Awaited<ReturnType<typeof bootstrap>> }[] = [];
    for (const entry of cfg.sites) {
      // Resolve site root relative to the directory containing sites.yaml
      const siteRoot = isAbsolute(entry.root)
        ? entry.root
        : resolve(configDir, entry.root);

      // Resolve sharedThemesDir relative to configDir (same convention as site roots)
      const sharedThemesDir = cfg.sharedThemesDir
        ? (isAbsolute(cfg.sharedThemesDir)
          ? cfg.sharedThemesDir
          : resolve(configDir, cfg.sharedThemesDir))
        : undefined;

      if (debug) {
        logger.debug("multisite.bootstrap", { site: entry.id, root: siteRoot });
      }

      const ctx = await bootstrap(siteRoot, {
        debug,
        dev,
        buildSearch: true,
        sharedThemesDir,
        basePath: entry.pathPrefix,
        siteId: entry.id,
      });

      booted.push({ entry, siteRoot, ctx });
    }

    // Island bundles are package-level, not site-specific, so one snapshot is
    // shared by every site: the union of the islands the sites' plugins declare
    // (the admin among them, when a site lists it). Nothing is assumed about
    // which plugins exist.
    const islandSpecs = new Set<string>();
    for (const { ctx } of booted) {
      for (const plugin of ctx.hooks.plugins()) {
        for (const spec of plugin.islandSpecifiers ?? []) {
          if (isValidPluginIslandSpecifier(spec)) islandSpecs.add(spec);
          else logger.warn("plugin.islandSpecifier.rejected", { spec });
        }
      }
    }
    const adminBuilder = new Builder({
      root: firstSiteRoot,
      islandDir: noCrawlDir,
      routeDir: noCrawlDir,
    });
    // Remote (https://) island specs are materialized as local wrappers —
    // Fresh's build cache only accepts file paths.
    for (const spec of await materializeRemoteIslands([...islandSpecs], firstSiteRoot)) {
      adminBuilder.registerIsland(spec);
    }
    const applyAdminSnapshot = await adminBuilder.build({ mode: "production", snapshot: "memory" });

    for (const { entry, siteRoot, ctx } of booted) {
      // Create a per-site Fresh app (admin + content in one handler).
      // Apply the shared admin island snapshot so /_fresh/js/* island bundles
      // are served correctly without rebuilding islands per site.
      const { app, notifyReload } = await createDuneApp(ctx, {
        root: siteRoot,
        port,
        debug,
        dev,
      });
      applyAdminSnapshot(app);

      const handler = app.handler();
      const notify = notifyReload;

      if (dev) {
        // Set up per-site file watcher (debounced 200ms). Calls notifyReload()
        // which pushes a reload event via /__dune_reload SSE to this site's clients.
        this._watchSite(siteRoot, ctx, notifyReload, debug);
      }

      const initialized: InitializedSite = {
        entry: { ...entry, root: siteRoot },
        ctx,
        handler,
        notify,
      };

      this.sites.push(initialized);

      // The first entry with default:true becomes the fallback.
      // If none is flagged, the first entry is the fallback.
      if (entry.default && !this.defaultSite) {
        this.defaultSite = initialized;
      }

      logger.info("multisite.site_ready", {
        site: entry.id,
        route: entry.hostname ?? entry.pathPrefix ?? "(default)",
        pages: ctx.engine.pages.length,
      });
    }

    if (!this.defaultSite && this.sites.length > 0) {
      this.defaultSite = this.sites[0];
    }

    // Wire up cross-site collection registry so @site.* sources work
    if (this.sites.length > 1) {
      const registry = new Map(
        this.sites.map((s) => [s.entry.id, s.ctx.collections]),
      );
      for (const site of this.sites) {
        site.ctx.collections.setSiteRegistry(registry);
      }
    }
  }

  /**
   * Resolve the correct site for an incoming request.
   *
   * Priority:
   *   1. Exact hostname match (req Host header)
   *   2. Longest pathPrefix match (URL pathname prefix)
   *   3. Default fallback
   */
  resolveEntry(req: Request): InitializedSite | null {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return this.defaultSite;
    }

    // 1. Exact hostname match
    for (const site of this.sites) {
      if (site.entry.hostname && site.entry.hostname === url.hostname) {
        return site;
      }
    }

    // 2. Longest pathPrefix match
    let best: InitializedSite | null = null;
    let bestLen = 0;
    for (const site of this.sites) {
      const prefix = site.entry.pathPrefix;
      if (!prefix) continue;
      if (
        (url.pathname === prefix ||
          url.pathname.startsWith(prefix + "/")) &&
        prefix.length > bestLen
      ) {
        best = site;
        bestLen = prefix.length;
      }
    }
    if (best) return best;

    // 3. Default fallback
    return this.defaultSite;
  }

  /**
   * For prefix-routed sites: rewrite the request URL to strip the prefix
   * before dispatching to the site handler.
   *
   * e.g. pathPrefix "/docs", request "/docs/getting-started" → "/getting-started"
   */
  adjustRequest(req: Request, entry: SiteEntry): Request {
    if (!entry.pathPrefix) return req;

    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return req;
    }

    const stripped = url.pathname.slice(entry.pathPrefix.length) || "/";
    url.pathname = stripped;
    const next = new Request(url.toString(), req);
    copySocketAddr(req, next);
    return next;
  }

  /**
   * Main entry point: resolve → adjust → dispatch.
   */
  async handle(
    req: Request,
    info?: { remoteAddr?: { hostname?: string } },
  ): Promise<Response> {
    rememberSocketAddr(req, info?.remoteAddr);
    const site = this.resolveEntry(req);
    if (!site) {
      return new Response("No site configured", { status: 503 });
    }
    const adjusted = this.adjustRequest(req, site.entry);
    return site.handler(adjusted);
  }

  siteCount(): number {
    return this.sites.length;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Set up a debounced file watcher for a single site's content and themes dirs.
   * File changes trigger engine rebuild + SSE live-reload for only this site's clients.
   */
  private _watchSite(
    siteRoot: string,
    ctx: Awaited<ReturnType<typeof bootstrap>>,
    notifyReload: () => void,
    debug: boolean,
  ): void {
    const contentDir = resolveContentDirPath(ctx.engine.config.system.content, siteRoot);
    const themesDir = `${siteRoot}/themes`;
    const flexObjectsDir = `${siteRoot}/flex-objects`;

    const watchPaths: string[] = [contentDir];

    (async () => {
      // Best-effort: skip dirs that don't exist yet
      for (const dir of [themesDir, flexObjectsDir]) {
        try {
          await Deno.stat(dir);
          watchPaths.push(dir);
        } catch { /* not present */ }
      }

      let rebuildTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const watcher = Deno.watchFs(watchPaths);
        for await (const event of watcher) {
          if (
            event.kind === "modify" ||
            event.kind === "create" ||
            event.kind === "remove"
          ) {
            clearTimeout(rebuildTimeout);
            rebuildTimeout = setTimeout(async () => {
              try {
                const start = performance.now();
                // Also refreshes the taxonomy, collections and search (bootstrap).
                await ctx.engine.rebuild();
                const elapsed = (performance.now() - start).toFixed(0);
                if (debug) {
                  logger.debug("multisite.rebuilt", {
                    root: siteRoot,
                    durationMs: Number(elapsed),
                    pages: ctx.engine.pages.length,
                  });
                }
                notifyReload();
              } catch (err) {
                logger.error("multisite.rebuild_error", {
                  root: siteRoot,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }, 200);
          }
        }
      } catch {
        // File watching not available (e.g. certain OS/permission configs)
      }
    })();
  }
}
