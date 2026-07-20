/**
 * Tests for env-file.ts — the optional `--env-file[=path]` flag for
 * `dune dev`/`dune serve`.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadEnvFile, parseEnvFileArg } from "../../src/cli/env-file.ts";

// ── parseEnvFileArg ────────────────────────────────────────────────────────────

Deno.test("parseEnvFileArg: absent flag returns null", () => {
  assertEquals(parseEnvFileArg(["dev", "--port", "3000"]), null);
});

Deno.test("parseEnvFileArg: bare flag defaults to .env", () => {
  assertEquals(parseEnvFileArg(["dev", "--env-file"]), ".env");
});

Deno.test("parseEnvFileArg: --env-file=<path> uses the given path", () => {
  assertEquals(parseEnvFileArg(["dev", "--env-file=.env.local"]), ".env.local");
});

Deno.test("parseEnvFileArg: ignores unrelated flags containing similar text", () => {
  assertEquals(parseEnvFileArg(["dev", "--envfile"]), null);
});

// ── loadEnvFile ──────────────────────────────────────────────────────────────

async function withTempEnvFile(
  content: string,
  run: (dir: string, filename: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  const filename = ".env";
  try {
    await Deno.writeTextFile(`${dir}/${filename}`, content);
    await run(dir, filename);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function clearEnv(...keys: string[]) {
  for (const key of keys) Deno.env.delete(key);
}

Deno.test("loadEnvFile: sets KEY=VALUE pairs", async () => {
  await withTempEnvFile("FOO=bar\nBAZ=qux\n", async (dir, filename) => {
    clearEnv("FOO", "BAZ");
    try {
      await loadEnvFile(filename, dir);
      assertEquals(Deno.env.get("FOO"), "bar");
      assertEquals(Deno.env.get("BAZ"), "qux");
    } finally {
      clearEnv("FOO", "BAZ");
    }
  });
});

Deno.test("loadEnvFile: skips blank lines and comments", async () => {
  await withTempEnvFile(
    "# a comment\n\nFOO=bar\n  # indented comment\n",
    async (dir, filename) => {
      clearEnv("FOO");
      try {
        await loadEnvFile(filename, dir);
        assertEquals(Deno.env.get("FOO"), "bar");
      } finally {
        clearEnv("FOO");
      }
    },
  );
});

Deno.test("loadEnvFile: strips matching single or double quotes from values", async () => {
  await withTempEnvFile(
    `SINGLE='a value'\nDOUBLE="another value"\nMISMATCHED='oops"\n`,
    async (dir, filename) => {
      clearEnv("SINGLE", "DOUBLE", "MISMATCHED");
      try {
        await loadEnvFile(filename, dir);
        assertEquals(Deno.env.get("SINGLE"), "a value");
        assertEquals(Deno.env.get("DOUBLE"), "another value");
        // Mismatched quotes aren't a matching pair — left as-is.
        assertEquals(Deno.env.get("MISMATCHED"), `'oops"`);
      } finally {
        clearEnv("SINGLE", "DOUBLE", "MISMATCHED");
      }
    },
  );
});

Deno.test("loadEnvFile: does not override an already-set environment variable", async () => {
  await withTempEnvFile("FOO=from-file\n", async (dir, filename) => {
    Deno.env.set("FOO", "from-environment");
    try {
      await loadEnvFile(filename, dir);
      assertEquals(Deno.env.get("FOO"), "from-environment");
    } finally {
      clearEnv("FOO");
    }
  });
});

Deno.test("loadEnvFile: values with '=' in them keep everything after the first '='", async () => {
  await withTempEnvFile(
    "URL=http://example.com/?a=b\n",
    async (dir, filename) => {
      clearEnv("URL");
      try {
        await loadEnvFile(filename, dir);
        assertEquals(Deno.env.get("URL"), "http://example.com/?a=b");
      } finally {
        clearEnv("URL");
      }
    },
  );
});

Deno.test("loadEnvFile: throws when the file doesn't exist", async () => {
  await assertRejects(
    () => loadEnvFile(".env.does-not-exist", "/nonexistent/dir"),
    Error,
    "--env-file",
  );
});

Deno.test("loadEnvFile: absolute path is used as-is, ignoring root", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const absPath = `${dir}/custom.env`;
    await Deno.writeTextFile(absPath, "FOO=absolute\n");
    clearEnv("FOO");
    try {
      await loadEnvFile(absPath, "/some/other/root");
      assertEquals(Deno.env.get("FOO"), "absolute");
    } finally {
      clearEnv("FOO");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
