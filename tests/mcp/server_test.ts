/**
 * Tests for src/mcp/server.ts — McpServer JSON-RPC 2.0 protocol handling.
 *
 * The server speaks over stdio, so we test it by directly calling dispatch()
 * via a test harness rather than spawning a subprocess.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { McpServer } from "../../src/mcp/server.ts";
import type { McpToolResult } from "../../src/mcp/server.ts";

// ---------------------------------------------------------------------------
// Test harness: capture JSON-RPC responses by intercepting stdout writes
// ---------------------------------------------------------------------------

interface Captured {
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Call the server's internal dispatch method and collect the JSON-RPC response.
 *
 * McpServer.dispatch is private, so we access it via Reflect to keep tests
 * free of TypeScript casts while still avoiding a full stdin/stdout pipe.
 */
async function dispatch(
  server: McpServer,
  req: { jsonrpc?: string; id?: unknown; method: string; params?: unknown },
): Promise<Captured> {
  let captured: Captured = { id: null };

  const sendResult = (id: string | number | null, result: unknown) => {
    captured = { id, result };
  };

  const sendError = (id: string | number | null, code: number, message: string) => {
    captured = { id, error: { code, message } };
  };

  const isNotification = req.id === undefined;

  // Access the private method via `as any`
  // deno-lint-ignore no-explicit-any
  await (server as any).dispatch(
    { jsonrpc: "2.0", ...req },
    sendResult,
    sendError,
    isNotification,
  );

  return captured;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal server with one tool and one resource
// ---------------------------------------------------------------------------

function makeServer() {
  const server = new McpServer({ name: "test", version: "0.0.1" });

  server.registerTool(
    {
      name: "echo",
      description: "Return the input",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
    async (args) => ({
      content: [{ type: "text", text: String(args.text ?? "") }],
    }),
  );

  server.registerResource(
    {
      uri: "test://data",
      name: "Test data",
      mimeType: "application/json",
    },
    async (uri) => ({ uri, mimeType: "application/json", text: JSON.stringify({ ok: true }) }),
  );

  return server;
}

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

Deno.test("initialize: returns protocol version and server info", async () => {
  const server = makeServer();
  const res = await dispatch(server, { id: 1, method: "initialize", params: {} });

  assertEquals(res.id, 1);
  assertExists(res.result);
  const result = res.result as Record<string, unknown>;
  assertEquals(result.protocolVersion, "2024-11-05");
  const info = result.serverInfo as Record<string, unknown>;
  assertEquals(info.name, "test");
  assertEquals(info.version, "0.0.1");
  assertExists((result.capabilities as Record<string, unknown>).tools);
  assertExists((result.capabilities as Record<string, unknown>).resources);
});

// ---------------------------------------------------------------------------
// ping
// ---------------------------------------------------------------------------

Deno.test("ping: returns empty result", async () => {
  const server = makeServer();
  const res = await dispatch(server, { id: 2, method: "ping" });
  assertEquals(res.id, 2);
  assertEquals(res.result, {});
});

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

Deno.test("tools/list: returns registered tools", async () => {
  const server = makeServer();
  const res = await dispatch(server, { id: 3, method: "tools/list" });

  assertEquals(res.id, 3);
  const tools = (res.result as { tools: unknown[] }).tools;
  assertEquals(tools.length, 1);
  const tool = tools[0] as { name: string; description: string };
  assertEquals(tool.name, "echo");
  assertExists(tool.description);
});

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

Deno.test("tools/call: invokes tool and returns content", async () => {
  const server = makeServer();
  const res = await dispatch(server, {
    id: 4,
    method: "tools/call",
    params: { name: "echo", arguments: { text: "hello" } },
  });

  assertEquals(res.id, 4);
  const toolResult = res.result as McpToolResult;
  assertEquals(toolResult.content.length, 1);
  assertEquals(toolResult.content[0].text, "hello");
});

Deno.test("tools/call: returns error for unknown tool", async () => {
  const server = makeServer();
  const res = await dispatch(server, {
    id: 5,
    method: "tools/call",
    params: { name: "nonexistent" },
  });

  assertExists(res.error);
  assertEquals(res.error!.code, -32601); // METHOD_NOT_FOUND
});

Deno.test("tools/call: returns isError content when tool throws", async () => {
  const server = makeServer();
  server.registerTool(
    {
      name: "broken",
      description: "Always fails",
      inputSchema: { type: "object", properties: {} },
    },
    async () => {
      throw new Error("intentional failure");
    },
  );

  const res = await dispatch(server, {
    id: 6,
    method: "tools/call",
    params: { name: "broken", arguments: {} },
  });

  // Tool errors come back as successful JSON-RPC responses with isError: true
  assertExists(res.result);
  const toolResult = res.result as McpToolResult;
  assertEquals(toolResult.isError, true);
  assertEquals(toolResult.content[0].text.includes("intentional failure"), true);
});

// ---------------------------------------------------------------------------
// resources/list
// ---------------------------------------------------------------------------

Deno.test("resources/list: returns registered resources", async () => {
  const server = makeServer();
  const res = await dispatch(server, { id: 7, method: "resources/list" });

  assertEquals(res.id, 7);
  const resources = (res.result as { resources: unknown[] }).resources;
  assertEquals(resources.length, 1);
  const resource = resources[0] as { uri: string; name: string };
  assertEquals(resource.uri, "test://data");
  assertExists(resource.name);
});

// ---------------------------------------------------------------------------
// resources/read
// ---------------------------------------------------------------------------

Deno.test("resources/read: returns resource content for known URI", async () => {
  const server = makeServer();
  const res = await dispatch(server, {
    id: 8,
    method: "resources/read",
    params: { uri: "test://data" },
  });

  assertEquals(res.id, 8);
  const contents = (res.result as { contents: unknown[] }).contents;
  assertEquals(contents.length, 1);
  const content = contents[0] as { uri: string; mimeType: string; text: string };
  assertEquals(content.uri, "test://data");
  assertEquals(content.mimeType, "application/json");
  assertEquals(JSON.parse(content.text), { ok: true });
});

Deno.test("resources/read: returns error for unknown URI", async () => {
  const server = makeServer();
  const res = await dispatch(server, {
    id: 9,
    method: "resources/read",
    params: { uri: "test://unknown" },
  });

  assertExists(res.error);
  assertEquals(res.error!.code, -32601);
});

// ---------------------------------------------------------------------------
// Unknown method
// ---------------------------------------------------------------------------

Deno.test("unknown method: returns method-not-found error", async () => {
  const server = makeServer();
  const res = await dispatch(server, { id: 10, method: "notARealMethod" });

  assertExists(res.error);
  assertEquals(res.error!.code, -32601);
});

// ---------------------------------------------------------------------------
// Notifications (no id)
// ---------------------------------------------------------------------------

Deno.test("notifications/initialized: does not produce a response", async () => {
  const server = makeServer();
  // isNotification = true (no id field)
  const res = await dispatch(server, { method: "notifications/initialized" });

  // No result, no error — nothing was sent
  assertEquals(res.id, null);
  assertEquals(res.result, undefined);
  assertEquals(res.error, undefined);
});

// ---------------------------------------------------------------------------
// tools/call: missing name
// ---------------------------------------------------------------------------

Deno.test("tools/call: returns invalid-params error when name is missing", async () => {
  const server = makeServer();
  const res = await dispatch(server, {
    id: 11,
    method: "tools/call",
    params: { arguments: {} }, // no name
  });

  assertExists(res.error);
  assertEquals(res.error!.code, -32602); // INVALID_PARAMS
});
