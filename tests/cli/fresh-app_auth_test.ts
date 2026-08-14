/**
 * createDuneApp(): mountDuneAuth() auto-wiring (mountAuth option, default true).
 *
 * Previously mountDuneAuth() was never called from anywhere in the normal
 * `dune serve`/`dune dev` path — `auth:` in site.yaml had zero effect no
 * matter how it was configured. createDuneApp() now calls it automatically
 * whenever `site.auth` is present, gated so sites that never opted in get
 * zero behavior change (no new directories, no /auth/* routes, no added
 * per-request middleware).
 *
 * NOTE: same file-watcher/session-store cleanup-race caveat as
 * fresh-app_test.ts and mount_test.ts — sanitizeOps/sanitizeResources off,
 * best-effort remove.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";

async function withApp(
  siteYaml: string,
  fn: (handler: (req: Request) => Promise<Response>) => Promise<void>,
  appOptions: { mountAuth?: boolean } = {},
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_freshapp_auth_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\nHello\n",
    );
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), siteYaml);

    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false, ...appOptions });
    const handler = app.handler();

    await fn(handler);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "createDuneApp: auth: configured in site.yaml -> /auth/me is real (401, not 404)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp(
      "title: Test Site\nurl: http://localhost:3000\nauth:\n  mode: dune\n  userStore: session\n",
      async (handler) => {
        const res = await handler(new Request("http://localhost/auth/me"));
        assertEquals(res.status, 401);
      },
    );
  },
);

Deno.test(
  "createDuneApp: no auth: block in site.yaml -> /auth/me 404s (unchanged behavior, opted out)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp(
      "title: Test Site\nurl: http://localhost:3000\n",
      async (handler) => {
        const res = await handler(new Request("http://localhost/auth/me"));
        assertEquals(res.status, 404);
      },
    );
  },
);

Deno.test(
  "createDuneApp: mountAuth: false opts out even with auth: configured (SSG builder's case)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp(
      "title: Test Site\nurl: http://localhost:3000\nauth:\n  mode: dune\n  userStore: session\n",
      async (handler) => {
        const res = await handler(new Request("http://localhost/auth/me"));
        assertEquals(res.status, 404);
      },
      { mountAuth: false },
    );
  },
);
