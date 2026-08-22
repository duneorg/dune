import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  captureHandlerSocketAddr,
  clientIp,
  copySocketAddr,
  RateLimiter,
  rememberSocketAddr,
  withSocketAddr,
} from "../../src/security/rate-limit.ts";

Deno.test("RateLimiter: allows requests under the limit", () => {
  const rl = new RateLimiter(3, 1000);
  assert(rl.check("1.1.1.1"));
  assert(rl.check("1.1.1.1"));
  assert(rl.check("1.1.1.1"));
});

Deno.test("RateLimiter: blocks once limit is reached", () => {
  const rl = new RateLimiter(2, 1000);
  assert(rl.check("1.1.1.1"));
  assert(rl.check("1.1.1.1"));
  assertFalse(rl.check("1.1.1.1"));
});

Deno.test("RateLimiter: tracks keys independently", () => {
  const rl = new RateLimiter(1, 1000);
  assert(rl.check("1.1.1.1"));
  assertFalse(rl.check("1.1.1.1"));
  assert(rl.check("2.2.2.2"));
});

Deno.test("RateLimiter: resets after window expires", async () => {
  const rl = new RateLimiter(1, 50);
  assert(rl.check("ip"));
  assertFalse(rl.check("ip"));
  await new Promise((r) => setTimeout(r, 60));
  assert(rl.check("ip"));
});

Deno.test("RateLimiter: retryAfter returns seconds remaining", () => {
  const rl = new RateLimiter(1, 5000);
  rl.check("ip");
  rl.check("ip");
  const retry = rl.retryAfter("ip");
  assert(retry >= 1 && retry <= 5);
});

// After MED-6 (trusted-proxy opt-in), forwarded headers are honored only
// when the caller explicitly opts in. Each test exercises both modes.

Deno.test("clientIp: ignores x-forwarded-for by default", () => {
  const req = new Request("http://x/", {
    headers: { "x-forwarded-for": "203.0.113.1, 198.51.100.1" },
  });
  assertEquals(clientIp(req), "unknown");
});

Deno.test("clientIp: reads x-forwarded-for first entry when trusted", () => {
  const req = new Request("http://x/", {
    headers: { "x-forwarded-for": "203.0.113.1, 198.51.100.1" },
  });
  assertEquals(clientIp(req, { trustForwardedFor: true }), "203.0.113.1");
});

Deno.test("clientIp: ignores x-real-ip by default", () => {
  const req = new Request("http://x/", {
    headers: { "x-real-ip": "203.0.113.2" },
  });
  assertEquals(clientIp(req), "unknown");
});

Deno.test("clientIp: falls back to x-real-ip when trusted", () => {
  const req = new Request("http://x/", {
    headers: { "x-real-ip": "203.0.113.2" },
  });
  assertEquals(clientIp(req, { trustForwardedFor: true }), "203.0.113.2");
});

Deno.test("clientIp: returns 'unknown' when no header and no socket stamp", () => {
  const req = new Request("http://x/");
  assertEquals(clientIp(req), "unknown");
});

Deno.test("clientIp: uses remembered socket address when forwarded headers are not trusted", () => {
  const req = new Request("http://x/", {
    headers: { "x-forwarded-for": "203.0.113.1" },
  });
  rememberSocketAddr(req, { hostname: "198.51.100.10" });
  assertEquals(clientIp(req), "198.51.100.10");
});

Deno.test("clientIp: trusted forwarded header still wins over the socket", () => {
  const req = new Request("http://x/", {
    headers: { "x-forwarded-for": "203.0.113.1" },
  });
  rememberSocketAddr(req, { hostname: "198.51.100.10" });
  assertEquals(clientIp(req, { trustForwardedFor: true }), "203.0.113.1");
});

Deno.test("clientIp: ignores unix-socket addrs with no hostname", () => {
  const req = new Request("http://x/");
  rememberSocketAddr(req, { hostname: "" });
  rememberSocketAddr(req, {});
  assertEquals(clientIp(req), "unknown");
});

Deno.test("copySocketAddr: cloned requests keep the peer address", () => {
  const req = new Request("http://x/");
  rememberSocketAddr(req, { hostname: "192.0.2.5" });
  const clone = new Request(req, { headers: new Headers(req.headers) });
  assertEquals(clientIp(clone), "unknown");
  copySocketAddr(req, clone);
  assertEquals(clientIp(clone), "192.0.2.5");
});

function fakeServeInfo(hostname: string): Deno.ServeHandlerInfo {
  return {
    remoteAddr: { hostname, port: 443, transport: "tcp" },
    completed: Promise.resolve(),
  } as Deno.ServeHandlerInfo;
}

Deno.test("withSocketAddr: stamps the TCP peer and forwards info", async () => {
  let seenInfo: Deno.ServeHandlerInfo | undefined;
  const handler = withSocketAddr((req, info) => {
    seenInfo = info;
    return new Response(clientIp(req));
  });
  const info = fakeServeInfo("198.51.100.7");
  const res = await handler(new Request("http://x/"), info);
  assertEquals(await res.text(), "198.51.100.7");
  assertEquals(seenInfo, info);
});

Deno.test("captureHandlerSocketAddr: stamps remoteAddr before the inner handler", async () => {
  const createHandler = captureHandlerSocketAddr(() => {
    return async (req) => new Response(clientIp(req));
  });
  const res = await createHandler()(
    new Request("http://x/"),
    fakeServeInfo("192.0.2.80"),
  );
  assertEquals(await res.text(), "192.0.2.80");
});
