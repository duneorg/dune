/**
 * Authored config keys that were camelCase before the snake_case convention
 * (0.36). The rename is hard — no aliases — so a config that still carries an
 * old key is refused at load time with the new name, and `dune migrate:config`
 * rewrites the files.
 *
 * @module
 */

export type ConfigFileKind = "site" | "system";

interface Rule {
  file: ConfigFileKind;
  /** Path of the parent mapping; "*" matches any key at that level. */
  parent: string[];
  renames: Record<string, string>;
}

const RULES: Rule[] = [
  { file: "system", parent: ["content"], renames: { allowTsxFormat: "allow_tsx_format" } },
  { file: "system", parent: ["search"], renames: { customFields: "custom_fields" } },
  { file: "system", parent: ["metrics"], renames: { slowQueryThresholdMs: "slow_query_threshold_ms" } },
  {
    file: "system",
    parent: ["admin"],
    renames: {
      sessionLifetime: "session_lifetime",
      dataDir: "data_dir",
      runtimeDir: "runtime_dir",
      maxRevisions: "max_revisions",
      maxUploadMb: "max_upload_mb",
      authzStore: "authz_store",
    },
  },
  { file: "system", parent: ["admin", "audit"], renames: { logFile: "log_file" } },
  {
    file: "system",
    parent: ["admin", "auth_provider"],
    renames: {
      baseDn: "base_dn",
      usernameAttr: "username_attr",
      bindDn: "bind_dn",
      bindPassword: "bind_password",
      emailAttr: "email_attr",
      nameAttr: "name_attr",
      roleMap: "role_map",
      defaultRole: "default_role",
      entityId: "entity_id",
      acsUrl: "acs_url",
      idpMetadata: "idp_metadata",
      roleAttr: "role_attr",
    },
  },
  {
    file: "site",
    parent: ["auth"],
    renames: { sessionLifetime: "session_lifetime", userStore: "user_store", authzStore: "authz_store" },
  },
  { file: "site", parent: ["auth", "providers"], renames: { magicLink: "magic_link" } },
  {
    file: "site",
    parent: ["auth", "providers", "*"],
    renames: { clientId: "client_id", clientSecret: "client_secret" },
  },
  {
    file: "site",
    parent: ["auth", "jwt"],
    renames: {
      jwksUrl: "jwks_url",
      userIdClaim: "user_id_claim",
      emailClaim: "email_claim",
      rolesClaim: "roles_claim",
    },
  },
  { file: "site", parent: ["auth", "webhook"], renames: { signatureHeader: "signature_header" } },
  {
    file: "site",
    parent: ["uploads"],
    renames: { maxSizeMb: "max_size_mb", allowedTypes: "allowed_types", requireAuth: "require_auth" },
  },
];

/** A legacy key found in a config file. `path` is the dotted location of the old key. */
export interface LegacyKey {
  path: string;
  from: string;
  to: string;
}

function matches(rule: string[], path: string[]): boolean {
  return rule.length === path.length &&
    rule.every((seg, i) => seg === "*" || seg === path[i]);
}

/** The new name for `key` under `parentPath` in `file`, or undefined. */
function renameFor(file: ConfigFileKind, parentPath: string[], key: string): string | undefined {
  for (const r of RULES) {
    if (r.file === file && matches(r.parent, parentPath) && key in r.renames) {
      return r.renames[key];
    }
  }
  return undefined;
}

/** Legacy keys present in an already-parsed config file. */
export function findLegacyKeys(file: ConfigFileKind, parsed: unknown): LegacyKey[] {
  const found: LegacyKey[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const to = renameFor(file, path, key);
      if (to) found.push({ path: [...path, key].join("."), from: key, to });
      walk(value, [...path, key]);
    }
  };
  walk(parsed, []);
  return found;
}

/**
 * Rename legacy keys in block-style YAML text, leaving comments, order and
 * formatting untouched. Keys it cannot reach (flow style `{a: 1}`, quoted keys,
 * mappings inside list items) stay as they are; callers compare against
 * {@link findLegacyKeys} on the result to report those.
 */
export function renameLegacyKeysInText(
  file: ConfigFileKind,
  text: string,
): { text: string; renamed: LegacyKey[] } {
  const renamed: LegacyKey[] = [];
  const stack: { indent: number; key: string }[] = [];
  const lines = text.split("\n");
  const out = lines.map((line) => {
    if (/^\s*(#.*)?$/.test(line)) return line;
    const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)(.*)$/);
    if (!m) return line; // list item, flow style, scalar continuation, ...
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = stack.map((s) => s.key);
    const key = m[2];
    const to = renameFor(file, path, key);
    stack.push({ indent, key });
    if (!to) return line;
    renamed.push({ path: [...path, key].join("."), from: key, to });
    return `${m[1]}${to}${m[3]}${m[4]}`;
  });
  return { text: out.join("\n"), renamed };
}

/** Human-readable list for error messages and the migrator. */
export function describeLegacyKeys(keys: LegacyKey[]): string {
  return keys.map((k) => `${k.path} → ${k.to}`).join(", ");
}
