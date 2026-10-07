import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";

Deno.test("plugin:update --help and -h print usage without touching site.yaml", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_help_" });
  try {
    await Deno.mkdir(join(root, "config"));
    const yaml = 'plugins:\n  - src: "jsr:@dune/plugin-admin@0.0.1"\n';
    await Deno.writeTextFile(join(root, "config", "site.yaml"), yaml);
    for (const flag of ["--help", "-h"]) {
      const out = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          join(Deno.cwd(), "src/cli.ts"),
          "plugin:update",
          flag,
          "--root",
          root,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(out.code, 0);
      assertStringIncludes(
        new TextDecoder().decode(out.stdout),
        "Usage: dune plugin:update",
      );
      assertEquals(
        await Deno.readTextFile(join(root, "config", "site.yaml")),
        yaml,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
