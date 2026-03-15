---
title: "Administration"
published: true
visible: true
taxonomy:
  audience: [webmaster, editor]
  difficulty: [beginner]
  topic: [admin]
metadata:
  description: "Admin panel overview: authentication, roles, content editing, and media management"
---

# Admin Panel

The Dune admin panel is a browser-based interface for managing content, media, users, and site configuration without editing files directly.

> **Stability note**: The admin panel UI and its internal API endpoints (`/admin/api/…`) are functional but should be considered **beta**. Breaking changes to panel internals may occur in minor releases. The panel is intended for human editors, not programmatic integrations — use the [REST API](/reference/api) for machine-to-machine access.

## Accessing the panel

By default the panel is at `/admin`. Log in with the credentials created at first startup — Dune prints the password to the console and writes it to a temporary file:

```
🔑 Default admin created — username: admin
   Password written to: data/users/.admin-password-XXXXX
   Read it, then delete the file and change your password.
```

Change the URL prefix with `admin.path` in your config:

```yaml
# dune.config.ts
export default {
  admin: {
    path: "/cms",   # panel available at /cms
  },
};
```

Disable the panel entirely for read-only / public deployments:

```yaml
admin:
  enabled: false
```

## Roles and permissions

Three roles control what each user can do:

| Role | Can do |
|------|--------|
| `admin` | Everything: content, media, users, config, form submissions |
| `editor` | Content CRUD, media management, read config and submissions. Cannot manage users or change config. |
| `author` | Create and edit pages, upload media, read submissions. Cannot delete pages, media, or access config. |

Users are stored in `data/users/` (controlled by `admin.dataDir`) and should be committed to version control. Passwords are stored as PBKDF2 hashes — never in plaintext.

On first startup, a default `admin` account is created automatically. Delete the temporary password file and change the password immediately.

## What the panel provides

| Feature | Description |
|---------|-------------|
| **Content editor** | Create, edit, and delete pages. Supports Markdown, MDX, and frontmatter editing. Blueprint-driven custom fields are auto-generated from `blueprints/{template}.yaml`. |
| **Draft preview** | Save a draft and get a shareable preview URL that renders through the active theme. Reviewers don't need admin access. See [Draft preview](/content/workflow#draft-preview). |
| **Workflow** | Move pages through `draft → in_review → published → archived` states. |
| **Scheduled actions** | Set a date/time for automatic publish or unpublish. |
| **Revision history** | Browse and restore previous versions of any page. Up to `admin.maxRevisions` (default 50) saved per page. The current revision count is shown in the editor toolbar. |
| **Flex Objects** | Create, edit, and delete records for schema-driven custom data types (products, team members, events, etc.). Schemas defined in `flex-objects/{type}.yaml`. See [Flex Objects](/flex-objects). |
| **Configuration editor** | Edit `config/site.yaml` and `config/system.yaml` through a form UI without touching files directly (admin role only). |
| **Themes** | Browse installed and registry themes, preview any theme before switching, and install new themes from the marketplace. See `/admin/themes`. |
| **Media library** | Upload, browse, and delete media files co-located with content pages. |
| **Form submissions** | View submissions collected from blueprint-driven forms. See [Forms](/forms). |
| **User management** | Create, edit, enable/disable admin users (admin role only). |

## Configuration editor

The configuration editor (admin role only) lets you edit `config/site.yaml` and `config/system.yaml` through a form UI at `/admin/config`. Fields are rendered based on the schema for each config file — no need to know the YAML syntax.

Changes are written back to the config files and take effect on next request (for system config) or after a content rebuild (for site config). The editor shows all recognised fields with their current values and inline help text.

## Themes

The **Theme tab** of the configuration editor lets you switch the active theme and preview alternatives before committing. Select a theme from the dropdown and click **Preview** to see an iframe rendering of your site in that theme; click **Apply this theme** to make the switch.

For a full theme browser, go to `/admin/themes` (also linked from the bottom of the Theme tab). The marketplace shows your installed themes and a curated registry of community themes. You can install a theme directly from the registry — no restart required. See [Theme Preview & Marketplace](/themes/preview-and-marketplace) for details.

## Revision history

Every save to a page creates a revision snapshot. The page editor toolbar shows a **History** button with the current revision count. Clicking it opens a timeline of all saved versions, with timestamps and author information.

From the history view you can restore any previous version — this creates a new revision rather than overwriting the current one, so you can always undo a restore by reverting again.

Revisions are stored in `admin.runtimeDir` (default `.dune/admin/`) and are **not** committed to version control. The maximum number of revisions kept per page is controlled by `admin.maxRevisions` (default 50); older revisions are pruned automatically.

## Draft staging

Staging lets editors save work-in-progress content and share a live preview with reviewers — before the page goes public.

Saving a draft from the page editor stores a staging file in `admin.runtimeDir/staging/`. Each draft gets a random opaque token. The preview URL is:

```
https://example.com/__preview?path={encoded-source-path}&token={token}
```

The token is stable across saves, so sharing the link once is enough — it stays valid as the editor continues working. When the draft is published, the staging file is removed.

Staging files are ephemeral (live in `runtimeDir`, not committed to git). They are lost if you wipe `runtimeDir` or deploy to a fresh server. To keep drafts across deploys, back up `runtimeDir` or mount it on persistent storage.

## Git auto-commit

When `admin.git_commit: true` is enabled, every page save and staging publish triggers an automatic `git add` + `git commit`:

```yaml
# dune.config.ts (or config/system.yaml)
export default {
  admin: {
    git_commit: true,
  },
};
```

The commit message includes the file path and editor username:

```
Admin: update content/blog/my-post/default.md (by jane)
```

Commit failures are logged as warnings and never block the save. Git must be available in the server's PATH.

## Sessions

Sessions are cookie-based and stored in `admin.runtimeDir` (default `.dune/admin/sessions/`). They expire after `admin.sessionLifetime` seconds (default 24 hours). Sessions are ephemeral — they are lost on restart or deploy.

The session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` (in production). In development (`DUNE_ENV=dev`), the `Secure` flag is omitted to allow HTTP.

## Security considerations

- Admin routes are isolated under `admin.path` and require authentication on every request
- Sessions use PBKDF2-hashed passwords with per-user salts
- The `admin` role is required to create other `admin`-role accounts — editors and authors cannot escalate their own privileges
- Form submission data lives in `admin.dataDir` (git-tracked); session and revision data lives in `admin.runtimeDir` (gitignored) — keep these locations separate
- If you expose the panel publicly, put it behind HTTPS and consider restricting access by IP at the infrastructure level for higher-security sites
