/**
 * dune schema:export — Print the JSON Schema for site.yaml to stdout.
 *
 * Useful for editor integrations (VSCode YAML extension, etc.) and
 * for wiring the schema into CI validation pipelines.
 *
 * Usage:
 *   dune schema:export                  # pretty-print to stdout
 *   dune schema:export > site.schema.json  # save to file
 */

import { CONFIG_SCHEMA, SCHEMA_VERSION } from "../schema/config-schema.ts";

export async function schemaExportCommand(): Promise<void> {
  const output = {
    schemaVersion: SCHEMA_VERSION,
    schema: CONFIG_SCHEMA,
  };
  console.log(JSON.stringify(output, null, 2));
}
