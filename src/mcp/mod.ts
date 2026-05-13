/**
 * Dune MCP Server — public module exports.
 *
 * @module
 */

export { McpServer } from "./server.ts";
export type {
  McpTool,
  McpResource,
  McpToolResult,
  McpResourceContent,
  McpTextContent,
  ToolHandler,
  ResourceHandler,
  McpServerConfig,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./server.ts";
export { buildTools } from "./tools.ts";
export type { ToolDependencies, ToolRegistration } from "./tools.ts";
export { buildResources } from "./resources.ts";
export type { ResourceRegistration } from "./resources.ts";
