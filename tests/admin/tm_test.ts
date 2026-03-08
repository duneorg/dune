/**
 * Tests for Translation Memory utilities (src/admin/tm.ts)
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractSegments,
  buildTMFromPages,
  lookupSuggestions,
  loadTM,
  saveTM,
} from "../../src/admin/tm.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

// === extractSegments ===

Deno.test("extractSegments: strips frontmatter", () => {
  const content = `---
title: Hello
---

This is the first paragraph.

And a second paragraph here.`;
  const segs = extractSegments(content);
  assertEquals(segs, [
    "This is the first paragraph.",
    "And a second paragraph here.",
  ]);
});

Deno.test("extractSegments: returns paragraphs in order", () => {
  const content = `First paragraph.

Second paragraph.

Third paragraph.`;
  const segs = extractSegments(content);
  assertEquals(segs, ["First paragraph.", "Second paragraph.", "Third paragraph."]);
});

Deno.test("extractSegments: skips fenced code blocks", () => {
  const content = `A normal paragraph.

\`\`\`typescript
const x = 1;
\`\`\`

Another paragraph.`;
  const segs = extractSegments(content);
  assertEquals(segs, ["A normal paragraph.", "Another paragraph."]);
});

Deno.test("extractSegments: skips HTML blocks", () => {
  const content = `Normal text here.

<div class="foo">Some html</div>

More text.`;
  const segs = extractSegments(content);
  assertEquals(segs, ["Normal text here.", "More text."]);
});

Deno.test("extractSegments: skips table separator rows", () => {
  const content = `Some intro text here.

| A | B |
| --- | --- |
| 1 | 2 |

Closing text.`;
  const segs = extractSegments(content);
  // Table separator "| --- | --- |" skipped; other rows may or may not be included
  // depending on length. Main check: table separators don't appear.
  const hasTableSep = segs.some((s) => /^[\s|:-]+$/.test(s));
  assertEquals(hasTableSep, false);
});

Deno.test("extractSegments: skips pure image lines", () => {
  const content = `Text before image.

![Alt text](image.jpg)

Text after image.`;
  const segs = extractSegments(content);
  assertEquals(segs, ["Text before image.", "Text after image."]);
});

Deno.test("extractSegments: skips very short segments", () => {
  const content = `OK

This is a proper paragraph with enough content.`;
  const segs = extractSegments(content);
  // "OK" is 2 chars — below threshold
  assertEquals(segs, ["This is a proper paragraph with enough content."]);
});

Deno.test("extractSegments: handles content without frontmatter", () => {
  const content = `First paragraph without frontmatter.

Second paragraph.`;
  const segs = extractSegments(content);
  assertEquals(segs, ["First paragraph without frontmatter.", "Second paragraph."]);
});

// === buildTMFromPages ===

Deno.test("buildTMFromPages: pairs matching segments", () => {
  const source = `First paragraph in English.

Second paragraph in English.`;
  const target = `Erster Absatz auf Deutsch.

Zweiter Absatz auf Deutsch.`;
  const tm = buildTMFromPages(source, target);
  assertEquals(tm["First paragraph in English."], "Erster Absatz auf Deutsch.");
  assertEquals(tm["Second paragraph in English."], "Zweiter Absatz auf Deutsch.");
});

Deno.test("buildTMFromPages: returns empty when segment counts differ", () => {
  const source = `Para one.\n\nPara two.\n\nPara three.`;
  const target = `Absatz eins.\n\nAbsatz zwei.`;
  const tm = buildTMFromPages(source, target);
  assertEquals(Object.keys(tm).length, 0);
});

Deno.test("buildTMFromPages: skips identical source/target pairs", () => {
  const source = `Untranslated paragraph here.`;
  const target = `Untranslated paragraph here.`;
  const tm = buildTMFromPages(source, target);
  // Identical pair should not be stored (not actually translated)
  assertEquals(Object.keys(tm).length, 0);
});

Deno.test("buildTMFromPages: returns empty when source is empty", () => {
  const tm = buildTMFromPages("", "Some content here.");
  assertEquals(Object.keys(tm).length, 0);
});

// === lookupSuggestions ===

Deno.test("lookupSuggestions: finds exact matches", () => {
  const tm = { "Hello World": "Hallo Welt", "Read more": "Mehr lesen" };
  const results = lookupSuggestions(tm, ["Hello World", "Read more", "No match"]);
  assertEquals(results.length, 2);
  assertEquals(results[0], { source: "Hello World", target: "Hallo Welt" });
  assertEquals(results[1], { source: "Read more", target: "Mehr lesen" });
});

Deno.test("lookupSuggestions: deduplicates repeated segments", () => {
  const tm = { "Repeated text here.": "Wiederholter Text hier." };
  const results = lookupSuggestions(tm, [
    "Repeated text here.",
    "Repeated text here.",
  ]);
  assertEquals(results.length, 1);
});

Deno.test("lookupSuggestions: returns empty when no matches", () => {
  const tm = { "Known phrase.": "Bekannte Phrase." };
  const results = lookupSuggestions(tm, ["Unknown segment here.", "Another unknown."]);
  assertEquals(results.length, 0);
});

Deno.test("lookupSuggestions: returns empty for empty TM", () => {
  const results = lookupSuggestions({}, ["Some text here."]);
  assertEquals(results.length, 0);
});

// === loadTM / saveTM (with in-memory storage stub) ===

function makeMemoryStorage(): StorageAdapter & { _files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    _files: files,
    async read(path) {
      const t = files.get(path);
      if (!t) throw new Error("Not found: " + path);
      return new TextEncoder().encode(t);
    },
    async readText(path) {
      const t = files.get(path);
      if (!t) throw new Error("Not found: " + path);
      return t;
    },
    async write(path, data) {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      files.set(path, text);
    },
    async exists(path) { return files.has(path); },
    async delete(path) { files.delete(path); },
    async rename(o, n) {
      const v = files.get(o);
      if (!v) throw new Error("Not found");
      files.set(n, v);
      files.delete(o);
    },
    async list(_path) { return []; },
    async listRecursive(_path) { return []; },
    async stat(_path) { return { size: 0, mtime: 0, isFile: true, isDirectory: false }; },
    async getJSON(_key) { return null; },
    async setJSON(_key, _value, _ttl) {},
    async deleteJSON(_key) {},
    watch(_path, _cb) { return () => {}; },
  };
}

Deno.test("loadTM: returns empty object when file does not exist", async () => {
  const storage = makeMemoryStorage();
  const tm = await loadTM(storage, "/content", "en", "de");
  assertEquals(tm, {});
});

Deno.test("saveTM / loadTM: round-trips TM data", async () => {
  const storage = makeMemoryStorage();
  const original = { "Hello World": "Hallo Welt", "Read more": "Mehr lesen" };
  await saveTM(storage, "/content", "en", "de", original);
  const loaded = await loadTM(storage, "/content", "en", "de");
  assertEquals(loaded["Hello World"], "Hallo Welt");
  assertEquals(loaded["Read more"], "Mehr lesen");
});

Deno.test("saveTM: deletes file when TM is empty", async () => {
  const storage = makeMemoryStorage();
  // Write something first
  await saveTM(storage, "/content", "en", "fr", { "Hello": "Bonjour" });
  // Now save empty TM
  await saveTM(storage, "/content", "en", "fr", {});
  // File should be gone
  const tm = await loadTM(storage, "/content", "en", "fr");
  assertEquals(tm, {});
});

Deno.test("saveTM: stores keys in sorted order", async () => {
  const storage = makeMemoryStorage();
  await saveTM(storage, "/content", "en", "de", {
    "Zebra text here.": "Zebra Text.",
    "Apple text here.": "Apfel Text.",
  });
  const raw = storage._files.get("/content/_tm/en-de.json")!;
  const keys = Object.keys(JSON.parse(raw));
  assertEquals(keys[0], "Apple text here.");
  assertEquals(keys[1], "Zebra text here.");
});
