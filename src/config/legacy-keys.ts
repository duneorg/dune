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
  {
    file: "system",
    parent: ["metrics"],
    renames: { slowQueryThresholdMs: "slow_query_threshold_ms" },
  },
  {
    file: "system",
    parent: ["admin"],
    renames: {
      sessionLifetime: "session_lifetime",
      maxUploadMb: "max_upload_mb",
    },
  },
  { file: "system", parent: ["admin", "audit"], renames: { logFile: "log_file" } },
  {
    file: "site",
    parent: ["auth"],
    renames: {
      sessionLifetime: "session_lifetime",
      userStore: "user_store",
      authzStore: "authz_store",
    },
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
];

/**
 * Keys that no longer exist at all because the setting moved. They are not
 * renamed in place (the destination is another file or section), so
 * `dune migrate:config` reports them and the loader refuses them.
 */
interface MovedRule {
  file: ConfigFileKind;
  parent: string[];
  keys: Record<string, string>;
}

const MOVED: MovedRule[] = [
  {
    file: "site",
    parent: [],
    keys: {
      machine_translation:
        "the admin plugin's config (`config:` of its entry in plugins:), with api_key and base_url in snake_case; `dune migrate:config` moves it",
    },
  },
  {
    file: "system",
    parent: [],
    keys: {
      admin:
        "the admin's settings are the admin plugin's own config now: put them under `config:` of its entry in plugins: (site.yaml); `dune migrate:config` moves them",
    },
  },
  {
    file: "system",
    parent: ["admin"],
    keys: {
      honeypot: "forms.honeypot in site.yaml",
      notifications: "forms.notifications in site.yaml",
      incoming_webhooks: "webhooks.incoming in system.yaml",
      incomingWebhooks: "webhooks.incoming in system.yaml",
      data_dir: "data_dir at the top level of system.yaml",
      dataDir: "data_dir at the top level of system.yaml",
      enabled:
        "removed: the admin runs only when jsr:@dune/plugin-admin is listed under plugins: in site.yaml (delete this key to run without it)",
      authz_store: "removed: the admin's authz store is always local",
      authzStore: "removed: the admin's authz store is always local",
      runtime_dir: "runtime_dir at the top level of system.yaml",
      runtimeDir: "runtime_dir at the top level of system.yaml",
      max_revisions: "max_revisions at the top level of system.yaml",
      maxRevisions: "max_revisions at the top level of system.yaml",
    },
  },
  {
    file: "site",
    parent: ["forms", "notifications", "email"],
    keys: { smtp: "site.email (one provider for every email the site sends)" },
  },
];

/**
 * Keys that were declared and documented but that nothing ever read. Setting
 * one changes nothing, so the loader warns and ignores it instead of
 * refusing to load, and `dune migrate:config` deletes it. (Refusal is kept
 * for the keys in {@link MOVED}, where ignoring would silently change behaviour.)
 */
const IGNORED: MovedRule[] = [
  {
    file: "site",
    parent: [],
    keys: {
      uploads: "Dune has no public upload endpoint; use a `file` field in a form (forms/*.yaml)",
    },
  },
  {
    file: "system",
    parent: [],
    keys: {
      cache: "it never did anything; the rendered-page cache is `page_cache`",
      timezone: "it never did anything",
    },
  },
  {
    file: "system",
    parent: ["content"],
    keys: { markdown: "the markdown renderer never read these settings" },
  },
  {
    file: "system",
    parent: ["search"],
    keys: { include_flex: "it never did anything" },
  },
];

/** Keys in {@link IGNORED} present in an already-parsed config file. */
export function findIgnoredKeys(file: ConfigFileKind, parsed: unknown): MovedKey[] {
  const found: MovedKey[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      for (const r of IGNORED) {
        if (r.file === file && matches(r.parent, path) && key in r.keys) {
          found.push({ path: [...path, key].join("."), to: r.keys[key] });
        }
      }
      walk(value, [...path, key]);
    }
  };
  walk(parsed, []);
  return found;
}

/**
 * Delete ignored keys, with their nested block, from block-style YAML text.
 * Comments and everything else stay. Keys it cannot reach (flow style, quoted
 * keys, list items) stay; callers compare against {@link findIgnoredKeys} on
 * the result.
 */
export function removeIgnoredKeysInText(
  file: ConfigFileKind,
  text: string,
): { text: string; removed: MovedKey[] } {
  return removeKeysInText(IGNORED, file, text);
}

/** `admin.enabled` in system.yaml: removed in 0.36 (the admin runs only when its plugin is listed). */
const ADMIN_ENABLED: MovedRule[] = [{ file: "system", parent: ["admin"], keys: { enabled: "" } }];

/** Delete the `admin.enabled` line from a system.yaml text (comments and the rest are kept). */
export function removeAdminEnabledInText(text: string): { text: string; removed: boolean } {
  const r = removeKeysInText(ADMIN_ENABLED, "system", text);
  return { text: r.text, removed: r.removed.length > 0 };
}

/** Delete a top-level key and its children from a config file's text (comments elsewhere are kept). */
export function removeTopLevelKeyInText(
  file: ConfigFileKind,
  text: string,
  key: string,
): { text: string; removed: boolean } {
  const r = removeKeysInText([{ file, parent: [], keys: { [key]: "" } }], file, text);
  return { text: r.text, removed: r.removed.length > 0 };
}

function removeKeysInText(
  rules: MovedRule[],
  file: ConfigFileKind,
  text: string,
): { text: string; removed: MovedKey[] } {
  const removed: MovedKey[] = [];
  const stack: { indent: number; key: string }[] = [];
  const lines = text.split("\n");
  const out: string[] = [];
  let skipIndent = -1; // inside a removed block: drop lines indented deeper than this
  for (const line of lines) {
    const blank = /^\s*(#.*)?$/.test(line);
    if (skipIndent >= 0) {
      if (blank) {
        out.push(line);
        continue;
      }
      const indent = line.match(/^(\s*)/)![1].length;
      if (indent > skipIndent) continue;
      skipIndent = -1;
    }
    const m = blank ? null : line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)(.*)$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const path = stack.map((x) => x.key);
    const hit = rules.find((r) => r.file === file && matches(r.parent, path) && m[2] in r.keys);
    if (hit) {
      removed.push({ path: [...path, m[2]].join("."), to: hit.keys[m[2]] });
      skipIndent = indent;
      continue;
    }
    stack.push({ indent, key: m[2] });
    out.push(line);
  }
  return { text: out.join("\n"), removed };
}

/** A removed key and where its setting lives now. */
export interface MovedKey {
  path: string;
  to: string;
}

/** Moved or removed keys present in an already-parsed config file. */
export function findMovedKeys(file: ConfigFileKind, parsed: unknown): MovedKey[] {
  const found: MovedKey[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      for (const r of MOVED) {
        if (r.file === file && matches(r.parent, path) && key in r.keys) {
          found.push({ path: [...path, key].join("."), to: r.keys[key] });
        }
      }
      walk(value, [...path, key]);
    }
  };
  walk(parsed, []);
  return found;
}

export function describeMovedKeys(keys: MovedKey[]): string {
  return keys.map((k) => `${k.path} → ${k.to}`).join(", ");
}

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
