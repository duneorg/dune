/**
 * Translation Memory (TM) utilities.
 *
 * Stores previously translated segment pairs so the admin UI can suggest
 * translations when editors are working on new pages.
 *
 * Storage: one JSON file per language pair at
 *   {contentDir}/_tm/{from}-{to}.json
 * Format:  { [sourceSegment: string]: translatedSegment }
 *
 * Segments are paragraph-level chunks extracted from raw Markdown.
 * Segment matching is exact (case-sensitive) — no fuzzy matching.
 */

import type { StorageAdapter } from "../storage/types.ts";

/** Sub-directory inside contentDir where TM files are stored. */
const TM_DIR = "_tm";

// ---------------------------------------------------------------------------
// Segment extraction
// ---------------------------------------------------------------------------

/**
 * Extract translatable text segments from raw Markdown / MDX content.
 *
 * Rules:
 *  - Strips YAML frontmatter (--- … ---) before processing.
 *  - Splits on blank lines (paragraph separator).
 *  - Discards fenced code blocks, pure image lines, HTML blocks, table
 *    separator rows, and very short/long segments.
 *  - Returns segments in document order, preserving Markdown markup so that
 *    pairs stay comparable when built from two parallel documents.
 */
export function extractSegments(rawContent: string): string[] {
  // Strip leading YAML frontmatter
  let content = rawContent;
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      content = content.slice(end + 4);
    }
  }

  const segments: string[] = [];
  const blocks = content.split(/\n{2,}/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Skip fenced code blocks
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) continue;

    // Skip pure HTML blocks
    if (trimmed.startsWith("<") && trimmed.includes(">")) continue;

    // Skip table separator rows (e.g.  | --- | --- |)
    if (/^[\s|:=-]+$/.test(trimmed)) continue;

    // Skip lines that are only an image embed with no surrounding text
    if (/^!\[.*?\]\(.*?\)$/.test(trimmed)) continue;

    // Discard segments that are too short (noise) or too long (entire pages)
    if (trimmed.length < 8 || trimmed.length > 800) continue;

    segments.push(trimmed);
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Building TM from parallel page pairs
// ---------------------------------------------------------------------------

/**
 * Derive TM entries from two parallel documents (source language and target
 * language version of the same page).
 *
 * Pairs segments by position.  Only produces entries when the extracted
 * segment counts match exactly — if a translator restructured the page the
 * alignment would be wrong and we'd rather produce nothing than wrong pairs.
 *
 * Returns a partial TM record { sourceSegment → targetSegment }.
 * Identical source/target pairs (untranslated segments) are excluded.
 */
export function buildTMFromPages(
  sourceContent: string,
  targetContent: string,
): Record<string, string> {
  const sourceSegs = extractSegments(sourceContent);
  const targetSegs = extractSegments(targetContent);

  if (sourceSegs.length === 0 || sourceSegs.length !== targetSegs.length) {
    return {};
  }

  const tm: Record<string, string> = {};
  for (let i = 0; i < sourceSegs.length; i++) {
    const src = sourceSegs[i];
    const tgt = targetSegs[i];
    // Skip identical pairs — translator hasn't changed the text yet
    if (src !== tgt) {
      tm[src] = tgt;
    }
  }
  return tm;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function tmFilePath(contentDir: string, from: string, to: string): string {
  return `${contentDir}/${TM_DIR}/${from}-${to}.json`;
}

/**
 * Load TM entries for a language pair.
 * Returns an empty object when the file does not exist yet.
 */
export async function loadTM(
  storage: StorageAdapter,
  contentDir: string,
  from: string,
  to: string,
): Promise<Record<string, string>> {
  const path = tmFilePath(contentDir, from, to);
  try {
    const text = await storage.readText(path);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist TM entries for a language pair.
 * Deletes the file when the TM is empty.
 */
export async function saveTM(
  storage: StorageAdapter,
  contentDir: string,
  from: string,
  to: string,
  tm: Record<string, string>,
): Promise<void> {
  const path = tmFilePath(contentDir, from, to);
  if (Object.keys(tm).length === 0) {
    try {
      await storage.delete(path);
    } catch {
      // File may not exist — that's fine
    }
    return;
  }
  // Sort keys for stable diffs
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(tm).sort()) {
    sorted[k] = tm[k];
  }
  await storage.write(path, JSON.stringify(sorted, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Return TM matches for a list of source segments.
 * Preserves document order; only returns segments that have a known target.
 */
export function lookupSuggestions(
  tm: Record<string, string>,
  segments: string[],
): Array<{ source: string; target: string }> {
  const results: Array<{ source: string; target: string }> = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    if (tm[seg] && !seen.has(seg)) {
      results.push({ source: seg, target: tm[seg] });
      seen.add(seg);
    }
  }
  return results;
}
