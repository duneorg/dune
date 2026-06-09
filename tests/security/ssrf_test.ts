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
