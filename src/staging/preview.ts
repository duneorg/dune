/**
 * Staged draft preview renderer.
 *
 * Shared between dune serve and dune dev — renders a staged draft through the
 * active theme for the `GET /__preview?path=...&token=...` public endpoint.
 */

import type { DuneEngine } from "../core/engine.ts";
import type { StagingEngine } from "./engine.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import { h, type ComponentType } from "preact";
import { render as renderToString } from "preact-render-to-string";
import type { Page } from "../content/types.ts";

/**
 * Serve a staged draft preview.
 *
 * Validates the token against the stored draft, then renders through the theme.
 * Returns null if the draft is not found or the token is invalid.
 */
export async function serveStagedPreview(
  url: URL,
  engine: DuneEngine,
  staging: StagingEngine | undefined,
): Promise<Response | null> {
  if (!staging) return null;

  const sourcePath = url.searchParams.get("path");
  const token = url.searchParams.get("token");
  if (!sourcePath || !token) return null;

  const draft = await staging.verify(sourcePath, token);
  if (!draft) return null;

  try {
    const pageIndex = engine.pages.find((p) => p.sourcePath === sourcePath);
    if (!pageIndex) return null;

    // Reconstruct raw file content for display purposes
    const fmYaml = stringifyYaml(draft.frontmatter as Record<string, unknown>).trimEnd();
    const rawContent = `---\n${fmYaml}\n---\n\n${draft.content}`;

    const bannerHtml = `<div style="position:fixed;top:0;left:0;right:0;background:#d97706;color:#fff;text-align:center;padding:0.5rem 1rem;font-family:system-ui;font-size:0.85rem;z-index:9999">
      ⚠️ Draft preview — not published. <a href="/__preview?path=${encodeURIComponent(sourcePath)}&token=${encodeURIComponent(token)}" style="color:#fff;text-decoration:underline">Refresh</a>
    </div><div style="padding-top:2.5rem">`;

    const templateName = (draft.frontmatter.template as string)
      ?? pageIndex.template
      ?? "default";
    const [template, layout] = await Promise.all([
      engine.themes.loadTemplate(templateName),
      engine.themes.loadLayout("layout"),
    ]);

    if (!template) {
      // Fallback: bare HTML with draft content rendered as plain text
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Draft Preview</title>
        <style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto;line-height:1.6}
        img{max-width:100%}pre{background:#f5f5f5;padding:1rem;border-radius:4px;overflow-x:auto}</style>
        </head><body>${bannerHtml}<pre style="white-space:pre-wrap">${draft.content}</pre></div></body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    // Build a synthetic Page object so the template has what it expects
    const synthPage: Partial<Page> = {
      ...pageIndex,
      rawContent,
      frontmatter: draft.frontmatter as Page["frontmatter"],
    };

    const locale = await engine.themes.loadLocale(pageIndex.language ?? "en");
    const t = (key: string) => (locale[key] ?? key) as string;

    const props = {
      page: synthPage as Page,
      site: engine.site,
      config: engine.config,
      themeConfig: engine.themeConfig,
      Layout: layout ?? undefined,
      t,
      collections: {},
    };

    const componentHtml = renderToString(h(template.component as ComponentType<any>, props));
    return new Response(
      `<!DOCTYPE html>${bannerHtml}${componentHtml}</div>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch {
    return null;
  }
}
