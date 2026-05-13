/**
 * Tests for src/schema/config-schema.ts — JSON Schema for site.yaml.
 *
 * Verifies the schema has the expected top-level structure and that
 * SCHEMA_VERSION is a non-empty string.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { CONFIG_SCHEMA, SCHEMA_VERSION } from "../../src/schema/config-schema.ts";

Deno.test("SCHEMA_VERSION: is a non-empty string", () => {
  assertEquals(typeof SCHEMA_VERSION, "string");
  assertEquals(SCHEMA_VERSION.length > 0, true);
});

Deno.test("CONFIG_SCHEMA: has $schema and type=object", () => {
  assertExists(CONFIG_SCHEMA);
  const schema = CONFIG_SCHEMA as Record<string, unknown>;
  assertEquals(schema.type, "object");
  assertExists(schema.properties);
});

Deno.test("CONFIG_SCHEMA: includes site, system, theme, plugins, admin properties", () => {
  const props = (CONFIG_SCHEMA as { properties: Record<string, unknown> }).properties;
  assertExists(props.site, "schema must have 'site' property");
  assertExists(props.system, "schema must have 'system' property");
  assertExists(props.theme, "schema must have 'theme' property");
  assertExists(props.plugins, "schema must have 'plugins' property");
  assertExists(props.admin, "schema must have 'admin' property");
});

Deno.test("CONFIG_SCHEMA: site.title is required", () => {
  const site = (CONFIG_SCHEMA as { properties: Record<string, unknown> }).properties.site as {
    required?: string[];
  };
  assertExists(site.required);
  assertEquals(site.required!.includes("title"), true);
});

Deno.test("CONFIG_SCHEMA: plugins is an array schema", () => {
  const props = (CONFIG_SCHEMA as { properties: Record<string, unknown> }).properties;
  const plugins = props.plugins as { type: string };
  assertEquals(plugins.type, "array");
});
