/**
 * Content root resolution — mirrors `theme.src` (see `themes/reference.ts`).
 *
 * `content.dir` is a subdirectory name under the site root. `content.src`,
 * when set, points content at an arbitrary local path instead (useful for
 * multisite setups sharing one fixture/content source across many sites).
 * It never widens the site's own storage boundary — a package-backed
 * `content.src` gets its own independently-contained `FileSystemAdapter`,
 * the same pattern already used for package-backed themes
 * (`themes/loader.ts`'s `createStorage({ rootDir: absoluteRoot })`).
 */

import { isAbsolute, join, resolve } from "@std/path";
import { createStorage } from "../storage/mod.ts";
import type { StorageAdapter } from "../storage/types.ts";

export interface ContentConfig {
  dir: string;
  src?: string;
}

/**
 * Resolve `content.src` (or `content.dir` when unset) to an absolute path.
 * For use by call sites that need a plain filesystem path rather than a
 * storage-adapter pair — e.g. file watchers, incremental-build hash checks.
 */
export function resolveContentDirPath(content: ContentConfig, siteRoot: string): string {
  if (!content.src) return join(siteRoot, content.dir);
  return isAbsolute(content.src) ? content.src : resolve(siteRoot, content.src);
}

/**
 * Resolve the storage adapter + contentDir pair to use for content
 * operations. When `content.src` is unset, this is a passthrough to the
 * site's own storage (today's behavior, unchanged). When set, returns a new
 * storage instance rooted at the resolved external path — `contentDir`
 * becomes `"."`, meaning "the root of this storage IS the content root".
 */
export function createContentStorage(
  content: ContentConfig,
  siteRoot: string,
  siteStorage: StorageAdapter,
): { storage: StorageAdapter; contentDir: string } {
  if (!content.src) {
    return { storage: siteStorage, contentDir: content.dir };
  }
  const absoluteRoot = resolveContentDirPath(content, siteRoot);
  return { storage: createStorage({ rootDir: absoluteRoot }), contentDir: "." };
}
