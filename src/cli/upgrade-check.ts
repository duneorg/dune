/**
 * Background update check for @dune/core.
 *
 * Fetches the latest version from JSR at most once per 24 hours (cached).
 * Prints a one-line notice if a newer version is available.
 * Never blocks startup — all I/O runs in a detached async task.
 * No-ops when running from a local file:// URL (dev / CI context).
 */

const JSR_META_URL = "https://jsr.io/@dune/core/meta.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  checkedAt: number;
  latest: string;
  current: string;
}

/** Extract running @dune/core version from the JSR module URL. */
function currentVersion(): string | null {
  // JSR URL format: https://jsr.io/@dune/core/0.9.1/src/cli/upgrade-check.ts
  const match = import.meta.url.match(/jsr\.io\/@dune\/core\/([^/]+)\//);
  return match?.[1] ?? null;
}

function cacheDir(): string {
  const xdg = Deno.env.get("XDG_CACHE_HOME");
  if (xdg) return `${xdg}/dune`;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.cache/dune`;
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const raw = await Deno.readTextFile(`${cacheDir()}/update-check.json`);
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  try {
    await Deno.mkdir(cacheDir(), { recursive: true });
    await Deno.writeTextFile(`${cacheDir()}/update-check.json`, JSON.stringify(entry));
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(JSR_META_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const meta = await res.json() as { latest?: string };
    return meta.latest ?? null;
  } catch {
    return null;
  }
}

/** Returns true if semver string `a` is strictly greater than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function printNotice(current: string, latest: string): void {
  console.log(`\n  💡 Dune ${latest} is available (you have ${current}).`);
  console.log(`     Run \`dune upgrade\` to update.\n`);
}

/**
 * Fire-and-forget update check.
 *
 * Call once at startup for long-running commands (dev, serve).
 * Prints a notice to stdout if a newer @dune/core version exists on JSR.
 * Uses a 24-hour cache to avoid network requests on every startup.
 */
export function checkForUpdates(): void {
  // Skip when running from local source (dune dev / CI)
  if (import.meta.url.startsWith("file://")) return;

  const current = currentVersion();
  if (!current) return;

  // Detach — never block the caller
  (async () => {
    const cache = await readCache();
    const now = Date.now();

    if (cache && now - cache.checkedAt < CHECK_INTERVAL_MS) {
      // Use cached result — no network request
      if (isNewer(cache.latest, current)) {
        printNotice(current, cache.latest);
      }
      return;
    }

    // Cache is stale or absent — fetch in background
    const latest = await fetchLatestVersion();
    if (!latest) return;

    await writeCache({ checkedAt: now, latest, current });

    if (isNewer(latest, current)) {
      printNotice(current, latest);
    }
  })();
}
