/**
 * `dune lockfile check` / `dune lockfile sync`
 *
 * Problem this solves: a Dune site's `deno.lock` only gets entries for a
 * plugin's dependencies (server-side imports, and — via the separate
 * `client-bundles.ts` bundling subprocess — browser-side npm packages like
 * TipTap) the first time the server actually starts after that plugin (or a
 * version bump that changes its deps) is installed. Until then, the running
 * `serve` task resolves them itself, on an unfrozen lockfile, which is what
 * silently dirties `deno.lock` on a server's working tree.
 *
 * `sync` does that same resolution work ahead of time, safely:
 *   - it never touches an already-pinned entry's resolved value, only adds
 *     entries that are genuinely missing for the current plugin/import set
 *   - an entry that *would* resolve to something different (e.g. the
 *     registry now serves a newer version for an already-locked semver
 *     range) is left exactly as committed, unless explicitly named via
 *     `--upgrade <specifier>`
 *
 * `check` runs the same comparison read-only and exits non-zero if anything
 * is missing — suitable as a pre-restart gate (see ExecStartPre= in systemd
 * unit files) so a `--frozen` `serve` task never gets a chance to fail.
 */

import { dirname, join, resolve } from "@std/path";

// ── Lockfile diff/merge (pure — no I/O, fully unit-testable) ─────────────────

/** Per-section (specifiers/jsr/npm/remote) diff of one merge pass. */
export interface SectionDiff {
  /** Keys present only in the fresh resolve — safe, always applied. */
  added: string[];
  /** Keys whose value differs and were *not* in `upgradeKeys` — left as committed. */
  blocked: string[];
  /** Keys whose value differs and were explicitly allowed via `upgradeKeys`. */
  upgraded: string[];
}

export interface MergeResult {
  merged: Record<string, unknown>;
  diffs: Record<string, SectionDiff>;
}

/** The lockfile sections that are flat maps keyed by specifier/URL string. */
const MAP_SECTIONS = ["specifiers", "jsr", "npm", "remote"] as const;

/**
 * Merge a freshly-resolved lockfile into the original, additively.
 *
 * - Keys only in `resolved` (genuinely new) are added.
 * - Keys only in `original` (no longer referenced) are kept as-is — pruning
 *   orphaned entries is a separate, riskier operation and out of scope here.
 * - Keys in both with the same value are untouched.
 * - Keys in both with *different* values are reverted to `original`'s value
 *   unless the key is in `upgradeKeys`, in which case `resolved`'s value wins.
 * - `workspace` is taken wholesale from `resolved` — it's a direct,
 *   deterministic reflection of the project's current `deno.json` imports,
 *   not a "which concrete version was picked" decision with drift risk.
 * - `version` is kept from `original` when present.
 */
export function mergeLockfiles(
  original: Record<string, unknown> | null,
  resolved: Record<string, unknown>,
  upgradeKeys: ReadonlySet<string>,
): MergeResult {
  const merged: Record<string, unknown> = { ...resolved };
  const diffs: Record<string, SectionDiff> = {};

  if (original && typeof original.version === "string") {
    merged.version = original.version;
  }

  for (const section of MAP_SECTIONS) {
    const origSection = (original?.[section] as Record<string, unknown> | undefined) ?? {};
    const resolvedSection = (resolved[section] as Record<string, unknown> | undefined) ?? {};
    const mergedSection: Record<string, unknown> = {};
    const added: string[] = [];
    const blocked: string[] = [];
    const upgraded: string[] = [];

    const allKeys = new Set([...Object.keys(origSection), ...Object.keys(resolvedSection)]);
    for (const key of allKeys) {
      const inOrig = key in origSection;
      const inResolved = key in resolvedSection;

      if (inOrig && !inResolved) {
        mergedSection[key] = origSection[key];
      } else if (!inOrig && inResolved) {
        mergedSection[key] = resolvedSection[key];
        added.push(key);
      } else {
        const sameValue = JSON.stringify(origSection[key]) === JSON.stringify(resolvedSection[key]);
        if (sameValue) {
          mergedSection[key] = origSection[key];
        } else if (upgradeKeys.has(key)) {
          mergedSection[key] = resolvedSection[key];
          upgraded.push(key);
        } else {
          mergedSection[key] = origSection[key];
          blocked.push(key);
        }
      }
    }

    if (Object.keys(mergedSection).length > 0) {
      merged[section] = mergedSection;
    } else {
      delete merged[section];
    }
    diffs[section] = { added: added.sort(), blocked: blocked.sort(), upgraded: upgraded.sort() };
  }

  if (resolved.workspace !== undefined) {
    merged.workspace = resolved.workspace;
  } else if (original?.workspace !== undefined) {
    merged.workspace = original.workspace;
  }

  return { merged, diffs };
}

// ── Workspace-root / lockfile-path discovery ──────────────────────────────────

/**
 * Find the directory whose `deno.lock` actually governs `root` — the
 * nearest ancestor (including `root` itself) whose `deno.json` declares a
 * `"workspace"`. Falls back to `root` when no workspace is found, matching
 * Deno's own resolution for a standalone (non-workspace) project.
 */
export async function findEffectiveLockfileDir(root: string): Promise<string> {
  let dir = resolve(root);
  for (let i = 0; i < 8; i++) {
    try {
      const raw = await Deno.readTextFile(join(dir, "deno.json"));
      const parsed = JSON.parse(raw);
      if (parsed.workspace) return dir;
    } catch {
      // No config here, or unreadable — keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return resolve(root);
}

// ── Subprocess orchestration ───────────────────────────────────────────────────

interface DiscoveryResult {
  pluginSpecifiers: string[];
  clientEntrySpecifiers: string[];
}

async function runDiscovery(
  siteDenoJson: string,
  scratchLockPath: string,
  root: string,
  opts: { frozen?: boolean } = {},
): Promise<DiscoveryResult> {
  const helperUrl = import.meta.resolve("./lockfile-resolve-helper.ts");
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      `--config=${siteDenoJson}`,
      `--lock=${scratchLockPath}`,
      ...(opts.frozen ? ["--frozen"] : []),
      helperUrl,
      root,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(`Plugin discovery failed:\n${new TextDecoder().decode(stderr).trim()}`);
  }
  const text = new TextDecoder().decode(stdout).trim();
  // Tolerate any stray console output a plugin's own top-level code might
  // produce during loading — our JSON line is always the last one printed.
  const lastLine = text.split("\n").pop() ?? "{}";
  return JSON.parse(lastLine);
}

async function runCacheForSpecifiers(
  siteDenoJson: string,
  scratchLockPath: string,
  specifiers: string[],
  opts: { frozen?: boolean } = {},
): Promise<void> {
  if (specifiers.length === 0) return;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "cache",
      `--config=${siteDenoJson}`,
      `--lock=${scratchLockPath}`,
      ...(opts.frozen ? ["--frozen"] : []),
      ...specifiers,
    ],
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(`Dependency caching failed:\n${new TextDecoder().decode(stderr).trim()}`);
  }
}

/**
 * Verify a merged lockfile is internally self-consistent before it's ever
 * written to disk.
 *
 * The additive-only merge can, in one specific case, produce a lockfile
 * that's individually well-formed JSON but fails Deno's own `--frozen`
 * check: if the newly-added entries introduce a *second*, different semver
 * range for a package that some other already-pinned entry references via
 * a bare (unqualified) specifier, that bare reference becomes ambiguous —
 * Deno requires it to be disambiguated. Reverting "changed" values by
 * default (the whole point of additive-only merging) would incorrectly
 * revert that disambiguation too, since from a pure diff perspective it
 * looks like an ordinary modification to an existing entry.
 *
 * Re-running discovery and caching with `--frozen` against the merged
 * result catches this: if it fails, the merge is incomplete and must not
 * be written as-is.
 */
async function assertFrozenConsistent(
  siteDenoJson: string,
  merged: Record<string, unknown>,
  root: string,
  pluginSpecifiers: string[],
  clientEntrySpecifiers: string[],
): Promise<void> {
  const validationPath = await Deno.makeTempFile({ suffix: ".lock.json" });
  try {
    await Deno.writeTextFile(validationPath, JSON.stringify(merged));
    await runDiscovery(siteDenoJson, validationPath, root, { frozen: true });
    await runCacheForSpecifiers(siteDenoJson, validationPath, [
      ...pluginSpecifiers,
      ...clientEntrySpecifiers,
    ], { frozen: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `The merged lockfile would not be self-consistent (--frozen rejects it):\n${message}\n\n` +
        `This usually means a new addition introduced a second, different version range for an ` +
        `already-pinned shared dependency, and an existing entry referencing it ambiguously needs ` +
        `updating too — additive-only merging can't safely apply that on its own. Please report this ` +
        `with the diff above; it indicates a gap in the merge algorithm, not a problem with your project.`,
    );
  } finally {
    await Deno.remove(validationPath).catch(() => {});
  }
}

export interface LockfileSyncStatus {
  lockfilePath: string;
  diffs: Record<string, SectionDiff>;
}

/**
 * Compute (but do not write) the merged lockfile for `root`.
 *
 * Resolution happens against a scratch copy of the current lockfile — the
 * real file is never touched until (and unless) a caller writes `merged`.
 */
export async function computeLockfileSync(
  root: string,
  upgradeKeys: ReadonlySet<string>,
): Promise<{ status: LockfileSyncStatus; merged: Record<string, unknown> }> {
  const absRoot = resolve(root);
  const lockfileDir = await findEffectiveLockfileDir(absRoot);
  const lockfilePath = join(lockfileDir, "deno.lock");
  const siteDenoJson = join(absRoot, "deno.json");

  let original: Record<string, unknown> | null = null;
  try {
    original = JSON.parse(await Deno.readTextFile(lockfilePath));
  } catch {
    // No lockfile yet — everything will show up as "added".
  }

  const scratchPath = await Deno.makeTempFile({ suffix: ".lock.json" });
  await Deno.remove(scratchPath); // reserve a unique path only; recreate below
  try {
    if (original) {
      await Deno.writeTextFile(scratchPath, JSON.stringify(original));
    }

    const { pluginSpecifiers, clientEntrySpecifiers } = await runDiscovery(
      siteDenoJson,
      scratchPath,
      absRoot,
    );
    await runCacheForSpecifiers(siteDenoJson, scratchPath, [
      ...pluginSpecifiers,
      ...clientEntrySpecifiers,
    ]);

    const resolved = JSON.parse(await Deno.readTextFile(scratchPath));
    const { merged, diffs } = mergeLockfiles(original, resolved, upgradeKeys);

    await assertFrozenConsistent(
      siteDenoJson,
      merged,
      absRoot,
      pluginSpecifiers,
      clientEntrySpecifiers,
    );

    return { status: { lockfilePath, diffs }, merged };
  } finally {
    await Deno.remove(scratchPath).catch(() => {});
  }
}

function countAll(diffs: Record<string, SectionDiff>, field: keyof SectionDiff): number {
  return Object.values(diffs).reduce((n, d) => n + d[field].length, 0);
}

function printSectionEntries(diffs: Record<string, SectionDiff>, field: keyof SectionDiff, marker: string) {
  for (const [section, diff] of Object.entries(diffs)) {
    for (const key of diff[field]) {
      console.log(`    ${marker} [${section}] ${key}`);
    }
  }
}

// ── Public commands ───────────────────────────────────────────────────────────

export interface LockfileCheckOptions {
  json?: boolean;
}

/** Read-only: exits 1 if the lockfile is missing entries the current plugin/import set needs. */
export async function lockfileCheckCommand(root: string, opts: LockfileCheckOptions = {}): Promise<void> {
  const { status } = await computeLockfileSync(root, new Set());
  const added = countAll(status.diffs, "added");
  const blocked = countAll(status.diffs, "blocked");

  if (opts.json) {
    console.log(JSON.stringify({ ok: added === 0, lockfilePath: status.lockfilePath, diffs: status.diffs }));
  } else if (added === 0) {
    console.log(`${status.lockfilePath} is complete — no missing entries for the current plugin/dependency set.`);
    if (blocked > 0) {
      console.log(
        `  (${blocked} already-pinned entr${blocked === 1 ? "y" : "ies"} could resolve to a newer version — ` +
          `run "dune lockfile sync --upgrade <specifier>" to apply intentionally.)`,
      );
    }
  } else {
    console.log(
      `${status.lockfilePath} is missing ${added} entr${added === 1 ? "y" : "ies"} needed by the current plugin/dependency set:`,
    );
    printSectionEntries(status.diffs, "added", "+");
    console.log(`\n  Run "dune lockfile sync" to add ${added === 1 ? "it" : "them"}.`);
  }

  Deno.exit(added === 0 ? 0 : 1);
}

export interface LockfileSyncOptions {
  json?: boolean;
  /** Exact specifier keys (as printed by `check`/`sync`) to allow upgrading. */
  upgrade?: string[];
}

/** Writes the lockfile: adds missing entries, applies any explicit `--upgrade` keys, leaves everything else untouched. */
export async function lockfileSyncCommand(root: string, opts: LockfileSyncOptions = {}): Promise<void> {
  const upgradeKeys = new Set(opts.upgrade ?? []);
  const { status, merged } = await computeLockfileSync(root, upgradeKeys);

  await Deno.writeTextFile(status.lockfilePath, JSON.stringify(merged, null, 2) + "\n");

  const added = countAll(status.diffs, "added");
  const upgraded = countAll(status.diffs, "upgraded");
  const blocked = countAll(status.diffs, "blocked");

  if (opts.json) {
    console.log(JSON.stringify({ lockfilePath: status.lockfilePath, diffs: status.diffs }));
    return;
  }

  console.log(`${status.lockfilePath}:`);
  console.log(`  +${added} added, ~${upgraded} upgraded, ${blocked} left unchanged (already pinned)`);
  printSectionEntries(status.diffs, "added", "+");
  printSectionEntries(status.diffs, "upgraded", "~");

  if (blocked > 0) {
    console.log(
      `\n  ${blocked} entr${blocked === 1 ? "y" : "ies"} could resolve to a newer version but ${
        blocked === 1 ? "was" : "were"
      } left unchanged (registry drift is never applied automatically):`,
    );
    for (const [section, diff] of Object.entries(status.diffs)) {
      for (const key of diff.blocked) {
        console.log(`    = [${section}] ${key}  (rerun with --upgrade "${key}" to apply)`);
      }
    }
  }
}
