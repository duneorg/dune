/**
 * HMAC signing helpers for polizy permission tuple files.
 *
 * Each tuple file may include an `hmac` field containing a hex-encoded
 * HMAC-SHA256 of the canonical tuple payload. When DUNE_AUTHZ_HMAC_SECRET
 * is set, AuthzLocalAdapter verifies this field on load and signs on write.
 *
 * Fail-open: if the env var is absent, signing and verification are skipped
 * (a startup warning is emitted but the server still starts).
 *
 * Migration: unsigned files (no `hmac` field) are loaded by default even when
 * a key is configured. Run `dune authz:sign` to sign existing files after
 * setting DUNE_AUTHZ_HMAC_SECRET, then set DUNE_AUTHZ_HMAC_STRICT=1 to reject
 * unsigned tuples (closing the strip-the-hmac tamper bypass).
 */

/** The shape of a stored tuple including the optional hmac field. */
export interface SignedTuple {
  id: string;
  subject: { type: string; id: string };
  relation: string;
  object: { type: string; id: string };
  condition?: { validSince?: string; validUntil?: string };
  /** Hex-encoded HMAC-SHA256 of the canonical payload. Present when signing is enabled. */
  hmac?: string;
}

/**
 * Derive a deterministic canonical payload string for HMAC computation.
 * Key order is fixed; the `hmac` field itself is excluded.
 */
export function canonicalPayload(tuple: Omit<SignedTuple, "hmac">): string {
  const obj: Record<string, unknown> = {
    id: tuple.id,
    subject: { type: tuple.subject.type, id: tuple.subject.id },
    relation: tuple.relation,
    object: { type: tuple.object.type, id: tuple.object.id },
  };
  if (tuple.condition !== undefined) obj.condition = tuple.condition;
  return JSON.stringify(obj);
}

/** Import raw bytes into a HMAC-SHA256 CryptoKey. */
export async function importHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    secret.slice(),   // .slice() produces Uint8Array<ArrayBuffer>, satisfying BufferSource
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Compute HMAC-SHA256 of the tuple payload and return as a lowercase hex string. */
export async function signTuple(tuple: Omit<SignedTuple, "hmac">, key: CryptoKey): Promise<string> {
  const payload = new TextEncoder().encode(canonicalPayload(tuple));
  const raw = await crypto.subtle.sign("HMAC", key, payload);
  return Array.from(new Uint8Array(raw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify the `hmac` field on a stored tuple.
 *
 * Returns:
 *   - `"ok"`      — hmac is present and valid
 *   - `"missing"` — no hmac field (unsigned; treat as accepted during migration)
 *   - `"invalid"` — hmac is present but verification failed (tampered)
 */
export async function verifyTuple(
  tuple: SignedTuple,
  key: CryptoKey,
): Promise<"ok" | "missing" | "invalid"> {
  if (!tuple.hmac) return "missing";

  const expected = await signTuple(tuple, key);
  // Constant-time comparison via timingSafeEqual-equivalent:
  // XOR all bytes — returns false immediately if lengths differ
  if (expected.length !== tuple.hmac.length) return "invalid";

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ tuple.hmac.charCodeAt(i);
  }
  return diff === 0 ? "ok" : "invalid";
}

/**
 * Attempt to load DUNE_AUTHZ_HMAC_SECRET from the environment and import it
 * as a HMAC-SHA256 CryptoKey.
 *
 * Returns null and logs a startup warning if the env var is absent.
 * Throws if the var is present but too short (< 32 bytes after UTF-8 encoding).
 */
export async function loadHmacKeyFromEnv(): Promise<CryptoKey | null> {
  const secret = Deno.env.get("DUNE_AUTHZ_HMAC_SECRET");
  if (!secret) {
    console.warn(
      "[dune/authz] DUNE_AUTHZ_HMAC_SECRET is not set — " +
        "tuple file integrity checking is disabled. " +
        "Set this env var and run `dune authz:sign` to enable tamper detection.",
    );
    return null;
  }

  const encoded = new TextEncoder().encode(secret);
  if (encoded.byteLength < 32) {
    throw new Error(
      "[dune/authz] DUNE_AUTHZ_HMAC_SECRET must be at least 32 bytes (256 bits). " +
        `Current value encodes to ${encoded.byteLength} bytes.`,
    );
  }

  return importHmacKey(encoded);
}
