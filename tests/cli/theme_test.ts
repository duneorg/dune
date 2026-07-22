/**
 * Tests for theme.ts's parent-chain auto-install (`dune theme:install`) —
 * ensureParentChainInstalled and deriveParentSpecifier.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import type { ThemePackageEntry } from "../../src/config/types.ts";
import {
  deriveParentSpecifier,
  ensureParentChainInstalled,
} from "../../src/cli/theme.ts";

/**
 * Replace globalThis.fetch with a stub answering api.jsr.io package lookups.
 * `responses` maps a package name (e.g. "theme-dune-minimal") to either a
 * latestVersion string, or `null` for a 404 (not published).
 */
function stubJsrFetch(responses: Record<string, string | null>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url;
    const m = url.match(/\/packages\/([^/?]+)$/);
    const pkgName = m?.[1] ?? "";
    if (!(pkgName in responses)) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    const latest = responses[pkgName];
    if (latest === null) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ latestVersion: latest }), { status: 200 }),
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function withTempSite(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

async function writeThemeYaml(
  dir: string,
  content: string,
): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "theme.yaml"), content);
}

// ── deriveParentSpecifier — local path installs ─────────────────────────────

Deno.test("deriveParentSpecifier: local — sibling package found returns relative path", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    const parentRoot = join(root, "packages", "theme-base");
    await writeThemeYaml(childRoot, "name: child\n");
    await writeThemeYaml(parentRoot, "name: base\n");

    const spec = await deriveParentSpecifier(
      "./packages/theme-child",
      "base",
      childRoot,
      root,
    );
    assertEquals(spec, "./packages/theme-base");
  });
});

Deno.test("deriveParentSpecifier: local — missing sibling throws with actionable message", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    await writeThemeYaml(childRoot, "name: child\n");

    await assertRejects(
      () =>
        deriveParentSpecifier(
          "./packages/theme-child",
          "base",
          childRoot,
          root,
        ),
      Error,
      "no sibling package found",
    );
  });
});

// ── deriveParentSpecifier — JSR installs ────────────────────────────────────

Deno.test("deriveParentSpecifier: jsr — published parent returns pinned specifier", async () => {
  const restore = stubJsrFetch({ "theme-base": "2.3.1" });
  try {
    const spec = await deriveParentSpecifier(
      "jsr:@dune/theme-child@1.0.0",
      "base",
      "/unused",
      "/unused",
    );
    assertEquals(spec, "jsr:@dune/theme-base@2.3.1");
  } finally {
    restore();
  }
});

Deno.test("deriveParentSpecifier: jsr — unpublished parent throws", async () => {
  const restore = stubJsrFetch({ "theme-base": null });
  try {
    await assertRejects(
      () =>
        deriveParentSpecifier(
          "jsr:@dune/theme-child@1.0.0",
          "base",
          "/unused",
          "/unused",
        ),
      Error,
      "is not published on JSR yet",
    );
  } finally {
    restore();
  }
});

Deno.test("deriveParentSpecifier: jsr — package exists but has no published version throws", async () => {
  const restore = stubJsrFetch({
    "theme-base": undefined as unknown as string,
  });
  // Simulate a 200 response with no latestVersion field by overriding again:
  restore();
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
  try {
    await assertRejects(
      () =>
        deriveParentSpecifier(
          "jsr:@dune/theme-child@1.0.0",
          "base",
          "/unused",
          "/unused",
        ),
      Error,
      "has no published version yet",
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("deriveParentSpecifier: jsr — malformed child specifier throws", async () => {
  await assertRejects(
    () =>
      deriveParentSpecifier(
        "jsr:@dune/not-a-theme-package@1.0.0",
        "base",
        "/unused",
        "/unused",
      ),
    Error,
    "Could not derive a JSR specifier",
  );
});

Deno.test("deriveParentSpecifier: unknown source kind throws", async () => {
  await assertRejects(
    () =>
      deriveParentSpecifier(
        "npm:some-theme@1.0.0",
        "base",
        "/unused",
        "/unused",
      ),
    Error,
    "Don't know how to auto-install",
  );
});

// ── ensureParentChainInstalled ───────────────────────────────────────────────

Deno.test("ensureParentChainInstalled: no theme.yaml — no-op", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    await Deno.mkdir(childRoot, { recursive: true });
    const existing: ThemePackageEntry[] = [];

    await ensureParentChainInstalled(
      root,
      childRoot,
      "./packages/theme-child",
      existing,
    );
    assertEquals(existing, []);
  });
});

Deno.test("ensureParentChainInstalled: theme.yaml with no parent field — no-op", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    await writeThemeYaml(childRoot, "name: child\n");
    const existing: ThemePackageEntry[] = [];

    await ensureParentChainInstalled(
      root,
      childRoot,
      "./packages/theme-child",
      existing,
    );
    assertEquals(existing, []);
  });
});

Deno.test("ensureParentChainInstalled: parent already registered — no-op, no fetch", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    await writeThemeYaml(childRoot, "name: child\nparent: base\n");
    const existing: ThemePackageEntry[] = [{
      name: "base",
      src: "jsr:@dune/theme-base@1.0.0",
    }];

    // No fetch stub installed — a call to fetch would throw/hang, proving
    // this path returns before ever needing to resolve the parent.
    await ensureParentChainInstalled(
      root,
      childRoot,
      "./packages/theme-child",
      existing,
    );
    assertEquals(existing.length, 1);
  });
});

Deno.test("ensureParentChainInstalled: parent already present as local themes/ dir — no-op", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    await writeThemeYaml(childRoot, "name: child\nparent: base\n");
    await Deno.mkdir(join(root, "themes", "base"), { recursive: true });
    const existing: ThemePackageEntry[] = [];

    await ensureParentChainInstalled(
      root,
      childRoot,
      "./packages/theme-child",
      existing,
    );
    assertEquals(existing, []);
  });
});

Deno.test("ensureParentChainInstalled: installs a missing local-sibling parent", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    const baseRoot = join(root, "packages", "theme-base");
    await writeThemeYaml(childRoot, "name: child\nparent: base\n");
    await writeThemeYaml(baseRoot, "name: base\n");
    const existing: ThemePackageEntry[] = [];

    await ensureParentChainInstalled(
      root,
      childRoot,
      "./packages/theme-child",
      existing,
    );
    assertEquals(existing, [{ name: "base", src: "./packages/theme-base" }]);
  });
});

Deno.test("ensureParentChainInstalled: recurses through a multi-level parent chain", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    const midRoot = join(root, "packages", "theme-mid");
    const rootThemeRoot = join(root, "packages", "theme-root");
    await writeThemeYaml(childRoot, "name: child\nparent: mid\n");
    await writeThemeYaml(midRoot, "name: mid\nparent: root\n");
    await writeThemeYaml(rootThemeRoot, "name: root\n");
    const existing: ThemePackageEntry[] = [];

    await ensureParentChainInstalled(
      root,
      childRoot,
      "./packages/theme-child",
      existing,
    );
    assertEquals(existing, [
      { name: "mid", src: "./packages/theme-mid" },
      { name: "root", src: "./packages/theme-root" },
    ]);
  });
});

Deno.test("ensureParentChainInstalled: circular parent reference terminates instead of looping forever", async () => {
  await withTempSite(async (root) => {
    const aRoot = join(root, "packages", "theme-a");
    const bRoot = join(root, "packages", "theme-b");
    // a → parent: b, b → parent: a
    await writeThemeYaml(aRoot, "name: a\nparent: b\n");
    await writeThemeYaml(bRoot, "name: b\nparent: a\n");
    const existing: ThemePackageEntry[] = [];

    await ensureParentChainInstalled(
      root,
      aRoot,
      "./packages/theme-a",
      existing,
    );
    // The seen-set is keyed by parent slug, checked once per hop: a→b (seen
    // gains "b"), then b→a (seen gains "a", "a" wasn't seen yet so this hop
    // proceeds), then a→b again — only *this* third hop is caught, since "b"
    // is now in `seen`. Net effect: both "b" and "a" end up installed before
    // the walk detects the cycle, not just the first one. Documents actual
    // behavior — a 2-cycle isn't caught until it's been walked once fully.
    assertEquals(existing, [
      { name: "b", src: "./packages/theme-b" },
      { name: "a", src: "./packages/theme-a" },
    ]);
  });
});

Deno.test("ensureParentChainInstalled: unpublished JSR parent propagates a clear error", async () => {
  await withTempSite(async (root) => {
    const childRoot = join(root, "packages", "theme-child");
    await writeThemeYaml(childRoot, "name: child\nparent: dune-minimal\n");
    const existing: ThemePackageEntry[] = [];

    const restore = stubJsrFetch({ "theme-dune-minimal": null });
    try {
      await assertRejects(
        () =>
          ensureParentChainInstalled(
            root,
            childRoot,
            "jsr:@dune/theme-child@1.0.0",
            existing,
          ),
        Error,
        "is not published on JSR yet",
      );
    } finally {
      restore();
    }
  });
});
