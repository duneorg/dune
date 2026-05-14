/**
 * Tests for src/cli/generate.ts — dune generate:* commands.
 *
 * Each test uses an isolated temporary directory to avoid cross-test pollution.
 */

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  generatePlugin,
  generateRoute,
  generateForm,
  generateTheme,
  generateSchema,
  generateCommand,
  generateList,
} from "../../src/cli/generate.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempSite(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune-gen-test-" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function readFile(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Capture console.log / console.error output during fn(). */
async function captureOutput(fn: () => Promise<void>): Promise<{ out: string; err: string }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => outLines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errLines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out: outLines.join("\n"), err: errLines.join("\n") };
}

// ---------------------------------------------------------------------------
// generate:plugin
// ---------------------------------------------------------------------------

Deno.test("generate:plugin creates plugins/{name}/index.ts", async () => {
  await withTempSite(async (root) => {
    await generatePlugin(root, "my-plugin");

    const outPath = join(root, "plugins", "my-plugin", "index.ts");
    const content = await readFile(outPath);

    assertStringIncludes(content, 'name: "my-plugin"');
    assertStringIncludes(content, 'version: "0.1.0"');
    assertStringIncludes(content, "DunePlugin");
    assertStringIncludes(content, "setup(hooks)");
    assertStringIncludes(content, "export default plugin");
  });
});

Deno.test("generate:plugin slugifies name (spaces → hyphens, lowercase)", async () => {
  await withTempSite(async (root) => {
    await generatePlugin(root, "My Cool Plugin");

    const outPath = join(root, "plugins", "my-cool-plugin", "index.ts");
    const content = await readFile(outPath);

    assertStringIncludes(content, 'name: "my-cool-plugin"');
  });
});

Deno.test("generate:plugin: collision without --force exits 1", async () => {
  await withTempSite(async (root) => {
    await generatePlugin(root, "dupe");

    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generatePlugin(root, "dupe");
    } catch {
      // swallow the thrown "exit" error
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

Deno.test("generate:plugin: collision with --force overwrites", async () => {
  await withTempSite(async (root) => {
    await generatePlugin(root, "dupe");

    // Overwrite the file with known sentinel content
    const outPath = join(root, "plugins", "dupe", "index.ts");
    await Deno.writeTextFile(outPath, "// old content");

    await generatePlugin(root, "dupe", { force: true });
    const content = await readFile(outPath);

    assertStringIncludes(content, 'name: "dupe"');
  });
});

// ---------------------------------------------------------------------------
// generate:route
// ---------------------------------------------------------------------------

Deno.test("generate:route creates content/{name}.md with frontmatter", async () => {
  await withTempSite(async (root) => {
    await generateRoute(root, "about");

    const outPath = join(root, "content", "about.md");
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: About");
    assertStringIncludes(content, "template: default");
    assertStringIncludes(content, "published: false");
    assertStringIncludes(content, "# About");
    assertStringIncludes(content, "Content goes here.");
  });
});

Deno.test("generate:route supports nested path (blog/archive)", async () => {
  await withTempSite(async (root) => {
    await generateRoute(root, "blog/archive");

    const outPath = join(root, "content", "blog", "archive.md");
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: Archive");
    assertStringIncludes(content, "template: default");
  });
});

Deno.test("generate:route slugifies name correctly", async () => {
  await withTempSite(async (root) => {
    await generateRoute(root, "My New Page");

    const outPath = join(root, "content", "my-new-page.md");
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: My New Page");
  });
});

Deno.test("generate:route: collision without --force exits 1", async () => {
  await withTempSite(async (root) => {
    await generateRoute(root, "contact");

    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generateRoute(root, "contact");
    } catch {
      // swallow
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

Deno.test("generate:route: collision with --force overwrites", async () => {
  await withTempSite(async (root) => {
    await generateRoute(root, "contact");

    const outPath = join(root, "content", "contact.md");
    await Deno.writeTextFile(outPath, "old");

    await generateRoute(root, "contact", { force: true });
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: Contact");
  });
});

// ---------------------------------------------------------------------------
// generate:form
// ---------------------------------------------------------------------------

Deno.test("generate:form creates schemas/{name}.yaml with example fields", async () => {
  await withTempSite(async (root) => {
    await generateForm(root, "contact");

    const outPath = join(root, "schemas", "contact.yaml");
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: Contact");
    assertStringIncludes(content, "type: text");
    assertStringIncludes(content, "type: email");
    assertStringIncludes(content, "type: textarea");
    assertStringIncludes(content, "required: true");
  });
});

Deno.test("generate:form slugifies name", async () => {
  await withTempSite(async (root) => {
    await generateForm(root, "Customer Inquiry");

    const outPath = join(root, "schemas", "customer-inquiry.yaml");
    assertEquals(await fileExists(outPath), true);
  });
});

Deno.test("generate:form: collision without --force exits 1", async () => {
  await withTempSite(async (root) => {
    await generateForm(root, "myform");

    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generateForm(root, "myform");
    } catch {
      // swallow
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

Deno.test("generate:form: collision with --force overwrites", async () => {
  await withTempSite(async (root) => {
    await generateForm(root, "myform");

    const outPath = join(root, "schemas", "myform.yaml");
    await Deno.writeTextFile(outPath, "old: true");

    await generateForm(root, "myform", { force: true });
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: Myform");
  });
});

// ---------------------------------------------------------------------------
// generate:theme
// ---------------------------------------------------------------------------

Deno.test("generate:theme creates all three scaffold files", async () => {
  await withTempSite(async (root) => {
    await generateTheme(root, "minimal");

    const themeYaml = join(root, "themes", "minimal", "theme.yaml");
    const template = join(root, "themes", "minimal", "templates", "default.tsx");
    const css = join(root, "themes", "minimal", "assets", "style.css");

    assertEquals(await fileExists(themeYaml), true);
    assertEquals(await fileExists(template), true);
    assertEquals(await fileExists(css), true);

    const yamlContent = await readFile(themeYaml);
    assertStringIncludes(yamlContent, 'name: "minimal"');
    assertStringIncludes(yamlContent, 'version: "0.1.0"');

    const tsxContent = await readFile(template);
    assertStringIncludes(tsxContent, "page.html");
    assertStringIncludes(tsxContent, "PageProps");
  });
});

Deno.test("generate:theme slugifies name", async () => {
  await withTempSite(async (root) => {
    await generateTheme(root, "My Theme");

    const themeYaml = join(root, "themes", "my-theme", "theme.yaml");
    assertEquals(await fileExists(themeYaml), true);
  });
});

Deno.test("generate:theme: collision without --force exits 1", async () => {
  await withTempSite(async (root) => {
    await generateTheme(root, "basic");

    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generateTheme(root, "basic");
    } catch {
      // swallow
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

Deno.test("generate:theme: collision with --force overwrites", async () => {
  await withTempSite(async (root) => {
    await generateTheme(root, "basic");

    const themeYaml = join(root, "themes", "basic", "theme.yaml");
    await Deno.writeTextFile(themeYaml, "name: old");

    await generateTheme(root, "basic", { force: true });
    const content = await readFile(themeYaml);

    assertStringIncludes(content, 'name: "basic"');
  });
});

// ---------------------------------------------------------------------------
// generate:schema
// ---------------------------------------------------------------------------

Deno.test("generate:schema creates flex-objects/{name}.yaml", async () => {
  await withTempSite(async (root) => {
    await generateSchema(root, "products");

    const outPath = join(root, "flex-objects", "products.yaml");
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: Products");
    assertStringIncludes(content, "icon: 📦");
    assertStringIncludes(content, "description: Products records");
    assertStringIncludes(content, "type: text");
    assertStringIncludes(content, "type: textarea");
    assertStringIncludes(content, "required: true");
  });
});

Deno.test("generate:schema slugifies name", async () => {
  await withTempSite(async (root) => {
    await generateSchema(root, "Team Members");

    const outPath = join(root, "flex-objects", "team-members.yaml");
    assertEquals(await fileExists(outPath), true);
  });
});

Deno.test("generate:schema: collision without --force exits 1", async () => {
  await withTempSite(async (root) => {
    await generateSchema(root, "events");

    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generateSchema(root, "events");
    } catch {
      // swallow
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

Deno.test("generate:schema: collision with --force overwrites", async () => {
  await withTempSite(async (root) => {
    await generateSchema(root, "events");

    const outPath = join(root, "flex-objects", "events.yaml");
    await Deno.writeTextFile(outPath, "title: old");

    await generateSchema(root, "events", { force: true });
    const content = await readFile(outPath);

    assertStringIncludes(content, "title: Events");
  });
});

// ---------------------------------------------------------------------------
// generateCommand dispatcher
// ---------------------------------------------------------------------------

Deno.test("generateCommand: routes to correct generator", async () => {
  await withTempSite(async (root) => {
    await generateCommand(root, "generate:plugin", "dispatch-test", {});

    const outPath = join(root, "plugins", "dispatch-test", "index.ts");
    assertEquals(await fileExists(outPath), true);
  });
});

Deno.test("generateCommand: unknown subcommand exits 1", async () => {
  await withTempSite(async (root) => {
    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generateCommand(root, "generate:foobar", "test", {});
    } catch {
      // swallow
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});

Deno.test("generateCommand --list prints all generators", async () => {
  const { out } = await captureOutput(async () => {
    generateList();
  });

  assertStringIncludes(out, "generate:plugin");
  assertStringIncludes(out, "generate:route");
  assertStringIncludes(out, "generate:form");
  assertStringIncludes(out, "generate:theme");
  assertStringIncludes(out, "generate:schema");
});

Deno.test("generateCommand: missing name exits 1", async () => {
  await withTempSite(async (root) => {
    let exitCode: number | undefined;
    const origExit = Deno.exit;
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = (code: number) => { exitCode = code; throw new Error("exit"); };

    try {
      await generateCommand(root, "generate:plugin", "", {});
    } catch {
      // swallow
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = origExit;
    }

    assertEquals(exitCode, 1);
  });
});
