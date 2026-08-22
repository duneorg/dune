/**
 * Regression test for the "./auth/mount" public export.
 *
 * mountDuneAuth() was previously only reachable via a relative src/ import —
 * not listed under any @dune/core/* subpath in deno.json — so no site could
 * actually enable public user auth (see later-roadmap's "mountDuneAuth() has
 * no public export" entry). This imports via the real public specifier
 * (the way a consuming site's main.ts would) and boots it against a real
 * bootstrap()'d app to prove both the export and the mount actually work.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { App } from "fresh";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { mountDuneAuth, type PublicAuthContext } from "@dune/core/auth/mount";

async function withAuthMountedApp(
  fn: (handler: (req: Request) => Promise<Response>, authCtx: PublicAuthContext) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_auth_mount_" });
  try {
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.home", "default.md"),
      "---\ntitle: Home\n---\n\nHello\n",
    );
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "site.yaml"),
      "title: Test Site\nurl: http://localhost:3000\nauth:\n  mode: dune\n  userStore: session\n",
    );

    const ctx = await bootstrap(root, {});
    // deno-lint-ignore no-explicit-any
    const app = new App() as any;
    const authCtx = await mountDuneAuth(app, ctx);
    const handler = app.handler();

    await fn(handler, authCtx);
  } finally {
    // Best-effort cleanup — mountDuneAuth's session/user-store setup can
    // still be settling a write when the test function returns, racing a
    // synchronous recursive remove (same class of leak fresh-app_test.ts
    // notes for bootstrap()'s file watcher). Not correctness-relevant here.
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "mountDuneAuth: importable via the public @dune/core/auth/mount specifier and returns a PublicAuthContext",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withAuthMountedApp(async (_handler, authCtx) => {
      assertEquals(typeof authCtx.resolveUser, "function");
      // mode: dune defaults authzStore to "local" — a real DuneAuthSystem, not null
      // (null only happens in external-jwt mode without authzStore: local).
      assertEquals(typeof authCtx.authz?.check, "function");
    });
  },
);

Deno.test(
  "mountDuneAuth: registers real /auth/* routes on the app — GET /auth/me is 401 with no session",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withAuthMountedApp(async (handler) => {
      const res = await handler(new Request("http://localhost/auth/me"));
      assertEquals(res.status, 401);
    });
  },
);

Deno.test(
  "mountDuneAuth: external-jwt without issuer and audience refuses to start",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    const root = await Deno.makeTempDir({ prefix: "dune_test_auth_jwt_unbound_" });
    try {
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\nHello\n",
      );
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "config", "site.yaml"),
        "title: Test Site\nurl: http://localhost:3000\nauth:\n  mode: external-jwt\n  jwt:\n    secret: test-secret\n",
      );

      const ctx = await bootstrap(root, {});
      // deno-lint-ignore no-explicit-any
      const app = new App() as any;
      await assertRejects(
        () => mountDuneAuth(app, ctx),
        Error,
        "auth.jwt.issuer and auth.jwt.audience",
      );
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
);
