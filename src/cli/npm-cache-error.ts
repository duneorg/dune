/**
 * Detects and reformats Deno's npm-cache-mismatch error class.
 *
 * Symptom (duneorg/dune#2): `dune dev`/`dune serve` fails at build time with
 * esbuild/Deno errors like `[ERR_MODULE_NOT_FOUND] Cannot find module
 * '.../npm/registry.npmjs.org/preact/10.29.8_1/hooks'` alongside a *different*
 * resolved version of the same package elsewhere in the same error output —
 * two concrete versions where the resolver should have unified on one.
 *
 * Investigated live (2026-08-26/27): reproduced nothing in three clean
 * environments (macOS, a genuinely fresh `$DENO_DIR`, a Docker container
 * pinned to the reporter's exact Deno version) — the npm import map itself
 * was fine every time. The working theory is a stale/corrupted local
 * `~/.cache/deno/npm` on the affected machine, from before this install, not
 * anything in Dune's own dependency graph. There is nothing Dune's code can
 * do to prevent this — it isn't Dune's cache — so this only shortens the gap
 * between "something's wrong" and "here's the fix" by recognizing the error
 * shape and suggesting the cache-reload/clear steps directly, instead of
 * requiring someone to reach that same conclusion by filing an issue and
 * waiting for a maintainer to reproduce it (which is how this was found).
 */

// Both known error shapes name an npm cache path under registry.npmjs.org
// and pair it with one of these two failure kinds.
const NPM_CACHE_PATH_RE = /npm[\\/]registry\.npmjs\.org[\\/]/;
const RELEVANT_KIND_RE = /ERR_MODULE_NOT_FOUND|Could not find referrer npm package/;

export function isNpmCacheMismatchError(err: unknown): err is Error {
  return err instanceof Error && NPM_CACHE_PATH_RE.test(err.message) &&
    RELEVANT_KIND_RE.test(err.message);
}

// e.g. ".../npm/registry.npmjs.org/preact/10.29.8_1/hooks" -> "preact@10.29.8"
// (the trailing "_1"-style suffix is Deno's own de-dup counter, not part of
// the version — stripped so the same real version doesn't look like two).
const CACHED_PKG_VERSION_RE =
  /registry\.npmjs\.org\/((?:@[^/]+\/)?[^/]+)\/(\d+\.\d+\.\d+)(?:_\d+)?\//g;

// The other half of the mismatch: the specifier Deno was actually trying to
// resolve, e.g. "npm:preact@^10.29.1/hooks" -> "preact@10.29.1". Caret/tilde
// range markers are stripped since they're not part of the version itself.
const REQUESTED_PKG_VERSION_RE =
  /npm:((?:@[^/@\s]+\/)?[^/@\s]+)@[\^~]?(\d+\.\d+\.\d+)/g;

function distinctVersionsMentioned(message: string): string[] {
  const found = new Set<string>();
  for (const match of message.matchAll(CACHED_PKG_VERSION_RE)) {
    found.add(`${match[1]}@${match[2]}`);
  }
  for (const match of message.matchAll(REQUESTED_PKG_VERSION_RE)) {
    found.add(`${match[1]}@${match[2]}`);
  }
  return [...found];
}

/**
 * Return a formatted, actionable error string for an npm-cache-mismatch
 * error, pointing at the standard cache-reload/clear remedy instead of the
 * raw esbuild/Deno stack trace.
 */
export function formatNpmCacheMismatchError(err: Error): string {
  const versions = distinctVersionsMentioned(err.message);
  const versionsLine = versions.length > 1
    ? `\nVersions mentioned in the error: ${versions.join(", ")} — if these ` +
      `differ for what should be the same package, that mismatch is the cause.\n`
    : "\n";

  return (
    `[dune] This looks like a local npm cache inconsistency, not a Dune ` +
    `problem — Deno's cache appears to hold more than one resolved version ` +
    `of the same package instead of one unified resolution.${versionsLine}\n` +
    `Try, in order:\n\n` +
    `  1. deno cache --reload\n` +
    `  2. If that doesn't clear it, remove Deno's npm cache directory and retry:\n` +
    `       macOS:   rm -rf ~/Library/Caches/deno/npm\n` +
    `       Linux:   rm -rf ~/.cache/deno/npm\n` +
    `       Windows: Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\deno\\npm"\n\n` +
    `Original error:\n${err.message}`
  );
}
