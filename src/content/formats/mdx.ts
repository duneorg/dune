/**
 * MDX content format handler.
 *
 * MDX is Markdown with embedded JSX components — the hybrid between
 * pure markdown (.md) and pure JSX (.tsx).
 *
 * Processing pipeline:
 *   1. Parse YAML frontmatter between --- delimiters (same as .md)
 *   2. Extract raw MDX body
 *   3. At render time: compile MDX → evaluate → render to HTML string
 *   4. Resolve co-located media references (same regex as .md)
 *
 * Components available inside MDX content come from the MdxComponentRegistry.
 */

import matter from "gray-matter";
import { h } from "preact";
import { render } from "preact-render-to-string";
import type {
  ContentFormatHandler,
  Page,
  PageFrontmatter,
  RenderContext,
} from "../types.ts";
import type { MdxComponentRegistry } from "./mdx-components.ts";
import { resolveMediaRefs } from "./media-resolve.ts";

export interface MdxHandlerOptions {
  /** Component registry for MDX content (optional — defaults to empty) */
  components?: MdxComponentRegistry;
}

export class MdxHandler implements ContentFormatHandler {
  readonly extensions = [".mdx"];

  private components: MdxComponentRegistry | null;

  constructor(options: MdxHandlerOptions = {}) {
    this.components = options.components ?? null;
  }

  /**
   * Extract frontmatter from an MDX file.
   * Uses gray-matter (same YAML --- blocks as .md files).
   */
  async extractFrontmatter(
    raw: string,
    _filePath: string,
  ): Promise<PageFrontmatter> {
    const { data } = matter(raw);

    return {
      title: "",
      published: true,
      visible: true,
      routable: true,
      ...data,
    } as PageFrontmatter;
  }

  /**
   * Extract the MDX body (everything after the frontmatter block).
   */
  extractBody(raw: string, _filePath: string): string | null {
    const { content } = matter(raw);
    return content.trim() || null;
  }

  /**
   * Render MDX content to HTML.
   *
   * Pipeline:
   *   1. Resolve media references (same as markdown handler)
   *   2. Compile MDX source to a module via @mdx-js/mdx
   *   3. Evaluate the compiled module to get a component function
   *   4. Render the component to an HTML string via Preact SSR
   */
  async renderToHtml(
    page: Page,
    ctx: RenderContext,
  ): Promise<string> {
    const raw = page.rawContent;
    if (!raw) return "";

    // Resolve relative image/link references to absolute /content-media/ URLs
    const resolved = resolveMediaRefs(raw, ctx);

    try {
      // Lazy import @mdx-js/mdx (heavy dependency, only load when needed)
      const { compile } = await import("@mdx-js/mdx");

      // Compile MDX source to a JS module string
      const compiled = await compile(resolved, {
        // Output as function body (not full module) for evaluation
        outputFormat: "function-body",
        // Use development mode for better error messages
        development: false,
        // JSX runtime config — we'll provide our own
        providerImportSource: undefined,
      });

      // Evaluate the compiled MDX to get the content component.
      // The compiled code expects a runtime with `jsx`, `jsxs`, `Fragment`.
      const { run } = await import("@mdx-js/mdx");

      // Build component scope from registry
      const componentScope = this.components?.getComponents() ?? {};

      const mdxModule = await run(compiled, {
        // Provide the JSX runtime
        jsx: h as any,
        jsxs: h as any,
        jsxDEV: h as any,
        Fragment: "div" as any,
        // Provide components from the registry (cast to satisfy @mdx-js types)
        useMDXComponents: (() => componentScope) as any,
      });

      // mdxModule.default is the MDX content component
      const MdxContent = mdxModule.default;
      if (!MdxContent) return "";

      // Build component props with available components
      const componentProps: Record<string, unknown> = {};
      if (this.components) {
        componentProps.components = this.components.getComponents();
      }

      // Render MDX component to HTML via Preact SSR
      const jsx = h(MdxContent, componentProps);
      const html = render(jsx);

      return html;
    } catch (err) {
      // MDX compilation/evaluation errors — return error message wrapped in HTML.
      // Log the full message server-side (includes paths for debugging) but strip
      // filesystem paths from the client-facing output to avoid leaking server layout.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ MDX render error in ${page.sourcePath}: ${message}`);
      return `<div class="mdx-error"><p><strong>MDX Error:</strong> ${escapeHtml(sanitizeMdxError(message))}</p></div>`;
    }
  }

}

/** Escape HTML special characters for safe inline display. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip absolute filesystem paths from MDX compiler error messages before
 * sending them to the browser. The compiler often embeds the full path of the
 * source file (e.g. `/Users/xrs/project/content/pages/foo.mdx`), which would
 * reveal server directory structure to end users.
 *
 * Patterns replaced with `<path>`:
 *   /Users/xrs/project/content/pages/foo.mdx  →  <path>
 *   /home/user/site/src/page.mdx               →  <path>
 *
 * The full message is still logged server-side (see console.error above).
 */
function sanitizeMdxError(message: string): string {
  // Match absolute Unix paths: at least two /segment components.
  return message.replace(/\/(?:[^\s/]+\/)+[^\s/]*/g, "<path>");
}
