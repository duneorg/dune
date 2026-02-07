/**
 * Block editor types — structured data model for content blocks.
 *
 * Blocks are the intermediate representation between the visual editor
 * and the stored markdown/content format. The serializer handles
 * bidirectional conversion: markdown ↔ blocks.
 */

/** All supported block types */
export type BlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "blockquote"
  | "code"
  | "image"
  | "divider"
  | "table"
  | "html";

/** Base block interface — all blocks share these fields */
export interface BaseBlock {
  /** Unique client-side ID (not persisted) */
  id: string;
  /** Block type discriminator */
  type: BlockType;
}

/** Paragraph block — inline-formatted text */
export interface ParagraphBlock extends BaseBlock {
  type: "paragraph";
  /** Markdown-formatted text (may contain **bold**, *italic*, `code`, [links]()) */
  text: string;
}

/** Heading block — h1 through h6 */
export interface HeadingBlock extends BaseBlock {
  type: "heading";
  /** Heading level 1-6 */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Heading text (may contain inline markdown) */
  text: string;
}

/** List block — ordered or unordered */
export interface ListBlock extends BaseBlock {
  type: "list";
  /** List style */
  ordered: boolean;
  /** List items (each may contain inline markdown) */
  items: string[];
}

/** Blockquote block */
export interface BlockquoteBlock extends BaseBlock {
  type: "blockquote";
  /** Quoted text (may contain inline markdown) */
  text: string;
}

/** Code block — fenced code with optional language */
export interface CodeBlock extends BaseBlock {
  type: "code";
  /** Programming language (e.g. "typescript", "bash") */
  language: string;
  /** Code content (raw, no markdown processing) */
  code: string;
}

/** Image block — single image with alt text and optional caption */
export interface ImageBlock extends BaseBlock {
  type: "image";
  /** Image source (filename for co-located, or full URL) */
  src: string;
  /** Alt text */
  alt: string;
  /** Optional caption displayed below image */
  caption?: string;
}

/** Divider block — horizontal rule */
export interface DividerBlock extends BaseBlock {
  type: "divider";
}

/** Table block — rows and columns */
export interface TableBlock extends BaseBlock {
  type: "table";
  /** Header row */
  headers: string[];
  /** Data rows */
  rows: string[][];
  /** Column alignment */
  align?: ("left" | "center" | "right" | null)[];
}

/** HTML block — raw HTML passthrough */
export interface HtmlBlock extends BaseBlock {
  type: "html";
  /** Raw HTML content */
  html: string;
}

/** Union of all block types */
export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | BlockquoteBlock
  | CodeBlock
  | ImageBlock
  | DividerBlock
  | TableBlock
  | HtmlBlock;

/** Document model — ordered array of blocks */
export interface BlockDocument {
  /** Content blocks in display order */
  blocks: Block[];
  /** Document version for future migrations */
  version: 1;
}

/**
 * Generate a unique block ID.
 * Uses crypto.randomUUID() for uniqueness.
 */
export function generateBlockId(): string {
  return crypto.randomUUID().slice(0, 8);
}
