/**
 * Theme CLI commands.
 *
 * Themes use a dedicated registry (`themes:` in site.yaml) plus deno.json
 * imports — separate from plugins so package themes and local overrides
 * can compose cleanly via inheritance.
 *
 *   dune theme:list                  List local + registered package themes
 *   dune theme:install <src>         Register a package theme (+ deno.json import)
 *   dune theme:remove <name>         Remove from themes: registry
 *   dune theme:publish [dir]         Publish a theme package to JSR (deno publish)
 */

import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { join, resolve } from "@std/path";
import type { ThemePackageEntry } from "../config/types.ts";
import { lockfileSyncCommand } from "./lockfile.ts";
import {
  assertPinnedThemeSpecifier,
  assertThemeName,
  defaultThemeNameFromSpecifier,
  importKeyForThemeSpecifier,
  isRemoteThemeSpecifier,
  resolveThemePackageRoot,
} from "../themes/reference.ts";

// ─── theme:list ─────────────────────────────────────────────────────────────

export async function themeListCommand(root: string): Promise<void> {
  root = resolve(root);
  const siteYamlPath = join(root, "config", "site.yaml");
  let raw = "";
  try {
    raw = await Deno.readTextFile(siteYamlPath);
  } catch {
    console.log("No config/site.yaml found.");
    return;
  }

  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const theme = parsed.theme as { name?: string; src?: string } | undefined;
  const packages = Array.isArray(parsed.themes)
    ? parsed.themes as ThemePackageEntry[]
    : [];

  console.log("\nTheme packages:\n");
  if (packages.length === 0) {
    console.log("  (none — add with dune theme:install jsr:@scope/theme-name@1.0.0)");
  } else {
    for (const pkg of packages) {
      console.log(`  ${pkg.name}  ←  ${pkg.src}`);
    }
  }

  console.log("\nLocal themes (themes/):\n");
  let localCount = 0;
  try {
    for await (const entry of Deno.readDir(join(root, "themes"))) {
      if (!entry.isDirectory) continue;
      localCount++;
      const active = theme?.name === entry.name ? " (active)" : "";
      console.log(`  ${entry.name}${active}`);
    }
  } catch {
    console.log("  (no themes/ directory)");
  }
  if (localCount === 0) {
    console.log("  (none)");
  }

  if (theme?.name) {
    console.log(`\nActive: ${theme.name}${theme.src ? ` via ${theme.src}` : ""}\n`);
  } else {
    console.log();
  }
}

// ─── theme:install ──────────────────────────────────────────────────────────

export interface ThemeInstallOptions {
  /** Override derived theme name. */
  name?: string;
  /** Set as active theme (writes theme.name / theme.src). */
  activate?: boolean;
}

export async function themeInstallCommand(
  root: string,
  src: string,
  opts: ThemeInstallOptions = {},
): Promise<void> {
  root = resolve(root);

  if (!src) {
    console.error("Usage: dune theme:install <src> [--name <slug>] [--activate]");
    console.error('  <src>  jsr:@scope/theme-name@1.0.0, npm:pkg@1.0.0, or ./path/to/theme');
    Deno.exit(1);
  }

  const resolvedSrc = src;
  if (isRemoteThemeSpecifier(src)) {
    assertPinnedThemeSpecifier(src);
  }

  const name = opts.name ?? defaultThemeNameFromSpecifier(src);
  try {
    assertThemeName(name);
  } catch (err) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    Deno.exit(1);
  }

  console.log(`  Verifying theme package…`);
  try {
    await resolveThemePackageRoot(src, root);
  } catch (err) {
    console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    Deno.exit(1);
  }

  const siteYamlPath = join(root, "config", "site.yaml");
  let siteRaw = "";
  try {
    siteRaw = await Deno.readTextFile(siteYamlPath);
  } catch {
    console.error(`Could not read ${siteYamlPath}`);
    Deno.exit(1);
  }

  const site = (parseYaml(siteRaw) ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(site.themes)
    ? site.themes as ThemePackageEntry[]
    : [];

  const idx = existing.findIndex((e) => e.name === name);
  if (idx >= 0) {
    existing[idx] = { name, src: resolvedSrc };
  } else {
    existing.push({ name, src: resolvedSrc });
  }
  site.themes = existing;

  if (opts.activate) {
    const themeBlock = (site.theme && typeof site.theme === "object")
      ? { ...(site.theme as Record<string, unknown>) }
      : {};
    themeBlock.name = name;
    if (isRemoteThemeSpecifier(resolvedSrc)) {
      themeBlock.src = resolvedSrc;
    } else {
      delete themeBlock.src;
    }
    site.theme = themeBlock;
  }

  await Deno.writeTextFile(siteYamlPath, stringifyYaml(site).trimEnd() + "\n");
  console.log(`  ✓ Registered theme "${name}" in config/site.yaml`);

  if (isRemoteThemeSpecifier(resolvedSrc)) {
    await addThemeImport(root, resolvedSrc);
  }

  if (opts.activate) {
    console.log(`  ✓ Set active theme to "${name}"`);
  }

  console.log(`\n  Run "dune dev" to load the theme.`);
}

async function addThemeImport(root: string, specifier: string): Promise<void> {
  const denoJsonPath = join(root, "deno.json");
  let denoJson: Record<string, unknown>;
  try {
    denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
  } catch {
    console.log(`  ⚠  No deno.json — add import manually: "${importKeyForThemeSpecifier(specifier)}": "${specifier}"`);
    return;
  }

  const imports = (denoJson.imports ?? {}) as Record<string, string>;
  const key = importKeyForThemeSpecifier(specifier);
  if (imports[key] && imports[key] !== specifier) {
    console.log(`  ℹ  deno.json already maps "${key}" → "${imports[key]}" (unchanged)`);
  } else if (!imports[key]) {
    imports[key] = specifier;
    denoJson.imports = imports;
    await Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + "\n");
    console.log(`  ✓ Added deno.json import: "${key}": "${specifier}"`);
  }

  console.log(`\n  🔒 Syncing lockfile…`);
  try {
    await lockfileSyncCommand(root, {});
    console.log(`  Commit deno.lock along with config changes before deploying.`);
  } catch {
    console.log(`  ⚠  Lockfile sync failed — run "dune lockfile:sync" manually.`);
  }
}

// ─── theme:remove ───────────────────────────────────────────────────────────

export async function themeRemoveCommand(root: string, name: string): Promise<void> {
  root = resolve(root);
  if (!name) {
    console.error("Usage: dune theme:remove <name>");
    Deno.exit(1);
  }

  const siteYamlPath = join(root, "config", "site.yaml");
  const site = (parseYaml(await Deno.readTextFile(siteYamlPath)) ?? {}) as Record<
    string,
    unknown
  >;
  const existing = Array.isArray(site.themes)
    ? site.themes as ThemePackageEntry[]
    : [];
  const filtered = existing.filter((e) => e.name !== name);
  if (filtered.length === existing.length) {
    console.log(`Theme "${name}" is not in the themes: registry.`);
    return;
  }
  site.themes = filtered;

  const theme = site.theme as { name?: string; src?: string } | undefined;
  if (theme?.name === name) {
    console.log(`  ℹ  "${name}" is the active theme — update theme.name in site.yaml manually.`);
  }

  await Deno.writeTextFile(siteYamlPath, stringifyYaml(site).trimEnd() + "\n");
  console.log(`✓ Removed theme "${name}" from config/site.yaml`);
  console.log(`  Remove the deno.json import and run lockfile:sync if no longer needed.`);
}

// ─── theme:publish ──────────────────────────────────────────────────────────

export async function themePublishCommand(root: string, dir?: string): Promise<void> {
  root = resolve(root);
  let themeDir: string;

  if (dir) {
    themeDir = resolve(root, dir);
  } else {
    const packagesDir = join(root, "packages");
    const candidates: string[] = [];
    try {
      for await (const e of Deno.readDir(packagesDir)) {
        if (e.isDirectory && e.name.startsWith("theme-")) candidates.push(e.name);
      }
    } catch {
      console.error('No packages/ directory. Pass a path: dune theme:publish ./packages/theme-paper');
      Deno.exit(1);
    }
    if (candidates.length === 0) {
      console.error("No theme-* packages found under packages/");
      Deno.exit(1);
    }
    if (candidates.length > 1) {
      console.error(`Multiple theme packages: ${candidates.join(", ")}`);
      console.error("Specify one: dune theme:publish ./packages/theme-paper");
      Deno.exit(1);
    }
    themeDir = join(packagesDir, candidates[0]!);
  }

  try {
    await Deno.stat(join(themeDir, "deno.json"));
    await Deno.stat(join(themeDir, "theme.yaml"));
  } catch {
    console.error(`Theme package must contain deno.json and theme.yaml (${themeDir})`);
    Deno.exit(1);
  }

  console.log(`Publishing theme from ${themeDir}…\n`);
  const cmd = new Deno.Command("deno", {
    args: ["publish"],
    cwd: themeDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code, success } = await cmd.output();
  if (!success) {
    console.error(`\n✗ Publish failed (exit code ${code}).`);
    Deno.exit(code ?? 1);
  }
  console.log(`\n✓ Theme published to JSR.`);
  console.log(`  Sites can install with: dune theme:install jsr:<scope>/<name>@<version>`);
}

export const themeCommands = {
  list: themeListCommand,
  install: themeInstallCommand,
  remove: themeRemoveCommand,
  publish: themePublishCommand,
};
