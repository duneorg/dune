import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkSameOriginCsrf } from "../../src/security/csrf.ts";

function post(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/contact", {
    method: "POST",
    headers,
  });
}

Deno.test("checkSameOriginCsrf: safe methods always pass", () => {
  const url = new URL("https://example.com/contact");
  assertEquals(
    checkSameOriginCsrf(new Request("https://example.com/contact"), url),
    null,
  );
});

Deno.test("checkSameOriginCsrf: same-origin Origin passes", () => {
  assertEquals(
    checkSameOriginCsrf(post({ origin: "https://example.com" })),
    null,
  );
});

Deno.test("checkSameOriginCsrf: cross-origin Origin is rejected", async () => {
  const denied = checkSameOriginCsrf(post({ origin: "https://evil.example" }));
  assertEquals(denied?.status, 403);
  assertEquals((await denied!.json()).error.includes("cross-origin"), true);
});

Deno.test("checkSameOriginCsrf: Sec-Fetch-Site cross-site is rejected when Origin is absent", () => {
  const denied = checkSameOriginCsrf(post({ "sec-fetch-site": "cross-site" }));
  assertEquals(denied?.status, 403);
});

Deno.test("checkSameOriginCsrf: Sec-Fetch-Site same-origin passes when Origin is absent", () => {
  assertEquals(
    checkSameOriginCsrf(post({ "sec-fetch-site": "same-origin" })),
    null,
  );
});

Deno.test("checkSameOriginCsrf: cross-site Referer is rejected when Origin and Sec-Fetch-Site are absent", () => {
  const denied = checkSameOriginCsrf(
    post({ referer: "https://evil.example/page" }),
  );
  assertEquals(denied?.status, 403);
});

Deno.test("checkSameOriginCsrf: all headers absent fail open (curl / webhooks)", () => {
  assertEquals(checkSameOriginCsrf(post()), null);
});
