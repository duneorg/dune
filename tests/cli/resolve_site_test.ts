/**
 * `--site <id>` resolution for multisite installs.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join, resolve } from "@std/path";
import { parseCliOptions } from "../../src/cli/args.ts";
import { resolveSiteRoot, SiteResolutionError } from "../../src/cli/resolve-site.ts";
import { usersPasswdCommand } from "../../src/cli/users-passwd.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { verifyPassword } from "../../src/auth/passwords.ts";
import { createStorage } from "../../src/storage/mod.ts";

async function withInstall(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_site_flag_" });
  try {
    await Deno.mkdir(join(root, "config"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "config", "sites.yaml"),
      [
        "sites:",
        "  - id: blog",
        "    root: ../sites/blog",
        "    hostname: blog.example.com",
        "  - id: shop",
        `    root: ${join(root, "elsewhere", "shop")}`,
        "    hostname: shop.example.com",
        "",
      ].join("\n"),
    );
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("--site is parsed as an option", () => {
  const { options } = parseCliOptions(["users:passwd", "--site", "blog", "alice"]);
  assertEquals(options.site, "blog");
  assertEquals(options.positional, "alice");
});

Deno.test("--site resolves a relative root against config/, like the manager", async () => {
  await withInstall(async (root) => {
    assertEquals(
      await resolveSiteRoot(root, "users:passwd", "blog"),
      resolve(join(root, "config"), "../sites/blog"),
    );
  });
});

Deno.test("--site resolves an absolute root as given", async () => {
  await withInstall(async (root) => {
    assertEquals(
      await resolveSiteRoot(root, "users:passwd", "shop"),
      join(root, "elsewhere", "shop"),
    );
  });
});

Deno.test("--site with an unknown id lists the known ids", async () => {
  await withInstall(async (root) => {
    const err = await assertRejects(
      () => resolveSiteRoot(root, "users:passwd", "nope"),
      SiteResolutionError,
    );
    assertEquals(err.message.includes("blog, shop"), true);
  });
});

Deno.test("--site outside a multisite install is an error", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_site_flag_single_" });
  try {
    await assertRejects(
      () => resolveSiteRoot(root, "users:passwd", "blog"),
      SiteResolutionError,
      "not a multisite install",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("site-scoped commands at a multisite root are refused without --site", async () => {
  await withInstall(async (root) => {
    for (
      const cmd of [
        "users:create",
        "users:passwd",
        "users:grant-role",
        "users:revoke-role",
        "authz:sign",
        "migrate:users",
      ]
    ) {
      const err = await assertRejects(
        () => resolveSiteRoot(root, cmd),
        SiteResolutionError,
      );
      assertEquals(err.message.includes("--site <id> (blog, shop)"), true, cmd);
    }
  });
});

Deno.test("other commands at a multisite root, and any command in a single site, are untouched", async () => {
  await withInstall(async (root) => {
    assertEquals(await resolveSiteRoot(root, "dev"), root);
    assertEquals(await resolveSiteRoot(root, "doctor"), root);
  });
  const single = await Deno.makeTempDir({ prefix: "dune_test_site_flag_single_" });
  try {
    assertEquals(await resolveSiteRoot(single, "users:passwd"), single);
  } finally {
    await Deno.remove(single, { recursive: true });
  }
});

Deno.test("users:passwd on the resolved site root changes that site's user only", async () => {
  await withInstall(async (root) => {
    const seed = async (siteRoot: string) => {
      const store = createLocalUserStore({
        storage: createStorage({ rootDir: siteRoot }),
        usersDir: "data/users",
      });
      await store.create({
        email: "admin@example.com",
        username: "admin",
        provider: "local",
        roles: ["admin"],
        passwordHash: "pbkdf2:600000:00:00",
      });
      return store;
    };
    const blogRoot = await resolveSiteRoot(root, "users:passwd", "blog");
    const shopRoot = await resolveSiteRoot(root, "users:passwd", "shop");
    const blog = await seed(blogRoot);
    const shop = await seed(shopRoot);

    const log = console.log;
    console.log = () => {};
    try {
      await usersPasswdCommand(blogRoot, "admin", {
        readPassword: () => Promise.resolve("a-long-enough-passphrase"),
      });
    } finally {
      console.log = log;
    }

    const changed = await blog.getByUsername("admin");
    const untouched = await shop.getByUsername("admin");
    assertEquals(
      await verifyPassword("a-long-enough-passphrase", changed!.passwordHash!),
      true,
    );
    assertEquals(untouched!.passwordHash, "pbkdf2:600000:00:00");
  });
});
