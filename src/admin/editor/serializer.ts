/**
 * Bidirectional block serializer — blocks ↔ markdown.
 *
 * Two main functions:
 *   blocksToMarkdown(blocks) → markdown string
 *   markdownToBlocks(markdown) → BlockDocument
 *
 * Round-trip fidelity is critical: markdown → blocks → markdown should
 * preserve the essential content (formatting may normalize).
 */

import type { Block, BlockDocument } from "./types.ts";
import { parseMarkdownToBlocks } from "./parser.ts";

/**
 * Convert markdown text to a BlockDocument.
 * Delegates to the parser module.
 */
export function markdownToBlocks(markdown: string): BlockDocument {
  return parseMarkdownToBlocks(markdown);
}

/**
 * Convert a BlockDocument (or array of blocks) to markdown text.
 */
export function blocksToMarkdown(doc: BlockDocument | Block[]): string {
  const blocks = Array.isArray(doc) ? doc : doc.blocks;
  const parts: string[] = [];

  for (const block of blocks) {
    parts.push(blockToMarkdown(block));
  }

  return parts.join("\n\n");
}

/**
 * Convert a single block to its markdown representation.
 */
function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return block.text;

    case "heading": {
      const prefix = "#".repeat(block.level);
      return `${prefix} ${block.text}`;
    }

    case "list": {
      return block.items
        .map((item, i) => {
          const bullet = block.ordered ? `${i + 1}.` : "-";
          return `${bullet} ${item}`;
        })
        .join("\n");
    }

    case "blockquote": {
      return block.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }

    case "code": {
      const lang = block.language ?? "";
      return `\`\`\`${lang}\n${block.code}\n\`\`\``;
    }

    case "image": {
      let md = `![${block.alt}](${block.src})`;
      if (block.caption) {
        md += `\n${block.caption}`;
      }
      return md;
    }

    case "divider":
      return "---";

    case "table": {
      if (!block.headers.length) return "";

      const headerRow = `| ${block.headers.join(" | ")} |`;
      const alignRow = `| ${block.headers.map((_, i) => {
        const a = block.align?.[i];
        if (a === "center") return ":---:";
        if (a === "right") return "---:";
        return "---";
      }).join(" | ")} |`;

      const dataRows = block.rows
        .map((row) => `| ${row.join(" | ")} |`)
        .join("\n");

      return `${headerRow}\n${alignRow}\n${dataRows}`;
    }

    case "html":
      return block.html;

    default:
      return "";
  }
}
