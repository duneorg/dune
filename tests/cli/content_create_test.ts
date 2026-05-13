/**
 * Tests for src/cli/content-create.ts — dune content:create command.
 *
 * Tests the path resolution logic, frontmatter generation, and
 * existing-folder detection using a real temporary filesystem.
 * All tests create an isolated temp dir and clean up after themselves.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { contentCreateCommand } from "../../src/cli/content-create.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTempSite(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune-test-" });
  // Create a minimal content dir
  await Deno.mkdir(join(root, "content"), { recursive: true });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function readFile(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

// ---------------------------------------------------------------------------
// Basic creation
// ---------------------------------------------------------------------------

Deno.test("content:create: creates folder-based page at top level", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/about", {
      title: "About Us",
      json: false,
    });

    const filePath = join(root, "content", "01.about", "default.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "title: About Us");
    assertStringIncludes(content, "published: false");
    assertStringIncludes(content, "# About Us");
  });
});

Deno.test("content:create: derives title from slug when --title not given", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/my-new-page", {});

    const filePath = join(root, "content", "01.my-new-page", "default.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "title: My New Page");
  });
});

Deno.test("content:create: creates flat file with --flat", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/about", {
      title: "About",
      flat: true,
    });

    // Should be content/about.md (no subfolder)
    const filePath = join(root, "content", "about.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "title: About");
  });
});

Deno.test("content:create: marks as published with --publish", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/news", {
      publish: true,
    });

    const filePath = join(root, "content", "01.news", "default.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "published: true");
  });
});

Deno.test("content:create: includes template in frontmatter when specified", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/blog/hello", {
      template: "blog-post",
    });

    const filePath = join(root, "content", "01.blog", "01.hello", "default.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "template: blog-post");
  });
});

Deno.test("content:create: skips template in frontmatter when 'default'", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/about", {
      template: "default",
    });

    const filePath = join(root, "content", "01.about", "default.md");
    const content = await readFile(filePath);

    // "default" template should not be written to frontmatter
    assertEquals(content.includes("template: default"), false);
  });
});

// ---------------------------------------------------------------------------
// Nested routes
// ---------------------------------------------------------------------------

Deno.test("content:create: creates nested route with intermediate dirs", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/docs/getting-started/installation", {
      title: "Installation",
    });

    const filePath = join(
      root,
      "content",
      "01.docs",
      "01.getting-started",
      "01.installation",
      "default.md",
    );
    const content = await readFile(filePath);

    assertStringIncludes(content, "title: Installation");
  });
});

// ---------------------------------------------------------------------------
// Existing folder detection
// ---------------------------------------------------------------------------

Deno.test("content:create: respects existing numeric-prefix folder", async () => {
  await withTempSite(async (root) => {
    // Pre-create a blog folder with prefix 03
    await Deno.mkdir(join(root, "content", "03.blog"), { recursive: true });

    await contentCreateCommand(root, "/blog/my-post", {
      title: "My Post",
    });

    // Should create post inside 03.blog (not 01.blog)
    const filePath = join(root, "content", "03.blog", "01.my-post", "default.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "title: My Post");
  });
});

Deno.test("content:create: auto-increments prefix past existing folders", async () => {
  await withTempSite(async (root) => {
    // Pre-create two top-level folders
    await Deno.mkdir(join(root, "content", "01.home"), { recursive: true });
    await Deno.mkdir(join(root, "content", "02.about"), { recursive: true });

    await contentCreateCommand(root, "/contact", {
      title: "Contact",
    });

    // Next prefix should be 03
    const filePath = join(root, "content", "03.contact", "default.md");
    const content = await readFile(filePath);

    assertStringIncludes(content, "title: Contact");
  });
});

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

Deno.test("content:create: --json outputs structured result", async () => {
  await withTempSite(async (root) => {
    // Capture stdout via a simple approach: override console.log
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));

    try {
      await contentCreateCommand(root, "/products", {
        title: "Products",
        json: true,
      });
    } finally {
      console.log = origLog;
    }

    const output = JSON.parse(lines.join(""));
    assertEquals(output.created, true);
    assertEquals(output.route, "/products");
    assertExists(output.path);
    assertEquals(output.title, "Products");
    assertEquals(output.published, false);
  });
});

// ---------------------------------------------------------------------------
// Date frontmatter
// ---------------------------------------------------------------------------

Deno.test("content:create: includes today's date in frontmatter", async () => {
  await withTempSite(async (root) => {
    await contentCreateCommand(root, "/news/announcement", {
      title: "Announcement",
    });

    const filePath = join(root, "content", "01.news", "01.announcement", "default.md");
    const content = await readFile(filePath);

    const today = new Date().toISOString().slice(0, 10);
    assertStringIncludes(content, `date: ${today}`);
  });
});
