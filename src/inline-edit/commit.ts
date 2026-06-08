/**
 * Commit logic: flush a live Y.js document to a history revision and write
 * the committed Markdown back to the content file on disk.
 *
 * This is the "Save" action.  It does NOT write directly to the `.md` file
 * without going through the history engine — every commit creates a revision.
 *
 * Body serialisation: the Y.js shared text type "body" holds the Markdown
 * source.  On the client, TipTap serialises its document back to Markdown
 * before writing to the Y.js text; what we persist here is that Markdown.
 */

import * as Y from "yjs";
import { parseUserYaml as parseYaml } from "../security/safe-yaml.ts";
import { stringify as stringifyYaml } from "@std/yaml";
import type { StorageAdapter } from "../storage/types.ts";
import type { HistoryEngine } from "../history/engine.ts";
import { getDocBody } from "./ydoc-manager.ts";

// ── File splitting helpers ─────────────────────────────────────────────────────

/** Split a raw content file into frontmatter header and body. */
export function splitFile(raw: string): { header: string; frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^(---\r?\n([\s\S]*?)\r?\n---\r?\n?)([\s\S]*)$/);
  if (match) {
    let fm: Record<string, unknown> = {};
    try {
      fm = (parseYaml(match[2]) ?? {}) as Record<string, unknown>;
    } catch { /* malformed YAML — treat as empty */ }
    return { header: match[1], frontmatter: fm, body: match[3] };
  }
  return { header: "", frontmatter: {}, body: raw };
}

/** Splice a new body back into a file, preserving the frontmatter header. */
export function spliceBody(header: string, newBody: string): string {
  if (!header) return newBody;
  // Ensure a single newline between header and body.
  return header.endsWith("\n") ? header + newBody : header + "\n" + newBody;
}

/**
 * Splice updated frontmatter fields into a raw file string.
 * Replaces only the specified keys; leaves all other frontmatter intact.
 */
export function spliceFrontmatter(
  raw: string,
  fields: Record<string, unknown>,
): string {
  const { header: _h, frontmatter, body } = splitFile(raw);
  const updated = { ...frontmatter, ...fields };
  const newHeader = `---\n${stringifyYaml(updated)}---\n`;
  return spliceBody(newHeader, body);
}

// ── Commit ─────────────────────────────────────────────────────────────────────

/**
 * Flush the Y.js document body to disk via the history engine.
 *
 * Steps:
 * 1. Get current body from Y.Doc.
 * 2. Read current raw file from storage.
 * 3. Splice new body in, preserving frontmatter.
 * 4. Record a revision via the history engine.
 * 5. Write the new content to the `.md` file.
 */
export async function commitDoc(opts: {
  doc: Y.Doc;
  sourcePath: string;
  author: string;
  storage: StorageAdapter;
  history: HistoryEngine;
  contentDir: string;
}): Promise<void> {
  const { doc, sourcePath, author, storage, history, contentDir } = opts;
  const body = getDocBody(doc);

  const filePath = `${contentDir}/${sourcePath}`;
  let raw = "";
  try {
    raw = await storage.readText(filePath);
  } catch {
    // File may not exist if this is a brand-new draft — start with empty header.
  }

  const { header, frontmatter } = splitFile(raw);
  const committed = spliceBody(header, body);

  // Record revision first (creates history entry).
  await history.record({
    sourcePath,
    content: committed,
    frontmatter,
    author,
    message: "Inline edit",
  });

  // Write to disk.
  await storage.write(filePath, committed);
}

// ── Field patch ────────────────────────────────────────────────────────────────

/**
 * Patch individual frontmatter fields without touching the Markdown body.
 * Writes through the history engine (creates a revision).
 *
 * **Special key `__body`**: when `fields.__body` is present, the Markdown body
 * is replaced with its value (a raw Markdown string).  This is used by the
 * auto-overlay plain-textarea editor which cannot go through the Y.js pathway.
 * All other keys in `fields` are treated as frontmatter fields as normal.
 */
export async function patchFrontmatterFields(opts: {
  sourcePath: string;
  fields: Record<string, unknown>;
  author: string;
  storage: StorageAdapter;
  history: HistoryEngine;
  contentDir: string;
}): Promise<void> {
  const { sourcePath, author, storage, history, contentDir } = opts;
  const fields = { ...opts.fields };

  const filePath = `${contentDir}/${sourcePath}`;
  let raw = "";
  try {
    raw = await storage.readText(filePath);
  } catch { /* new file */ }

  // Extract and remove the special __body key before frontmatter patching.
  let newBody: string | undefined;
  if (typeof fields.__body === "string") {
    newBody = fields.__body;
    delete fields.__body;
  }

  // Patch frontmatter fields (may be empty after removing __body).
  let patched = Object.keys(fields).length > 0
    ? spliceFrontmatter(raw, fields)
    : raw;

  // Replace body if __body was provided.
  if (newBody !== undefined) {
    const { header } = splitFile(patched);
    patched = spliceBody(header, newBody);
  }

  const { frontmatter: updatedFm } = splitFile(patched);

  await history.record({
    sourcePath,
    content: patched,
    frontmatter: updatedFm,
    author,
    message: newBody !== undefined ? "Body update (auto-overlay)" : "Field update",
  });

  await storage.write(filePath, patched);
}
