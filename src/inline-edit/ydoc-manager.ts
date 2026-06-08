/**
 * Y.js document persistence.
 *
 * Loads and saves Y.js document state to disk as binary update logs under
 * `{dataDir}/ydoc/{encodedPath}.bin`.  Each file is a concatenation of raw
 * Y.js update blobs — `Y.applyUpdate` can be applied repeatedly over the
 * concatenated bytes to reconstruct the document.
 *
 * On load we read the whole binary, apply every update, then compact: a new
 * state snapshot is written back so the file never grows unboundedly.
 */

import * as Y from "yjs";
import type { StorageAdapter } from "../storage/types.ts";

/**
 * Encode a source path to a safe filename.
 *
 * `encodeURIComponent` percent-encodes all characters except `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
 * Slashes become `%2F`, dots remain as-is.  We intentionally do NOT replace
 * `%2F` with `__` because that would create a collision: `foo/bar.md` and
 * the (admittedly unusual) file `foo__bar.md` would produce the same encoded
 * name, causing them to share Y.js state.  Keeping `%2F` encoded is unambiguous.
 */
export function encodeSourcePath(sourcePath: string): string {
  return encodeURIComponent(sourcePath);
}

/** Resolve the on-disk path for a Y.js doc binary. */
function ydocPath(dataDir: string, sourcePath: string): string {
  return `${dataDir}/ydoc/${encodeSourcePath(sourcePath)}.bin`;
}

/**
 * Load (or create) a Y.js document for the given source path.
 *
 * If a persisted binary exists it is applied to a fresh Y.Doc.  The initial
 * body text (from the `.md` file) is only used when no persisted doc exists.
 *
 * After loading, the doc is compacted: the merged state vector is written
 * back so subsequent loads are faster.
 */
export async function loadYDoc(
  dataDir: string,
  sourcePath: string,
  initialBody: string,
  storage: StorageAdapter,
): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const path = ydocPath(dataDir, sourcePath);

  let persisted = false;
  try {
    const raw = await storage.read(path);
    if (raw && raw.byteLength > 0) {
      Y.applyUpdate(doc, raw);
      persisted = true;
    }
  } catch {
    // File doesn't exist yet — that's fine; we'll initialise from initialBody.
  }

  if (!persisted) {
    // Seed the document with the current file body so the first client
    // receives the real content rather than an empty document.
    const text = doc.getText("body");
    doc.transact(() => {
      text.insert(0, initialBody);
    });
  }

  // Compact: write the merged state vector back.
  await persistYDoc(dataDir, sourcePath, doc, storage);

  return doc;
}

/**
 * Persist the current Y.Doc state to disk (full snapshot, not incremental).
 * Overwrites the existing binary — safe because we hold the full state in RAM.
 */
export async function persistYDoc(
  dataDir: string,
  sourcePath: string,
  doc: Y.Doc,
  storage: StorageAdapter,
): Promise<void> {
  const state = Y.encodeStateAsUpdate(doc);
  const path = ydocPath(dataDir, sourcePath);
  await storage.write(path, state);
}

/**
 * Delete the persisted Y.Doc binary for a source path.
 * Called after a successful commit so stale drafts don't accumulate.
 */
export async function deleteYDoc(
  dataDir: string,
  sourcePath: string,
  storage: StorageAdapter,
): Promise<void> {
  const path = ydocPath(dataDir, sourcePath);
  try {
    await storage.delete(path);
  } catch {
    // Ignore — file may not exist.
  }
}

/**
 * Get the current body text from a Y.Doc (the "body" shared text type).
 */
export function getDocBody(doc: Y.Doc): string {
  return doc.getText("body").toString();
}
