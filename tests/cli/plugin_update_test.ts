/**
 * Tests for src/cli/plugin.ts — the `--dry-run` support on the site.yaml
 * mutating plugin commands (plugin:update / plugin:install / plugin:remove).
 *
 * plugin:update's JSR latest-version lookup is stubbed via the
 * `resolveLatestVersion` option so these tests never touch the network.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  pluginInstallCommand,
  pluginRemoveCommand,
  pluginUpdateCommand,
} from "../../src/cli/plugin.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempSite(
  siteYaml: string,
  fn: (root: string, siteYamlPath: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_plugin_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    const siteYamlPath = join(root, "config", "site.yaml");
    await Deno.writeTextFile(siteYamlPath, siteYaml);
    await fn(root, siteYamlPath);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  return {
    lines,
    restore: () => {
      console.log = orig;
    },
  };
}

const SITE_YAML = `plugins:
  - src: "jsr:@dune/plugin-admin@1.0.0"
  - src: "jsr:@dune/plugin-orama@0.1.0"
`;

/** Stub resolver: always reports a newer version for every package. */
const resolveLatestVersion = (_scope: string, pkgName: string) =>
  Promise.resolve(pkgName === "plugin-admin" ? "1.2.0" : "0.4.0");

// ---------------------------------------------------------------------------
// plugin:update
// ---------------------------------------------------------------------------

Deno.test("plugin:update --dry-run does not write site.yaml", async () => {
  await withTempSite(SITE_YAML, async (root, siteYamlPath) => {
    const before = await Deno.readTextFile(siteYamlPath);
    const { restore } = captureLog();
    try {
      await pluginUpdateCommand(root, undefined, {
        dryRun: true,
        resolveLatestVersion,
      });
    } finally {
      restore();
    }
    assertEquals(await Deno.readTextFile(siteYamlPath), before);
  });
});

Deno.test("plugin:update --dry-run still reports the computed version changes", async () => {
  await withTempSite(SITE_YAML, async (root) => {
    const { lines, restore } = captureLog();
    try {
      await pluginUpdateCommand(root, undefined, {
        dryRun: true,
        resolveLatestVersion,
      });
    } finally {
      restore();
    }
    const out = lines.join("\n");
    assertStringIncludes(out, "@dune/plugin-admin: 1.0.0 → 1.2.0");
    assertStringIncludes(out, "@dune/plugin-orama: 0.1.0 → 0.4.0");
    assertStringIncludes(
      out,
      "Would update 2 plugins in config/site.yaml (dry run).",
    );
  });
});

Deno.test("plugin:update without --dry-run writes the bumped versions (regression guard)", async () => {
  await withTempSite(SITE_YAML, async (root, siteYamlPath) => {
    const { lines, restore } = captureLog();
    try {
      await pluginUpdateCommand(root, undefined, { resolveLatestVersion });
    } finally {
      restore();
    }
    const written = await Deno.readTextFile(siteYamlPath);
    assertStringIncludes(written, "jsr:@dune/plugin-admin@1.2.0");
    assertStringIncludes(written, "jsr:@dune/plugin-orama@0.4.0");
    assertStringIncludes(
      lines.join("\n"),
      "✓ Updated 2 plugins in config/site.yaml.",
    );
  });
});

// ---------------------------------------------------------------------------
// plugin:install
// ---------------------------------------------------------------------------

Deno.test("plugin:install --dry-run does not write site.yaml but reports the change", async () => {
  await withTempSite(SITE_YAML, async (root, siteYamlPath) => {
    const before = await Deno.readTextFile(siteYamlPath);
    const { lines, restore } = captureLog();
    try {
      await pluginInstallCommand(root, "jsr:@dune/plugin-pdf@1.0.0", {
        dryRun: true,
      });
    } finally {
      restore();
    }
    assertEquals(await Deno.readTextFile(siteYamlPath), before);
    assertStringIncludes(
      lines.join("\n"),
      'Would add plugin "jsr:@dune/plugin-pdf@1.0.0" to config/site.yaml (dry run).',
    );
  });
});

Deno.test("plugin:install without --dry-run writes the new entry (regression guard)", async () => {
  await withTempSite(SITE_YAML, async (root, siteYamlPath) => {
    const { restore } = captureLog();
    try {
      await pluginInstallCommand(root, "jsr:@dune/plugin-pdf@1.0.0");
    } finally {
      restore();
    }
    assertStringIncludes(
      await Deno.readTextFile(siteYamlPath),
      "jsr:@dune/plugin-pdf@1.0.0",
    );
  });
});

// ---------------------------------------------------------------------------
// plugin:remove
// ---------------------------------------------------------------------------

Deno.test("plugin:remove --dry-run does not write site.yaml but reports the change", async () => {
  await withTempSite(SITE_YAML, async (root, siteYamlPath) => {
    const before = await Deno.readTextFile(siteYamlPath);
    const { lines, restore } = captureLog();
    try {
      await pluginRemoveCommand(root, "plugin-orama", { dryRun: true });
    } finally {
      restore();
    }
    assertEquals(await Deno.readTextFile(siteYamlPath), before);
    assertStringIncludes(
      lines.join("\n"),
      'Would remove 1 plugin matching "plugin-orama" from config/site.yaml (dry run).',
    );
  });
});

Deno.test("plugin:remove without --dry-run drops the entry (regression guard)", async () => {
  await withTempSite(SITE_YAML, async (root, siteYamlPath) => {
    const { restore } = captureLog();
    try {
      await pluginRemoveCommand(root, "plugin-orama");
    } finally {
      restore();
    }
    const written = await Deno.readTextFile(siteYamlPath);
    assertEquals(written.includes("plugin-orama"), false);
    assertStringIncludes(written, "plugin-admin");
  });
});
