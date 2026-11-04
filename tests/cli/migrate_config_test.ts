import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
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
    "config/site.yaml": "# c\nauth:\n  userStore: db # keep\n",
    "config/system.yaml": "admin:\n  maxUploadMb: 5\n",
    "config/env/production/system.yaml": "metrics:\n  slowQueryThresholdMs: 10\n",
  }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root));
    assertStringIncludes(out, "config/site.yaml");
    assertEquals(
      await Deno.readTextFile(join(root, "config/site.yaml")),
      "# c\nauth:\n  user_store: db # keep\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "config/system.yaml")),
      "admin:\n  max_upload_mb: 5\n",
    );
    assertEquals(
      await Deno.readTextFile(join(root, "config/env/production/system.yaml")),
      "metrics:\n  slow_query_threshold_ms: 10\n",
    );
    // second run: nothing left
    assertStringIncludes(await quiet(() => migrateConfigCommand(root)), "Nothing to migrate");
  });
});

Deno.test("migrate:config --dry-run writes nothing", async () => {
  const src = "auth:\n  userStore: db\n";
  await withSite({ "config/site.yaml": src }, async (root) => {
    const out = await quiet(() => migrateConfigCommand(root, { dryRun: true }));
    assertStringIncludes(out, "user_store");
    assertStringIncludes(out, "Dry run");
    assertEquals(await Deno.readTextFile(join(root, "config/site.yaml")), src);
  });
});

Deno.test("migrate:config leaves a file with unreachable keys untouched and exits 1", async () => {
  const src = "auth: { userStore: db }\n";
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
  await withSite({ "config/site.yaml": "title: T\n" }, async (root) => {
    assertStringIncludes(await quiet(() => migrateConfigCommand(root)), "Nothing to migrate");
  });
});
