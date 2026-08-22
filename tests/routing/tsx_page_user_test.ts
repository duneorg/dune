/**
 * Full-pipeline integration tests, covering two related pieces:
 *
 * - Backlog item #9: TSX content pages get an auto-populated `user`
 *   prop (ContentPageProps.user) instead of having to hand-parse the
 *   internal x-dune-user header themselves. (Field was originally named
 *   `siteUser`, matching the pre-rename `SiteUser` type; renamed to `user`
 *   to follow dec-identity-unification's `SiteUser` → `User` rename.)
 * - createDuneApp() strips any externally-supplied x-dune-user header
 *   unconditionally, regardless of whether site.auth is configured, so a
 *   request can never set its own value for this internal header — see
 *   stripUserHeader() in src/runtime/server.ts.
 *
 * These render a real .tsx content page through bootstrap() +
 * createDuneApp() (not a mocked/unit harness) so the actual request
 * pipeline — middleware ordering, dynamic import, prop threading — is what
 * gets exercised, not just the extracted helper functions covered
 * elsewhere (tests/runtime/server_test.ts).
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";

const TSX_PAGE = `
/** @jsxImportSource preact */
export const frontmatter = {
  title: "Whoami",
  published: true,
  visible: true,
  layout: false,
};

export default function Whoami({ user }) {
  return <div id="whoami">{JSON.stringify(user)}</div>;
}
`;

async function withApp(
  siteYaml: string,
  fn: (handler: (req: Request) => Promise<Response>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_tsx_siteuser_" });
  try {
    await Deno.mkdir(join(root, "content", "01.whoami"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "content", "01.whoami", "default.tsx"),
      TSX_PAGE,
    );
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(join(root, "config", "site.yaml"), siteYaml);

    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();

    await fn(handler);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "TSX page user prop: no session, no site.auth configured -> user is null",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp(
      "title: Test Site\nurl: http://localhost:3000\n",
      async (handler) => {
        const res = await handler(new Request("http://localhost/whoami/"));
        const body = await res.text();
        assertStringIncludes(body, `<div id="whoami">null</div>`);
      },
    );
  },
);

Deno.test(
  "TSX page user prop: an incoming x-dune-user header has no effect, with no site.auth configured",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp(
      "title: Test Site\nurl: http://localhost:3000\n",
      async (handler) => {
        const incoming = JSON.stringify({
          id: "someone-else",
          email: "someone-else@example.com",
          roles: ["admin"],
          provider: "test",
        });
        const res = await handler(
          new Request("http://localhost/whoami/", {
            headers: { "x-dune-user": incoming },
          }),
        );
        const body = await res.text();
        // The header is internal-only; an incoming request can't set it.
        assertStringIncludes(body, `<div id="whoami">null</div>`);
        assertEquals(body.includes("someone-else"), false);
      },
    );
  },
);

Deno.test(
  "TSX page user prop: an incoming x-dune-user header has no effect, with site.auth configured",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withApp(
      "title: Test Site\nurl: http://localhost:3000\nauth:\n  mode: dune\n  userStore: session\n",
      async (handler) => {
        const incoming = JSON.stringify({
          id: "someone-else",
          email: "someone-else@example.com",
          roles: ["admin"],
          provider: "test",
        });
        const res = await handler(
          new Request("http://localhost/whoami/", {
            headers: { "x-dune-user": incoming },
          }),
        );
        const body = await res.text();
        assertStringIncludes(body, `<div id="whoami">null</div>`);
        assertEquals(body.includes("someone-else"), false);
      },
    );
  },
);
