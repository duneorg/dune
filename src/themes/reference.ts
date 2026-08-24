/**
 * Theme reference parsing and package resolution.
 *
 * Themes can be local directories under `themes/` or version-pinned packages
 * (JSR/npm) declared in site.yaml. This module is the single place that
 * understands those reference forms — the loader consumes resolved locations only.
 */

import { dirname, fromFileUrl, isAbsolute, join, resolve } from "@std/path";

/** A parsed theme reference before filesystem resolution. */
export interface ThemeReference {
  /** Logical theme name used in config and `/themes/{name}/static/` URLs. */
  name: string;
  /** Package specifier when remote; omitted for local-only references. */
  src?: string;
}

/**
 * Remote package specifiers must at least name a version (exact or ^/~
 * range) — not required to be an exact pin. `--lock --frozen` (dune's
 * default) already freezes whatever version a range resolves to on first
 * sync, so drift is covered by the lockfile either way; requiring an exact
 * pin on top of that only bought marginal defense-in-depth while blocking
 * composability with `minimumDependencyAge`, which needs a range to fall
 * back within. See the matching comment in `src/plugins/reference.ts`.
 */
export const PINNED_THEME_SPECIFIER_RE =
  /^jsr:@?[a-z0-9_.-]+\/[a-zA-Z0-9_.-]+@[\^~]?\d+(?:\.\d+){0,2}(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$|^npm:(?:@[^/]+\/)?[^@\s]+@[\^~]?\d+(?:\.\d+){0,2}(?:[-+][a-zA-Z0-9_.-]+)?(?:\/.*)?$/;

const THEME_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** True when the string is a JSR or npm package specifier. */
export function isRemoteThemeSpecifier(spec: string): boolean {
  return spec.startsWith("jsr:") || spec.startsWith("npm:");
}

/** True when the string is a site-local path (not a registry specifier). */
export function isLocalThemePath(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") ||
    isAbsolute(spec);
}

/** Validate a theme directory/slug name. */
export function assertThemeName(name: string): void {
  if (!THEME_NAME_RE.test(name)) {
    throw new Error(
      `Invalid theme name "${name}" — must match [a-z0-9][a-z0-9_-]*`,
    );
  }
}

/** Validate a remote theme package specifier names a version (exact or ^/~ range). */
export function assertPinnedThemeSpecifier(spec: string): void {
  if (!isRemoteThemeSpecifier(spec)) return;
  if (!PINNED_THEME_SPECIFIER_RE.test(spec)) {
    throw new Error(
      `Theme package specifier must name a version, exact or a ^/~ range ` +
        `(e.g. jsr:@dune/theme-paper@1.0.0 or jsr:@dune/theme-paper@^1.0.0), got: ${spec}`,
    );
  }
}

/** Normalize a specifier for map lookups (trim, no trailing slash). */
export function normalizeThemeSpecifier(spec: string): string {
  return spec.trim().replace(/\/+$/, "");
}

/**
 * Derive a default theme name from a package specifier or import key.
 * `jsr:@dune/theme-paper@1.0.0` → `paper`
 */
export function defaultThemeNameFromSpecifier(spec: string): string {
  let s = spec.replace(/^(jsr:|npm:)/, "");
  const atIdx = s.lastIndexOf("@");
  if (atIdx > 0) s = s.slice(0, atIdx);
  const slash = s.lastIndexOf("/");
  const base = slash >= 0 ? s.slice(slash + 1) : s;
  if (base.startsWith("theme-")) return base.slice("theme-".length);
  return base.replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "theme";
}

/** Read deno.json imports from a site root (empty map when missing). */
export async function readSiteImportMap(
  siteRoot: string,
): Promise<Record<string, string>> {
  try {
    const text = await Deno.readTextFile(join(siteRoot, "deno.json"));
    const json = JSON.parse(text) as { imports?: Record<string, string> };
    return json.imports ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolve a theme reference string to a concrete package specifier.
 * Handles import-map aliases (`@dune/theme-paper` → `jsr:…`).
 */
export async function resolveThemeSpecifier(
  spec: string,
  siteRoot: string,
): Promise<string> {
  const trimmed = spec.trim();
  if (isRemoteThemeSpecifier(trimmed) || isLocalThemePath(trimmed)) {
    return trimmed;
  }
  const imports = await readSiteImportMap(siteRoot);
  const mapped = imports[trimmed];
  if (mapped) return mapped;
  return trimmed;
}

async function assertThemePackageRoot(dir: string): Promise<void> {
  try {
    await Deno.stat(join(dir, "theme.yaml"));
  } catch {
    throw new Error(`No theme.yaml found at ${dir} — not a valid Dune theme package`);
  }
}

/** Walk up from a resolved module file to the directory containing theme.yaml. */
async function findThemeRootFromEntry(entryPath: string): Promise<string> {
  let dir = (await Deno.stat(entryPath)).isDirectory
    ? entryPath
    : dirname(entryPath);
  for (let i = 0; i < 12; i++) {
    try {
      await Deno.stat(join(dir, "theme.yaml"));
      return dir;
    } catch { /* continue */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate theme.yaml near ${entryPath}`);
}

/**
 * Resolve a theme package specifier to the absolute directory containing theme.yaml.
 */
export async function resolveThemePackageRoot(
  specifier: string,
  siteRoot: string,
): Promise<string> {
  const resolved = await resolveThemeSpecifier(specifier, siteRoot);

  if (isLocalThemePath(resolved)) {
    const abs = resolve(siteRoot, resolved);
    await assertThemePackageRoot(abs);
    return abs;
  }

  assertPinnedThemeSpecifier(resolved);

  let entryUrl: string;
  try {
    entryUrl = import.meta.resolve(resolved);
  } catch (err) {
    throw new Error(
      `Could not resolve theme package "${specifier}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!entryUrl.startsWith("file:")) {
    throw new Error(
      `Theme package "${specifier}" resolved to non-file URL: ${entryUrl}`,
    );
  }

  const root = await findThemeRootFromEntry(fromFileUrl(entryUrl));
  await assertThemePackageRoot(root);
  return root;
}

/** Import map key for a theme package (used by theme:install). */
export function importKeyForThemeSpecifier(spec: string): string {
  if (spec.startsWith("jsr:") || spec.startsWith("npm:")) {
    let s = spec.replace(/^(jsr:|npm:)/, "");
    const atIdx = s.lastIndexOf("@");
    if (atIdx > 0) s = s.slice(0, atIdx);
    return s;
  }
  return spec;
}
