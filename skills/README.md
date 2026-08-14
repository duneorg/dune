# Dune Skills

Skill files for AI coding agents working on Dune projects. Installed into `.claude/skills/` by `dune new` and `dune update:skills` (not `dune add` — that command only installs *package*-specific skills bundled with a JSR/npm package you add, e.g. `dune add polizy` copies polizy's own skill files; it never touches this core set).

Each skill covers one domain: the pattern, minimal working examples, and the gotchas agents most commonly hit.

## Available skills

| File | Topic | Reach for this when... |
|------|-------|----------------------|
| `dune-auth.md` | Public user authentication | Adding login/logout, configuring OAuth providers or magic link, protecting routes |
| `dune-authz.md` | Authorization via polizy | Checking permissions, adding users to groups, content gating, route middleware |
| `dune-plugin-authoring.md` | Writing plugins | Creating a plugin, adding hooks, adding admin routes |
| `dune-schemas.md` | DB data layer (`schemas/*.yaml`) | Defining database-backed models, querying app data, running migrations. Not for editor-managed content — that's Flex Objects, documented separately in `dune-docs`. |
| `dune-jobs.md` | Background jobs | Scheduling recurring tasks, debugging job execution, handling errors |
| `dune-email.md` | Transactional email | Sending email from a plugin or job, creating templates, debugging in dev |
| `dune-content.md` | Content conventions | File naming, frontmatter, templates, taxonomy, language variants |
| `dune-mcp.md` | MCP server / agent tooling | Configuring `dune mcp:serve`, using its read/write tools and resources, the HTTP admin API agents can call |
| `dune-themes.md` | Theme architecture | Directory layout, templates, layouts, islands, static assets, theme inheritance |

## Installation

`dune new` installs all skills into `.claude/skills/` automatically. **How it discovers files depends on where the `@dune/core` package is running from**, and the two paths behave differently:
- **Local source** (this repo, a workspace-linked dev checkout): a plain directory scan of `skills/` — every `.md` file is copied, including this README, no allowlist involved.
- **JSR/remote install** (the normal case for a real site, running `jsr:@dune/core`): no directory listing is possible over HTTP, so `copySkillFiles()` (`src/cli/update-skills.ts`) fetches a hardcoded `KNOWN_SKILL_FILES` array instead. A file added to `skills/` without also being added to that array is silently never installed for real sites — a regression test (`tests/cli/update_skills_test.ts`) diffs the array against the directory to catch drift, but it only runs in this repo's own CI, not at install time on someone else's site.

To reinstall after upgrading:
```sh
dune update:skills
```

## Reading order (new agent session)

1. `dune-plugin-authoring` — file conventions and plugin model
2. `dune-content` — content file conventions, frontmatter, templates
3. `dune-schemas` — DB data layer, if the task touches application data
4. `dune-auth` — if the site has public users
5. `dune-authz` — if the site has roles or gated content
6. `dune-email` — if the task involves sending email
7. `dune-jobs` — if the task involves scheduled work
8. `dune-themes` — if the task touches theme/frontend work
9. `dune-mcp` — if the task involves configuring or using the MCP server itself
