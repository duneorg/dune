import { assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  addAdminPluginToText,
  ADMIN_PLUGIN_ENTRY_SRC,
  setAdminPluginConfigInText,
} from "../../src/cli/add-admin-plugin.ts";

const SRC = ADMIN_PLUGIN_ENTRY_SRC;

Deno.test("addAdminPluginToText: no plugins key appends a block, keeping comments", () => {
  const r = addAdminPluginToText("# site\ntitle: T # name\n");
  assertEquals(r.outcome, "added");
  assertEquals(r.text, `# site\ntitle: T # name\n\nplugins:\n  - src: ${SRC}\n`);
});

Deno.test("addAdminPluginToText: an empty plugins list becomes a block", () => {
  for (const empty of ["plugins: []", "plugins:", "plugins: # none"]) {
    const r = addAdminPluginToText(`title: T\n${empty}\ntheme:\n  name: x\n`);
    assertEquals(r.outcome, "added", empty);
    assertEquals(
      (parseYaml(r.text) as { plugins: { src: string }[] }).plugins,
      [{ src: SRC }],
      empty,
    );
  }
});

Deno.test("addAdminPluginToText: appends after the last item of a block list, including its config", () => {
  const r = addAdminPluginToText(
    "plugins:\n  - src: jsr:@dune/plugin-seo@^1\n    config:\n      x: 1\n\n  # next\n  - src: ./plugins/a.ts\ntheme:\n  name: x\n",
  );
  assertEquals(r.outcome, "added");
  const doc = parseYaml(r.text) as { plugins: { src: string }[]; theme: { name: string } };
  assertEquals(doc.plugins.map((p) => p.src), ["jsr:@dune/plugin-seo@^1", "./plugins/a.ts", SRC]);
  assertEquals(doc.theme.name, "x");
});

Deno.test("addAdminPluginToText: an unindented block list works too", () => {
  const r = addAdminPluginToText("plugins:\n- src: ./a.ts\ntitle: T\n");
  assertEquals(r.outcome, "added");
  assertEquals((parseYaml(r.text) as { plugins: { src: string }[] }).plugins.map((p) => p.src), [
    "./a.ts",
    SRC,
  ]);
});

Deno.test("addAdminPluginToText: an admin entry already there is left alone", () => {
  for (
    const text of [
      `plugins:\n  - src: ${SRC}\n`,
      "plugins:\n  - src: jsr:@dune/plugin-admin@4.0.1\n",
    ]
  ) {
    const r = addAdminPluginToText(text);
    assertEquals(r.outcome, "present");
    assertEquals(r.text, text);
  }
});

Deno.test("addAdminPluginToText: flow style with entries cannot be extended safely", () => {
  const text = "plugins: [{ src: ./a.ts }]\n";
  const r = addAdminPluginToText(text);
  assertEquals(r.outcome, "manual");
  assertEquals(r.text, text);
});

Deno.test("setAdminPluginConfigInText: writes config: under the admin entry, leaving the rest alone", () => {
  const text =
    `plugins:\n  - src: ./a.ts\n  - src: ${SRC}\n    integrity: sha256:abc\n  - src: ./b.ts\ntheme:\n  name: x\n`;
  const r = setAdminPluginConfigInText(text, { path: "/cms", audit: { enabled: false } });
  assertEquals(r.outcome, "set");
  const doc = parseYaml(r.text) as { plugins: Record<string, unknown>[]; theme: { name: string } };
  assertEquals(doc.plugins[1], {
    src: SRC,
    integrity: "sha256:abc",
    config: { path: "/cms", audit: { enabled: false } },
  });
  assertEquals(doc.plugins[0], { src: "./a.ts" });
  assertEquals(doc.plugins[2], { src: "./b.ts" });
  assertEquals(doc.theme.name, "x");
});

Deno.test("setAdminPluginConfigInText: nothing to write, no admin entry, or an existing config: are left alone", () => {
  const text = `plugins:\n  - src: ${SRC}\n`;
  assertEquals(setAdminPluginConfigInText(text, {}), { text, outcome: "none" });
  assertEquals(setAdminPluginConfigInText("title: T\n", { path: "/cms" }).outcome, "manual");
  const withConfig = `plugins:\n  - src: ${SRC}\n    config:\n      path: /x\n`;
  const r = setAdminPluginConfigInText(withConfig, { path: "/cms" });
  assertEquals(r.outcome, "manual");
  assertEquals(r.text, withConfig);
});
