/**
 * Dune MCP Server — JSON-RPC 2.0 over stdio.
 *
 * Implements the Model Context Protocol (MCP) specification, exposing
 * Dune's content engine as tools and resources that AI coding agents
 * (Claude, Cursor, etc.) can call directly without running a web server.
 *
 * Transport: stdio (newline-delimited JSON on stdin / stdout)
 * Protocol:  MCP 2024-11-05
 *
 * Usage:
 *   dune mcp:serve [--root <dir>] [--debug]
 *
 * Claude Code config (~/.claude.json or .mcp.json):
 *   {
 *     "mcpServers": {
 *       "dune": {
 *         "command": "deno",
 *         "args": ["run", "-A", "jsr:@dune/core/cli", "mcp:serve"],
 *         "cwd": "/path/to/site"
 *       }
 *     }
 *   }
 */

/** @module */

// ── JSON-RPC 2.0 types ──────────────────────────────────────────────────────

/** JSON-RPC 2.0 request message. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 success response. */
export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

/** JSON-RPC 2.0 error response. */
export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 2.0 response — either a success or an error message. */
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// ── MCP types ───────────────────────────────────────────────────────────────

/** MCP tool descriptor — name, description, and JSON Schema for input parameters. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP resource descriptor — identifies a readable resource by URI. */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP tool/resource content item — plain text payload. */
export interface McpTextContent {
  type: "text";
  text: string;
}

/** Return value of an MCP tool handler. */
export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

/** Return value of an MCP resource handler. */
export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text: string;
}

// ── Handler types ───────────────────────────────────────────────────────────

/** Async function that handles a tool call and returns a result. */
export type ToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult>;
/** Async function that reads a resource by URI and returns its content. */
export type ResourceHandler = (uri: string) => Promise<McpResourceContent>;

/** Configuration for {@link McpServer}. */
export interface McpServerConfig {
  name: string;
  version: string;
  debug?: boolean;
}

// ── Server ──────────────────────────────────────────────────────────────────

/**
 * MCP server over stdio. Register tools and resources, then call `serve()`.
 */
export class McpServer {
  private tools = new Map<string, { meta: McpTool; handler: ToolHandler }>();
  private resources = new Map<string, { meta: McpResource; handler: ResourceHandler }>();
  private initialized = false;

  constructor(private config: McpServerConfig) {}

  /** Register a callable tool. */
  registerTool(meta: McpTool, handler: ToolHandler): this {
    this.tools.set(meta.name, { meta, handler });
    return this;
  }

  /** Register a readable resource. */
  registerResource(meta: McpResource, handler: ResourceHandler): this {
    this.resources.set(meta.uri, { meta, handler });
    return this;
  }

  /** Start the stdio event loop (blocks until stdin closes). */
  async serve(): Promise<void> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const send = (msg: unknown) => {
      const line = JSON.stringify(msg) + "\n";
      Deno.stdout.writeSync(encoder.encode(line));
    };

    const sendError = (id: string | number | null, code: number, message: string, data?: unknown) => {
      send({ jsonrpc: "2.0", id, error: { code, message, data } } satisfies JsonRpcError);
    };

    const sendResult = (id: string | number | null, result: unknown) => {
      send({ jsonrpc: "2.0", id, result } satisfies JsonRpcSuccess);
    };

    // Read stdin line by line
    const buf = new Uint8Array(65536);
    let partial = "";

    while (true) {
      let n: number | null;
      try {
        n = await Deno.stdin.read(buf);
      } catch {
        break;
      }
      if (n === null) break;

      partial += decoder.decode(buf.subarray(0, n));
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let req: JsonRpcRequest;
        try {
          req = JSON.parse(trimmed) as JsonRpcRequest;
        } catch {
          sendError(null, PARSE_ERROR, "Parse error");
          continue;
        }

        if (req.jsonrpc !== "2.0") {
          sendError(req.id ?? null, INVALID_REQUEST, "Invalid Request");
          continue;
        }

        // Notifications (no id) — no response expected
        const isNotification = req.id === undefined || req.id === null;

        try {
          await this.dispatch(req, sendResult, sendError, isNotification);
        } catch (err) {
          if (!isNotification) {
            sendError(req.id ?? null, INTERNAL_ERROR, "Internal error", {
              message: err instanceof Error ? err.message : String(err),
            });
          }
          if (this.config.debug) {
            console.error("[mcp] error:", err);
          }
        }
      }
    }
  }

  private async dispatch(
    req: JsonRpcRequest,
    sendResult: (id: string | number | null, result: unknown) => void,
    sendError: (id: string | number | null, code: number, message: string, data?: unknown) => void,
    isNotification: boolean,
  ): Promise<void> {
    const id = (req.id ?? null) as string | number | null;

    switch (req.method) {
      // ── Initialize ────────────────────────────────────────────────────────
      case "initialize": {
        this.initialized = true;
        sendResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: this.config.name,
            version: this.config.version,
          },
        });
        break;
      }

      // ── Initialized notification ──────────────────────────────────────────
      case "notifications/initialized":
        // Client acknowledges initialization — no response
        break;

      // ── Ping ──────────────────────────────────────────────────────────────
      case "ping":
        if (!isNotification) sendResult(id, {});
        break;

      // ── Tools ─────────────────────────────────────────────────────────────
      case "tools/list": {
        sendResult(id, {
          tools: Array.from(this.tools.values()).map((t) => t.meta),
        });
        break;
      }

      case "tools/call": {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        if (!params?.name) {
          sendError(id, INVALID_PARAMS, "Missing tool name");
          break;
        }

        const tool = this.tools.get(params.name);
        if (!tool) {
          sendError(id, METHOD_NOT_FOUND, `Unknown tool: ${params.name}`);
          break;
        }

        try {
          const result = await tool.handler(params.arguments ?? {});
          sendResult(id, result);
        } catch (err) {
          sendResult(id, {
            content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          } satisfies McpToolResult);
        }
        break;
      }

      // ── Resources ─────────────────────────────────────────────────────────
      case "resources/list": {
        sendResult(id, {
          resources: Array.from(this.resources.values()).map((r) => r.meta),
        });
        break;
      }

      case "resources/read": {
        const params = req.params as { uri?: string } | undefined;
        if (!params?.uri) {
          sendError(id, INVALID_PARAMS, "Missing resource URI");
          break;
        }

        // Find the most specific matching resource handler
        const resource = this.resources.get(params.uri) ??
          Array.from(this.resources.entries())
            .filter(([uri]) => params.uri!.startsWith(uri))
            .sort(([a], [b]) => b.length - a.length)[0]?.[1];

        if (!resource) {
          sendError(id, METHOD_NOT_FOUND, `Unknown resource: ${params.uri}`);
          break;
        }

        const content = await resource.handler(params.uri);
        sendResult(id, { contents: [content] });
        break;
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      default: {
        if (!isNotification) {
          sendError(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
        }
        break;
      }
    }
  }
}
