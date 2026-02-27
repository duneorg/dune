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
| **Content editor** | Create, edit, and delete pages. Supports Markdown, MDX, and frontmatter editing. |
| **Workflow** | Move pages through `draft → in_review → published → archived` states. |
| **Scheduled actions** | Set a date/time for automatic publish or unpublish. |
| **Revision history** | Browse, compare, and restore previous versions of any page. Up to `admin.maxRevisions` (default 50) per page. |
| **Media library** | Upload, browse, and delete media files co-located with content pages. |
| **Form submissions** | View submissions collected from contact forms or other form integrations. |
| **User management** | Create, edit, enable/disable admin users (admin role only). |

## Sessions

Sessions are cookie-based and stored in `admin.runtimeDir` (default `.dune/admin/sessions/`). They expire after `admin.sessionLifetime` seconds (default 24 hours). Sessions are ephemeral — they are lost on restart or deploy.

The session cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` (in production). In development (`DUNE_ENV=dev`), the `Secure` flag is omitted to allow HTTP.

## Security considerations

- Admin routes are isolated under `admin.path` and require authentication on every request
- Sessions use PBKDF2-hashed passwords with per-user salts
- The `admin` role is required to create other `admin`-role accounts — editors and authors cannot escalate their own privileges
- Form submission data lives in `admin.dataDir` (git-tracked); session and revision data lives in `admin.runtimeDir` (gitignored) — keep these locations separate
- If you expose the panel publicly, put it behind HTTPS and consider restricting access by IP at the infrastructure level for higher-security sites
