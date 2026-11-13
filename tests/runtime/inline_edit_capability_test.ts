/**
 * The inline-edit WebSocket route takes its manager from the `editor.inline`
 * capability, not from the removed `adminServices` field.
 *
 * Without a provider the route answers 501 ("not enabled"); with one it
 * proceeds to the WebSocket checks (426 when the request is not an upgrade).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";
import type { DunePlugin } from "../../src/hooks/types.ts";

async function withApp(
  plugins: DunePlugin[],
  fn: (handler: (req: Request) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_inline_edit_cap_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\nHello\n",
    );
    const ctx = await bootstrap(root, {
      plugins,
      // deno-lint-ignore no-explicit-any
    });
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    await fn(app.handler());
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "/api/inline-edit/ws: no inline-edit provider -> 501",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp([], async (handler) => {
      const res = await handler(new Request("http://localhost/api/inline-edit/ws"));
      assertEquals(res.status, 501);
    });
  },
);

Deno.test(
  "/api/inline-edit/ws: a plugin providing the inline-edit capability enables the route",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const provider: DunePlugin = {
      name: "test-inline-edit",
      version: "1.0.0",
      hooks: {},
      setup(api) {
        api.capabilities.provide("editor.inline", () => ({
          handleUpgrade: () => new Response(null, { status: 204 }),
        } as never));
      },
    };
    await withApp([provider], async (handler) => {
      const res = await handler(new Request("http://localhost/api/inline-edit/ws"));
      assertEquals(res.status, 426);
    });
  },
);
