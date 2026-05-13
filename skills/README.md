# Dune Skills

Skill files for AI coding agents working on Dune projects. Installed into `.claude/skills/` by `dune new` and `dune add`.

Each skill covers one domain: the pattern, minimal working examples, and the gotchas agents most commonly hit.

## Available skills

| File | Topic | Reach for this when... |
|------|-------|----------------------|
| `dune-auth.md` | Public user authentication | Adding login/logout, configuring OAuth providers or magic link, protecting routes |
| `dune-authz.md` | Authorization via polizy | Checking permissions, adding users to groups, content gating, route middleware |
| `dune-plugin-authoring.md` | Writing plugins | Creating a plugin, adding hooks, adding admin routes with security guards |
| `dune-schemas.md` | Schema layer (local + db) | Defining data models, querying app data, running migrations |
| `dune-jobs.md` | Background jobs | Scheduling recurring tasks, debugging job execution, handling errors |
| `dune-email.md` | Transactional email | Sending email from a plugin or job, creating templates, debugging in dev |
| `dune-content.md` | Content conventions | File naming, frontmatter, templates, taxonomy, language variants |

## Installation

`dune new` installs all skills into `.claude/skills/` automatically.

To reinstall after upgrading:
```sh
dune update:skills
```

## Reading order (new agent session)

1. `dune-plugin-authoring` — file conventions and plugin model
2. `dune-schemas` — data model
3. `dune-auth` — if the site has public users
4. `dune-authz` — if the site has roles or gated content
5. `dune-email` — if the task involves sending email
6. `dune-jobs` — if the task involves scheduled work
