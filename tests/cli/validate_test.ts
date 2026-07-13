/**
 * Regression test for `dune validate`'s template-reference check.
 *
 * Bug: the checker only looked in the active theme's own templates/
 * directory, not through the theme's `parent:` inheritance chain that the
 * runtime engine (src/themes/loader.ts) already resolves correctly at
 * request time. A theme that inherits a template from its parent (e.g.
 * dune-themes' sirocco inheriting dune-minimal's search.tsx via
 * `parent: dune-minimal`) was flagged as "missing" even though it renders
 * fine, which blocked the release pipeline's required `dune validate` step.
 *
 * validate.ts now delegates to `engine.themes.getAvailableTemplates()` (the
 * same chain-walking helper used elsewhere, already covered for child+parent
 * merging in tests/themes/loader_test.ts) instead of a single-directory
 * `storage.exists()` check. This test exercises that fix through a real
 * bootstrap() over a two-level theme inheritance chain, mirroring the
 * reported scenario.
 *
 * NOTE: bootstrap() starts a file-watcher interval that leaks across test
 * boundaries (same caveat as tests/cli/content_delete_test.ts) — this test
 * uses { sanitizeOps: false, sanitizeResources: false }.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { bootstrap } from "../../src/runtime/bootstrap.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_validate_" });
  try {
    await fn(root);
  } finally {
    // bootstrap()'s file-watcher interval can still be writing (e.g. a
    // content-index cache file) for a moment after this test's assertions
    // run, which occasionally races a recursive remove with
    // "Directory not empty". Retry a few times rather than flake.
    for (let attempt = 0; ; attempt++) {
      try {
        await Deno.remove(root, { recursive: true });
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }
}

Deno.test(
  "engine.themes.getAvailableTemplates: includes a template inherited from a parent theme (sirocco/dune-minimal regression)",
  { sanitizeOps: false, sanitizeResources: false },
  async () => {
    await withTempSite(async (root) => {
      // Home page — required for bootstrap to resolve a home route.
      await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "01.home", "default.md"),
        "---\ntitle: Home\n---\n\n# Home\n",
      );

      // A page that references a template the child theme does NOT have,
      // but its parent does — the exact sirocco/search.tsx scenario.
      await Deno.mkdir(join(root, "content", "02.search"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "content", "02.search", "default.md"),
        "---\ntitle: Search\ntemplate: search\n---\n\n# Search\n",
      );

      // Parent theme ("base") — has the search.tsx template.
      await Deno.mkdir(join(root, "themes", "base", "templates"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "themes", "base", "theme.yaml"),
        "name: base\n",
      );
      await Deno.writeTextFile(
        join(root, "themes", "base", "templates", "default.tsx"),
        `export default function Default({ children }: { children: unknown }) {\n  return children;\n}\n`,
      );
      await Deno.writeTextFile(
        join(root, "themes", "base", "templates", "search.tsx"),
        `export default function Search() {\n  return null;\n}\n`,
      );

      // Child theme ("child") — inherits from "base", has no search.tsx of its own.
      await Deno.mkdir(join(root, "themes", "child", "templates"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "themes", "child", "theme.yaml"),
        "name: child\nparent: base\n",
      );
      await Deno.writeTextFile(
        join(root, "themes", "child", "templates", "default.tsx"),
        `export default function Default({ children }: { children: unknown }) {\n  return children;\n}\n`,
      );

      // Site config: active theme is "child".
      await Deno.mkdir(join(root, "config"), { recursive: true });
      await Deno.writeTextFile(
        join(root, "config", "site.yaml"),
        "theme:\n  name: child\n",
      );

      const ctx = await bootstrap(root, {});

      // This is the exact check validate.ts now performs: the template
      // referenced in frontmatter ("search") must resolve across the full
      // theme chain, not just the active theme's own templates/ directory.
      const available = ctx.engine.themes.getAvailableTemplates();
      assertEquals(available.includes("search"), true);

      // Sanity: a template that genuinely doesn't exist anywhere in the
      // chain is correctly absent.
      assertEquals(available.includes("does-not-exist-anywhere"), false);
    });
  },
);
