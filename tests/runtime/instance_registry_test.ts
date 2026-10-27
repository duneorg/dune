/**
 * Tests for the instance registry (src/runtime/instance-registry.ts).
 * Every test points DUNE_REGISTRY_DIR at a temp directory, so nothing here
 * touches the real ~/.dune.
 */

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "@std/path";
import {
  listRegisteredInstances,
  readProcessStart,
  registerInstance,
  registryDir,
} from "../../src/runtime/instance-registry.ts";

const unixOnly = { ignore: Deno.build.os === "windows" };

async function withRegistry(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "dune_test_registry_" });
  const prev = Deno.env.get("DUNE_REGISTRY_DIR");
  Deno.env.set("DUNE_REGISTRY_DIR", join(dir, "instances"));
  try {
    await fn(join(dir, "instances"));
  } finally {
    if (prev === undefined) Deno.env.delete("DUNE_REGISTRY_DIR");
    else Deno.env.set("DUNE_REGISTRY_DIR", prev);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

const INIT = {
  mode: "serve" as const,
  root: "/sites/example",
  title: "Example",
  port: 3123,
  version: "9.9.9",
};

Deno.test("registryDir: honours DUNE_REGISTRY_DIR, defaults under ~/.dune", () => {
  const prev = Deno.env.get("DUNE_REGISTRY_DIR");
  try {
    Deno.env.set("DUNE_REGISTRY_DIR", "/somewhere/else");
    assertEquals(registryDir(), "/somewhere/else");
    Deno.env.delete("DUNE_REGISTRY_DIR");
    assert(registryDir().endsWith(join(".dune", "instances")));
  } finally {
    if (prev !== undefined) Deno.env.set("DUNE_REGISTRY_DIR", prev);
  }
});

Deno.test("register: writes a record for this process, listed back with its fields", unixOnly, async () => {
  await withRegistry(async (dir) => {
    const handle = await registerInstance(INIT);
    const names: string[] = [];
    for await (const e of Deno.readDir(dir)) names.push(e.name);
    assertEquals(names, [`${Deno.pid}.json`], "exactly the record, no leftover temp file");

    const list = await listRegisteredInstances();
    assertEquals(list.length, 1);
    const r = list[0];
    assertEquals(r.pid, Deno.pid);
    assertEquals(r.mode, "serve");
    assertEquals(r.root, "/sites/example");
    assertEquals(r.title, "Example");
    assertEquals(r.port, 3123);
    assertEquals(r.version, "9.9.9");
    assertExists(r.processStart);
    handle.unregister();
  });
});

Deno.test("unregister: removes the record, and is safe to repeat", unixOnly, async () => {
  await withRegistry(async () => {
    const handle = await registerInstance(INIT);
    handle.unregister();
    handle.unregister();
    assertEquals(await listRegisteredInstances(), []);
  });
});

Deno.test("list: a record whose process is gone is dropped and its file pruned", unixOnly, async () => {
  await withRegistry(async (dir) => {
    // A real process that has definitely exited.
    const child = new Deno.Command(Deno.execPath(), { args: ["eval", "1"], stdout: "null", stderr: "null" })
      .spawn();
    const pid = child.pid;
    const start = await readProcessStart(pid) ?? "Thu Jan  1 00:00:00 1970";
    await child.status;
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      join(dir, `${pid}.json`),
      JSON.stringify({ pid, processStart: start, ...INIT, registeredAt: new Date().toISOString() }),
    );
    assertEquals(await listRegisteredInstances(), []);
    assertEquals([...Deno.readDirSync(dir)].length, 0, "stale file should be pruned");
  });
});

Deno.test("list: a live pid with a different start time (pid reuse) is treated as stale", unixOnly, async () => {
  await withRegistry(async (dir) => {
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      join(dir, `${Deno.pid}.json`),
      JSON.stringify({
        pid: Deno.pid,
        processStart: "Mon Jan  1 00:00:00 2001", // not when this process started
        ...INIT,
        registeredAt: new Date().toISOString(),
      }),
    );
    assertEquals(await listRegisteredInstances(), []);
    assertEquals([...Deno.readDirSync(dir)].length, 0);
  });
});

Deno.test("list: garbage, mismatched names and non-record files never throw and are not listed", unixOnly, async () => {
  await withRegistry(async (dir) => {
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(join(dir, "123.json"), "{ not json");
    await Deno.writeTextFile(join(dir, "124.json"), JSON.stringify({ pid: 999, nope: true }));
    await Deno.writeTextFile(join(dir, "notes.txt"), "keep me");
    assertEquals(await listRegisteredInstances(), []);
    const left = [...Deno.readDirSync(dir)].map((e) => e.name);
    assertEquals(left, ["notes.txt"], "unrelated files are left alone");
  });
});

Deno.test("list: no registry directory yet is an empty list, not an error", async () => {
  await withRegistry(async () => {
    assertEquals(await listRegisteredInstances(), []);
  });
});

Deno.test("register: an unwritable registry location doesn't throw", unixOnly, async () => {
  const prev = Deno.env.get("DUNE_REGISTRY_DIR");
  try {
    // A path under a regular file can't become a directory.
    const file = await Deno.makeTempFile();
    Deno.env.set("DUNE_REGISTRY_DIR", join(file, "instances"));
    const handle = await registerInstance(INIT);
    handle.unregister();
    await Deno.remove(file);
  } finally {
    if (prev === undefined) Deno.env.delete("DUNE_REGISTRY_DIR");
    else Deno.env.set("DUNE_REGISTRY_DIR", prev);
  }
});

Deno.test("register: a process exiting normally leaves no record behind", unixOnly, async () => {
  await withRegistry(async (dir) => {
    const url = new URL("../../src/runtime/instance-registry.ts", import.meta.url).href;
    const out = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `import { registerInstance } from ${JSON.stringify(url)};` +
          `await registerInstance({ mode: "dev", root: "/x", title: null, port: null, version: "0" });`,
      ],
      env: { DUNE_REGISTRY_DIR: dir },
      stdout: "null",
      stderr: "piped",
    }).output();
    assert(out.success, new TextDecoder().decode(out.stderr));
    assertEquals([...Deno.readDirSync(dir)].length, 0, "unload handler should have removed the record");
  });
});
