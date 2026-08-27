/**
 * Detects an enclosing Deno workspace that doesn't list a freshly-scaffolded
 * site as a member.
 *
 * Deno refuses to run a `deno.json` that sits under a workspace root's tree
 * without being declared in that root's `"workspace"` array — "Config file
 * must be a member of the workspace." `dune new` has no way to know whether
 * it's scaffolding into such a tree, so a site created there fails to start
 * with that error the moment `deno task dev` runs, with no indication why.
 *
 * This walks up from the new site looking for that situation and, if found,
 * prints the exact line to add — mirroring the existing
 * `local-checkout-detect.ts` warn-don't-mutate approach: editing a file
 * outside the site root without being asked is a bigger surprise than a
 * warning would be.
 *
 * @module
 */

import { relative } from "@std/path";
import { findWorkspaceRoot } from "./local-checkout-detect.ts";

/**
 * Print a warning if `siteDir` sits inside an ancestor Deno workspace that
 * doesn't already list it as a member. No-op (and cheap) otherwise.
 */
export async function warnIfUnregisteredWorkspaceMember(siteDir: string): Promise<void> {
  const absSite = await Deno.realPath(siteDir).catch(() => siteDir);
  // Look from the site's parent — the site's own deno.json has no
  // "workspace" field of its own to find, so starting there just costs an
  // extra no-op stat.
  const parent = absSite.replace(/\/[^/]+$/, "") || "/";
  const workspace = await findWorkspaceRoot(parent).catch(() => null);
  if (!workspace) return;

  const members = Array.isArray(workspace.config.workspace)
    ? workspace.config.workspace.filter((m): m is string => typeof m === "string")
    : [];
  const relFromRoot = relative(workspace.rootDir, absSite).replace(/\\/g, "/");
  const alreadyMember = members.some((m) => {
    const normalized = m.replace(/^\.\//, "").replace(/\/+$/, "");
    return normalized === relFromRoot;
  });
  if (alreadyMember) return;

  const memberEntry = relFromRoot.startsWith("../") ? relFromRoot : `./${relFromRoot}`;
  console.warn(
    `\n  ⚠️  This site sits inside an enclosing Deno workspace at ${workspace.rootDir}\n` +
      `     that doesn't list it as a member — "deno task dev" will fail with\n` +
      `     "Config file must be a member of the workspace" until you add it.\n\n` +
      `     Add "${memberEntry}" to the "workspace" array in:\n` +
      `       ${workspace.rootDir}/deno.json\n`,
  );
}
