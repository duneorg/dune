import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkBodySize } from "../../src/security/body-limit.ts";

Deno.test("checkBodySize: returns null when Content-Length is under the cap", () => {
  const req = new Request("http://x/", {
    method: "POST",
    headers: { "content-length": "1024" },
  });
  assertEquals(checkBodySize(req, 2048), null);
});

Deno.test("checkBodySize: returns 413 when Content-Length exceeds the cap", async () => {
  const req = new Request("http://x/", {
    method: "POST",
    headers: { "content-length": "4096" },
  });
  const res = checkBodySize(req, 2048);
  assert(res);
  assertEquals(res.status, 413);
  const body = await res.json();
  assertEquals(body.error, "Request too large");
});

Deno.test("checkBodySize: missing Content-Length is deferred to downstream limits", () => {
  const req = new Request("http://x/", { method: "POST" });
  assertEquals(checkBodySize(req, 1024), null);
});

Deno.test("checkBodySize: non-numeric Content-Length is treated as absent", () => {
  const req = new Request("http://x/", {
    method: "POST",
    headers: { "content-length": "not-a-number" },
  });
  assertEquals(checkBodySize(req, 1024), null);
});

Deno.test("checkBodySize: equal to cap is allowed", () => {
  const req = new Request("http://x/", {
    method: "POST",
    headers: { "content-length": "1024" },
  });
  assertEquals(checkBodySize(req, 1024), null);
});
