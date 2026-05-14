/**
 * CDN provider tests — verify each provider sends the correct HTTP request.
 *
 * Uses Deno's fetch stub pattern to intercept outbound calls without
 * hitting real CDN APIs.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createCloudflareProvider } from "../../src/cdn/providers/cloudflare.ts";
import { createFastlyProvider } from "../../src/cdn/providers/fastly.ts";
import { createBunnyProvider } from "../../src/cdn/providers/bunny.ts";
import { createCustomProvider } from "../../src/cdn/providers/custom.ts";

// ─── Fetch stub helpers ──────────────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Replace globalThis.fetch with a stub that returns a 200 response and
 * captures the outgoing request. Returns a cleanup function.
 */
function stubFetch(captured: CapturedRequest[], status = 200): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url;

    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers ?? {};
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => { headers[k] = v; });
    } else {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k] = v;
      }
    }

    let body = "";
    if (init?.body) {
      body = typeof init.body === "string"
        ? init.body
        : new TextDecoder().decode(init.body as Uint8Array);
    }

    captured.push({ url, method: init?.method ?? "GET", headers, body });

    return new Response(status === 200 ? "" : "error", { status });
  };

  return () => { globalThis.fetch = original; };
}

// ─── Cloudflare ──────────────────────────────────────────────────────────────

Deno.test("cloudflare: sends correct Authorization header and endpoint", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createCloudflareProvider({ zoneId: "zone123", apiToken: "tok_abc" });
    await provider.purge({ urls: ["https://example.com/blog"] });

    assertEquals(requests.length, 1);
    assertEquals(requests[0].url, "https://api.cloudflare.com/client/v4/zones/zone123/purge_cache");
    assertEquals(requests[0].method, "POST");
    assertEquals(requests[0].headers["Authorization"], "Bearer tok_abc");

    const parsed = JSON.parse(requests[0].body);
    assertEquals(parsed.files, ["https://example.com/blog"]);
  } finally {
    restore();
  }
});

Deno.test("cloudflare: uses tags body when tags provided", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createCloudflareProvider({ zoneId: "zone123", apiToken: "tok_abc" });
    await provider.purge({ urls: [], tags: ["blog", "homepage"] });

    const parsed = JSON.parse(requests[0].body);
    assertEquals(parsed.tags, ["blog", "homepage"]);
    assertEquals(parsed.files, undefined);
  } finally {
    restore();
  }
});

Deno.test("cloudflare: throws on non-2xx response", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests, 400);
  try {
    const provider = createCloudflareProvider({ zoneId: "zone123", apiToken: "tok_abc" });
    await assertRejects(
      () => provider.purge({ urls: ["https://example.com/"] }),
      Error,
      "HTTP 400",
    );
  } finally {
    restore();
  }
});

// ─── Fastly ──────────────────────────────────────────────────────────────────

Deno.test("fastly: sends PURGE method with Fastly-Key header", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createFastlyProvider({ serviceId: "svc999", apiKey: "fastly-key-xyz" });
    await provider.purge({ urls: ["https://example.com/about", "https://example.com/blog"] });

    assertEquals(requests.length, 2);
    // Both must use PURGE method
    for (const r of requests) {
      assertEquals(r.method, "PURGE");
      assertEquals(r.headers["Fastly-Key"], "fastly-key-xyz");
    }
    assertEquals(requests[0].url, "https://example.com/about");
    assertEquals(requests[1].url, "https://example.com/blog");
  } finally {
    restore();
  }
});

Deno.test("fastly: throws when any URL purge returns non-2xx", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests, 503);
  try {
    const provider = createFastlyProvider({ serviceId: "svc999", apiKey: "fastly-key-xyz" });
    await assertRejects(
      () => provider.purge({ urls: ["https://example.com/"] }),
      Error,
      "HTTP 503",
    );
  } finally {
    restore();
  }
});

// ─── BunnyCDN ────────────────────────────────────────────────────────────────

Deno.test("bunny: sends POST to purge endpoint with AccessKey header", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createBunnyProvider({ apiKey: "bunny-api-key" });
    await provider.purge({ urls: ["https://example.com/shop"] });

    assertEquals(requests.length, 1);
    assertEquals(requests[0].method, "POST");
    assertEquals(requests[0].headers["AccessKey"], "bunny-api-key");

    const expected = "https://api.bunny.net/purge?url=" +
      encodeURIComponent("https://example.com/shop") + "&async=false";
    assertEquals(requests[0].url, expected);
  } finally {
    restore();
  }
});

Deno.test("bunny: throws when purge returns non-2xx", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests, 401);
  try {
    const provider = createBunnyProvider({ apiKey: "bunny-api-key" });
    await assertRejects(
      () => provider.purge({ urls: ["https://example.com/"] }),
      Error,
      "HTTP 401",
    );
  } finally {
    restore();
  }
});

// ─── Custom ──────────────────────────────────────────────────────────────────

Deno.test("custom: POSTs { urls } body to configured purge_url", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createCustomProvider({ purge_url: "https://example.com/cdn-purge" });
    await provider.purge({ urls: ["https://example.com/a", "https://example.com/b"] });

    assertEquals(requests.length, 1);
    assertEquals(requests[0].method, "POST");
    assertEquals(requests[0].url, "https://example.com/cdn-purge");

    const parsed = JSON.parse(requests[0].body);
    assertEquals(parsed.urls, ["https://example.com/a", "https://example.com/b"]);
  } finally {
    restore();
  }
});

Deno.test("custom: sets Authorization header when api_token provided", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createCustomProvider({
      purge_url: "https://example.com/cdn-purge",
      api_token: "my-secret-token",
    });
    await provider.purge({ urls: ["https://example.com/"] });

    assertEquals(requests[0].headers["Authorization"], "Bearer my-secret-token");
  } finally {
    restore();
  }
});

Deno.test("custom: no Authorization header when api_token is absent", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests);
  try {
    const provider = createCustomProvider({ purge_url: "https://example.com/cdn-purge" });
    await provider.purge({ urls: ["https://example.com/"] });

    assertEquals(requests[0].headers["Authorization"], undefined);
  } finally {
    restore();
  }
});

Deno.test("custom: throws on non-2xx response", async () => {
  const requests: CapturedRequest[] = [];
  const restore = stubFetch(requests, 500);
  try {
    const provider = createCustomProvider({ purge_url: "https://example.com/cdn-purge" });
    await assertRejects(
      () => provider.purge({ urls: ["https://example.com/"] }),
      Error,
      "HTTP 500",
    );
  } finally {
    restore();
  }
});
