/**
 * dune validate — Whole-project lint.
 *
 * Checks:
 *   1. Config validity (site.yaml structure and field types)
 *   2. Plugin spec pinning (remote specs must include a version)
 *   3. Template references (frontmatter template: must exist in active theme)
 *   4. Schema files (schemas/*.yaml must have a `store:` field)
 *   5. Content integrity (missing title, duplicate routes, future dates)
 */

import { join } from "@std/path";
import { bootstrap } from "./bootstrap.ts";
import { validateConfig } from "../config/validator.ts";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";

export interface ValidateOptions {
  debug?: boolean;
  /** Output machine-parseable JSON instead of human-readable text. */
  json?: boolean;
  /**
   * Check code blocks in .claude/skills/*.md against live hook names and
   * permission strings. Reports unknown identifiers as warnings.
   * Automatically enabled when .claude/skills/ exists; pass false to skip.
   */
  skills?: boolean;
}

/** A single validation finding. */
export interface ValidateFinding {
  /** Category of the check that produced this finding. */
  category: "config" | "plugin" | "template" | "schema" | "content" | "skills";
  /** Severity: error = blocks build, warning = advisory. */
  severity: "error" | "warning";
  /** Human-readable description. */
  message: string;
  /** Source path or identifier for context (optional). */
  source?: string;
}

// ── Skills check constants ────────────────────────────────────────────────────

const VALID_HOOK_EVENTS = new Set([
  "onConfigLoaded", "onStorageReady", "onContentIndexReady",
  "onRequest", "onRouteResolved", "onPageLoaded", "onCollectionResolved",
  "onBeforeRender", "onAfterRender", "onResponse",
  "onMarkdownProcess", "onMarkdownProcessed", "onMediaDiscovered",
  "onCacheHit", "onCacheMiss", "onCacheInvalidate",
  "onApiRequest", "onApiResponse",
  "onRebuild", "onThemeSwitch",
  "onPageCreate", "onPageUpdate", "onPageDelete", "onWorkflowChange",
]);

const VALID_PERMISSIONS = new Set([
  "pages.create", "pages.read", "pages.update", "pages.delete",
  "media.upload", "media.read", "media.delete",
  "users.create", "users.read", "users.update", "users.delete",
  "config.read", "config.update",
  "submissions.read", "submissions.delete",
  "admin.access",
]);

/**
 * Extract TypeScript/JavaScript code blocks from a Markdown string.
 * Returns the raw code from each fenced block tagged as ts/typescript/js/javascript.
 */
function extractCodeBlocks(md: string): string[] {
  const blocks: string[] = [];
  const fence = /^```(?:ts|typescript|js|javascript)\n([\s\S]*?)^```/gm;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

/**
 * Scan a block of code for hook event names and permission strings,
 * returning any that aren't in the known-valid sets.
 */
function scanCodeBlock(code: string): { unknownHooks: string[]; unknownPerms: string[] } {
  const unknownHooks: string[] = [];
  const unknownPerms: string[] = [];

  // hooks.on("eventName") and hooks.on('eventName')
  const hookRe = /hooks\.on\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = hookRe.exec(code)) !== null) {
    if (!VALID_HOOK_EVENTS.has(m[1])) unknownHooks.push(m[1]);
  }

  // requirePermission(ctx, "perm.name") and requirePermission(ctx, 'perm.name')
  const permRe = /requirePermission\([^,]+,\s*["']([^"']+)["']/g;
  while ((m = permRe.exec(code)) !== null) {
    if (!VALID_PERMISSIONS.has(m[1])) unknownPerms.push(m[1]);
  }

  return { unknownHooks, unknownPerms };
}

async function checkSkills(
  root: string,
  findings: ValidateFinding[],
  json: boolean,
): Promise<void> {
  const skillsDir = join(root, ".claude", "skills");

  let files: string[] = [];
  try {
    for await (const entry of Deno.readDir(skillsDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        files.push(join(skillsDir, entry.name));
      }
    }
  } catch {
    // .claude/skills/ doesn't exist — nothing to check
    if (!json) console.log("  ℹ️  Skills: no .claude/skills/ directory found — skipped");
    return;
  }

  files = files.sort();
  const skillFindings: ValidateFinding[] = [];

  for (const filePath of files) {
    const rel = filePath.slice(root.length + 1);
    const content = await Deno.readTextFile(filePath).catch(() => "");
    const blocks = extractCodeBlocks(content);

    for (const block of blocks) {
      const { unknownHooks, unknownPerms } = scanCodeBlock(block);
      for (const hook of unknownHooks) {
        skillFindings.push({
          category: "skills",
          severity: "warning",
          message: `Unknown hook event "${hook}" — not in HookEvent union (may be a future API)`,
          source: rel,
        });
        findings.push(skillFindings.at(-1)!);
      }
      for (const perm of unknownPerms) {
        skillFindings.push({
          category: "skills",
          severity: "warning",
          message: `Unknown permission "${perm}" — not in AdminPermission union (may be a future API)`,
          source: rel,
        });
        findings.push(skillFindings.at(-1)!);
      }
    }
  }

  if (!json) {
    if (skillFindings.length === 0) {
      console.log(`  ✅ Skills valid (${files.length} file(s) checked)`);
    } else {
      console.log(`  ⚠️  Skills: ${skillFindings.length} warning(s) across ${files.length} file(s)`);
      for (const f of skillFindings) {
        console.log(`     ⚠ ${f.source}: ${f.message}`);
      }
    }
  }
}

export async function validateCommand(
  root: string,
  options: ValidateOptions = {},
): Promise<void> {
  const { debug = false, json = false } = options;
  // skills check: run when explicitly requested, or auto-detect (default true)
  const runSkills = options.skills !== false;

  if (!json) console.log("🏜️  Dune — validating project...\n");

  const findings: ValidateFinding[] = [];
  const start = performance.now();

  // ── 1. Config validation ──────────────────────────────────────────────────

  const storage = createStorage({ rootDir: root });
  const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
  const configErrors = validateConfig(config);

  for (const err of configErrors) {
    findings.push({ category: "config", severity: "error", message: err });
  }

  if (!json) {
    if (configErrors.length === 0) {
      console.log("  ✅ Config valid");
    } else {
      console.log(`  ❌ Config: ${configErrors.length} error(s)`);
      for (const err of configErrors) {
        console.log(`     ✗ ${err.split("\n")[0]}`);
      }
    }
  }

  // ── 2. Plugin spec pinning ────────────────────────────────────────────────

  const unpinned: string[] = [];
  for (const entry of config.pluginList ?? []) {
    const src = (entry as { src?: string; spec?: string }).src ??
      (entry as { src?: string; spec?: string }).spec;
    if (!src) continue;

    // Remote specs (jsr:, npm:, https:) must have a version pin
    if (
      src.startsWith("jsr:") ||
      src.startsWith("npm:") ||
      src.startsWith("https://")
    ) {
      // jsr:@scope/name@^1.2.0 — must contain @<version>
      // npm:package@^1.2.0 — must contain @<version> (after the package name)
      const hasVersion = src.startsWith("https://") || /[@^~][\d*]/.test(src.slice(src.lastIndexOf("/") + 1));
      if (!hasVersion) {
        unpinned.push(src);
        findings.push({
          category: "plugin",
          severity: "error",
          message: `Plugin spec not pinned: "${src}" — add a version constraint (e.g. @^1.0.0)`,
          source: "site.yaml",
        });
      }
    }
  }

  if (!json) {
    if (unpinned.length === 0) {
      console.log("  ✅ Plugin specs valid");
    } else {
      console.log(`  ❌ Plugins: ${unpinned.length} unpinned spec(s)`);
      for (const s of unpinned) {
        console.log(`     ✗ ${s}`);
      }
    }
  }

  // ── 3. Template reference validation ─────────────────────────────────────

  // Full bootstrap needed for engine.pages and theme information
  const ctx = await bootstrap(root, { debug }).catch((err) => {
    if (!json) {
      console.log(`\n  ⚠️  Could not bootstrap engine: ${err.message}`);
      console.log("     Skipping template, schema, and content checks.\n");
    }
    findings.push({
      category: "config",
      severity: "error",
      message: `Engine bootstrap failed: ${err.message}`,
    });
    return null;
  });

  if (ctx) {
    const { engine } = ctx;
    const themeName = config.theme?.name ?? "default";
    const themeDir = join("themes", themeName, "templates");

    // Collect all unique templates referenced in content
    const templatesUsed = new Set<string>();
    for (const page of engine.pages) {
      if (page.template && page.template !== "default") {
        templatesUsed.add(page.template);
      }
    }

    const missingTemplates: string[] = [];
    for (const tmpl of templatesUsed) {
      const tmplPath = join(themeDir, `${tmpl}.tsx`);
      const exists = await storage.exists(tmplPath);
      if (!exists) {
        missingTemplates.push(tmpl);
        // Find pages using this template for context
        const using = engine.pages
          .filter((p) => p.template === tmpl)
          .map((p) => p.sourcePath)
          .slice(0, 3);
        findings.push({
          category: "template",
          severity: "error",
          message: `Template "${tmpl}" not found at ${tmplPath}`,
          source: using.join(", "),
        });
      }
    }

    if (!json) {
      if (missingTemplates.length === 0) {
        console.log("  ✅ Template references valid");
      } else {
        console.log(`  ❌ Templates: ${missingTemplates.length} missing`);
        for (const t of missingTemplates) {
          console.log(`     ✗ "${t}" not found in ${themeDir}/`);
        }
      }
    }

    // ── 4. Schema file validation ───────────────────────────────────────────

    const schemaFindings: ValidateFinding[] = [];

    try {
      const schemaFiles: string[] = [];
      for await (const entry of Deno.readDir(join(root, "schemas"))) {
        if (entry.isFile && entry.name.endsWith(".yaml")) {
          schemaFiles.push(entry.name);
        }
      }

      const { parse } = await import("@std/yaml");
      for (const filename of schemaFiles) {
        const path = join(root, "schemas", filename);
        const text = await Deno.readTextFile(path);
        const parsed = parse(text) as Record<string, unknown>;
        if (!parsed?.store) {
          schemaFindings.push({
            category: "schema",
            severity: "error",
            message: `Missing required field "store:" (must be "local" or "db")`,
            source: `schemas/${filename}`,
          });
        } else if (parsed.store !== "local" && parsed.store !== "db") {
          schemaFindings.push({
            category: "schema",
            severity: "error",
            message: `Invalid "store:" value "${parsed.store}" (must be "local" or "db")`,
            source: `schemas/${filename}`,
          });
        }
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        schemaFindings.push({
          category: "schema",
          severity: "warning",
          message: `Could not read schemas/ directory: ${err}`,
        });
      }
      // No schemas/ directory — not an error
    }

    findings.push(...schemaFindings);

    if (!json) {
      if (schemaFindings.length === 0) {
        console.log("  ✅ Schema files valid");
      } else {
        console.log(`  ❌ Schemas: ${schemaFindings.length} issue(s)`);
        for (const f of schemaFindings) {
          const loc = f.source ? ` (${f.source})` : "";
          console.log(`     ✗ ${f.message}${loc}`);
        }
      }
    }

    // ── 5. Content integrity ────────────────────────────────────────────────

    interface ContentIssue {
      sourcePath: string;
      message: string;
      severity: "error" | "warning";
    }

    const contentIssues: ContentIssue[] = [];

    for (const page of engine.pages) {
      if (!page.title) {
        contentIssues.push({
          sourcePath: page.sourcePath,
          message: "Missing title",
          severity: "warning",
        });
      }

      if (!page.route && !page.isModule) {
        contentIssues.push({
          sourcePath: page.sourcePath,
          message: "No route generated",
          severity: "error",
        });
      }

      // Duplicate route check
      const duplicates = engine.pages.filter(
        (p) => p.route === page.route && p.sourcePath !== page.sourcePath,
      );
      if (duplicates.length > 0 && page.route) {
        contentIssues.push({
          sourcePath: page.sourcePath,
          message: `Duplicate route "${page.route}" (also: ${
            duplicates.map((d) => d.sourcePath).join(", ")
          })`,
          severity: "error",
        });
      }

      // Future date
      if (page.date) {
        const pageDate = new Date(page.date);
        if (pageDate > new Date()) {
          contentIssues.push({
            sourcePath: page.sourcePath,
            message: `Future date (${page.date})`,
            severity: "warning",
          });
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniqueContent = contentIssues.filter((issue) => {
      const key = `${issue.sourcePath}:${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const issue of uniqueContent) {
      findings.push({
        category: "content",
        severity: issue.severity,
        message: issue.message,
        source: issue.sourcePath,
      });
    }

    if (!json) {
      const contentErrors = uniqueContent.filter((i) => i.severity === "error");
      const contentWarnings = uniqueContent.filter((i) => i.severity === "warning");
      if (uniqueContent.length === 0) {
        console.log(`  ✅ Content valid (${engine.pages.length} pages)`);
      } else {
        const parts: string[] = [];
        if (contentErrors.length > 0) parts.push(`${contentErrors.length} error(s)`);
        if (contentWarnings.length > 0) parts.push(`${contentWarnings.length} warning(s)`);
        console.log(`  ⚠️  Content: ${parts.join(", ")} across ${engine.pages.length} pages`);
        for (const issue of uniqueContent) {
          const icon = issue.severity === "error" ? "✗" : "⚠";
          console.log(`     ${icon} ${issue.sourcePath}: ${issue.message}`);
        }
      }
    }
  }

  // ── 6. Skills sync check ─────────────────────────────────────────────────
  if (runSkills) {
    await checkSkills(root, findings, json);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const elapsedMs = Math.round(performance.now() - start);
  const valid = errors.length === 0;

  if (json) {
    const output = {
      valid,
      errorCount: errors.length,
      warningCount: warnings.length,
      findings,
      elapsedMs,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!valid) Deno.exit(1);
    return;
  }

  console.log();
  if (valid && warnings.length === 0) {
    console.log(`  ✅ All checks passed in ${elapsedMs}ms`);
  } else if (valid) {
    console.log(
      `  ✅ No errors (${warnings.length} warning(s)) — ${elapsedMs}ms`,
    );
  } else {
    console.log(
      `  ❌ ${errors.length} error(s), ${warnings.length} warning(s) — ${elapsedMs}ms`,
    );
    Deno.exit(1);
  }
}
