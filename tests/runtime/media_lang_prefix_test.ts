/**
 * Co-located media must be reachable at /<lang>/<route>/<file> as well as the
 * unprefixed path (older rewritten links and external links may carry the
 * prefix), and gating must follow the real owner page.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("co-located media is served at the language-prefixed path too", opts, async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_medialang_" });
  try {
    const files: Record<string, string | Uint8Array> = {
      "config/site.yaml":
        "title: T\nurl: http://localhost:3000\ntheme:\n  name: t\n",
      "themes/t/theme.yaml": "name: t\n",
      "themes/t/templates/default.tsx":
        "/** @jsxImportSource preact */\nexport default function T({ children }) { return <html><body>{children}</body></html>; }\n",
      "config/system.yaml": "languages:\n  supported: [en, de]\n  default: en\n",
      "content/01.home/default.md": "---\ntitle: Home\n---\nhi\n",
      "content/02.docs/default.md": "---\ntitle: Docs\n---\nhi\n",
      "content/02.docs/default.de.md": "---\ntitle: Dokumente\n---\n[Download](doc.pdf)\n",
      "content/02.docs/doc.pdf": new TextEncoder().encode("%PDF-1.4 test"),
    };
    for (const [rel, data] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
      await Deno.writeFile(
        join(root, rel),
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    }
    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    const get = (p: string) =>
      handler(new Request(`http://localhost:3000${p}`), {} as never);

    const plain = await get("/docs/doc.pdf");
    assertEquals(plain.status, 200);
    await plain.arrayBuffer();

    const prefixed = await get("/de/docs/doc.pdf");
    assertEquals(prefixed.status, 200);
    assertEquals(await prefixed.text(), "%PDF-1.4 test");

    // The rendered German page links the file at its unprefixed path.
    const page = await (await get("/de/docs/")).text();
    assertEquals(page.includes('href="/docs/doc.pdf"'), true);
    assertEquals(page.includes("/de/docs/doc.pdf"), false);

    assertEquals((await get("/de/docs/missing.pdf")).status, 404);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
