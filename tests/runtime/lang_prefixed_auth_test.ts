/**
 * The auth routes exist only unprefixed (#168): a translated page must not
 * rewrite a link to them, and /<lang>/auth/login must go to the real one.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("/<lang>/auth/* goes to /auth/*, and links to it stay unprefixed", opts, async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_langauth_" });
  try {
    const files: Record<string, string> = {
      "config/site.yaml": "title: T\nurl: http://localhost:3000\ntheme:\n  name: t\n",
      "themes/t/theme.yaml": "name: t\n",
      "themes/t/templates/default.tsx":
        "/** @jsxImportSource preact */\nexport default function T({ children }) { return <html><body>{children}</body></html>; }\n",
      "config/system.yaml": "languages:\n  supported: [en, de]\n  default: en\n",
      "content/01.home/default.md": "---\ntitle: Home\n---\nhi\n",
      "content/02.docs/default.md": "---\ntitle: Docs\n---\nhi\n",
      "content/02.docs/default.de.md":
        "---\ntitle: Dokumente\n---\n[Anmelden](/auth/login) [Kontakt](/contact)\n",
      "content/03.auth/01.handbook/default.md": "---\ntitle: Handbook\n---\nhi\n",
      "content/03.auth/01.handbook/default.de.md": "---\ntitle: Handbuch\n---\nhallo\n",
      "content/03.auth/default.md": "---\ntitle: Auth\n---\nhi\n",
    };
    for (const [rel, data] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
      await Deno.writeTextFile(join(root, rel), data);
    }
    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    const get = (p: string) =>
      handler(new Request(`http://localhost:3000${p}`, { redirect: "manual" }), {} as never);

    const page = await (await get("/de/docs/")).text();
    assertEquals(page.includes('href="/auth/login"'), true, page);
    assertEquals(page.includes('href="/de/contact"'), true, page);

    const res = await get("/de/auth/login?next=%2Fde%2Fdocs");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/login?next=%2Fde%2Fdocs");
    await res.body?.cancel();

    // A site's own content under /auth still routes in every language.
    const own = await get("/de/auth/handbook/");
    assertEquals(own.status, 200);
    await own.body?.cancel();
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
