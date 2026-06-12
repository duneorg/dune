/**
 * Guards the generated admin route/island manifest.
 *
 * The manifest (src/admin/manifest.gen.ts) replaces Fresh's fsRoutes()
 * directory crawling so the admin panel works when Dune runs from JSR.
 * It must be regenerated whenever files under src/admin/routes/ or
 * src/admin/islands/ change:
 *
 *   deno task gen:admin-manifest
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateManifest } from "../../scripts/generate-admin-manifest.ts";
import { adminIslands, adminLayout, adminMiddleware, adminRoutes } from "../../src/admin/manifest.gen.ts";

Deno.test("admin manifest is up to date with src/admin/routes and islands", async () => {
  const expected = await generateManifest();
  const actual = await Deno.readTextFile(
    new URL("../../src/admin/manifest.gen.ts", import.meta.url),
  );
  assertEquals(
    actual,
    expected,
    "src/admin/manifest.gen.ts is stale — run: deno task gen:admin-manifest",
  );
});

Deno.test("admin manifest contains middleware, layout, routes, and islands", () => {
  assertEquals(typeof adminMiddleware.handler, "function");
  assertEquals(typeof adminLayout.default, "function");

  // Every route module must expose something registrable.
  for (const { pattern, mod } of adminRoutes) {
    const registrable = typeof mod.default === "function" ||
      typeof mod.handler === "function" || typeof mod.handler === "object" ||
      typeof mod.handlers === "function" || typeof mod.handlers === "object";
    assertEquals(registrable, true, `route ${pattern} exports no component or handler`);
  }

  // Known anchors that must exist for the admin panel to function at all.
  const patterns = adminRoutes.map((r) => r.pattern);
  for (const required of ["/", "/login", "/pages", "/api/pages"]) {
    assertEquals(patterns.includes(required), true, `missing route pattern ${required}`);
  }

  assertEquals(adminIslands.length > 0, true, "no admin islands in manifest");
});

Deno.test("admin manifest orders static segments before dynamic ones", () => {
  const patterns = adminRoutes.map((r) => r.pattern);
  // /api/pages/reorder (static) must be registered before /api/pages/:path
  // (param), or the param route would shadow it.
  const reorder = patterns.indexOf("/api/pages/reorder");
  const param = patterns.indexOf("/api/pages/:path");
  assertEquals(reorder >= 0 && param >= 0, true);
  assertEquals(reorder < param, true, "static route must precede param route");
});
