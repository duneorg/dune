/**
 * Unit tests for csrfCheck (L-2): Origin-based rejection plus the
 * Sec-Fetch-Site / Referer fallbacks used when Origin is absent.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { csrfCheck } from "../../src/admin/routes/api/_utils.ts";

// deno-lint-ignore no-explicit-any
function ctx(method: string, headers: Record<string, string>): any {
  return {
    req: new Request("https://cms.example.com/admin/api/x", {
      method,
      headers,
    }),
    url: new URL("https://cms.example.com/admin/api/x"),
    state: { adminContext: { auditLogger: null }, auth: {} },
  };
}

function isDenied(res: Response | null): boolean {
  return res !== null && res.status === 403;
}

Deno.test("csrfCheck: safe methods always pass", () => {
  assertEquals(csrfCheck(ctx("GET", {})), null);
  assertEquals(csrfCheck(ctx("HEAD", {})), null);
});

Deno.test("csrfCheck: same-origin Origin passes, cross-origin is denied", () => {
  assertEquals(csrfCheck(ctx("POST", { origin: "https://cms.example.com" })), null);
  assertEquals(isDenied(csrfCheck(ctx("POST", { origin: "https://evil.example.com" }))), true);
});

Deno.test("csrfCheck: no Origin falls back to Sec-Fetch-Site (L-2)", () => {
  // cross-site / same-site are rejected.
  assertEquals(isDenied(csrfCheck(ctx("POST", { "sec-fetch-site": "cross-site" }))), true);
  assertEquals(isDenied(csrfCheck(ctx("POST", { "sec-fetch-site": "same-site" }))), true);
  // same-origin / none are allowed.
  assertEquals(csrfCheck(ctx("POST", { "sec-fetch-site": "same-origin" })), null);
  assertEquals(csrfCheck(ctx("POST", { "sec-fetch-site": "none" })), null);
});

Deno.test("csrfCheck: no Origin falls back to Referer host (L-2)", () => {
  assertEquals(
    isDenied(csrfCheck(ctx("POST", { referer: "https://evil.example.com/x" }))),
    true,
  );
  assertEquals(
    csrfCheck(ctx("POST", { referer: "https://cms.example.com/admin" })),
    null,
  );
});

Deno.test("csrfCheck: no signals at all is allowed (SameSite backstop)", () => {
  assertEquals(csrfCheck(ctx("POST", {})), null);
});
