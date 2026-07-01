/**
 * lint-dynamic-imports.ts
 *
 * Guards against non-literal dynamic import() calls in src/ that reference
 * external packages. Dune's lockfile:sync relies on Deno being able to
 * statically trace the full module graph by following literal-string import()
 * calls. A computed import() of an external specifier would silently escape
 * that trace and break --frozen serve after a lockfile:sync.
 *
 * Existing non-literal imports that are intentionally safe are marked with
 * a trailing `// lockfile-safe` comment on the import() line:
 *   - "site-local"   — resolves to a site file path, not an external package
 *   - "discovery"    — handled by the plugin discovery subprocess
 *   - "constant"     — variable is always a literal string (constant alias)
 *
 * Any new non-literal import() without a `// lockfile-safe` comment fails CI.
 *
 * Usage:  deno run --allow-read scripts/lint-dynamic-imports.ts
 * Exit:   0 = clean, 1 = violations found
 */

import { walk } from "@std/fs/walk";
import { relative } from "@std/path";

const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*([^)]+?)\s*\)/g;
const LITERAL_RE = /^(['"`])(?:[^\\]|\\.)*?\1$/;

const srcDir = new URL("../src", import.meta.url).pathname;
let violations = 0;

for await (const entry of walk(srcDir, { exts: [".ts", ".tsx"], skip: [/node_modules/] })) {
  const src = await Deno.readTextFile(entry.path);
  const lines = src.split("\n");
  let match: RegExpExecArray | null;
  DYNAMIC_IMPORT_RE.lastIndex = 0;

  while ((match = DYNAMIC_IMPORT_RE.exec(src)) !== null) {
    const arg = match[1].trim();

    // Literal string arguments are always safe — Deno traces them statically.
    if (LITERAL_RE.test(arg)) continue;

    const lineIndex = src.slice(0, match.index).split("\n").length - 1;
    const lineText = lines[lineIndex] ?? "";

    // Skip comment lines (JSDoc or single-line).
    const trimmed = lineText.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Opt-out: lines annotated with `// lockfile-safe` have been audited.
    if (lineText.includes("// lockfile-safe")) continue;

    const rel = relative(srcDir, entry.path);
    console.error(
      `src/${rel}:${lineIndex + 1}: non-literal import() may escape lockfile graph: import(${arg})\n` +
      `  Add \`// lockfile-safe: <reason>\` if this is intentional (site-local / discovery / constant).`,
    );
    violations++;
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} violation(s). Non-literal import() of external packages breaks dune lockfile:sync.`,
  );
  Deno.exit(1);
}

console.log("lint-dynamic-imports: OK");
