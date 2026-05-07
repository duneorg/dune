/**
 * TSX content format handler.
 *
 * TSX content files are full JSX components that serve as both content AND template.
 *
 * Frontmatter extraction (for content index — no code execution):
 *   - Fast path: read .frontmatter.yaml sidecar file
 *   - Fallback: AST-extract `export const frontmatter = { ... }` via regex on static literal
 *
 * Rendering:
 *   - Dynamic import of the TSX file at request time
 *   - Component receives ContentPageProps
 *   - Layout wrapping determined by frontmatter.layout
 */

import { parseUserYaml as parseYaml } from "../../security/safe-yaml.ts";
import { dirname, join } from "@std/path";
import type {
  ContentFormatHandler,
  Page,
  PageFrontmatter,
  RenderContext,
} from "../types.ts";

export class TsxHandler implements ContentFormatHandler {
  readonly extensions = [".tsx"];

  /**
   * Extract frontmatter from a TSX content file.
   *
   * Strategy:
   *   1. Check for .frontmatter.yaml sidecar (fast path, no parsing)
   *   2. Fallback: extract `export const frontmatter = { ... }` from source
   *      (static JSON-compatible object literal only — no function calls, no variables)
   */
  async extractFrontmatter(
    raw: string,
    filePath: string,
  ): Promise<PageFrontmatter> {
    // Fast path: try sidecar YAML
    const sidecar = await this.tryLoadSidecar(filePath);
    if (sidecar) return sidecar;

    // Fallback: extract from source
    return this.extractFromSource(raw, filePath);
  }

  /**
   * TSX content files don't have a separate "body" — the component IS the content.
   */
  extractBody(_raw: string, _filePath: string): string | null {
    return null;
  }

  /**
   * Render TSX content page.
   * Dynamically imports the TSX file and calls its default export.
   *
   * The actual layout wrapping is handled by the rendering engine,
   * not by this handler. This just produces the raw component output.
   */
  async renderToHtml(
    page: Page,
    _ctx: RenderContext,
  ): Promise<string> {
    // TSX pages render themselves via their component — the rendering engine
    // handles dynamic import and JSX rendering. This handler returns empty
    // to signal "use component rendering path".
    // The actual component is accessed via page.component().
    return "";
  }

  /**
   * Try to load a .frontmatter.yaml sidecar file.
   *
   * Given a file like `content/04.landing/page.tsx`,
   * looks for `content/04.landing/page.frontmatter.yaml`.
   */
  private async tryLoadSidecar(
    filePath: string,
  ): Promise<PageFrontmatter | null> {
    // Build sidecar path: page.tsx → page.frontmatter.yaml
    const dir = dirname(filePath);
    const basename = filePath.split("/").pop()!;
    const nameWithoutExt = basename.replace(/\.tsx$/, "");
    const sidecarPath = join(dir, `${nameWithoutExt}.frontmatter.yaml`);

    try {
      const text = await Deno.readTextFile(sidecarPath);
      const data = parseYaml(text);

      if (data && typeof data === "object" && !Array.isArray(data)) {
        return {
          title: "",
          published: true,
          visible: true,
          routable: true,
          ...(data as Record<string, unknown>),
        } as PageFrontmatter;
      }
    } catch {
      // Sidecar not found — fall through to source extraction
    }

    return null;
  }

  /**
   * Extract frontmatter from TSX source by parsing the static
   * `export const frontmatter = { ... }` expression.
   *
   * Constraint: The frontmatter object must be a JSON-compatible literal.
   * No function calls, no variable references, no template literals.
   *
   * Uses a balanced-brace extraction approach rather than a full AST parser
   * to keep dependencies minimal for v0.1.
   */
  private extractFromSource(
    raw: string,
    _filePath: string,
  ): PageFrontmatter {
    // Match: export const frontmatter = { ... }
    // We find the start, then count braces to find the matching close
    const exportMatch = raw.match(
      /export\s+const\s+frontmatter\s*=\s*\{/,
    );

    if (!exportMatch || exportMatch.index === undefined) {
      // No frontmatter found — return minimal defaults
      return {
        title: "",
        published: true,
        visible: true,
        routable: true,
      };
    }

    // Find the opening brace position
    const startIndex = exportMatch.index + exportMatch[0].length - 1;

    // Count braces to find the matching closing brace
    let depth = 0;
    let endIndex = -1;

    for (let i = startIndex; i < raw.length; i++) {
      const char = raw[i];

      // Skip string contents
      if (char === '"' || char === "'") {
        const quote = char;
        i++;
        while (i < raw.length && raw[i] !== quote) {
          if (raw[i] === "\\") i++; // skip escaped chars
          i++;
        }
        continue;
      }

      // Skip template literal contents
      if (char === "`") {
        i++;
        while (i < raw.length && raw[i] !== "`") {
          if (raw[i] === "\\") i++;
          i++;
        }
        continue;
      }

      // Skip line comments
      if (char === "/" && i + 1 < raw.length && raw[i + 1] === "/") {
        while (i < raw.length && raw[i] !== "\n") i++;
        continue;
      }

      // Skip block comments
      if (char === "/" && i + 1 < raw.length && raw[i + 1] === "*") {
        i += 2;
        while (i + 1 < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
        i++; // skip past closing /
        continue;
      }

      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) {
      // Unbalanced braces — return defaults
      return {
        title: "",
        published: true,
        visible: true,
        routable: true,
      };
    }

    // Extract the object literal source
    const objectSource = raw.slice(startIndex, endIndex + 1);

    try {
      // Convert JS object literal to JSON-parseable string:
      // - Replace single quotes with double quotes
      // - Remove trailing commas
      // - Handle unquoted keys
      const jsonized = this.jsObjectToJson(objectSource);
      const data = JSON.parse(jsonized);

      return {
        title: "",
        published: true,
        visible: true,
        routable: true,
        ...data,
      } as PageFrontmatter;
    } catch {
      // Couldn't parse — return defaults
      // In production this would log a warning
      return {
        title: "",
        published: true,
        visible: true,
        routable: true,
      };
    }
  }

  /**
   * Convert a JavaScript object literal string to valid JSON.
   *
   * Handles:
   *   - Unquoted keys: { title: "..." } → { "title": "..." }
   *   - Single quotes: 'value' → "value"
   *   - Trailing commas: { a: 1, } → { a: 1 }
   *   - Line comments: // ... → removed
   *   - false/true/null literals
   */
  private jsObjectToJson(source: string): string {
    let result = source;

    // Remove line comments (// ...)
    result = result.replace(/\/\/[^\n]*/g, "");

    // Remove block comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");

    // Replace single-quoted strings with double-quoted
    // This is simplified — handles basic cases
    result = result.replace(
      /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
      (_match, content: string) => `"${content.replace(/"/g, '\\"')}"`,
    );

    // Quote unquoted keys: { key: → { "key":
    result = result.replace(
      /(?<=[\{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
      '"$1":',
    );

    // Remove trailing commas before } or ]
    result = result.replace(/,\s*([\}\]])/g, "$1");

    return result;
  }
}
