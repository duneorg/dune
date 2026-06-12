import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scrubMarkersFromResponse, stripDuneMarkers } from "../../src/cli/marker-scrub.ts";

Deno.test("stripDuneMarkers: removes marker attributes from tags", () => {
  const html =
    `<article><h1 data-dune-field="title" data-dune-source="content/01.about/default.md">About</h1>` +
    `<div data-dune-body data-dune-source="content/01.about/default.md" class="body">Hi</div></article>`;
  assertEquals(
    stripDuneMarkers(html),
    `<article><h1>About</h1><div class="body">Hi</div></article>`,
  );
});

Deno.test("stripDuneMarkers: handles quoting variants and typed markers", () => {
  const html =
    `<span data-dune-field='date' data-dune-field-type=date data-dune-source="a.md">2026</span>` +
    `<nav data-dune-no-edit>menu</nav>`;
  assertEquals(stripDuneMarkers(html), `<span>2026</span><nav>menu</nav>`);
});

Deno.test("stripDuneMarkers: leaves escaped occurrences in text alone", () => {
  // Documentation pages show markers inside code blocks; the HTML there is
  // entity-escaped, so it is not a tag token and must survive.
  const html = `<pre><code>&lt;div data-dune-body&gt;</code></pre>` +
    `<p>Use data-dune-no-edit to opt out.</p>`;
  assertEquals(stripDuneMarkers(html), html);
});

Deno.test("stripDuneMarkers: no markers — returns same reference", () => {
  const html = `<p class="x">plain</p>`;
  assertStrictEquals(stripDuneMarkers(html), html);
});

Deno.test("stripDuneMarkers: non-marker attributes on the same tag survive", () => {
  const html = `<div id="a" data-dune-body data-other="keep" class="b">x</div>`;
  assertEquals(stripDuneMarkers(html), `<div id="a" data-other="keep" class="b">x</div>`);
});

Deno.test("scrubMarkersFromResponse: scrubs HTML responses, preserves status/headers", async () => {
  const res = new Response(`<div data-dune-body>x</div>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Keep": "1" },
  });
  const out = await scrubMarkersFromResponse(res);
  assertEquals(await out.text(), `<div>x</div>`);
  assertEquals(out.status, 200);
  assertEquals(out.headers.get("X-Keep"), "1");
});

Deno.test("scrubMarkersFromResponse: non-HTML passes through untouched", async () => {
  const res = new Response(`{"data-dune-body":1}`, {
    headers: { "Content-Type": "application/json" },
  });
  const out = await scrubMarkersFromResponse(res);
  assertStrictEquals(out, res);
  assert((await out.text()).includes("data-dune-body"));
});
