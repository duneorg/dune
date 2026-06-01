/**
 * dune add <package> — Add a package to the site's deno.json imports.
 *
 * Usage:
 *   dune add polizy                  # adds npm:polizy
 *   dune add npm:polizy@^2.0.0       # explicit specifier + version
 *   dune add jsr:@scope/pkg          # JSR package
 *   dune add mylib@1.2.3             # bare name with version
 */

import { join, resolve } from "@std/path";

export interface AddOptions {
  force?: boolean;
}

/**
 * Derive the deno.json import key and full specifier from user input.
 *
 * Rules:
 *   - Already-prefixed specifiers ("npm:", "jsr:", "https:") are used verbatim.
 *   - Scoped packages (@scope/name) without a prefix → jsr:@scope/name
 *   - Bare names (no @ prefix, no protocol) → npm:name
 *   - Version suffix (@x.y.z or @^x.y.z) is preserved on the specifier but
 *     stripped from the import key.
 */
function resolveSpecifier(input: string): { key: string; specifier: string } {
  // Already a full specifier
  if (/^(npm:|jsr:|https:|http:)/.test(input)) {
    const key = importKeyFromSpecifier(input);
    return { key, specifier: input };
  }

  // Separate version suffix: "polizy@^2.0.0" → name="polizy", version="@^2.0.0"
  // Careful: "@scope/pkg@1.0.0" — only the LAST @ is the version
  let name = input;
  let versionSuffix = "";
  const versionMatch = input.match(/^(.+?)(@[\d^~><*].*)$/);
  if (versionMatch) {
    name = versionMatch[1];
    versionSuffix = versionMatch[2];
  }

  const protocol = name.startsWith("@") ? "jsr:" : "npm:";
  const specifier = `${protocol}${name}${versionSuffix}`;
  return { key: name, specifier };
}

/** Strip protocol prefix and version from a full specifier to get the import key. */
function importKeyFromSpecifier(spec: string): string {
  let s = spec.replace(/^(npm:|jsr:)/, "");
  // Strip version: @scope/name@1.0.0 → @scope/name; pkg@1.0.0 → pkg
  // "@scope/name@1.0.0" — the last @ is the version
  const atIdx = s.lastIndexOf("@");
  if (atIdx > 0) s = s.slice(0, atIdx); // atIdx > 0 skips the leading @ in @scope
  return s;
}

export async function addCommand(
  root: string,
  packageInput: string,
  _opts: AddOptions = {},
): Promise<void> {
  root = resolve(root);

  if (!packageInput) {
    console.error("  ✗ Usage: dune add <package>");
    Deno.exit(1);
  }

  const { key, specifier } = resolveSpecifier(packageInput);

  // ── Read deno.json ──────────────────────────────────────────────────────────
  const denoJsonPath = join(root, "deno.json");
  let denoJson: Record<string, unknown>;
  try {
    denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath));
  } catch {
    console.error(`  ✗ Could not read deno.json at ${denoJsonPath}`);
    Deno.exit(1);
  }

  const imports = (denoJson.imports ?? {}) as Record<string, string>;

  if (imports[key]) {
    console.log(`🏜️  Dune — add\n`);
    console.log(`  ℹ️  ${key} is already in deno.json imports (${imports[key]})`);
    console.log(`     Run with --force to overwrite.`);
    // Still run package-specific scaffolding in case it was skipped before
  } else {
    imports[key] = specifier;
    denoJson.imports = imports;
    await Deno.writeTextFile(denoJsonPath, JSON.stringify(denoJson, null, 2) + "\n");

    console.log(`🏜️  Dune — add\n`);
    console.log(`  ✅ Added to deno.json imports:`);
    console.log(`     "${key}": "${specifier}"`);
  }

  // ── Package-specific scaffolding ────────────────────────────────────────────
  await runPackageScaffolding(root, key);
}

async function runPackageScaffolding(root: string, key: string): Promise<void> {
  switch (key) {
    case "polizy":
      await scaffoldPolizy(root);
      break;
    default:
      // No known scaffolding — suggest skill update if the package might provide skills
      console.log(`\n  Run \`dune update:skills\` if ${key} provides Dune skill files.`);
  }
}

async function scaffoldPolizy(root: string): Promise<void> {
  console.log(`\n  📦 polizy — relationship-based authorization`);

  // Scaffold src/auth/authz.ts in the user's project if it doesn't exist.
  // This is the project-local authz setup file (distinct from Dune's internal
  // src/auth/authz.ts — users create this in their own project root's src/).
  const authzPath = join(root, "src", "auth", "authz.ts");

  const exists = await Deno.stat(authzPath).then(() => true).catch(() => false);
  if (!exists) {
    await Deno.mkdir(join(root, "src", "auth"), { recursive: true });
    const content = `/**
 * Project authz setup — exposes a shared authz instance for use in plugins
 * and route handlers.
 *
 * In most cases you don't need this file — Dune wires authz automatically
 * when authzStore: local is set in site.yaml. Import from here when you need
 * direct access to authz outside of plugin hooks (e.g. in a custom API route).
 */

import { createDuneAuthSystem } from "@dune/core/auth/authz";
import type { StorageAdapter } from "@dune/core";

// Lazily initialised — call initAuthz() in your app bootstrap before using.
let _authz: ReturnType<typeof createDuneAuthSystem> | null = null;

export function initAuthz(storage: StorageAdapter, dataDir = "data") {
  _authz = createDuneAuthSystem({ authzStore: "local", dataDir }, storage);
  return _authz;
}

export function getAuthz() {
  if (!_authz) throw new Error("authz not initialised — call initAuthz() first");
  return _authz;
}
`;
    await Deno.writeTextFile(authzPath, content);
    console.log(`  ✅ Scaffolded src/auth/authz.ts`);
  } else {
    console.log(`  ℹ️  src/auth/authz.ts already exists — skipped`);
  }

  console.log(`\n  Next steps:`);
  console.log(`    1. In site.yaml, set:  auth:\n                             authzStore: local`);
  console.log(`    2. Polizy skills (polizy-core, polizy-schema) are shipped with`);
  console.log(`       the polizy npm package under its skills/ directory.`);
  console.log(`       Copy them into .claude/skills/ to enable agent authz assistance.`);
}
