/**
 * Tests for the SSRF guard and safeFetch IP pinning (M-3).
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertOutboundUrlAllowed, safeFetch, SsrfBlockedError } from "../../src/security/ssrf.ts";

Deno.test("assertOutboundUrlAllowed: rejects non-http(s) schemes", async () => {
  await assertRejects(() => assertOutboundUrlAllowed("file:///etc/passwd"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("gopher://x/"), SsrfBlockedError);
});

Deno.test("assertOutboundUrlAllowed: rejects loopback / link-local / private literals", async () => {
  await assertRejects(() => assertOutboundUrlAllowed("http://127.0.0.1/"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://169.254.169.254/latest/meta-data"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://10.0.0.5/"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://[::1]/"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://localhost/"), SsrfBlockedError);
});

Deno.test("assertOutboundUrlAllowed: rejects extended special-use IPv4 ranges", async () => {
  // IETF protocol assignments / NAT64 traversal
  await assertRejects(() => assertOutboundUrlAllowed("http://192.0.0.10/"), SsrfBlockedError);
  // TEST-NET documentation ranges
  await assertRejects(() => assertOutboundUrlAllowed("http://192.0.2.1/"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://198.51.100.7/"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://203.0.113.9/"), SsrfBlockedError);
  // Benchmarking (RFC2544)
  await assertRejects(() => assertOutboundUrlAllowed("http://198.19.0.1/"), SsrfBlockedError);
  // Reserved class E + broadcast
  await assertRejects(() => assertOutboundUrlAllowed("http://240.0.0.1/"), SsrfBlockedError);
  await assertRejects(() => assertOutboundUrlAllowed("http://255.255.255.255/"), SsrfBlockedError);
});

Deno.test("assertOutboundUrlAllowed: rejects NAT64, discard, doc, and IPv4-compatible IPv6 literals", async () => {
  // NAT64 well-known prefix
  await assertRejects(() => assertOutboundUrlAllowed("http://[64:ff9b::169.254.169.254]/"), SsrfBlockedError);
  // Discard-only range 100::/64
  await assertRejects(() => assertOutboundUrlAllowed("http://[100::1]/"), SsrfBlockedError);
  // Documentation range
  await assertRejects(() => assertOutboundUrlAllowed("http://[2001:db8::1]/"), SsrfBlockedError);
  // IPv4-compatible (::a.b.c.d) embedding a loopback address
  await assertRejects(() => assertOutboundUrlAllowed("http://[::127.0.0.1]/"), SsrfBlockedError);
  // IPv4-mapped embedding a private address (existing behavior, now via shared path)
  await assertRejects(() => assertOutboundUrlAllowed("http://[::ffff:10.0.0.1]/"), SsrfBlockedError);
});

Deno.test("assertOutboundUrlAllowed: allows a private literal when opted in", async () => {
  const { resolvedAddress } = await assertOutboundUrlAllowed("http://10.1.2.3/", {
    allowPrivateDestinations: true,
  });
  assertEquals(resolvedAddress, "10.1.2.3");
});

Deno.test("safeFetch: pins resolved IP and preserves Host for http (M-3)", async () => {
  // A local server bound to 127.0.0.1 records the Host header it receives.
  const ac = new AbortController();
  let seenHost: string | null = null;
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen: () => {} },
    (req) => {
      seenHost = req.headers.get("host");
      return new Response("ok");
    },
  );
  const { port } = server.addr as Deno.NetAddr;
  try {
    // Use a private-literal URL (opt-in) so we exercise the http IP-pin path:
    // the request must still carry the original Host header.
    const resp = await safeFetch(
      `http://127.0.0.1:${port}/`,
      {},
      { allowPrivateDestinations: true },
    );
    assertEquals(resp.status, 200);
    await resp.body?.cancel();
    assertEquals(seenHost, `127.0.0.1:${port}`);
  } finally {
    ac.abort();
    await server.finished;
  }
});

Deno.test("safeFetch: rejects a blocked URL before connecting", async () => {
  await assertRejects(() => safeFetch("http://169.254.169.254/"), SsrfBlockedError);
});

Deno.test("Deno.createHttpClient tcp transport dials a pinned IP (L-4)", async () => {
  // Proves the API safeFetch uses for HTTPS pinning: connect to this IP
  // while the request URL keeps a different hostname (SNI / Host).
  const ac = new AbortController();
  let seenHost: string | null = null;
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen: () => {} },
    (req) => {
      seenHost = req.headers.get("host");
      return new Response("pinned");
    },
  );
  const { port } = server.addr as Deno.NetAddr;
  const client = Deno.createHttpClient({
    proxy: { transport: "tcp", hostname: "127.0.0.1", port },
    allowHost: true,
  });
  try {
    const resp = await fetch(`http://ssrf-pin.test:${port}/`, { client });
    assertEquals(resp.status, 200);
    assertEquals(await resp.text(), "pinned");
    assertEquals(seenHost, `ssrf-pin.test:${port}`);
  } finally {
    client.close();
    ac.abort();
    await server.finished;
  }
});
