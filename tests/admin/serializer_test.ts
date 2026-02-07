/**
 * Tests for block editor serializer — bidirectional markdown ↔ blocks conversion.
 *
 * Round-trip fidelity is critical: markdown → blocks → markdown should
 * preserve essential content structure.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { markdownToBlocks, blocksToMarkdown } from "../../src/admin/editor/serializer.ts";
import { parseMarkdownToBlocks } from "../../src/admin/editor/parser.ts";
import type {
  Block,
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  CodeBlock,
  ImageBlock,
  TableBlock,
  BlockquoteBlock,
} from "../../src/admin/editor/types.ts";

// === Parsing: Markdown → Blocks ===

Deno.test("parser: empty string produces empty blocks", () => {
  const doc = markdownToBlocks("");
  assertEquals(doc.blocks.length, 0);
  assertEquals(doc.version, 1);
});

Deno.test("parser: single paragraph", () => {
  const doc = markdownToBlocks("Hello world");
  assertEquals(doc.blocks.length, 1);
  assertEquals(doc.blocks[0].type, "paragraph");
  assertEquals((doc.blocks[0] as ParagraphBlock).text, "Hello world");
});

Deno.test("parser: paragraph with inline formatting", () => {
  const doc = markdownToBlocks("Text with **bold** and *italic* and `code`.");
  assertEquals(doc.blocks.length, 1);
  assertEquals(doc.blocks[0].type, "paragraph");
  assertEquals(
    (doc.blocks[0] as ParagraphBlock).text,
    "Text with **bold** and *italic* and `code`.",
  );
});

Deno.test("parser: heading levels", () => {
  const doc = markdownToBlocks("# H1\n\n## H2\n\n### H3\n\n#### H4");
  const headings = doc.blocks.filter((b) => b.type === "heading") as HeadingBlock[];
  assertEquals(headings.length, 4);
  assertEquals(headings[0].level, 1);
  assertEquals(headings[0].text, "H1");
  assertEquals(headings[1].level, 2);
  assertEquals(headings[2].level, 3);
  assertEquals(headings[3].level, 4);
});

Deno.test("parser: unordered list", () => {
  const doc = markdownToBlocks("- Item one\n- Item two\n- Item three");
  assertEquals(doc.blocks.length, 1);
  const list = doc.blocks[0] as ListBlock;
  assertEquals(list.type, "list");
  assertEquals(list.ordered, false);
  assertEquals(list.items.length, 3);
  assertEquals(list.items[0], "Item one");
  assertEquals(list.items[2], "Item three");
});

Deno.test("parser: ordered list", () => {
  const doc = markdownToBlocks("1. First\n2. Second\n3. Third");
  assertEquals(doc.blocks.length, 1);
  const list = doc.blocks[0] as ListBlock;
  assertEquals(list.type, "list");
  assertEquals(list.ordered, true);
  assertEquals(list.items.length, 3);
});

Deno.test("parser: code block with language", () => {
  const doc = markdownToBlocks("```typescript\nconst x = 42;\nconsole.log(x);\n```");
  assertEquals(doc.blocks.length, 1);
  const code = doc.blocks[0] as CodeBlock;
  assertEquals(code.type, "code");
  assertEquals(code.language, "typescript");
  assertEquals(code.code, "const x = 42;\nconsole.log(x);");
});

Deno.test("parser: code block without language", () => {
  const doc = markdownToBlocks("```\nhello world\n```");
  assertEquals(doc.blocks.length, 1);
  const code = doc.blocks[0] as CodeBlock;
  assertEquals(code.type, "code");
  assertEquals(code.language, "");
  assertEquals(code.code, "hello world");
});

Deno.test("parser: blockquote", () => {
  const doc = markdownToBlocks("> This is a quote");
  assertEquals(doc.blocks.length, 1);
  assertEquals(doc.blocks[0].type, "blockquote");
  assertEquals((doc.blocks[0] as BlockquoteBlock).text, "This is a quote");
});

Deno.test("parser: horizontal rule", () => {
  const doc = markdownToBlocks("---");
  assertEquals(doc.blocks.length, 1);
  assertEquals(doc.blocks[0].type, "divider");
});

Deno.test("parser: image as paragraph", () => {
  const doc = markdownToBlocks("![Alt text](image.jpg)");
  assertEquals(doc.blocks.length, 1);
  const img = doc.blocks[0] as ImageBlock;
  assertEquals(img.type, "image");
  assertEquals(img.src, "image.jpg");
  assertEquals(img.alt, "Alt text");
});

Deno.test("parser: table", () => {
  const md = "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |";
  const doc = markdownToBlocks(md);
  assertEquals(doc.blocks.length, 1);
  const table = doc.blocks[0] as TableBlock;
  assertEquals(table.type, "table");
  assertEquals(table.headers.length, 2);
  assertEquals(table.headers[0], "Name");
  assertEquals(table.rows.length, 2);
  assertEquals(table.rows[0][0], "Alice");
  assertEquals(table.rows[1][1], "25");
});

Deno.test("parser: multiple block types", () => {
  const md = `# Title

A paragraph.

- Item one
- Item two

\`\`\`js
const x = 1;
\`\`\`

---

> Quote here`;

  const doc = markdownToBlocks(md);
  assertEquals(doc.blocks.length, 6);
  assertEquals(doc.blocks[0].type, "heading");
  assertEquals(doc.blocks[1].type, "paragraph");
  assertEquals(doc.blocks[2].type, "list");
  assertEquals(doc.blocks[3].type, "code");
  assertEquals(doc.blocks[4].type, "divider");
  assertEquals(doc.blocks[5].type, "blockquote");
});

Deno.test("parser: blocks have unique IDs", () => {
  const doc = markdownToBlocks("# H1\n\nParagraph\n\n- Item");
  const ids = doc.blocks.map((b) => b.id);
  assertEquals(new Set(ids).size, ids.length); // All unique
});

// === Serialization: Blocks → Markdown ===

Deno.test("serializer: paragraph block", () => {
  const blocks: Block[] = [
    { id: "1", type: "paragraph", text: "Hello world" },
  ];
  assertEquals(blocksToMarkdown(blocks), "Hello world");
});

Deno.test("serializer: heading block", () => {
  const blocks: Block[] = [
    { id: "1", type: "heading", level: 2, text: "Section Title" },
  ];
  assertEquals(blocksToMarkdown(blocks), "## Section Title");
});

Deno.test("serializer: unordered list block", () => {
  const blocks: Block[] = [
    { id: "1", type: "list", ordered: false, items: ["One", "Two", "Three"] },
  ];
  assertEquals(blocksToMarkdown(blocks), "- One\n- Two\n- Three");
});

Deno.test("serializer: ordered list block", () => {
  const blocks: Block[] = [
    { id: "1", type: "list", ordered: true, items: ["First", "Second"] },
  ];
  assertEquals(blocksToMarkdown(blocks), "1. First\n2. Second");
});

Deno.test("serializer: code block with language", () => {
  const blocks: Block[] = [
    { id: "1", type: "code", language: "ts", code: "const x = 1;" },
  ];
  assertEquals(blocksToMarkdown(blocks), "```ts\nconst x = 1;\n```");
});

Deno.test("serializer: blockquote block", () => {
  const blocks: Block[] = [
    { id: "1", type: "blockquote", text: "Wise words" },
  ];
  assertEquals(blocksToMarkdown(blocks), "> Wise words");
});

Deno.test("serializer: image block", () => {
  const blocks: Block[] = [
    { id: "1", type: "image", src: "photo.jpg", alt: "A photo" },
  ];
  assertEquals(blocksToMarkdown(blocks), "![A photo](photo.jpg)");
});

Deno.test("serializer: image block with caption", () => {
  const blocks: Block[] = [
    { id: "1", type: "image", src: "photo.jpg", alt: "Photo", caption: "My caption" },
  ];
  assertEquals(blocksToMarkdown(blocks), "![Photo](photo.jpg)\nMy caption");
});

Deno.test("serializer: divider block", () => {
  const blocks: Block[] = [{ id: "1", type: "divider" }];
  assertEquals(blocksToMarkdown(blocks), "---");
});

Deno.test("serializer: table block", () => {
  const blocks: Block[] = [
    {
      id: "1",
      type: "table",
      headers: ["Name", "Age"],
      rows: [["Alice", "30"], ["Bob", "25"]],
    },
  ];
  const md = blocksToMarkdown(blocks);
  assertEquals(md.includes("| Name | Age |"), true);
  assertEquals(md.includes("| Alice | 30 |"), true);
  assertEquals(md.includes("| Bob | 25 |"), true);
});

Deno.test("serializer: html block", () => {
  const blocks: Block[] = [
    { id: "1", type: "html", html: "<div class=\"custom\">Content</div>" },
  ];
  assertEquals(blocksToMarkdown(blocks), '<div class="custom">Content</div>');
});

Deno.test("serializer: multiple blocks separated by blank lines", () => {
  const blocks: Block[] = [
    { id: "1", type: "heading", level: 1, text: "Title" },
    { id: "2", type: "paragraph", text: "Body text." },
  ];
  assertEquals(blocksToMarkdown(blocks), "# Title\n\nBody text.");
});

Deno.test("serializer: accepts BlockDocument", () => {
  const doc = { version: 1 as const, blocks: [
    { id: "1", type: "paragraph" as const, text: "Test" },
  ] };
  assertEquals(blocksToMarkdown(doc), "Test");
});

// === Round-trip fidelity ===

Deno.test("round-trip: simple paragraph", () => {
  const original = "Hello world";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: heading", () => {
  const original = "## My Section";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: code block", () => {
  const original = "```typescript\nconst x = 42;\n```";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: unordered list", () => {
  const original = "- Alpha\n- Beta\n- Gamma";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: blockquote", () => {
  const original = "> A wise quote";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: divider", () => {
  const original = "---";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: image", () => {
  const original = "![Alt](image.jpg)";
  const roundTripped = blocksToMarkdown(markdownToBlocks(original));
  assertEquals(roundTripped, original);
});

Deno.test("round-trip: complex document structure preserved", () => {
  const original = `# Title

A paragraph with **bold** text.

- Item one
- Item two

\`\`\`js
const x = 1;
\`\`\`

---

> A quote`;

  const doc = markdownToBlocks(original);
  const result = blocksToMarkdown(doc);

  // Verify all block types are present
  assertEquals(result.includes("# Title"), true);
  assertEquals(result.includes("A paragraph with **bold** text."), true);
  assertEquals(result.includes("- Item one"), true);
  assertEquals(result.includes("```js"), true);
  assertEquals(result.includes("const x = 1;"), true);
  assertEquals(result.includes("---"), true);
  assertEquals(result.includes("> A quote"), true);
});

Deno.test("round-trip: table", () => {
  const original = "| A | B |\n| --- | --- |\n| 1 | 2 |";
  const doc = markdownToBlocks(original);
  const result = blocksToMarkdown(doc);
  assertEquals(result.includes("| A | B |"), true);
  assertEquals(result.includes("| 1 | 2 |"), true);
});

// === Edge cases ===

Deno.test("parser: handles empty lines gracefully", () => {
  const doc = markdownToBlocks("\n\n\n");
  // Should not crash, may produce empty blocks or no blocks
  assertEquals(doc.version, 1);
});

Deno.test("serializer: empty blocks array", () => {
  assertEquals(blocksToMarkdown([]), "");
});

Deno.test("serializer: empty BlockDocument", () => {
  assertEquals(blocksToMarkdown({ version: 1, blocks: [] }), "");
});

Deno.test("parser: paragraph with links", () => {
  const doc = markdownToBlocks("Visit [example](https://example.com) for more.");
  assertEquals(doc.blocks.length, 1);
  assertEquals(doc.blocks[0].type, "paragraph");
  assertEquals(
    (doc.blocks[0] as ParagraphBlock).text,
    "Visit [example](https://example.com) for more.",
  );
});

Deno.test("parser: absolute URL image preserved", () => {
  const doc = markdownToBlocks("![Logo](https://example.com/logo.png)");
  const img = doc.blocks[0] as ImageBlock;
  assertEquals(img.type, "image");
  assertEquals(img.src, "https://example.com/logo.png");
});
