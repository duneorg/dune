/**
 * Markdown → Blocks parser.
 *
 * Uses marked's lexer to tokenize markdown, then maps tokens to Block types.
 * This is the "markdown → blocks" direction of the serializer.
 */

import { Marked } from "marked";
import type {
  Block,
  BlockDocument,
  HeadingBlock,
  ListBlock,
  CodeBlock,
  ImageBlock,
  TableBlock,
} from "./types.ts";
import { generateBlockId } from "./types.ts";

const marked = new Marked();

/**
 * Parse markdown text into a BlockDocument.
 */
export function parseMarkdownToBlocks(markdown: string): BlockDocument {
  const tokens = marked.lexer(markdown);
  const blocks: Block[] = [];

  for (const token of tokens) {
    const block = tokenToBlock(token);
    if (block) {
      blocks.push(block);
    }
  }

  return { blocks, version: 1 };
}

/**
 * Convert a single marked token to a Block.
 * Returns null for tokens that don't map to blocks (e.g. space tokens).
 */
function tokenToBlock(token: any): Block | null {
  switch (token.type) {
    case "heading":
      return {
        id: generateBlockId(),
        type: "heading",
        level: token.depth as HeadingBlock["level"],
        text: token.text ?? "",
      };

    case "paragraph": {
      // Check if this paragraph is just an image
      const imgMatch = (token.text ?? "").match(
        /^!\[([^\]]*)\]\(([^)]+)\)(?:\s*\n(.+))?$/,
      );
      if (imgMatch) {
        return {
          id: generateBlockId(),
          type: "image",
          alt: imgMatch[1],
          src: imgMatch[2],
          caption: imgMatch[3] ?? undefined,
        } as ImageBlock;
      }

      return {
        id: generateBlockId(),
        type: "paragraph",
        text: token.text ?? "",
      };
    }

    case "list": {
      const items = (token.items ?? []).map((item: any) => item.text ?? "");
      return {
        id: generateBlockId(),
        type: "list",
        ordered: token.ordered ?? false,
        items,
      } as ListBlock;
    }

    case "blockquote": {
      // Extract text from blockquote tokens
      const text = (token.tokens ?? [])
        .map((t: any) => t.text ?? "")
        .join("\n");
      return {
        id: generateBlockId(),
        type: "blockquote",
        text,
      };
    }

    case "code":
      return {
        id: generateBlockId(),
        type: "code",
        language: token.lang ?? "",
        code: token.text ?? "",
      } as CodeBlock;

    case "hr":
      return {
        id: generateBlockId(),
        type: "divider",
      };

    case "table": {
      const headers = (token.header ?? []).map((h: any) => h.text ?? "");
      const rows = (token.rows ?? []).map((row: any[]) =>
        row.map((cell: any) => cell.text ?? ""),
      );
      const align = (token.align ?? []) as TableBlock["align"];
      return {
        id: generateBlockId(),
        type: "table",
        headers,
        rows,
        align,
      } as TableBlock;
    }

    case "html":
      return {
        id: generateBlockId(),
        type: "html",
        html: (token.text ?? "").trim(),
      };

    case "space":
      return null;

    default:
      // Unknown token type — wrap as paragraph
      if (token.text) {
        return {
          id: generateBlockId(),
          type: "paragraph",
          text: token.text,
        };
      }
      return null;
  }
}
