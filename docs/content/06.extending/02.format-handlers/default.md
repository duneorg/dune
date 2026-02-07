---
title: "Custom Format Handlers"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [advanced]
  topic: [extending, formats]
metadata:
  description: "Adding new content formats to Dune"
---

# Custom Format Handlers

Dune's content system is pluggable. Adding a new content format — RST, AsciiDoc, Djot, or anything else — is a matter of implementing the `ContentFormatHandler` interface and registering it.

## The ContentFormatHandler interface

```typescript
interface ContentFormatHandler {
  /** File extensions this handler supports */
  extensions: string[];

  /** Extract frontmatter (must be fast — used during indexing) */
  extractFrontmatter(raw: string, filePath: string): Promise<PageFrontmatter>;

  /** Extract the raw content body (without frontmatter) */
  extractBody(raw: string, filePath: string): string | null;

  /** Render content to HTML (called at request time) */
  renderToHtml(page: Page, ctx: RenderContext): Promise<string>;
}
```

Three methods, each with a clear responsibility:

1. **`extractFrontmatter`** — Parse metadata. Called during indexing. Must be fast and must not execute code.
2. **`extractBody`** — Separate content from metadata. Returns `null` for self-rendering formats (like TSX).
3. **`renderToHtml`** — Convert content to HTML. Called on demand when a page is requested.

## Example: AsciiDoc handler

```typescript
import type { ContentFormatHandler, Page, PageFrontmatter, RenderContext } from "dune/types";

export class AsciiDocHandler implements ContentFormatHandler {
  extensions = [".adoc", ".asciidoc"];

  async extractFrontmatter(raw: string, _filePath: string): Promise<PageFrontmatter> {
    // AsciiDoc uses = Title as first line, then :attribute: value pairs
    const lines = raw.split("\n");
    const attrs: Record<string, string> = {};

    for (const line of lines) {
      const match = line.match(/^:(\w+):\s*(.+)$/);
      if (match) {
        attrs[match[1]] = match[2];
      } else if (line.startsWith("=")) {
        attrs.title = line.replace(/^=+\s*/, "");
      } else if (line.trim() === "") {
        break; // blank line ends header
      }
    }

    return {
      title: attrs.title || "",
      published: attrs.published !== "false",
      visible: true,
      routable: true,
    };
  }

  extractBody(raw: string, _filePath: string): string | null {
    // Everything after the first blank line
    const index = raw.indexOf("\n\n");
    return index >= 0 ? raw.slice(index + 2) : raw;
  }

  async renderToHtml(page: Page, _ctx: RenderContext): Promise<string> {
    // Use an AsciiDoc library to render
    const asciidoctor = await import("npm:asciidoctor");
    const processor = asciidoctor.default();
    return processor.convert(page.rawContent || "");
  }
}
```

## Registration

Register your handler when creating the Dune engine:

```typescript
import { createDuneEngine, MarkdownHandler, TsxHandler } from "dune";
import { AsciiDocHandler } from "./plugins/asciidoc-handler.ts";

const engine = await createDuneEngine({
  formats: [
    new MarkdownHandler(),
    new TsxHandler(),
    new AsciiDocHandler(),   // your custom format
  ],
});
```

Now `.adoc` files in your `content/` directory are treated as first-class content pages, with the same routing, collections, taxonomy, and templating as Markdown and TSX.

## Guidelines

**`extractFrontmatter` must be fast.** It runs for every content file during indexing. Don't execute content, don't import heavy libraries, don't do I/O beyond reading the file.

**`extractBody` should be pure.** Just string splitting — separate frontmatter from body.

**`renderToHtml` can be expensive.** It only runs on demand when a specific page is requested. It's cached. Use heavy libraries here.
