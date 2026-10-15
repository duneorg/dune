/**
 * Which theme layout wraps a TSX content page (src/routing/tsx-handler.ts).
 *
 * Policy: a plain TSX content page is wrapped in the theme's standard layout
 * (components/layout.tsx — the one Markdown/flex/error pages get) unless it
 * opts out with `layout: false`; Fresh-style `handler` pages that call
 * ctx.render() own the whole page and are never wrapped. These run the real
 * bootstrap() + createDuneApp() pipeline against a real theme on disk.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";

const layoutSrc = (marker: string) => `
/** @jsxImportSource preact */
export default function Layout({ children, pageTitle }) {
  return <html><head><title>{pageTitle}</title></head><body><header id="chrome">${marker}</header>{children}</body></html>;
}
`;

const tsxPage = (frontmatterExtra: string, body = `<main id="page-body">hello</main>`) => `
/** @jsxImportSource preact */
export const frontmatter = { title: "TSX Page", published: true, visible: true${frontmatterExtra} };
export default function P() { return ${body}; }
`;

async function withSite(
  files: Record<string, string>,
  fn: (get: (path: string) => Promise<string>) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_tsx_layout_" });
  try {
    const all: Record<string, string> = {
      "config/site.yaml": "title: Test Site\nurl: http://localhost:3000\ntheme:\n  name: t\n",
      "themes/t/theme.yaml": "name: t\n",
      ...files,
    };
    for (const [rel, text] of Object.entries(all)) {
      await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
      await Deno.writeTextFile(join(root, rel), text);
    }
    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    await fn(async (path) => {
      const res = await handler(new Request(`http://localhost${path}`));
      assertEquals(res.status, 200, `GET ${path}`);
      return await res.text();
    });
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("TSX page with no layout: frontmatter is wrapped in the theme's components/layout.tsx", opts, async () => {
  await withSite({
    "themes/t/components/layout.tsx": layoutSrc("THEME-LAYOUT"),
    "content/01.page/default.tsx": tsxPage(""),
  }, async (get) => {
    const body = await get("/page/");
    assertStringIncludes(body, `<header id="chrome">THEME-LAYOUT</header>`);
    assertStringIncludes(body, `<main id="page-body">hello</main>`);
    assertStringIncludes(body, "<title>TSX Page");
  });
});

Deno.test('TSX page with layout: "default" gets the same standard theme layout', opts, async () => {
  await withSite({
    "themes/t/components/layout.tsx": layoutSrc("THEME-LAYOUT"),
    "content/01.page/default.tsx": tsxPage(`, layout: "default"`),
  }, async (get) => {
    assertStringIncludes(await get("/page/"), `<header id="chrome">THEME-LAYOUT</header>`);
  });
});

Deno.test("TSX page with layout: false is not wrapped", opts, async () => {
  await withSite({
    "themes/t/components/layout.tsx": layoutSrc("THEME-LAYOUT"),
    "content/01.page/default.tsx": tsxPage(`, layout: false`),
  }, async (get) => {
    const body = await get("/page/");
    assertEquals(body.includes("THEME-LAYOUT"), false);
    assertStringIncludes(body, `<main id="page-body">hello</main>`);
  });
});

Deno.test("TSX page with a named layout loads components/<name>.tsx, not the standard layout", opts, async () => {
  await withSite({
    "themes/t/components/layout.tsx": layoutSrc("THEME-LAYOUT"),
    "themes/t/components/landing.tsx": layoutSrc("LANDING-LAYOUT"),
    "content/01.page/default.tsx": tsxPage(`, layout: "landing"`),
  }, async (get) => {
    const body = await get("/page/");
    assertStringIncludes(body, "LANDING-LAYOUT");
    assertEquals(body.includes("THEME-LAYOUT"), false);
  });
});

Deno.test("a theme's literal components/default.tsx still takes precedence for TSX pages", opts, async () => {
  await withSite({
    "themes/t/components/layout.tsx": layoutSrc("THEME-LAYOUT"),
    "themes/t/components/default.tsx": layoutSrc("TSX-DEFAULT-LAYOUT"),
    "content/01.page/default.tsx": tsxPage(""),
  }, async (get) => {
    const body = await get("/page/");
    assertStringIncludes(body, "TSX-DEFAULT-LAYOUT");
    assertEquals(body.includes("THEME-LAYOUT"), false);
  });
});

Deno.test("a theme with no layout at all still serves the TSX page, unwrapped", opts, async () => {
  await withSite({
    "content/01.page/default.tsx": tsxPage(""),
  }, async (get) => {
    assertStringIncludes(await get("/page/"), `<main id="page-body">hello</main>`);
  });
});

Deno.test("handler pages that call ctx.render() own the whole page: never wrapped", opts, async () => {
  await withSite({
    "themes/t/components/layout.tsx": layoutSrc("THEME-LAYOUT"),
    "content/01.page/default.tsx": `
/** @jsxImportSource preact */
export const frontmatter = { title: "Handler Page", published: true, visible: true };
export const handler = { GET(_req, ctx) { return ctx.render({}); } };
export default function P() { return <main id="page-body">from handler</main>; }
`,
  }, async (get) => {
    const body = await get("/page/");
    assertStringIncludes(body, `<main id="page-body">from handler</main>`);
    assertEquals(body.includes("THEME-LAYOUT"), false);
  });
});
