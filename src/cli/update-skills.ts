/**
 * dune update:skills — Reinstall AI coding agent skill files.
 *
 * Copies the skills bundled with this version of @dune/core into
 * the site's `.claude/skills/` directory.  Run this after upgrading
 * Dune to pick up new or updated skills documentation.
 *
 * Usage:
 *   dune update:skills
 *   dune update:skills --force   # overwrite even unchanged files
 */

import { join, resolve, dirname, fromFileUrl } from "@std/path";

export interface UpdateSkillsOptions {
  /** Overwrite existing files even when content is unchanged */
  force?: boolean;
  debug?: boolean;
}

/** Known skill file names — used when running from a remote JSR URL. */
export const KNOWN_SKILL_FILES = [
  "dune-content.md",
  "dune-mcp.md",
  "dune-plugin-authoring.md",
  "dune-schemas.md",
  "dune-auth.md",
  "dune-authz.md",
  "dune-email.md",
  "dune-jobs.md",
];

export interface CopySkillsResult {
  installed: number;
  skipped: number;
  failed: number;
}

/**
 * Copy bundled skill files into `targetDir`.
 *
 * Shared by `updateSkillsCommand` (verbose, user-facing) and `newCommand`
 * (quiet, just returns counts).  When `verbose` is true each installed file
 * is logged to stdout.
 */
export async function copySkillFiles(
  targetDir: string,
  opts: { force?: boolean; verbose?: boolean; debug?: boolean } = {},
): Promise<CopySkillsResult> {
  await Deno.mkdir(targetDir, { recursive: true });

  const currentFileUrl = import.meta.url;
  let installed = 0;
  let skipped = 0;
  let failed = 0;

  if (currentFileUrl.startsWith("file://")) {
    // Local source — copy from filesystem
    const currentDir = dirname(fromFileUrl(currentFileUrl));
    const pkgSkillsDir = resolve(currentDir, "../../skills");

    try {
      for await (const entry of Deno.readDir(pkgSkillsDir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;

        const src = join(pkgSkillsDir, entry.name);
        const dest = join(targetDir, entry.name);

        try {
          const content = await Deno.readTextFile(src);
          let shouldWrite = true;

          if (!opts.force) {
            try {
              if (await Deno.readTextFile(dest) === content) {
                skipped++;
                shouldWrite = false;
              }
            } catch { /* file absent — write it */ }
          }

          if (shouldWrite) {
            await Deno.writeTextFile(dest, content);
            if (opts.verbose) console.log(`  ✅ .claude/skills/${entry.name}`);
            installed++;
          } else if (opts.debug) {
            console.log(`  ─  .claude/skills/${entry.name} (unchanged)`);
          }
        } catch { failed++; }
      }
    } catch {
      if (opts.debug) console.warn(`  ⚠️  Skills directory not found: ${pkgSkillsDir}`);
    }
  } else {
    // JSR / remote URL — fetch known skill files
    const baseUrl = new URL("../../skills/", currentFileUrl).href;

    for (const name of KNOWN_SKILL_FILES) {
      try {
        const res = await fetch(baseUrl + name);
        if (!res.ok) {
          if (opts.debug) console.warn(`  ⚠️  Could not fetch ${name}: ${res.status}`);
          failed++;
          continue;
        }
        const content = await res.text();
        const dest = join(targetDir, name);
        let shouldWrite = true;

        if (!opts.force) {
          try {
            if (await Deno.readTextFile(dest) === content) {
              skipped++;
              shouldWrite = false;
            }
          } catch { /* file absent — write it */ }
        }

        if (shouldWrite) {
          await Deno.writeTextFile(dest, content);
          if (opts.verbose) console.log(`  ✅ .claude/skills/${name}`);
          installed++;
        } else if (opts.debug) {
          console.log(`  ─  .claude/skills/${name} (unchanged)`);
        }
      } catch (err) {
        if (opts.debug) console.error(`  ✗ ${name}: ${err}`);
        failed++;
      }
    }
  }

  return { installed, skipped, failed };
}

export async function updateSkillsCommand(
  root: string,
  options: UpdateSkillsOptions = {},
): Promise<void> {
  root = resolve(root);

  const targetDir = join(root, ".claude", "skills");
  console.log("🏜️  Dune — updating agent skills\n");

  const { installed, skipped, failed } = await copySkillFiles(targetDir, {
    force: options.force,
    verbose: true,
    debug: options.debug,
  });

  printSummary(installed, skipped, failed, targetDir);
}

function printSummary(installed: number, skipped: number, failed: number, targetDir: string) {
  console.log();
  if (installed > 0) {
    console.log(`  ✅ ${installed} skill(s) updated → ${targetDir}`);
  }
  if (skipped > 0) {
    console.log(`  ─  ${skipped} skill(s) unchanged`);
  }
  if (failed > 0) {
    console.log(`  ⚠️  ${failed} skill(s) failed — run with --debug for details`);
  }
  if (installed === 0 && failed === 0) {
    console.log("  All skills are up to date");
  }
}
