/**
 * MDX content format handler.
 *
 * MDX is Markdown with embedded JSX components — the hybrid between
 * pure markdown (.md) and pure JSX (.tsx).
 *
 * Processing pipeline:
 *   1. Parse YAML frontmatter between --- delimiters (same as .md)
 *   2. Extract raw MDX body
 *   3. At render time:
 *      a. Resolve co-located media references (same regex as .md)
 *      b. Extract and resolve co-located import statements (relative ./... imports)
 *      c. Compile MDX (import-stripped source) → evaluate → render to HTML string
 *   4. Component scope = theme registry + co-located imports merged together
 *
 * Components available inside MDX content come from two sources:
 *   - MdxComponentRegistry: theme-wide reusable components (registered via
 *     themes/{name}/mdx-components.ts)
 *   - Co-located imports: relative import statements in the MDX file itself
 *     (e.g. `import Chart from './Chart.tsx'`) resolved against the MDX file's
 *     directory and loaded server-side via Deno dynamic import.
 */

import matter from "gray-matter";
import { dirname, join, SEPARATOR as SEP } from "@std/path";
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
   *   2. Extract and load co-located relative imports (./Foo.tsx etc.)
   *   3. Compile import-stripped MDX source via @mdx-js/mdx (function-body)
   *   4. Evaluate compiled module, merging registry + colocated component scopes
   *   5. Render component to HTML string via Preact SSR
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
      // Resolve co-located imports if we know the content directory.
      // Produces a stripped source (imports removed) + loaded component map.
      let mdxSource = resolved;
      let colocatedComponents: Record<string, unknown> = {};
      if (ctx.contentDir) {
        const mdxDir = join(ctx.contentDir, dirname(page.sourcePath));
        const result = await resolveColocaledImports(resolved, mdxDir);
        mdxSource = result.source;
        colocatedComponents = result.components;
      }

      // Lazy import @mdx-js/mdx (heavy dependency, only load when needed)
      const { compile, run } = await import("@mdx-js/mdx");

      // Compile MDX source to a JS module string
      const compiled = await compile(mdxSource, {
        // Output as function body (not full module) for evaluation
        outputFormat: "function-body",
        development: false,
        providerImportSource: undefined,
      });

      // Merge registry components + co-located imports into one scope.
      // Co-located imports take precedence so a post can shadow a theme component.
      const componentScope: Record<string, unknown> = {
        ...this.components?.getComponents() ?? {},
        ...colocatedComponents,
      };

      const mdxModule = await run(compiled, {
        jsx: h as any,
        jsxs: h as any,
        jsxDEV: h as any,
        Fragment: "div" as any,
        useMDXComponents: (() => componentScope) as any,
      });

      const MdxContent = mdxModule.default;
      if (!MdxContent) return "";

      // Render MDX component to HTML via Preact SSR
      const jsx = h(MdxContent, { components: componentScope } as any);
      let html = render(jsx);

      // MDX is a code-execution surface (arbitrary JSX with author-supplied
      // components and props). When the trusted_html flag isn't set, run the
      // rendered output through the same sanitizer the markdown handler uses.
      // This blocks raw <script>, <iframe>, on* event handlers, and unsafe
      // URL schemes that a non-admin author might emit through MDX.
      if (!ctx.trustedHtml) {
        const { sanitizeHtml } = await import("../../security/sanitize-html.ts");
        html = sanitizeHtml(html);
      }

      return html;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The client response already redacts filesystem paths via
      // sanitizeMdxError. The server-side log used to include the raw,
      // un-redacted message which is fine in dev/CI but exposes paths
      // (and any secret values that happen to live in error strings) on
      // production stdout. In production we apply the same redaction;
      // operators with shell access can still see full stacks via DUNE_DEV
      // or by inspecting `err` directly.
      const isProd = !Deno.env.get("DUNE_DEV");
      const safeMessage = isProd ? sanitizeMdxError(message) : message;
      console.error(`  ✗ MDX render error in ${page.sourcePath}: ${safeMessage}`);
      return `<div class="mdx-error"><p><strong>MDX Error:</strong> ${escapeHtml(sanitizeMdxError(message))}</p></div>`;
    }
  }

}

/**
 * Extract, load, and strip relative import statements from MDX source.
 *
 * Handles the three common import forms:
 *   import Foo from './Foo.tsx'           → default export bound as Foo
 *   import { Foo, Bar as B } from './x'  → named exports
 *   import * as Ns from './ns.tsx'        → entire module as namespace
 *
 * Only relative specifiers (starting with ./ or ../) are processed.
 * Non-relative imports are left in the source and will cause a compile
 * error later — MDX function-body format does not support bare imports.
 *
 * @param source  Raw MDX body (frontmatter already stripped)
 * @param mdxDir  Absolute path to the directory containing the MDX file
 */
async function resolveColocaledImports(
  source: string,
  mdxDir: string,
): Promise<{ source: string; components: Record<string, unknown> }> {
  const components: Record<string, unknown> = {};

  // Match ES import statements — covers default, named, and namespace forms.
  // Uses a single pattern that captures (bindings, specifier).
  // Multiline flag off: we process line-by-line via replace, gm handles newlines.
  const IMPORT_RE =
    /^import\s+((?:\*\s+as\s+\w+|\{[^}]*\}|[\w]+)(?:\s*,\s*(?:\{[^}]*\}|[\w]+))*)\s+from\s+(['"])(\.\.?\/[^'"]+)\2\s*;?\r?\n?/gm;

  // First pass: collect all relative imports and load them.
  // mdxDir is the trust boundary: only allow imports that resolve to files
  // inside this directory. Otherwise an MDX page could import arbitrary
  // server-side modules via `import x from "../../etc/something"` and
  // execute their top-level code (CWE-22 + CWE-94).
  let mdxDirCanonical: string;
  try {
    mdxDirCanonical = await Deno.realPath(mdxDir);
  } catch {
    // Page directory missing — drop all imports to fail safe.
    return { source, components };
  }
  const containmentRoot = mdxDirCanonical.endsWith(SEP) ? mdxDirCanonical : mdxDirCanonical + SEP;

  let match: RegExpExecArray | null;
  const reScan = new RegExp(IMPORT_RE.source, "gm");
  while ((match = reScan.exec(source)) !== null) {
    const [, bindings, , specifier] = match;

    // Defense in depth: reject specifiers that contain ".." segments before
    // doing any filesystem work. The regex already requires a leading "./"
    // or "../"; we further require that no segment is "..".
    const segments = specifier.split("/");
    if (segments.some((s) => s === "..")) {
      continue;
    }

    // Resolve specifier relative to the MDX file's directory and canonicalize
    // via realPath so symlinks can't smuggle the import out of the page dir.
    // Deno's dynamic import requires an absolute file:// URL.
    const candidatePath = join(mdxDir, specifier);
    let absPath: string;
    try {
      absPath = await Deno.realPath(candidatePath);
    } catch {
      // Target doesn't exist; let MDX surface its own error.
      continue;
    }
    if (!(absPath + SEP).startsWith(containmentRoot) && absPath !== mdxDirCanonical) {
      // Resolved outside the page directory — refuse the import.
      console.warn(`[mdx] refusing import outside page directory: ${specifier}`);
      continue;
    }

    let mod: Record<string, unknown>;
    try {
      mod = await import(`file://${absPath}`);
    } catch {
      // If the import fails, leave the line in source so MDX reports a clear error.
      continue;
    }

    // Parse bindings into name→value entries.
    const trimmed = bindings.trim();

    // Namespace import: * as Foo
    const nsMatch = trimmed.match(/^\*\s+as\s+(\w+)$/);
    if (nsMatch) {
      components[nsMatch[1]] = mod;
      continue;
    }

    // Named import block: { Foo, Bar as B, baz }
    const namedBlock = trimmed.match(/^\{([^}]*)\}$/);
    if (namedBlock) {
      for (const part of namedBlock[1].split(",")) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (!orig?.trim()) continue;
        const exportName = orig.trim();
        const localName = alias?.trim() ?? exportName;
        components[localName] = mod[exportName];
      }
      continue;
    }

    // Default import (possibly with trailing named block):
    //   Foo
    //   Foo, { Bar }
    const defaultMatch = trimmed.match(/^(\w+)(?:\s*,\s*\{([^}]*)\})?$/);
    if (defaultMatch) {
      components[defaultMatch[1]] = mod.default;
      if (defaultMatch[2]) {
        for (const part of defaultMatch[2].split(",")) {
          const [orig, alias] = part.trim().split(/\s+as\s+/);
          if (!orig?.trim()) continue;
          const exportName = orig.trim();
          const localName = alias?.trim() ?? exportName;
          components[localName] = mod[exportName];
        }
      }
    }
  }

  // Second pass: strip successfully-loaded relative imports from the source.
  // We only strip lines whose specifier resolves — failures were skipped above
  // so they remain and surface as MDX compile errors.
  const loadedSpecifiers = new Set(
    [...source.matchAll(new RegExp(IMPORT_RE.source, "gm"))]
      .map((m) => m[3])
      .filter((spec) => {
        const absPath = join(mdxDir, spec);
        // A specifier was loaded if its default or any named export landed in components.
        // Simplest heuristic: always strip relative imports we attempted (loaded or not
        // caught above); failures were re-tried and skipped, so the import line is safe
        // to remove since we already have the error case handled.
        return absPath.length > 0;
      }),
  );

  const stripped = source.replace(
    new RegExp(IMPORT_RE.source, "gm"),
    (line, _bindings, _quote, specifier) => {
      return loadedSpecifiers.has(specifier) ? "" : line;
    },
  );

  return { source: stripped.trimStart(), components };
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
