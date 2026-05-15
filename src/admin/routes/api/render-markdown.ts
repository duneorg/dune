/**
 * POST /admin/api/render-markdown
 *
 * Renders arbitrary markdown (with optional YAML frontmatter) to HTML
 * without writing any files to disk. Intended for agent tools and
 * editor previews that need to validate rendered output before
 * committing changes via the dev/apply endpoint.
 *
 * Request body:
 *   {
 *     content: string          // Full file content (frontmatter + body)
 *     trusted?: boolean        // Allow raw HTML passthrough (default: false)
 *   }
 *
 * Response:
 *   {
 *     html: string             // Rendered HTML body (no wrapper element)
 *     frontmatter: object      // Parsed YAML frontmatter
 *     warnings: string[]       // Non-fatal issues (e.g. invalid frontmatter fields)
 *   }
 */

import type { AdminState } from "../../types.ts";
import { requirePermission, serverError, csrfCheck } from "./_utils.ts";
import type { FreshContext } from "fresh";
import { parse as parseYaml } from "@std/yaml";
import { Marked } from "marked";
import { sanitizeHtml } from "../../../security/sanitize-html.ts";

/** Maximum content size: 500 KB */
const MAX_BYTES = 500 * 1024;

export const handler = {
  async POST(ctx: FreshContext<AdminState>) {
    const csrf = csrfCheck(ctx);
    if (csrf) return csrf;

    const denied = await requirePermission(ctx, "pages.read");
    if (denied) return denied;

    try {
      // Size guard
      const contentLength = parseInt(ctx.req.headers.get("content-length") ?? "0", 10);
      if (contentLength > MAX_BYTES) {
        return Response.json(
          { error: "Content too large (max 500 KB)" },
          { status: 413 },
        );
      }

      const body = await ctx.req.json();
      if (typeof body.content !== "string") {
        return Response.json(
          { error: "Missing required field: content (string)" },
          { status: 400 },
        );
      }

      const rawContent: string = body.content;
      // `trusted` skips HTML sanitization. Restrict to admin role only —
      // pages.read (author/editor) is not sufficient.
      const isAdmin = ctx.state.auth?.user?.role === "admin";
      const trusted: boolean = body.trusted === true && isAdmin;
      const warnings: string[] = [];

      if (new TextEncoder().encode(rawContent).length > MAX_BYTES) {
        return Response.json(
          { error: "Content too large (max 500 KB)" },
          { status: 413 },
        );
      }

      // Parse frontmatter
      let frontmatter: Record<string, unknown> = {};
      let markdownBody = rawContent;

      if (rawContent.startsWith("---")) {
        const end = rawContent.indexOf("\n---", 3);
        if (end === -1) {
          warnings.push("Frontmatter block opened but not closed (missing closing ---)");
        } else {
          const fmText = rawContent.slice(3, end).trim();
          markdownBody = rawContent.slice(end + 4).trimStart();

          try {
            const parsed = parseYaml(fmText);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              frontmatter = parsed as Record<string, unknown>;
            } else if (parsed !== null && parsed !== undefined) {
              warnings.push("Frontmatter is not a YAML object — ignoring");
            }
          } catch (err) {
            warnings.push(`YAML frontmatter parse error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // Render markdown to HTML
      const marked = new Marked();
      let html = await marked.parse(markdownBody);

      // Sanitize unless trusted
      if (!trusted) {
        html = sanitizeHtml(html);
      }

      // Add lazy loading to images
      html = html.replace(/<img(?=\s)(?![^>]*\bloading=)/gi, '<img loading="lazy"');

      return Response.json({
        html,
        frontmatter,
        warnings,
      });
    } catch (err) {
      return serverError(err);
    }
  },
};
