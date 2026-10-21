/**
 * Template `output` modes: a template that exports `output` produces the
 * response body itself — an HTML fragment, JSON, XML, text or any media type —
 * instead of being wrapped in an HTML document.
 *
 * Runs the real bootstrap() + createDuneApp() pipeline against an on-disk
 * theme, plus unit tests for the declaration parser.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";
import { dataOutputBody, parseTemplateOutput } from "../../src/themes/output.ts";

// ── parseTemplateOutput / dataOutputBody (pure) ──────────────────────────────

Deno.test("parseTemplateOutput: shorthands resolve to their media types", () => {
  assertEquals(parseTemplateOutput("fragment"), { kind: "fragment", contentType: "text/html; charset=utf-8", json: false });
  assertEquals(parseTemplateOutput("json"), { kind: "data", contentType: "application/json; charset=utf-8", json: true });
  assertEquals(parseTemplateOutput("xml"), { kind: "data", contentType: "application/xml; charset=utf-8", json: false });
  assertEquals(parseTemplateOutput("text"), { kind: "data", contentType: "text/plain; charset=utf-8", json: false });
});

Deno.test("parseTemplateOutput: a plain media type is taken verbatim, with charset only where it belongs", () => {
  assertEquals(parseTemplateOutput("text/csv")?.contentType, "text/csv; charset=utf-8");
  assertEquals(parseTemplateOutput("application/atom+xml")?.contentType, "application/atom+xml; charset=utf-8");
  assertEquals(parseTemplateOutput("application/pdf")?.contentType, "application/pdf");
  assertEquals(parseTemplateOutput("application/ld+json")?.json, true);
  assertEquals(parseTemplateOutput("text/csv")?.json, false);
});

Deno.test("parseTemplateOutput: an explicit text/html is the same as fragment", () => {
  assertEquals(parseTemplateOutput("text/html"), parseTemplateOutput("fragment"));
  assertEquals(parseTemplateOutput("TEXT/HTML")?.kind, "fragment");
});

Deno.test("parseTemplateOutput: invalid values are rejected, including header-injection attempts", () => {
  for (
    const bad of [
      "", "yaml", "html", "JSON ", "text/csv; charset=x", "text/csv\r\nSet-Cookie: a=b", "text/", "/csv", "a b/c",
      true, 42, null, undefined, { kind: "json" },
    ]
  ) {
    assertEquals(parseTemplateOutput(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("dataOutputBody: strings pass through, JSON values serialize, anything else throws", () => {
  const json = parseTemplateOutput("json")!;
  const xml = parseTemplateOutput("xml")!;
  assertEquals(dataOutputBody('{"a":1}', json, "t"), '{"a":1}');
  assertEquals(dataOutputBody({ a: 'x "y" & <z>' }, json, "t"), '{"a":"x \\"y\\" & <z>"}');
  assertEquals(dataOutputBody([1, 2], json, "t"), "[1,2]");
  assertEquals(dataOutputBody(null, json, "t"), "null");
  assertEquals(dataOutputBody("<r/>", xml, "t"), "<r/>");
  for (const [v, o] of [[{ a: 1 }, xml], [undefined, json], [undefined, xml], [() => 1, json]] as const) {
    let threw = false;
    try {
      dataOutputBody(v, o, "tpl");
    } catch (e) {
      threw = true;
      assertStringIncludes((e as Error).message, 'Template "tpl"');
    }
    assertEquals(threw, true);
  }
});

// ── full pipeline ────────────────────────────────────────────────────────────

const P = "/** @jsxImportSource preact */\n";

const FILES: Record<string, string> = {
  "config/site.yaml": "title: T\nurl: http://localhost:3000\ntheme:\n  name: t\nplugins:\n  - src: ./plugins/stamp.ts\n",
  "themes/t/theme.yaml": "name: t\n",
  "themes/t/components/layout.tsx": P +
    `export default function L({children}: any){ return <html><head><title>T</title></head><body><header>CHROME</header>{children}</body></html>; }`,
  "themes/t/templates/default.tsx": P +
    `export default function D(props: any){ const Layout = props.Layout; return <Layout {...props}><main>{props.children}</main></Layout>; }`,
  "themes/t/templates/frag.tsx": P +
    `export const output = "fragment";\nexport default function F(){ return <section id="frag" data-dune-edit="secret"><p>1 &lt; 2 &amp; "q"</p></section>; }`,
  "themes/t/templates/jsonout.tsx": `export const output = "json";\nexport default function J(props: any){ return { title: props.page.frontmatter.title, note: 'a "quoted" & <tag>' }; }`,
  "themes/t/templates/xmlout.tsx": `export const output = "xml";\nexport default async function X(){ return '<?xml version="1.0"?><r>&amp; ok</r>'; }`,
  "themes/t/templates/csvout.tsx": `export const output = "text/csv";\nexport default function C(){ return "a,b\\n1,2\\n"; }`,
  "themes/t/templates/textout.tsx": `export const output = "text";\nexport default function T(){ return "plain <not html> & text"; }`,
  "themes/t/templates/badxml.tsx": `export const output = "xml";\nexport default function B(){ return { not: "a string" }; }`,
  "themes/t/templates/badout.tsx": P + `export const output = "yaml";\nexport default function B(){ return <p id="normal">still a page</p>; }`,
  // Stands in for the admin bar: a transformResponse plugin that appends to ANY response body.
  "plugins/stamp.ts": `export default { name: "stamp", version: "1.0.0", hooks: {},
    async transformResponse({ response }: { response: Response }) {
      const text = await response.text();
      return new Response(text + "<!--TRANSFORMED-->", { status: response.status, headers: response.headers });
    } };`,
  "content/01.home/default.md": "---\ntitle: Home\n---\nhi\n",
  "content/02.frag/default.md": "---\ntitle: Frag\ntemplate: frag\n---\nbody\n",
  "content/03.data.md": "---\ntitle: Pricing\ntemplate: jsonout\nslug: pricing.json\n---\nbody\n",
  "content/04.feed.md": "---\ntitle: Feed\ntemplate: xmlout\nslug: items.xml\n---\nbody\n",
  "content/05.table.md": "---\ntitle: Table\ntemplate: csvout\nslug: table.csv\n---\nbody\n",
  "content/06.note.md": "---\ntitle: Note\ntemplate: textout\nslug: note.txt\n---\nbody\n",
  "content/07.bad.md": "---\ntitle: Bad\ntemplate: badxml\nslug: bad.xml\n---\nbody\n",
  "content/08.badout/default.md": "---\ntitle: BadOut\ntemplate: badout\n---\nbody\n",
};

async function withApp(
  dev: boolean,
  fn: (get: (path: string, init?: RequestInit) => Promise<Response>) => Promise<void>,
  extraFiles: Record<string, string> = {},
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_output_" });
  try {
    for (const [rel, text] of Object.entries({ ...FILES, ...extraFiles })) {
      await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
      await Deno.writeTextFile(join(root, rel), text);
    }
    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev });
    const handler = app.handler();
    await fn((path, init) => handler(new Request(`http://localhost${path}`, init)));
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("control: a normal page is a full document and DOES get the plugin transform", opts, async () => {
  await withApp(false, async (get) => {
    const body = await (await get("/")).text();
    assertStringIncludes(body, "<!DOCTYPE html>");
    assertStringIncludes(body, "CHROME");
    assertStringIncludes(body, "<!--TRANSFORMED-->");
  });
});

Deno.test('output = "fragment": bare HTML, no shell, no injectors, markers scrubbed', opts, async () => {
  await withApp(false, async (get) => {
    const res = await get("/frag/");
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
    const body = await res.text();
    // Preact escapes text; the data-dune-edit marker is scrubbed for an anonymous visitor.
    assertEquals(body, `<section id="frag"><p>1 &lt; 2 &amp; &quot;q&quot;</p></section>`);
    assertEquals(body.includes("<!--TRANSFORMED-->"), false);
  });
});

Deno.test('output = "json": serialized, not HTML-escaped, right content type, no transform', opts, async () => {
  await withApp(false, async (get) => {
    const res = await get("/pricing.json");
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json; charset=utf-8");
    const text = await res.text();
    assertEquals(JSON.parse(text), { title: "Pricing", note: 'a "quoted" & <tag>' });
    assertEquals(text.includes("&quot;") || text.includes("&amp;"), false);
  });
});

Deno.test('output = "xml" (async template) and "text" and a custom media type pass strings through untouched', opts, async () => {
  await withApp(false, async (get) => {
    const xml = await get("/items.xml");
    assertEquals(xml.headers.get("content-type"), "application/xml; charset=utf-8");
    assertEquals(await xml.text(), '<?xml version="1.0"?><r>&amp; ok</r>');

    const csv = await get("/table.csv");
    assertEquals(csv.headers.get("content-type"), "text/csv; charset=utf-8");
    assertEquals(await csv.text(), "a,b\n1,2\n");

    const txt = await get("/note.txt");
    assertEquals(txt.headers.get("content-type"), "text/plain; charset=utf-8");
    assertEquals(await txt.text(), "plain <not html> & text");
  });
});

Deno.test("bare outputs still get the standard security headers and normal caching", opts, async () => {
  await withApp(false, async (get) => {
    for (const path of ["/frag/", "/pricing.json", "/items.xml"]) {
      const res = await get(path);
      assertEquals(res.headers.get("x-content-type-options"), "nosniff", path);
      assertEquals(res.headers.get("x-frame-options"), "SAMEORIGIN", path);
      const etag = res.headers.get("etag");
      await res.body?.cancel();
      assertEquals(typeof etag, "string", `${path} has an ETag`);
      const again = await get(path, { headers: { "If-None-Match": etag! } });
      assertEquals(again.status, 304, `${path} revalidates`);
    }
  });
});

Deno.test("a data template that returns the wrong type is a 500, not '[object Object]'", opts, async () => {
  await withApp(false, async (get) => {
    const res = await get("/bad.xml");
    assertEquals(res.status, 500);
    assertEquals((await res.text()).includes("[object Object]"), false);
  });
});

Deno.test("an invalid output value is ignored: the page renders as a normal document", opts, async () => {
  await withApp(false, async (get) => {
    const body = await (await get("/badout/")).text();
    assertStringIncludes(body, `id="normal"`);
    assertStringIncludes(body, "<!DOCTYPE html>");
  });
});

Deno.test("dev mode: bare outputs get no live-reload script, normal pages still do", opts, async () => {
  await withApp(true, async (get) => {
    assertStringIncludes(await (await get("/")).text(), "/__dune_reload");
    for (const path of ["/frag/", "/pricing.json"]) {
      const body = await (await get(path)).text();
      assertEquals(body.includes("__dune_reload"), false, path);
      assertEquals(body.includes("<!--TRANSFORMED-->"), false, path);
    }
  });
});

Deno.test("with the page cache on, bare outputs keep their Content-Type on every request, not just the first", opts, async () => {
  await withApp(false, async (get) => {
    const expected: Record<string, string> = {
      "/pricing.json": "application/json; charset=utf-8",
      "/items.xml": "application/xml; charset=utf-8",
      "/note.txt": "text/plain; charset=utf-8",
      "/table.csv": "text/csv; charset=utf-8", // a custom media type survives the hit too
      "/frag/": "text/html; charset=utf-8",
    };
    for (const [path, type] of Object.entries(expected)) {
      let firstBody: string | undefined;
      // Request 1 fills the cache; 2 and 3 are served from it.
      for (let i = 1; i <= 3; i++) {
        const res = await get(path);
        assertEquals(res.status, 200, `${path} #${i}`);
        assertEquals(res.headers.get("content-type"), type, `${path} request #${i}`);
        assertEquals(res.headers.get("x-content-type-options"), "nosniff", `${path} #${i}`);
        const body = await res.text();
        firstBody ??= body;
        assertEquals(body, firstBody, `${path} #${i} body`);
      }
    }
  }, { "config/system.yaml": "page_cache:\n  enabled: true\n" });
});

Deno.test("with the page cache on, a cached JSON body is never served as text/html (stored-XSS shape)", opts, async () => {
  await withApp(false, async (get) => {
    for (let i = 1; i <= 3; i++) {
      const res = await get("/hostile.json");
      assertEquals(res.headers.get("content-type"), "application/json; charset=utf-8", `request #${i}`);
      assertStringIncludes(await res.text(), "<script>alert(1)</script>");
    }
  }, {
    "config/system.yaml": "page_cache:\n  enabled: true\n",
    "themes/t/templates/hostile.tsx": `export const output = "json";\nexport default function H(){ return { note: "<script>alert(1)</script>" }; }`,
    "content/09.hostile.md": "---\ntitle: H\ntemplate: hostile\nslug: hostile.json\n---\nx\n",
  });
});
