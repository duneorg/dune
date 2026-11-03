/**
 * Tests for `dune users:passwd` — set/reset a local user's password.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { usersPasswdCommand } from "../../src/cli/users-passwd.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { verifyPassword } from "../../src/auth/passwords.ts";
import { createStorage } from "../../src/storage/mod.ts";
import { createLocalSessionStore } from "../../src/session/local.ts";
import { createSessionManager } from "../../src/session/mod.ts";

async function withTempSite(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "dune_test_users_passwd_" });
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function storeFor(root: string) {
  return createLocalUserStore({
    storage: createStorage({ rootDir: root }),
    usersDir: "data/users",
  });
}

function sessionsFor(root: string, dir: string) {
  const lifetimeMs = 60_000;
  return createSessionManager(
    createLocalSessionStore({
      storage: createStorage({ rootDir: root }),
      sessionsDir: `.dune/admin/${dir}`,
      lifetimeMs,
    }),
    lifetimeMs,
  );
}

function withMockedExit(fn: () => Promise<void>): Promise<number | undefined> {
  const origExit = Deno.exit;
  let exitCode: number | undefined;
  // deno-lint-ignore no-explicit-any
  (Deno as any).exit = (code?: number) => {
    exitCode = code;
    throw new Error(`exit:${code}`);
  };
  return fn()
    .catch(() => {})
    .then(() => exitCode)
    .finally(() => {
      Deno.exit = origExit;
    });
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log, err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

async function seedLocalUser(root: string) {
  return await storeFor(root).create({
    email: "admin@example.com",
    username: "admin",
    provider: "local",
    roles: ["admin"],
    passwordHash: "pbkdf2:600000:00:00",
  });
}

Deno.test("users:passwd sets a new password by username", async () => {
  await withTempSite(async (root) => {
    await seedLocalUser(root);
    await quiet(() =>
      usersPasswdCommand(root, "admin", {
        readPassword: () => Promise.resolve("a-long-enough-passphrase"),
      })
    );
    const user = await storeFor(root).getByUsername("admin");
    assertExists(user);
    assertEquals(
      await verifyPassword("a-long-enough-passphrase", user!.passwordHash!),
      true,
    );
  });
});

Deno.test("users:passwd finds the user by email, case-insensitively", async () => {
  await withTempSite(async (root) => {
    await seedLocalUser(root);
    await quiet(() =>
      usersPasswdCommand(root, "Admin@Example.com", {
        readPassword: () => Promise.resolve("a-long-enough-passphrase"),
      })
    );
    const user = await storeFor(root).getByEmail("admin@example.com");
    assertEquals(
      await verifyPassword("a-long-enough-passphrase", user!.passwordHash!),
      true,
    );
  });
});

Deno.test("users:passwd revokes admin and site sessions for that user only", async () => {
  await withTempSite(async (root) => {
    const user = await seedLocalUser(root);
    const other = await storeFor(root).create({
      email: "o@example.com",
      provider: "local",
      roles: [],
      passwordHash: "x",
    });
    const admin = sessionsFor(root, "sessions");
    const site = sessionsFor(root, "site-sessions");
    const a1 = await admin.create(user.id);
    const s1 = await site.create(user.id);
    const keep = await admin.create(other.id);

    await quiet(() =>
      usersPasswdCommand(root, "admin", {
        readPassword: () => Promise.resolve("a-long-enough-passphrase"),
      })
    );

    assertEquals(await admin.get(a1.id), null);
    assertEquals(await site.get(s1.id), null);
    assertExists(await admin.get(keep.id));
  });
});

Deno.test("users:passwd exits 1 on a weak password and leaves the hash alone", async () => {
  await withTempSite(async (root) => {
    await seedLocalUser(root);
    const code = await quiet(() =>
      withMockedExit(() =>
        usersPasswdCommand(root, "admin", {
          readPassword: () => Promise.resolve("short"),
        })
      )
    );
    assertEquals(code, 1);
    assertEquals(
      (await storeFor(root).getByUsername("admin"))!.passwordHash,
      "pbkdf2:600000:00:00",
    );
  });
});

Deno.test("users:passwd exits 1 for an unknown user", async () => {
  await withTempSite(async (root) => {
    const code = await quiet(() =>
      withMockedExit(() =>
        usersPasswdCommand(root, "nobody", {
          readPassword: () => Promise.resolve("x"),
        })
      )
    );
    assertEquals(code, 1);
  });
});

Deno.test("users:passwd refuses accounts without a local password", async () => {
  await withTempSite(async (root) => {
    await storeFor(root).create({
      email: "inv@example.com",
      provider: "invited",
      roles: [],
    });
    const code = await quiet(() =>
      withMockedExit(() =>
        usersPasswdCommand(root, "inv@example.com", {
          readPassword: () => Promise.resolve("a-long-enough-passphrase"),
        })
      )
    );
    assertEquals(code, 1);
    assertEquals(
      (await storeFor(root).getByEmail("inv@example.com"))!.passwordHash,
      undefined,
    );
  });
});

Deno.test("users:passwd --generate sets a strong random password and prints it once", async () => {
  await withTempSite(async (root) => {
    await seedLocalUser(root);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      await usersPasswdCommand(root, "admin", { generate: true });
    } finally {
      console.log = log;
    }
    const printed = lines.flatMap((l) => l.split("\n")).map((l) => l.trim())
      .find((l) => /^[A-Za-z0-9_-]{24}$/.test(l));
    assertExists(printed);
    const user = await storeFor(root).getByUsername("admin");
    assertEquals(await verifyPassword(printed!, user!.passwordHash!), true);
  });
});

Deno.test("users:passwd rejects --stdin together with --generate", async () => {
  await withTempSite(async (root) => {
    await seedLocalUser(root);
    const code = await quiet(() =>
      withMockedExit(() =>
        usersPasswdCommand(root, "admin", { stdin: true, generate: true })
      )
    );
    assertEquals(code, 1);
  });
});
