/**
 * dune blueprint:* — Blueprint inspection commands.
 *
 * Blueprints define per-template frontmatter schemas.  These commands
 * expose the available blueprints so agents and editors can discover
 * what frontmatter fields are expected for each content template.
 *
 * Usage:
 *   dune blueprint:list              — List all blueprints
 *   dune blueprint:list --json       — Machine-readable list
 *   dune blueprint:show <template>   — Show full field schema
 *   dune blueprint:show post --json  — Field schema as JSON
 */

import { join, resolve } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { loadBlueprints } from "../blueprints/loader.ts";
import { resolveBlueprint, validateFrontmatter } from "../blueprints/validator.ts";
import type { ResolvedBlueprint } from "../blueprints/types.ts";

export interface BlueprintOptions {
  debug?: boolean;
  json?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadAllBlueprints(root: string): Promise<Record<string, ResolvedBlueprint>> {
  const storage = createStorage({ rootDir: root });

  // Try to find blueprints dir from config, default to "blueprints"
  let blueprintsDir = "blueprints";
  try {
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
    // Some configs may have system.blueprints.dir — fall back to default
    const sysAny = config.system as unknown as Record<string, unknown>;
    if (typeof (sysAny.blueprints as Record<string, unknown>)?.dir === "string") {
      blueprintsDir = (sysAny.blueprints as Record<string, unknown>).dir as string;
    }
  } catch {
    // No config — use default
  }

  const raw = await loadBlueprints(storage, blueprintsDir);

  // Resolve all blueprints (flatten inheritance)
  const resolved: Record<string, ResolvedBlueprint> = {};
  for (const [template, def] of Object.entries(raw)) {
    resolved[template] = resolveBlueprint(template, def, raw, 0);
  }
  return resolved;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export const blueprintCommands = {
  /**
   * dune blueprint:list — List all available blueprints.
   */
  async list(root: string, options: BlueprintOptions = {}): Promise<void> {
    root = resolve(root);
    const blueprints = await loadAllBlueprints(root);
    const entries = Object.entries(blueprints);

    if (options.json) {
      const output = {
        total: entries.length,
        blueprints: entries.map(([template, bp]) => ({
          template,
          title: bp.title,
          fieldCount: Object.keys(bp.fields).length,
          requiredFields: Object.entries(bp.fields)
            .filter(([, f]) => f.required)
            .map(([name]) => name),
          fields: Object.keys(bp.fields),
        })),
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log("🏜️  Dune — blueprints\n");

    if (entries.length === 0) {
      console.log("  No blueprints found.");
      console.log("  Create blueprints/post.yaml to define frontmatter schemas.");
      return;
    }

    const header = `  ${"Template".padEnd(20)} ${"Title".padEnd(30)} ${"Fields"} ${"Required"}`;
    console.log(header);
    console.log("  " + "─".repeat(Math.max(header.length - 2, 70)));

    for (const [template, bp] of entries) {
      const required = Object.entries(bp.fields)
        .filter(([, f]) => f.required)
        .map(([name]) => name);
      const tmpl = template.padEnd(20);
      const title = bp.title.padEnd(30);
      const fieldCount = String(Object.keys(bp.fields).length).padEnd(7);
      const req = required.length > 0 ? required.join(", ") : "(none)";
      console.log(`  ${tmpl} ${title} ${fieldCount} ${req}`);
    }

    console.log(`\n  Total: ${entries.length} blueprint(s)`);
  },

  /**
   * dune blueprint:show <template> — Show the full resolved field schema.
   */
  async show(root: string, template: string, options: BlueprintOptions = {}): Promise<void> {
    root = resolve(root);

    if (!template) {
      console.error("  ✗ Usage: dune blueprint:show <template>");
      Deno.exit(1);
    }

    const blueprints = await loadAllBlueprints(root);
    const bp = blueprints[template];

    if (!bp) {
      const available = Object.keys(blueprints);
      if (options.json) {
        console.log(JSON.stringify({
          error: `Blueprint "${template}" not found`,
          available,
        }, null, 2));
      } else {
        console.error(`  ✗ Blueprint "${template}" not found`);
        if (available.length > 0) {
          console.error(`    Available: ${available.join(", ")}`);
        } else {
          console.error("    No blueprints found in this project.");
        }
      }
      Deno.exit(1);
    }

    if (options.json) {
      const output = {
        template,
        title: bp.title,
        fields: Object.entries(bp.fields).reduce(
          (acc, [name, field]) => {
            acc[name] = {
              type: field.type,
              label: field.label,
              required: field.required ?? false,
              ...(field.default !== undefined ? { default: field.default } : {}),
              ...(field.options ? { options: field.options } : {}),
              ...(field.validate ? { validate: field.validate } : {}),
            };
            return acc;
          },
          {} as Record<string, unknown>,
        ),
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log(`🏜️  Dune — blueprint: ${template}\n`);
    console.log(`  Title:    ${bp.title}`);
    console.log(`  Template: ${template}`);
    console.log(`  Fields:   ${Object.keys(bp.fields).length}\n`);

    const required = Object.entries(bp.fields).filter(([, f]) => f.required);
    const optional = Object.entries(bp.fields).filter(([, f]) => !f.required);

    if (required.length > 0) {
      console.log("  Required fields:");
      for (const [name, field] of required) {
        const extras = formatFieldExtras(field);
        console.log(`    ${name.padEnd(20)} ${field.type.padEnd(12)} ${field.label}${extras}`);
      }
      console.log();
    }

    if (optional.length > 0) {
      console.log("  Optional fields:");
      for (const [name, field] of optional) {
        const extras = formatFieldExtras(field);
        console.log(`    ${name.padEnd(20)} ${field.type.padEnd(12)} ${field.label}${extras}`);
      }
      console.log();
    }

    // Show YAML frontmatter example
    console.log("  Example frontmatter:");
    console.log("    ---");
    for (const [name, field] of Object.entries(bp.fields)) {
      const example = exampleValue(name, field);
      console.log(`    ${name}: ${example}`);
    }
    console.log("    ---");
  },

  /**
   * dune blueprint:validate <file-path> — Validate a content file's frontmatter against its blueprint.
   *
   * The template name is read from the frontmatter `template:` field (or defaults to "default").
   */
  async validate(root: string, filePath: string, options: BlueprintOptions = {}): Promise<void> {
    root = resolve(root);

    if (!filePath) {
      console.error("  ✗ Usage: dune blueprint:validate <path-to-content-file>");
      Deno.exit(1);
    }

    // Read the file
    const absPath = filePath.startsWith("/") ? filePath : join(root, filePath);
    let raw: string;
    try {
      raw = await Deno.readTextFile(absPath);
    } catch {
      console.error(`  ✗ Could not read file: ${absPath}`);
      Deno.exit(1);
    }

    // Parse frontmatter
    let frontmatter: Record<string, unknown> = {};
    if (raw.startsWith("---")) {
      const end = raw.indexOf("\n---", 3);
      if (end !== -1) {
        const fmText = raw.slice(3, end).trim();
        try {
          const parsed = parseYaml(fmText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            frontmatter = parsed as Record<string, unknown>;
          }
        } catch (err) {
          const msg = `YAML parse error: ${err instanceof Error ? err.message : String(err)}`;
          if (options.json) {
            console.log(JSON.stringify({ valid: false, errors: [{ field: "(frontmatter)", message: msg }] }, null, 2));
          } else {
            console.error(`  ✗ ${msg}`);
          }
          Deno.exit(1);
        }
      }
    }

    const template = (frontmatter.template as string) ?? "default";
    const blueprints = await loadAllBlueprints(root);
    const blueprint = blueprints[template];

    if (!blueprint) {
      const msg = `No blueprint found for template "${template}" — skipping validation`;
      if (options.json) {
        console.log(JSON.stringify({ valid: true, skipped: true, reason: msg }, null, 2));
      } else {
        console.log(`  ⚠️  ${msg}`);
      }
      return;
    }

    // Import the raw blueprints map for validateFrontmatter
    const storage = createStorage({ rootDir: root });
    let blueprintsDir = "blueprints";
    try {
      const { loadConfig } = await import("../config/mod.ts");
      const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
      const sysAny = config.system as unknown as Record<string, unknown>;
      if (typeof (sysAny.blueprints as Record<string, unknown>)?.dir === "string") {
        blueprintsDir = (sysAny.blueprints as Record<string, unknown>).dir as string;
      }
    } catch {
      // Use default
    }
    const rawBlueprints = await loadBlueprints(storage, blueprintsDir);

    // Type cast frontmatter for validateFrontmatter
    type FM = import("../content/types.ts").PageFrontmatter;
    const errors = validateFrontmatter(frontmatter as FM, template, rawBlueprints);

    const relPath = absPath.replace(root + "/", "");

    if (options.json) {
      console.log(JSON.stringify({
        valid: errors.length === 0,
        file: relPath,
        template,
        errors: errors.map((e) => ({ field: e.field, message: e.message })),
      }, null, 2));
      if (errors.length > 0) Deno.exit(1);
      return;
    }

    console.log(`🏜️  Dune — blueprint validation\n`);
    console.log(`  File:     ${relPath}`);
    console.log(`  Template: ${template}`);
    console.log(`  Blueprint: ${blueprint.title}\n`);

    if (errors.length === 0) {
      console.log("  ✅ Frontmatter is valid");
    } else {
      console.log(`  ✗ ${errors.length} validation error(s):\n`);
      for (const err of errors) {
        console.log(`    ${err.field}: ${err.message}`);
      }
      Deno.exit(1);
    }
  },
};

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatFieldExtras(field: import("../blueprints/types.ts").BlueprintField): string {
  const parts: string[] = [];
  if (field.default !== undefined) parts.push(`default: ${JSON.stringify(field.default)}`);
  if (field.options) parts.push(`options: [${Object.keys(field.options).join(", ")}]`);
  if (field.validate?.min !== undefined) parts.push(`min: ${field.validate.min}`);
  if (field.validate?.max !== undefined) parts.push(`max: ${field.validate.max}`);
  return parts.length > 0 ? `  (${parts.join(", ")})` : "";
}

function exampleValue(
  name: string,
  field: import("../blueprints/types.ts").BlueprintField,
): string {
  if (field.default !== undefined) return JSON.stringify(field.default);
  switch (field.type) {
    case "text":
    case "textarea":
    case "markdown":
      return `"${name.replace(/-/g, " ")}"`;
    case "number":
      return "0";
    case "toggle":
      return "false";
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "select":
      return field.options ? `"${Object.keys(field.options)[0]}"` : '""';
    case "list":
      return "[]";
    case "file":
      return `"/uploads/${name}.jpg"`;
    case "color":
      return '"#000000"';
    default:
      return '""';
  }
}
