import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  changePassword,
  hashPassword,
  needsRehash,
  verifyPassword,
  WeakPasswordError,
} from "../../src/auth/passwords.ts";
import { createLocalUserStore } from "../../src/auth/user-store.ts";
import { createStorage } from "../../src/storage/mod.ts";

Deno.test("hashPassword produces the pbkdf2:600000:salt:key format and verifies", async () => {
  const hash = await hashPassword("correct horse battery");
  assert(/^pbkdf2:600000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(hash));
  assertEquals(await verifyPassword("correct horse battery", hash), true);
  assertEquals(await verifyPassword("wrong horse battery", hash), false);
  assertEquals(needsRehash(hash), false);
});

Deno.test("verifyPassword accepts a hash written by plugin-admin's implementation", async () => {
  // Produced independently with PBKDF2-SHA256, 600000 iterations.
  const salt = new Uint8Array(16).fill(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("legacy-pass-123"),
    "PBKDF2",
    false,
    [
      "deriveBits",
    ],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      key,
      256,
    ),
  );
  const hex = (b: Uint8Array) =>
    [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const stored = `pbkdf2:600000:${hex(salt)}:${hex(bits)}`;
  assertEquals(await verifyPassword("legacy-pass-123", stored), true);
});

Deno.test("verifyPassword rejects malformed and downgraded hashes", async () => {
  assertEquals(await verifyPassword("x", "not-a-hash"), false);
  assertEquals(await verifyPassword("x", "pbkdf2:1000:00:00"), false);
  assertEquals(await verifyPassword("x", "pbkdf2:600000:zz:00"), false);
  assertEquals(needsRehash("pbkdf2:100000:00:00"), true);
});

Deno.test("changePassword rejects a weak password without touching the stored hash", async () => {
  const root = await Deno.makeTempDir({ prefix: "dune_test_passwords_" });
  try {
    const store = createLocalUserStore({
      storage: createStorage({ rootDir: root }),
      usersDir: "data/users",
    });
    const user = await store.create({
      email: "a@example.com",
      username: "a",
      provider: "local",
      roles: [],
      passwordHash: "old",
    });
    await assertRejects(
      () => changePassword(store, user.id, "short"),
      WeakPasswordError,
    );
    assertEquals((await store.getById(user.id))!.passwordHash, "old");

    await changePassword(store, user.id, "a-long-enough-passphrase");
    const updated = await store.getById(user.id);
    assertEquals(
      await verifyPassword("a-long-enough-passphrase", updated!.passwordHash!),
      true,
    );
    assertEquals(
      await changePassword(store, "missing", "a-long-enough-passphrase"),
      null,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
