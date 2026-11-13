/**
 * Dune MCP Server — public module exports.
 *
 * @module
 */

export { McpServer } from "./server.ts";
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpTextContent,
  McpTool,
  McpToolResult,
  ResourceHandler,
  ToolHandler,
} from "./server.ts";
export { buildTools } from "./tools.ts";
export type { ToolDependencies, ToolRegistration } from "./tools.ts";
export { buildResources } from "./resources.ts";
export type { ResourceRegistration } from "./resources.ts";
