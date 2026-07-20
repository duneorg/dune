/**
 * Optional `.env` file loading for `dune dev` / `dune serve`, via
 * `--env-file[=path]`.
 *
 * Off by default — nothing auto-loads secrets from disk on a plain `dune
 * dev`. Only when the flag is explicitly passed does this parse a simple
 * KEY=VALUE dotenv file into the process environment, before any plugin or
 * config loading reads `Deno.env`. Values already present in the environment
 * take precedence — an explicit `MEILI_API_KEY=x dune dev --env-file` on the
 * command line always wins over the file.
 *
 * @module
 */

/**
 * Parse `--env-file` (bare, defaulting to `.env`) or `--env-file=<path>` out
 * of argv. Returns `null` when the flag is absent.
 */
export function parseEnvFileArg(args: string[]): string | null {
  for (const arg of args) {
    if (arg === "--env-file") return ".env";
    if (arg.startsWith("--env-file=")) return arg.slice("--env-file=".length);
  }
  return null;
}

const QUOTED_VALUE_RE = /^(['"])(.*)\1$/;

/**
 * Load a dotenv-style file into `Deno.env`.
 *
 * `path` resolves relative to `root` unless already absolute. Lines are
 * `KEY=VALUE`; blank lines and lines starting with `#` are skipped;
 * surrounding single or double quotes on the value are stripped. A key
 * already set in the environment is left untouched.
 *
 * Throws if the file can't be read — an explicitly-requested `--env-file`
 * that's missing is a configuration error worth failing loudly on, not a
 * silent no-op.
 */
export async function loadEnvFile(path: string, root: string): Promise<void> {
  const absPath = path.startsWith("/") ? path : `${root}/${path}`;
  let text: string;
  try {
    text = await Deno.readTextFile(absPath);
  } catch (err) {
    throw new Error(
      `--env-file: could not read "${absPath}": ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = value.match(QUOTED_VALUE_RE);
    if (quoted) value = quoted[2];
    if (Deno.env.get(key) === undefined) {
      Deno.env.set(key, value);
    }
  }
}
