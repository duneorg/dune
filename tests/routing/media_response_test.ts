import { assertEquals } from "jsr:@std/assert@^1";
import {
  mediaBodyResponse,
  parseByteRange,
} from "../../src/routing/media-response.ts";

const data = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256));
const media = { data, contentType: "audio/mpeg", size: data.length };

function get(range?: string, base: Record<string, string> = {}) {
  const req = new Request("http://localhost/a.mp3", {
    headers: range ? { Range: range } : {},
  });
  return mediaBodyResponse(req, media, {
    "Content-Type": "audio/mpeg",
    ...base,
  });
}

Deno.test("parseByteRange: a-b, a-, -n", () => {
  assertEquals(parseByteRange("bytes=100-199", 1000), {
    kind: "partial",
    start: 100,
    end: 199,
  });
  assertEquals(parseByteRange("bytes=900-", 1000), {
    kind: "partial",
    start: 900,
    end: 999,
  });
  assertEquals(parseByteRange("bytes=-100", 1000), {
    kind: "partial",
    start: 900,
    end: 999,
  });
  assertEquals(parseByteRange("bytes=-5000", 1000), {
    kind: "partial",
    start: 0,
    end: 999,
  });
  assertEquals(parseByteRange("bytes=990-5000", 1000), {
    kind: "partial",
    start: 990,
    end: 999,
  });
});

Deno.test("parseByteRange: unsatisfiable", () => {
  assertEquals(parseByteRange("bytes=1000-", 1000), { kind: "unsatisfiable" });
  assertEquals(parseByteRange("bytes=2000-3000", 1000), {
    kind: "unsatisfiable",
  });
  assertEquals(parseByteRange("bytes=-0", 1000), { kind: "unsatisfiable" });
});

Deno.test("parseByteRange: malformed, multi-range, other units are ignored", () => {
  for (
    const h of [
      "bytes=0-1,5-6",
      "bytes=abc",
      "bytes=-",
      "bytes=5-2",
      "items=0-1",
      "0-1",
      "",
    ]
  ) {
    assertEquals(parseByteRange(h, 1000), { kind: "full" }, h);
  }
  assertEquals(parseByteRange(null, 1000), { kind: "full" });
});

Deno.test("mediaBodyResponse: no Range → 200, full body, Accept-Ranges", async () => {
  const res = get();
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Accept-Ranges"), "bytes");
  assertEquals(res.headers.get("Content-Length"), "1000");
  assertEquals(res.headers.get("Content-Range"), null);
  assertEquals(new Uint8Array(await res.arrayBuffer()), data);
});

Deno.test("mediaBodyResponse: bytes=100-199 → 206 with slice", async () => {
  const res = get("bytes=100-199");
  assertEquals(res.status, 206);
  assertEquals(res.headers.get("Content-Range"), "bytes 100-199/1000");
  assertEquals(res.headers.get("Content-Length"), "100");
  assertEquals(res.headers.get("Accept-Ranges"), "bytes");
  assertEquals(new Uint8Array(await res.arrayBuffer()), data.slice(100, 200));
});

Deno.test("mediaBodyResponse: open-ended and suffix ranges", async () => {
  const open = get("bytes=990-");
  assertEquals(open.status, 206);
  assertEquals(open.headers.get("Content-Range"), "bytes 990-999/1000");
  assertEquals(open.headers.get("Content-Length"), "10");
  await open.body?.cancel();

  const suffix = get("bytes=-10");
  assertEquals(suffix.status, 206);
  assertEquals(suffix.headers.get("Content-Range"), "bytes 990-999/1000");
  assertEquals(new Uint8Array(await suffix.arrayBuffer()), data.slice(990));
});

Deno.test("mediaBodyResponse: unsatisfiable → 416 with bytes */size", async () => {
  const res = get("bytes=5000-6000");
  assertEquals(res.status, 416);
  assertEquals(res.headers.get("Content-Range"), "bytes */1000");
  assertEquals(res.headers.get("Accept-Ranges"), "bytes");
  assertEquals((await res.arrayBuffer()).byteLength, 0);
});

Deno.test("mediaBodyResponse: multi-range and malformed → 200 full", async () => {
  for (const h of ["bytes=0-1,5-6", "bytes=oops"]) {
    const res = get(h);
    assertEquals(res.status, 200, h);
    assertEquals(res.headers.get("Content-Length"), "1000", h);
    await res.body?.cancel();
  }
});

Deno.test("mediaBodyResponse: keeps sandbox/CSP headers on 200, 206 and 416", async () => {
  const base = {
    "Content-Security-Policy": "sandbox allow-scripts allow-popups",
    "X-Frame-Options": "SAMEORIGIN",
  };
  for (const range of [undefined, "bytes=0-9", "bytes=9999-"]) {
    const res = get(range, base);
    assertEquals(
      res.headers.get("Content-Security-Policy"),
      base["Content-Security-Policy"],
    );
    assertEquals(res.headers.get("X-Frame-Options"), "SAMEORIGIN");
    await res.body?.cancel();
  }
});
