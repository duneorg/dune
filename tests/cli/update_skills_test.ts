import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { KNOWN_SKILL_FILES } from "../../src/cli/update-skills.ts";

Deno.test("update-skills: KNOWN_SKILL_FILES matches the actual skills/ directory", async () => {
  const repoRoot = dirname(dirname(dirname(fromFileUrl(import.meta.url))));
  const skillsDir = join(repoRoot, "skills");

  const actual: string[] = [];
  for await (const entry of Deno.readDir(skillsDir)) {
    if (entry.isFile && entry.name.endsWith(".md")) actual.push(entry.name);
  }

  assertEquals(
    [...KNOWN_SKILL_FILES].sort(),
    actual.sort(),
    "KNOWN_SKILL_FILES (used for JSR/remote installs) has drifted from skills/ " +
      "— a file present in one but not the other is silently skipped for remote installs",
  );
});
