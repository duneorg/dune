/**
 * Markdown content format handler.
 *
 * Processing pipeline:
 *   1. Parse YAML frontmatter between --- delimiters
 *   2. Extract raw markdown body
 *   3. At render time: markdown → HTML via marked
 *   4. Resolve co-located media references
 *
 * Images: query params (width, height, format, quality) are preserved in URLs
 * and processed by the image handler at request time (v0.2).
 */

import matter from "gray-matter";
import { Marked } from "marked";
import type {
  ContentFormatHandler,
  Page,
  PageFrontmatter,
  RenderContext,
} from "../types.ts";
import { resolveMediaRefs } from "./media-resolve.ts";
import { sanitizeHtml } from "../../security/sanitize-html.ts";

export class MarkdownHandler implements ContentFormatHandler {
  readonly extensions = [".md"];

  private marked: Marked;

  constructor() {
    this.marked = new Marked();
  }

  /**
   * Extract frontmatter from a markdown file.
   * Uses gray-matter to parse YAML between --- delimiters.
   */
  async extractFrontmatter(
    raw: string,
    _filePath: string,
  ): Promise<PageFrontmatter> {
    const { data } = matter(raw);

    // Ensure required fields have defaults
    return {
      title: "",
      published: true,
      visible: true,
      routable: true,
      ...data,
    } as PageFrontmatter;
  }

  /**
   * Extract the markdown body (everything after the frontmatter block).
   */
  extractBody(raw: string, _filePath: string): string | null {
    const { content } = matter(raw);
    return content.trim() || null;
  }

  /**
   * Render markdown content to HTML.
   *
   * Resolves co-located media references:
   *   ![alt](photo.jpg)  → ![alt](/content-media/02.blog/01.hello-world/photo.jpg)
   *   [text](doc.pdf)    → [text](/content-media/02.blog/01.hello-world/doc.pdf)
   */
  async renderToHtml(
    page: Page,
    ctx: RenderContext,
  ): Promise<string> {
    const raw = page.rawContent;
    if (!raw) return "";

    // Resolve relative image/link references to absolute /content-media/ URLs
    const resolved = resolveMediaRefs(raw, ctx);

    // Parse markdown to HTML
    let html = await this.marked.parse(resolved);

    // Sanitize to strip any raw <script>, event handlers, javascript: URLs,
    // etc. that an author embedded in the markdown body. Formatting tags,
    // images, and safe links pass through.
    //
    // Sites that explicitly need raw HTML passthrough (e.g. when authors are
    // fully trusted and embed custom widgets) can opt out with
    // `site.trusted_html: true` in site.yaml or `trusted_html: true` in a
    // page's own frontmatter. The resolved flag is pre-computed in the page
    // loader and surfaced here as ctx.trustedHtml.
    if (!ctx.trustedHtml) {
      html = sanitizeHtml(html);
    }

    // Add loading="lazy" to img tags that don't have it
    html = html.replace(/<img(?=\s)(?![^>]*\bloading=)/gi, '<img loading="lazy"');
    return html;
  }
}
