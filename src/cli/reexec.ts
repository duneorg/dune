/**
 * Site-config auto re-exec.
 *
 * When the site root has a deno.json and the process wasn't started with one,
 * re-exec `dune` under `--config=<site>/deno.json` so dynamically-imported
 * theme TSX can resolve bare specifiers from the site's import map.
 *
 * @module
 */

import {
  computeLockPolicy,
  lockPolicyToArgs,
  preflightLockPolicy,
} from "./lock-policy.ts";
import { waitForwardingSignals } from "./forward-signals.ts";

/**
 * The real CLI entrypoint's URL, resolved relative to this module.
 *
 * reexec.ts itself lives at src/cli/reexec.ts, but the entrypoint script is
 * one directory up at src/cli.ts — a bare "./cli.ts" resolves to the
 * nonexistent src/cli/cli.ts instead. Only manifests when this module is
 * loaded from a non-`file://` URL (`jsr:`-resolved, i.e. every real site in
 * production) — `import.meta.url.startsWith("file://")` short-circuits this
 * whole re-exec path for a local checkout, which is why `deno task test`
 * alone never caught it.
 */
export function resolveCliEntryUrl(): string {
  return new URL("../cli.ts", import.meta.url).href;
}

/** See module doc. Returns normally when no re-exec was needed. */
export async function maybeReexecWithSiteConfig(
  args: string[],
  command: string,
  root: string,
): Promise<void> {
  if (
    !Deno.env.get("DUNE_CONFIG_APPLIED") && command !== "new" &&
    command !== "lockfile:check" && command !== "lockfile:sync" &&
    !import.meta.url.startsWith("file://")
  ) {
    // We're about to lock into running the published @dune/core package for
    // the rest of this process tree — see local-checkout-detect.ts for why
    // that's easy to hit by accident even with a workspace-linked checkout
    // on disk. Only worth the filesystem walk for the commands a maintainer
    // would actually use to exercise local changes against a real site.
    if (command === "dev" || command === "serve") {
      const { warnIfLocalCheckoutUnused } = await import(
        "./local-checkout-detect.ts"
      );
      await warnIfLocalCheckoutUnused(Deno.cwd());
    }
    const { resolve, join: joinPath } = await import("@std/path");
    const absRoot = resolve(root);
    const siteDenoJson = joinPath(absRoot, "deno.json");
    try {
      await Deno.stat(siteDenoJson);
      // Re-exec using cli.ts (not cli-impl.ts) so the entry-point module is
      // executed as a script and calls main() automatically.
      //
      // Lockfile flags are rendered explicitly (see cli/lock-policy.ts).
      // Without them, `--config=<site>` makes the child auto-discover the
      // site's deno.lock and rewrite it, unfrozen, as a side effect of
      // resolving its own module graph — silently dirtying the lockfile on
      // production working trees.
      const lockPolicy = await computeLockPolicy(args);
      const lockError = await preflightLockPolicy(lockPolicy);
      if (lockError) {
        console.error(lockError);
        Deno.exit(1);
      }
      const cliUrl = resolveCliEntryUrl();
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          `--config=${siteDenoJson}`,
          ...lockPolicyToArgs(lockPolicy),
          cliUrl,
          ...args,
        ],
        env: {
          ...Deno.env.toObject(),
          DUNE_CONFIG_APPLIED: "1",
          DENO_NO_UPDATE_CHECK: "1",
        },
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const status = await waitForwardingSignals(cmd.spawn());
      Deno.exit(status.code);
    } catch {
      // No deno.json in site root — proceed normally
    }
  }
}
