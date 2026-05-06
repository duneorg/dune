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

import { join, resolve, isAbsolute } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { Builder } from "jsr:@fresh/core@^2/dev";
import { bootstrap } from "../cli/bootstrap.ts";
import { createDuneApp } from "../cli/fresh-app.ts";
import {
  buildSitePrebuilt,
  createProductionSiteHandler,
  createDevSiteContext,
} from "../cli/site-handler.ts";
import type { MultisiteConfig, SiteEntry } from "../config/types.ts";
import type { InitializedSite } from "./types.ts";

export { loadMultisiteConfig };

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
    // package-level, not site-specific).
    const adminPkgDir = new URL("../admin", import.meta.url).pathname;
    const islandDir = join(adminPkgDir, "islands");
    const routeDir = join(adminPkgDir, "routes");
    const firstSiteRoot = isAbsolute(cfg.sites[0].root)
      ? cfg.sites[0].root
      : resolve(configDir, cfg.sites[0].root);
    const adminBuilder = new Builder({ root: firstSiteRoot, islandDir, routeDir });
    const applyAdminSnapshot = await adminBuilder.build({ mode: "production", snapshot: "memory" });

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
        console.log(
          `  [multisite] bootstrapping site "${entry.id}" at ${siteRoot}`,
        );
      }

      const ctx = await bootstrap(siteRoot, {
        debug,
        dev,
        buildSearch: true,
        sharedThemesDir,
      });

      // Build per-site Fresh admin app and apply shared island snapshot.
      const { app: adminApp } = await createDuneApp(ctx, {
        root: siteRoot,
        port,
        debug,
        dev: false,
      });
      applyAdminSnapshot(adminApp);
      const adminFreshHandler = adminApp.handler();

      let handler: (req: Request) => Promise<Response>;
      let notify: (() => void) | undefined;
      let cleanup: (() => void) | undefined;

      if (dev) {
        const devCtx = createDevSiteContext(ctx, siteRoot, { port, debug, adminFreshHandler });
        handler = devCtx.handler;
        notify = devCtx.notifyReload;
        cleanup = devCtx.cleanup;

        // Set up per-site file watcher (debounced 200ms)
        this._watchSite(siteRoot, ctx, devCtx.notifyReload, debug);
      } else {
        const prebuilt = await buildSitePrebuilt(ctx, port);
        handler = createProductionSiteHandler(ctx, prebuilt, siteRoot, {
          port,
          debug,
          adminFreshHandler,
        });
      }

      const initialized: InitializedSite = {
        entry: { ...entry, root: siteRoot },
        ctx,
        handler,
        notify,
        cleanup,
      };

      this.sites.push(initialized);

      // The first entry with default:true becomes the fallback.
      // If none is flagged, the first entry is the fallback.
      if (entry.default && !this.defaultSite) {
        this.defaultSite = initialized;
      }

      console.log(
        `  ✓ [${entry.id}] ${entry.hostname ?? entry.pathPrefix ?? "(default)"} — ${ctx.engine.pages.length} pages`,
      );
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
    return new Request(url.toString(), req);
  }

  /**
   * Main entry point: resolve → adjust → dispatch.
   */
  async handle(req: Request): Promise<Response> {
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
    const contentDir = `${siteRoot}/${ctx.engine.config.system.content.dir}`;
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

      let rebuildTimeout: number | undefined;
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
                await ctx.engine.rebuild();
                ctx.taxonomy.rebuild(ctx.engine.pages, ctx.engine.taxonomyMap);
                ctx.collections.rebuild(
                  ctx.engine.pages,
                  ctx.engine.taxonomyMap,
                );
                await ctx.search.rebuild(ctx.engine.pages);
                const elapsed = (performance.now() - start).toFixed(0);
                if (debug) {
                  console.log(
                    `  🔄 [${siteRoot}] rebuilt in ${elapsed}ms (${ctx.engine.pages.length} pages)`,
                  );
                }
                notifyReload();
              } catch (err) {
                console.error(
                  `  ✗ [${siteRoot}] rebuild error: ${err}`,
                );
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

/**
 * Parse `{installRoot}/config/sites.yaml`.
 * Returns null if the file does not exist.
 */
async function loadMultisiteConfig(
  installRoot: string,
): Promise<MultisiteConfig | null> {
  const cfgPath = join(installRoot, "config", "sites.yaml");
  let raw: string;
  try {
    raw = await Deno.readTextFile(cfgPath);
  } catch {
    return null;
  }

  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[dune/multisite] Invalid config/sites.yaml: expected a mapping`);
  }

  const data = parsed as Record<string, unknown>;

  const rawSites = data.sites;
  if (!Array.isArray(rawSites) || rawSites.length === 0) {
    throw new Error(`[dune/multisite] config/sites.yaml must contain a non-empty "sites" array`);
  }

  const sites: SiteEntry[] = rawSites.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`[dune/multisite] sites[${i}] is not an object`);
    }
    const entry = raw as Record<string, unknown>;
    if (!entry.id || typeof entry.id !== "string") {
      throw new Error(`[dune/multisite] sites[${i}] missing or invalid "id" field`);
    }
    if (!entry.root || typeof entry.root !== "string") {
      throw new Error(`[dune/multisite] sites[${i}] (${entry.id}) missing or invalid "root" field`);
    }
    if (entry.hostname && entry.path_prefix) {
      throw new Error(
        `[dune/multisite] sites[${i}] (${entry.id}): "hostname" and "path_prefix" are mutually exclusive`,
      );
    }
    return {
      id: entry.id,
      root: entry.root,
      hostname: typeof entry.hostname === "string" ? entry.hostname : undefined,
      pathPrefix: typeof entry.path_prefix === "string" ? entry.path_prefix : undefined,
      default: entry.default === true,
    };
  });

  return {
    sites,
    sharedThemesDir: typeof data.shared_themes_dir === "string"
      ? data.shared_themes_dir
      : undefined,
    sharedPluginsDir: typeof data.shared_plugins_dir === "string"
      ? data.shared_plugins_dir
      : undefined,
  };
}
