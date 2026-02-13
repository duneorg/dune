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
   *   ![alt](photo.jpg) → ![alt](/content-media/02.blog/01.hello-world/photo.jpg)
   */
  async renderToHtml(
    page: Page,
    ctx: RenderContext,
  ): Promise<string> {
    const raw = page.rawContent;
    if (!raw) return "";

    // Resolve relative image/link references to media URLs
    const resolved = this.resolveMediaReferences(raw, ctx);

    // Parse markdown to HTML
    let html = await this.marked.parse(resolved);
    // Add loading="lazy" to img tags that don't have it
    html = html.replace(/<img(?=\s)(?![^>]*\bloading=)/gi, '<img loading="lazy"');
    return html;
  }

  /**
   * Replace relative media references with full URLs.
   *
   * Patterns handled:
   *   ![alt](filename.jpg)           → ![alt](media.url("filename.jpg"))
   *   ![alt](filename.jpg?width=800) → preserves query string (for v0.2 processing)
   */
  private resolveMediaReferences(
    markdown: string,
    ctx: RenderContext,
  ): string {
    // Match markdown image syntax: ![alt](path)
    return markdown.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_match, alt: string, src: string) => {
        // Skip absolute URLs and protocol-relative URLs
        if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) {
          return `![${alt}](${src})`;
        }

        // Split filename from query params
        const [filename, query] = src.split("?", 2);

        // Look up the media file
        const mediaFile = ctx.media.get(filename);
        if (mediaFile) {
          const url = query ? `${mediaFile.url}?${query}` : mediaFile.url;
          return `![${alt}](${url})`;
        }

        // Not a known media file — leave as-is
        return `![${alt}](${src})`;
      },
    );
  }
}
