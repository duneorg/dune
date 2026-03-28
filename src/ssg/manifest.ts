/**
 * Build manifest — tracks rendered pages and their content hashes for
 * incremental rebuilds.  Persisted as dist/.dune-build.json after each build.
 */

import { join } from "@std/path";

export interface ManifestEntry {
  route: string;
  outputPath: string;
  /** SHA-256 hex digest of the source file at the time it was rendered. */
  contentHash: string;
  builtAt: number;
}

export interface BuildManifest {
  version: 1;
  builtAt: number;
  baseUrl: string;
  entries: Record<string, ManifestEntry>;
}

export function newManifest(baseUrl: string): BuildManifest {
  return { version: 1, builtAt: 0, baseUrl, entries: {} };
}

export async function loadManifest(outDir: string): Promise<BuildManifest | null> {
  const path = join(outDir, ".dune-build.json");
  try {
    const text = await Deno.readTextFile(path);
    const data = JSON.parse(text) as BuildManifest;
    if (data.version === 1) return data;
  } catch { /* not found or corrupt — start fresh */ }
  return null;
}

export async function saveManifest(outDir: string, manifest: BuildManifest): Promise<void> {
  const path = join(outDir, ".dune-build.json");
  await Deno.writeTextFile(path, JSON.stringify(manifest, null, 2));
}

/**
 * SHA-256 hex digest of a file's byte content.
 * Returns an empty string when the file cannot be read (missing, permission, etc.).
 */
export async function hashFile(filePath: string): Promise<string> {
  try {
    const data = await Deno.readFile(filePath);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}
