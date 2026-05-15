/**
 * GET /admin/api/page-source?route=<route>
 *
 * Returns the raw source content (YAML frontmatter + markdown body) for a
 * page identified by its route.  Intended for agent tools that need to read
 * a page's current content before editing it via POST /admin/api/dev/apply.
 *
 * Query parameters:
 *   route  — URL route of the page (e.g. /blog/my-post)
 *
 * Response (200):
 *   {
 *     route:      string        // Canonical route
 *     sourcePath: string        // Relative path within content dir (e.g. "02.blog/01.my-post/default.md")
 *     format:     string        // "md" | "mdx" | "tsx"
 *     content:    string        // Full raw file content
 *     frontmatter: object       // Parsed YAML frontmatter
 *     body:       string        // Markdown body (content after frontmatter)
 *     mtime:      number        // Last-modified timestamp (ms)
 *   }
 *
 * Error responses:
 *   400  Missing required `route` parameter
 *   404  No page found for the given route
 *   422  Page format is not text-readable (e.g. tsx)
 */

import type { FreshContext } from "fresh";
import type { AdminState } from "../../types.ts";
import { requirePermission, serverError } from "./_utils.ts";
import { parse as parseYaml } from "@std/yaml";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    const { engine, storage, config } = ctx.state.adminContext;

    try {
      // ── Resolve route ────────────────────────────────────────────────────
      const rawRoute = ctx.url.searchParams.get("route");
      if (!rawRoute) {
        return Response.json(
          { error: "Missing required query parameter: route" },
          { status: 400 },
        );
      }

      // Normalize route: ensure leading slash
      const route = rawRoute.startsWith("/") ? rawRoute : `/${rawRoute}`;

      // Find page index entry by route
      const pageIndex = engine.pages.find((p) => p.route === route);
      if (!pageIndex) {
        return Response.json(
          { error: `No page found for route: ${route}` },
          { status: 404 },
        );
      }

      const contentDir = config.system.content.dir;

      // ── Read raw content ─────────────────────────────────────────────────
      const fullPath = `${contentDir}/${pageIndex.sourcePath}`;

      let rawContent: string;
      try {
        const bytes = await storage.read(fullPath);
        rawContent = new TextDecoder().decode(bytes);
      } catch {
        return Response.json(
          { error: `Could not read source file: ${pageIndex.sourcePath}` },
          { status: 404 },
        );
      }

      // ── Parse frontmatter and body ───────────────────────────────────────
      let frontmatter: Record<string, unknown> = {};
      let body = rawContent;

      if (pageIndex.format === "md" || pageIndex.format === "mdx") {
        if (rawContent.startsWith("---")) {
          const end = rawContent.indexOf("\n---", 3);
          if (end !== -1) {
            const fmText = rawContent.slice(3, end).trim();
            body = rawContent.slice(end + 4).trimStart();
            try {
              const parsed = parseYaml(fmText);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                frontmatter = parsed as Record<string, unknown>;
              }
            } catch {
              // Return empty frontmatter on parse error
            }
          }
        }
      }

      // ── Stat for mtime ───────────────────────────────────────────────────
      const mtime = pageIndex.mtime ?? Date.now();

      return Response.json({
        route: pageIndex.route,
        sourcePath: pageIndex.sourcePath,
        format: pageIndex.format,
        content: rawContent,
        frontmatter,
        body: pageIndex.format === "tsx" ? null : body,
        mtime,
      });
    } catch (err) {
      return serverError(err);
    }
  },
};
