/**
 * The generated site-entrypoint pattern (plan-site-entrypoint.md) — shared
 * between `dune new` (new.ts, which writes it for fresh sites) and `dune
 * migrate:entrypoint` (migrate-entrypoint.ts, which writes it for existing
 * sites moving off the re-exec path). Keeping one canonical copy means
 * migrate-entrypoint's "refuse to touch a main.ts that doesn't match the
 * template" check has an actual template to compare against, and the two
 * commands can never scaffold/migrate sites to subtly different shapes.
 */

/**
 * `main.ts` is deliberately a one-liner: `deno run -A main.ts <command>`
 * runs as the site's own process with its own deno.json/deno.lock governing
 * natively — no re-exec, no synthesized config. Treat it as generated, not
 * a place to customize.
 */
export const MAIN_TS_TEMPLATE = `import { cli } from "@dune/core/cli";

await cli({ root: import.meta.dirname });
`;

/**
 * Every import dune-core's own internal code needs, beyond `@dune/core`
 * itself and a site's own preact/theme deps. With no re-exec to merge in
 * dune's own import map on top of the site's, the site's map has to carry
 * this whole closure itself — see plan-site-entrypoint.md's "costs" section.
 * Keep this in sync with dune's own deno.json imports (minus @std/assert, a
 * dev/test-only dependency, and the @dune/plugin-admin/* subpath entries,
 * which nothing reaches via a bare specifier — only via the literal jsr:
 * string in bootstrap.ts's variable dynamic import, which needs no import
 * map entry at all).
 */
export const DUNE_CORE_RUNTIME_IMPORTS: Record<string, string> = {
  "fresh": "jsr:@fresh/core@^2",
  "@std/yaml": "jsr:@std/yaml@^1",
  "@std/path": "jsr:@std/path@^1.1.4",
  "@std/fs": "jsr:@std/fs@^1",
  "@std/crypto": "jsr:@std/crypto@^1",
  "@std/encoding": "jsr:@std/encoding@^1",
  "marked": "npm:marked@^15",
  "gray-matter": "npm:gray-matter@^4",
  "@mdx-js/mdx": "npm:@mdx-js/mdx@^3",
  "sharp": "npm:sharp@^0.33",
  "nodemailer": "npm:nodemailer@^6",
  "@zip-js/zip-js": "jsr:@zip-js/zip-js@^2",
  "@db/sqlite": "jsr:@db/sqlite@^0.12",
  "postgres": "npm:postgres@^3.4",
  "ioredis": "npm:ioredis@^5",
  "polizy": "npm:polizy@^0.6.0",
};

/** The entrypoint-pattern task definitions for dev/build/serve. */
export const ENTRYPOINT_TASKS: Record<string, string> = {
  dev: "deno run -A --watch=main.ts main.ts dev",
  build: "deno run -A main.ts build",
  serve: "deno run -A main.ts serve",
};

/** The .mcp.json args array for the entrypoint pattern. */
export const ENTRYPOINT_MCP_ARGS = ["run", "-A", "main.ts", "mcp:serve"];
