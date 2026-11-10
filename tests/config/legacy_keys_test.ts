import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  findLegacyKeys,
  findIgnoredKeys,
  findMovedKeys,
  removeIgnoredKeysInText,
  renameLegacyKeysInText,
} from "../../src/config/legacy-keys.ts";
import { loadConfig } from "../../src/config/loader.ts";
import { MemoryStorageAdapter } from "../../src/storage/memory.ts";

const SITE = `# my site
title: Test
auth:
  mode: dune
  userStore: session   # keep sessions
  sessionLifetime: 3600
  providers:
    github:
      clientId: "$GH_ID"
      clientSecret: "$GH_SECRET"
    magicLink:
      enabled: true
  jwt:
    jwksUrl: https://example.com/jwks
    userIdClaim: sub
  webhook:
    provider: clerk
    signatureHeader: x-sig
plugins:
  - src: x
plugin_configs:
  thing:
    userStore: untouched   # plugin-owned, same name elsewhere
`;

const SYSTEM = `content:
  allowTsxFormat: [admin]
search:
  customFields: [summary]
metrics:
  slowQueryThresholdMs: 50
admin:
  enabled: true
  maxUploadMb: 20
  audit:
    logFile: data/audit.log
`;

Deno.test("findLegacyKeys: finds every renamed key and nothing else", () => {
  const site = findLegacyKeys("site", parseYaml(SITE));
  assertEquals(
    site.map((k) => k.path).sort(),
    [
      "auth.jwt.jwksUrl",
      "auth.jwt.userIdClaim",
      "auth.providers.github.clientId",
      "auth.providers.github.clientSecret",
      "auth.providers.magicLink",
      "auth.sessionLifetime",
      "auth.userStore",
      "auth.webhook.signatureHeader",
    ],
  );
  const system = findLegacyKeys("system", parseYaml(SYSTEM));
  assertEquals(system.length, 5);
});

Deno.test("findLegacyKeys: a key with the same name under another parent is left alone", () => {
  assertEquals(findLegacyKeys("site", { plugin_configs: { thing: { userStore: 1 } } }), []);
  assertEquals(findLegacyKeys("system", { auth: { userStore: 1 } }), []); // site-only rule
});

Deno.test("renameLegacyKeysInText: renames keys, keeps comments, order and values", () => {
  const { text, renamed } = renameLegacyKeysInText("site", SITE);
  assertEquals(renamed.length, 8);
  assertStringIncludes(text, "  user_store: session   # keep sessions");
  assertStringIncludes(text, '      client_id: "$GH_ID"');
  assertStringIncludes(text, "    magic_link:");
  assertStringIncludes(text, "# my site");
  assertStringIncludes(text, "    userStore: untouched   # plugin-owned, same name elsewhere");
  assertEquals(findLegacyKeys("site", parseYaml(text)), []);
  // same values, only key names differ
  assertEquals((parseYaml(text) as Record<string, any>).auth.jwt.jwks_url, "https://example.com/jwks");
});

Deno.test("renameLegacyKeysInText: idempotent", () => {
  const once = renameLegacyKeysInText("system", SYSTEM).text;
  const twice = renameLegacyKeysInText("system", once);
  assertEquals(twice.text, once);
  assertEquals(twice.renamed, []);
});

Deno.test("renameLegacyKeysInText: flow style cannot be rewritten and stays detectable", () => {
  const src = "auth: { userStore: db }\n";
  const { text } = renameLegacyKeysInText("site", src);
  assertEquals(text, src);
  assertEquals(findLegacyKeys("site", parseYaml(text)).length, 1);
});

async function load(files: Record<string, string>) {
  const storage = new MemoryStorageAdapter();
  for (const [p, c] of Object.entries(files)) await storage.write(p, c);
  return loadConfig({ storage, rootDir: "/x", skipConfigTs: true });
}

Deno.test("loadConfig refuses a legacy key and names the new one", async () => {
  let message = "";
  try {
    await load({ "config/site.yaml": "title: T\nauth:\n  userStore: db\n" });
  } catch (err) {
    message = (err as Error).message;
  }
  assertStringIncludes(message, "auth.userStore → user_store");
  assertStringIncludes(message, "dune migrate:config");
});

Deno.test("loadConfig accepts the migrated keys", async () => {
  const cfg = await load({
    "config/site.yaml": "title: T\nauth:\n  user_store: db\n",
    "config/system.yaml": "max_revisions: 7\n",
  });
  assertEquals((cfg.site as any).auth.user_store, "db");
  assertEquals(cfg.system.max_revisions, 7);
});

Deno.test("findMovedKeys: the removed forms aliases, admin.data_dir and the smtp block", () => {
  const system = findMovedKeys(
    "system",
    parseYaml("admin:\n  honeypot: x\n  notifications: {}\n  incoming_webhooks: []\n  data_dir: d\n  dataDir: d\n  enabled: true\n"),
  );
  assertEquals(
    system.map((k) => k.path).sort(),
    ["admin", "admin.dataDir", "admin.data_dir", "admin.enabled", "admin.honeypot", "admin.incoming_webhooks", "admin.notifications"],
  );
  const site = findMovedKeys(
    "site",
    parseYaml("forms:\n  notifications:\n    email:\n      to: a@b.c\n      smtp: {host: h}\n"),
  );
  assertEquals(site.map((k) => k.path), ["forms.notifications.email.smtp"]);
  assertEquals(findMovedKeys("system", parseYaml("data_dir: var\nwebhooks:\n  incoming: []\n")), []);
});

Deno.test("loadConfig refuses a moved key and says where it went", async () => {
  let message = "";
  try {
    await load({ "config/system.yaml": "admin:\n  data_dir: old\n" });
  } catch (err) {
    message = (err as Error).message;
  }
  assertStringIncludes(message, "admin.data_dir → data_dir at the top level of system.yaml");
  assertStringIncludes(message, "Move the moved or removed keys by hand");
});

Deno.test("admin.enabled and admin.authz_store are removed with a message that says what to do", async () => {
  const moved = findMovedKeys("system", parseYaml("admin:\n  enabled: true\n  authz_store: local\n  authzStore: local\n"));
  assertEquals(moved.map((k) => k.path).sort(), ["admin", "admin.authzStore", "admin.authz_store", "admin.enabled"]);
  let message = "";
  try {
    await load({ "config/system.yaml": "admin:\n  enabled: false\n" });
  } catch (err) {
    message = (err as Error).message;
  }
  assertStringIncludes(message, "admin.enabled");
  assertStringIncludes(message, "listed under plugins:");
});

Deno.test("admin.runtime_dir and admin.max_revisions moved to the top level of system.yaml", async () => {
  const moved = findMovedKeys(
    "system",
    parseYaml("admin:\n  runtime_dir: x\n  runtimeDir: x\n  max_revisions: 1\n  maxRevisions: 1\n  max_upload_mb: 5\n"),
  );
  assertEquals(
    moved.map((k) => k.path).sort(),
    ["admin", "admin.maxRevisions", "admin.max_revisions", "admin.runtimeDir", "admin.runtime_dir"],
  );
  let message = "";
  try {
    await load({ "config/system.yaml": "admin:\n  runtime_dir: var/rt\n" });
  } catch (err) {
    message = (err as Error).message;
  }
  assertStringIncludes(message, "admin.runtime_dir → runtime_dir at the top level of system.yaml");
  // the new location is accepted
  const cfg = await load({ "config/system.yaml": "runtime_dir: var/rt\nmax_revisions: 9\n" });
  assertEquals(cfg.system.runtime_dir, "var/rt");
  assertEquals(cfg.system.max_revisions, 9);
});

Deno.test("loadConfig rejects a config file whose top level is not a mapping", async () => {
  for (const [yaml, kind] of [["- a\n- b\n", "an array"], ["just a string\n", "string"]]) {
    let message = "";
    try {
      await load({ "config/site.yaml": yaml });
    } catch (err) {
      message = (err as Error).message;
    }
    assertStringIncludes(message, `Expected an object but got ${kind}`);
  }
});

Deno.test("findIgnoredKeys: keys that were declared but never read are found", () => {
  const site = findIgnoredKeys("site", parseYaml("title: T\nuploads:\n  max_size_mb: 5\n"));
  assertEquals(site.map((k) => k.path), ["uploads"]);
  assertStringIncludes(site[0].to, "form");

  const system = findIgnoredKeys(
    "system",
    parseYaml("cache:\n  enabled: true\ntimezone: UTC\ncontent:\n  markdown:\n    extra: true\nsearch:\n  include_flex: [a]\n"),
  );
  assertEquals(system.map((k) => k.path).sort(), ["cache", "content.markdown", "search.include_flex", "timezone"]);
});

Deno.test("findIgnoredKeys: the same names elsewhere are left alone", () => {
  // `cache` and `uploads` are only ignored where they were config keys.
  assertEquals(findIgnoredKeys("site", { cache: { x: 1 }, plugin_configs: { thing: { uploads: 1 } } }), []);
  assertEquals(findIgnoredKeys("system", { admin: { cache: 1, timezone: "x" }, search: { page_size: 5 } }), []);
});

Deno.test("removeIgnoredKeysInText: deletes the key and its block, keeps everything else", () => {
  const text = [
    "# system",
    "title: keep",
    "cache:",
    "  enabled: true",
    "",
    "  ttl: 60",
    "timezone: UTC",
    "content:",
    "  markdown:",
    "    extra: true",
    "  allow_tsx_format: true",
    "search:",
    "  page_size: 5",
    "",
  ].join("\n");
  const r = removeIgnoredKeysInText("system", text);
  assertEquals(r.removed.map((k) => k.path), ["cache", "timezone", "content.markdown"]);
  assertEquals(
    r.text,
    ["# system", "title: keep", "", "content:", "  allow_tsx_format: true", "search:", "  page_size: 5", ""].join("\n"),
  );
  assertEquals(findIgnoredKeys("system", parseYaml(r.text)), []);
});

Deno.test("removeIgnoredKeysInText: leaves flow style alone so the caller can report it", () => {
  const r = removeIgnoredKeysInText("system", "cache: {enabled: true}\n");
  assertEquals(r.removed.map((k) => k.path), ["cache"]); // block-style line with an inline value is removable
  assertEquals(findIgnoredKeys("system", parseYaml("content: {markdown: {x: 1}}\n")).length, 1);
  assertEquals(removeIgnoredKeysInText("system", "content: {markdown: {x: 1}}\n").removed, []);
});

Deno.test("loadConfig: a site.yaml that still sets uploads loads and ignores it", async () => {
  const storage = new MemoryStorageAdapter();
  await storage.write("config/site.yaml", new TextEncoder().encode("title: Kept\nuploads:\n  max_size_mb: 5\n"));
  const config = await loadConfig({ storage, rootDir: "/x" });
  assertEquals(config.site.title, "Kept");
});

Deno.test("loadConfig: system.cache and timezone no longer block a boot", async () => {
  const storage = new MemoryStorageAdapter();
  await storage.write("config/system.yaml", new TextEncoder().encode("cache:\n  enabled: true\ntimezone: UTC\n"));
  await loadConfig({ storage, rootDir: "/x" });
});
