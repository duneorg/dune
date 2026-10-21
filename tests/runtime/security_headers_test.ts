/**
 * Standard security headers on every route family (app-wide middleware in
 * createDuneApp()). They used to be applied by wrapping specific handlers, so
 * plugin publicRoutes, /api/*, /health, sitemap and feeds went out bare.
 *
 * Runs the real bootstrap() + createDuneApp() pipeline.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";
import { createDuneApp } from "../../src/runtime/server.ts";
import { SECURITY_HEADERS } from "../../src/cli/serve-utils.ts";

const PLUGIN = `
export default {
  name: "frag",
  version: "1.0.0",
  hooks: {},
  publicRoutes: [
    { path: "/x/raw", handler: () => new Response("<ul><li>a</li></ul>", { headers: { "Content-Type": "text/html; charset=utf-8" } }) },
    { path: "/x/own", handler: () => new Response("x", { headers: { "X-Frame-Options": "DENY" } }) },
    { path: "/x/ws", handler: (ctx) => {
        const { socket, response } = Deno.upgradeWebSocket(ctx.req);
        socket.onopen = () => socket.send("hello over ws");
        return response;
      } },
    { path: "/x/sse", handler: () => {
        const body = new ReadableStream({ async start(c) {
          for (let i = 0; i < 3; i++) { c.enqueue(new TextEncoder().encode("data: " + i + "\\n\\n")); await new Promise((r) => setTimeout(r, 150)); }
          c.close();
        } });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      } },
  ],
};
`;

async function withApp(
  fn: (handler: (req: Request) => Promise<Response>, serve: () => { port: number; stop: () => Promise<void> }) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_sechdr_" });
  try {
    const files: Record<string, string> = {
      "config/site.yaml": "title: T\nurl: http://localhost:3000\nplugins:\n  - src: ./plugins/frag.ts\n",
      "content/01.home/default.md": "---\ntitle: Home\n---\nhi\n",
      "plugins/frag.ts": PLUGIN,
    };
    for (const [rel, text] of Object.entries(files)) {
      await Deno.mkdir(dirname(join(root, rel)), { recursive: true });
      await Deno.writeTextFile(join(root, rel), text);
    }
    const ctx = await bootstrap(root, {});
    const { app } = await createDuneApp(ctx, { root, port: 0, dev: false });
    const handler = app.handler();
    const serve = () => {
      const ac = new AbortController();
      const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, (req, info) => handler(req, info));
      return {
        port: (server.addr as Deno.NetAddr).port,
        stop: async () => {
          ac.abort();
          await server.finished;
        },
      };
    };
    await fn(handler, serve);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("every route family carries all four standard security headers", opts, async () => {
  await withApp(async (handler) => {
    for (
      const path of [
        "/", // content page
        "/does-not-exist/", // 404
        "/x/raw", // plugin publicRoutes
        "/health",
        "/api/pages",
        "/api/nav",
        "/api/search?q=a",
        "/sitemap.xml",
        "/feed.xml",
      ]
    ) {
      const res = await handler(new Request(`http://localhost${path}`));
      await res.body?.cancel();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        assertEquals(res.headers.get(name), value, `${path} (${res.status}): ${name}`);
      }
    }
  });
});

Deno.test("a header the handler sets itself wins over the default", opts, async () => {
  await withApp(async (handler) => {
    const res = await handler(new Request("http://localhost/x/own"));
    await res.body?.cancel();
    assertEquals(res.headers.get("x-frame-options"), "DENY");
    assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  });
});

Deno.test("a WebSocket upgrade through the app-wide middleware still connects", opts, async () => {
  await withApp(async (_handler, serve) => {
    const { port, stop } = serve();
    try {
      const ws = new WebSocket(`ws://localhost:${port}/x/ws`);
      const msg = await new Promise<string>((resolve) => {
        ws.onmessage = (e) => resolve(String(e.data));
        ws.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 5000);
      });
      assertEquals(msg, "hello over ws");
      ws.close();
    } finally {
      await stop();
    }
  });
});

Deno.test("a streaming (SSE) response stays streaming and gets the headers", opts, async () => {
  await withApp(async (_handler, serve) => {
    const { port, stop } = serve();
    try {
      const t0 = performance.now();
      const res = await fetch(`http://localhost:${port}/x/sse`);
      assertEquals(res.headers.get("x-content-type-options"), "nosniff");
      const reader = res.body!.getReader();
      const arrivals: number[] = [];
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
        arrivals.push(performance.now() - t0);
      }
      // Chunks arrive ~150ms apart, not all at once when the stream closes.
      assertEquals(arrivals.length >= 3, true, `chunks: ${arrivals.length}`);
      assertEquals(arrivals[arrivals.length - 1] - arrivals[0] > 200, true, `arrivals: ${arrivals.join(",")}`);
    } finally {
      await stop();
    }
  });
});
