/**
 * Core's package exports are not a second copy of the plugin contract. The
 * subpaths whose content moved into `@dune/plugin-api` were removed in 0.37
 * (duneorg/dune#161); this keeps them from coming back.
 */
import { assertEquals } from "@std/assert";

const REMOVED = [
  "./hooks",
  "./config",
  "./inline-edit",
  "./plugin-api",
  "./content/path-utils",
  "./content/page-loader",
  "./i18n",
  "./auth/authz-schema",
  "./auth/types",
  "./auth/passwords",
  "./auth/user-store-db",
  "./auth/authz-adapter-local",
  "./auth/authz-adapter-db",
];

Deno.test("removed subpaths stay out of deno.json exports", async () => {
  const cfg = JSON.parse(
    await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
  );
  const present = REMOVED.filter((k) => k in cfg.exports);
  assertEquals(present, []);
});
