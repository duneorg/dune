import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYamlText } from "@std/yaml";
import { migrateConfigCommand } from "../../src/cli/migrate-config.ts";

async function withSite(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_migrate_config_" });
  try {
    for (const [rel, content] of Object.entries(files)) {
      await Deno.mkdir(join(root, rel, ".."), { recursive: true });
      await Deno.writeTextFile(join(root, rel), content);
    }
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/** A site.yaml tail that already lists the admin, so tests about other keys leave plugins: alone. */
const ADMIN = "plugins:\n  - src: jsr:@dune/plugin-admin@^4\n";

const quiet = async <T>(fn: () => Promise<T>): Promise<string> => {
  const log = console.log, err = console.error;
  const lines: string[] = [];
  console.log = (...a) => void lines.push(a.join(" "));
  console.error = (...a) => void lines.push(a.join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
  return lines.join("\n");
};

Deno.test("migrate:config rewrites site, system and env overlay files", async () => {
  await withSite({
    "config/site.yaml": "# c\nauth:\n  userStore: db # keep\n" + ADMIN,
    "config/system.yaml": "admin:\n  maxUploadMb: 5\n",
    "config/env/production/system.yaml": "metrics:\n  slowQueryThresholdMs: 10\n",
  }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "config/site.yaml");
    // the admin: block moved into the admin plugin's entry
    assertEquals(
      await Deno.readTextFile(join(root, "config/site.yaml")),
      "# c\nauth:\n  user_store: db # keep\n" + ADMIN + "    config:\n      max_upload_mb: 5\n",
    );
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), "");
    assertEquals(
      await Deno.readTextFile(join(root, "config/env/production/system.yaml")),
      "metrics:\n  slow_query_threshold_ms: 10\n",
    );
    // second run: nothing left
    assertStringIncludes(await quiet(() => migrateConfigCommand(root)), "Nothing to migrate");
  });
});

Deno.test("migrate:config --dry-run writes nothing", async () => {
  const src = "auth:\n  userStore: db\n" + ADMIN;
  await withSite({ "config/site.yaml": src }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root, { dryRun: true }));
    assertStringIncludes(out, "user_store");
    assertStringIncludes(out, "Dry run");
    assertEquals(await Deno.readTextFile(join(root, "config/site.yaml")), src);
  });
});

Deno.test("migrate:config leaves a file with unreachable keys untouched and exits 1", async () => {
  const src = "auth: { userStore: db }\n" + ADMIN;
  await withSite({ "config/site.yaml": src }, async (root) => {
    const origExit = Deno.exit;
    let code: number | undefined;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (c?: number) => {
      code = c;
      throw new Error("exit");
    };
    try {
      const out = await quiet(async () => {
        try {
          await migrateConfigCommand(root);
        } catch { /* exit */ }
      });
      assertStringIncludes(out, "edit these by hand");
    } finally {
      Deno.exit = origExit;
    }
    assertEquals(code, 1);
    assertEquals(await Deno.readTextFile(join(root, "config/site.yaml")), src);
  });
});

Deno.test("migrate:config on a site with no legacy keys does nothing", async () => {
  await withSite({ "config/site.yaml": "title: T\n" + ADMIN }, async (root) => {
    assertStringIncludes(await quiet(() => migrateConfigCommand(root)), "Nothing to migrate");
  });
});

Deno.test("migrate:config deletes keys that were declared and never read", async () => {
  await withSite({
    "config/system.yaml": "# c\ncache:\n  enabled: true\ntimezone: UTC\nadmin:\n  maxUploadMb: 5\n",
    "config/site.yaml": "title: T\nuploads:\n  max_size_mb: 5\n" + ADMIN,
  }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "removed cache, timezone");
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), "# c\n");
    assertEquals(
      await Deno.readTextFile(join(root, "config/site.yaml")),
      "title: T\n" + ADMIN + "    config:\n      max_upload_mb: 5\n",
    );
  });
});

Deno.test("migrate:config adds the admin plugin to a site that had the admin by default", async () => {
  await withSite({ "config/site.yaml": "# my site\ntitle: T\nplugins:\n  - src: ./plugins/mine.ts\n    config:\n      a: 1\ntheme:\n  name: x\n" }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "added jsr:@dune/plugin-admin@^4");
    assertEquals(
      await Deno.readTextFile(join(root, "config/site.yaml")),
      "# my site\ntitle: T\nplugins:\n  - src: ./plugins/mine.ts\n    config:\n      a: 1\n  - src: jsr:@dune/plugin-admin@^4\ntheme:\n  name: x\n",
    );
    assertStringIncludes(await quiet(() => migrateConfigCommand(root)), "Nothing to migrate");
  });
});

Deno.test("migrate:config removes admin.enabled: true and adds the admin plugin", async () => {
  await withSite({
    "config/site.yaml": "title: T\n",
    "config/system.yaml": "admin:\n  enabled: true\n  max_upload_mb: 5\ndebug: true\n",
  }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "removed admin.enabled");
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), "debug: true\n");
    assertEquals(
      await Deno.readTextFile(join(root, "config/site.yaml")),
      "title: T\n\nplugins:\n  - src: jsr:@dune/plugin-admin@^4\n    config:\n      max_upload_mb: 5\n",
    );
  });
});

Deno.test("migrate:config removes admin.enabled: false and leaves the site without an admin", async () => {
  await withSite({
    "config/site.yaml": "title: T\n",
    "config/system.yaml": "admin:\n  enabled: false\ndebug: true\n",
  }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "removed admin.enabled");
    assertStringIncludes(out, "admin plugin is not added");
    assertStringIncludes(out, "removed the admin: block");
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), "debug: true\n");
    assertEquals(await Deno.readTextFile(join(root, "config/site.yaml")), "title: T\n");
  });
});

Deno.test("migrate:config --dry-run reports the admin changes and writes nothing", async () => {
  const system = "admin:\n  enabled: true\n";
  await withSite({ "config/site.yaml": "title: T\n", "config/system.yaml": system }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root, { dryRun: true }));
    assertStringIncludes(out, "removed admin.enabled");
    assertStringIncludes(out, "added jsr:@dune/plugin-admin@^4");
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), system);
    assertEquals(await Deno.readTextFile(join(root, "config/site.yaml")), "title: T\n");
  });
});

Deno.test("migrate:config moves the whole admin: block: settings into the plugin's config, runtime_dir and max_revisions to the top level", async () => {
  await withSite({
    "config/site.yaml": "title: T\n",
    "config/system.yaml":
      "debug: true\nadmin:\n  path: /cms\n  runtime_dir: var/rt\n  maxRevisions: 20\n  authz_store: local\n  audit:\n    log_file: audit/a.log\n  webhooks:\n    - url: https://hooks.example.test/x\n      events: [onPageUpdate]\n",
  }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "moved the admin: block");
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), "debug: true\nruntime_dir: var/rt\nmax_revisions: 20\n");
    const site = parseYamlText(await Deno.readTextFile(join(root, "config/site.yaml"))) as {
      plugins: { src: string; config: Record<string, unknown> }[];
    };
    assertEquals(site.plugins[0].src, "jsr:@dune/plugin-admin@^4");
    assertEquals(site.plugins[0].config, {
      path: "/cms",
      audit: { log_file: "audit/a.log" },
      webhooks: [{ url: "https://hooks.example.test/x", events: ["onPageUpdate"] }],
    });
    assertStringIncludes(await quiet(() => migrateConfigCommand(root)), "Nothing to migrate");
  });
});

Deno.test("migrate:config leaves an admin: block holding keys that belong elsewhere for a manual move", async () => {
  const system = "admin:\n  path: /cms\n  honeypot: x\n";
  await withSite({ "config/site.yaml": "title: T\n", "config/system.yaml": system }, async (root) => {
    const origExit = Deno.exit;
    let code: number | undefined;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (c?: number) => {
      code = c;
      throw new Error("exit");
    };
    let out = "";
    try {
      out = await quiet(async () => {
        try {
          await migrateConfigCommand(root);
        } catch { /* exit */ }
      });
    } finally {
      Deno.exit = origExit;
    }
    assertEquals(code, 1);
    assertStringIncludes(out, "admin.honeypot");
    assertEquals(await Deno.readTextFile(join(root, "config/system.yaml")), system);
  });
});
