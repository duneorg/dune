/**
 * GET /admin/api/introspect
 *
 * Returns live runtime state as a JSON snapshot — useful for agent tooling
 * (MCP server, IDE plugins) that needs to understand the current project
 * without running a build.
 *
 * Requires: config.read permission (any authenticated admin, editor, or author).
 * Never returns credential-adjacent config fields (secrets, password hashes, etc.)
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../../types.ts";
import { json, requirePermission } from "./_utils.ts";
import { PLUGIN_API_VERSION } from "../../../plugins/mod.ts";

/** Derive Dune package version from the module URL (same logic as CLI). */
function getDuneVersion(): string {
  const url = import.meta.url;
  // JSR: https://jsr.io/@dune/core/<version>/src/...
  const jsrMatch = url.match(/jsr\.io\/@dune\/core\/([^/]+)\//);
  if (jsrMatch) return jsrMatch[1];
  // Local source: read from deno.json relative to this file
  try {
    const denoJsonPath = new URL("../../../../deno.json", import.meta.url).pathname;
    const raw = Deno.readTextFileSync(denoJsonPath);
    const parsed = JSON.parse(raw);
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const permDenied = await requirePermission(ctx, "config.read");
    if (permDenied) return permDenied;

    const { engine, config, hooks } = ctx.state.adminContext;

    // ── Version ────────────────────────────────────────────────────────────

    const version = getDuneVersion();

    // ── Engine / content stats ─────────────────────────────────────────────

    const allPages = engine.pages;
    const published = allPages.filter((p) => p.published);
    const drafts = allPages.filter((p) => !p.published);

    const formats: Record<string, number> = {};
    for (const page of allPages) {
      formats[page.format] = (formats[page.format] ?? 0) + 1;
    }

    // Taxonomy summary — top 10 values per taxonomy
    const taxonomySummary: Record<string, { total: number; topValues: string[] }> = {};
    for (const [taxName, values] of Object.entries(engine.taxonomyMap)) {
      const sorted = Object.entries(values)
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, 10)
        .map(([v]) => v);
      taxonomySummary[taxName] = { total: Object.keys(values).length, topValues: sorted };
    }

    // Content tree — top-level sections
    const sections: Record<string, number> = {};
    for (const page of published) {
      const topSegment = page.route?.split("/")[1] ?? "(root)";
      sections[topSegment] = (sections[topSegment] ?? 0) + 1;
    }

    // ── Theme ──────────────────────────────────────────────────────────────

    const resolvedTheme = engine.themes.theme;
    const themeInfo = {
      name: resolvedTheme.manifest.name,
      version: resolvedTheme.manifest.version ?? null,
      description: resolvedTheme.manifest.description ?? null,
      author: resolvedTheme.manifest.author ?? null,
      parent: resolvedTheme.manifest.parent ?? null,
      templates: resolvedTheme.templateNames,
      layouts: resolvedTheme.layoutNames,
    };

    // ── Plugins ────────────────────────────────────────────────────────────

    const pluginList = hooks?.plugins() ?? [];
    const pluginsInfo = pluginList.map((p) => ({
      name: p.name,
      version: p.version,
    }));

    // Configured plugin specs (from site.yaml) — without secrets
    const configuredSpecs = (config.pluginList ?? []).map((entry) => {
      const e = entry as { src?: string; spec?: string };
      return e.src ?? e.spec ?? "(unknown)";
    });

    // ── Config summary (no secrets) ────────────────────────────────────────

    const configSummary = {
      siteTitle: config.site.title,
      siteUrl: config.site.url,
      adminPath: config.admin?.path ?? "/admin",
      themeName: config.theme.name,
      taxonomies: config.site.taxonomies,
      languages: {
        supported: config.system.languages?.supported ?? [],
        default: config.system.languages?.default ?? "en",
      },
      cacheEnabled: config.system.cache?.enabled ?? false,
      cacheDriver: config.system.cache?.driver ?? "memory",
      debugMode: config.system.debug ?? false,
      authMode: ((config as unknown as Record<string, unknown>).auth as Record<string, unknown> | undefined)?.mode ?? null,
      feedEnabled: config.site.feed?.enabled !== false,
      workflowEnabled: !!config.site.workflow,
      auditEnabled: config.admin?.audit?.enabled !== false,
    };

    // ── Response ───────────────────────────────────────────────────────────

    return json({
      version,
      pluginApiVersion: PLUGIN_API_VERSION,
      generatedAt: new Date().toISOString(),

      engine: {
        pagesTotal: allPages.length,
        pagesPublished: published.length,
        pagesDraft: drafts.length,
        formats,
        sections,
        taxonomies: taxonomySummary,
      },

      theme: themeInfo,

      plugins: {
        loaded: pluginsInfo,
        configured: configuredSpecs,
      },

      config: configSummary,
    });
  },
};
