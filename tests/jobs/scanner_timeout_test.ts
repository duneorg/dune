/**
 * Tests for scanJobs()'s optional `timeoutMs` job-file export.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import { scanJobs } from "../../src/jobs/scanner.ts";

async function withJobsDir(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_scanner_timeout_" });
  try {
    await Deno.mkdir(join(root, "jobs"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await Deno.writeTextFile(join(root, "jobs", name), content);
    }
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("scanJobs: reads an explicit timeoutMs export", async () => {
  await withJobsDir(
    {
      "quick.ts": `
        export const schedule = "0 0 * * *";
        export const timeoutMs = 5000;
        export default async function () {}
      `,
    },
    async (root) => {
      const defs = await scanJobs(root, ["jobs/quick.ts"]);
      assertEquals(defs.length, 1);
      assertEquals(defs[0].timeoutMs, 5000);
    },
  );
});

Deno.test("scanJobs: timeoutMs is undefined when not exported (scheduler default applies)", async () => {
  await withJobsDir(
    {
      "plain.ts": `
        export const schedule = "0 0 * * *";
        export default async function () {}
      `,
    },
    async (root) => {
      const defs = await scanJobs(root, ["jobs/plain.ts"]);
      assertEquals(defs.length, 1);
      assertEquals(defs[0].timeoutMs, undefined);
    },
  );
});

Deno.test("scanJobs: an invalid timeoutMs export is ignored, job still loads", async () => {
  await withJobsDir(
    {
      "bad-timeout.ts": `
        export const schedule = "0 0 * * *";
        export const timeoutMs = "not a number";
        export default async function () {}
      `,
    },
    async (root) => {
      const defs = await scanJobs(root, ["jobs/bad-timeout.ts"]);
      assertEquals(defs.length, 1);
      assertEquals(defs[0].timeoutMs, undefined);
    },
  );
});

Deno.test("scanJobs: a negative timeoutMs export is ignored, job still loads", async () => {
  await withJobsDir(
    {
      "negative-timeout.ts": `
        export const schedule = "0 0 * * *";
        export const timeoutMs = -100;
        export default async function () {}
      `,
    },
    async (root) => {
      const defs = await scanJobs(root, ["jobs/negative-timeout.ts"]);
      assertEquals(defs.length, 1);
      assertEquals(defs[0].timeoutMs, undefined);
    },
  );
});
