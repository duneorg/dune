---
title: "Content Workflow"
published: true
visible: true
taxonomy:
  audience: [editor, webmaster]
  difficulty: [intermediate]
  topic: [content, workflow]
metadata:
  description: "Managing content status with draft, review, published, and archived states"
---

# Content Workflow

Dune includes a built-in editorial workflow with four content states. The workflow is visible in the admin panel and can be controlled via frontmatter.

## States

| Status | Description |
|--------|-------------|
| `draft` | Work in progress — not visible to visitors (unless `published: true` is also set) |
| `in_review` | Submitted for editorial review — not yet public |
| `published` | Approved and live — visible to visitors |
| `archived` | Removed from circulation — not visible, kept for historical reference |

The `status` frontmatter field sets a page's workflow state:

```yaml
---
title: "My New Article"
status: draft
---
```

## Allowed transitions

Not all state changes are valid. The engine enforces the following transition graph:

```
draft ──────────→ in_review ──→ published ──→ archived
  ↑                   │                          │
  └───────────────────┘←─────────────────────────┘
  ↑                                              │
  └──────────────────────────────────────────────┘
```

Specifically:

| From | To | Notes |
|------|----|-------|
| `draft` | `in_review` | Submit for review |
| `draft` | `published` | Publish directly (bypass review) |
| `in_review` | `published` | Approve and publish |
| `in_review` | `draft` | Return to author for changes |
| `published` | `archived` | Archive published content |
| `published` | `draft` | Unpublish and return to draft |
| `archived` | `draft` | Restore from archive |

Any other transition (e.g. `archived → published`) is invalid and will be rejected.

## Status vs. `published`

`status` and `published` are independent fields:

- `published: false` — page has no URL and does not exist for visitors, regardless of status
- `published: true` with `status: draft` — technically accessible via URL, but the workflow treats it as a draft

In practice, use `status` for editorial tracking and use `published: false` for pages that should be completely hidden.

## Scheduling

The admin panel supports scheduled publish and unpublish actions. These are stored as scheduled actions and applied by the Dune scheduler at the configured time.

Frontmatter equivalents:

```yaml
publish_date: "2025-12-01T09:00:00Z"    # Auto-publish at this time
unpublish_date: "2026-01-01T00:00:00Z"  # Auto-unpublish at this time
```

## Draft preview

Before publishing, editors can preview how a draft will look on the live site — with the active theme, layout, and styles applied — without making the page public.

### Creating a preview

From the page editor, save a draft and click **Preview Draft**. This generates a secure, shareable preview URL:

```
https://example.com/__preview?path=content%2Fblog%2Fmy-post%2Fdefault.md&token=abc123…
```

The URL can be shared with reviewers who don't have admin access — no login required.

### How it works

- Draft content (frontmatter + body) is saved to the staging area in `admin.runtimeDir` (default `.dune/admin/staging/`).
- A random opaque token is generated and tied to the draft. The token is preserved across subsequent saves so shared links remain valid.
- `GET /__preview` verifies the token and renders the draft through the active theme, with an orange "Draft preview" banner injected so viewers know the page is not live.
- Staging files are ephemeral — they live in `runtimeDir` and are not committed to version control.

### Publishing a staged draft

Clicking **Publish** in the panel writes the staged draft to the content files, records a revision, and optionally creates a git commit (see [Git auto-commit](#git-auto-commit) below). The staging file is removed after a successful publish.

### Git auto-commit

When `admin.git_commit: true` is set in your config, every page save and staged publish triggers a `git add` + `git commit` automatically:

```yaml
# dune.config.ts
export default {
  admin: {
    git_commit: true,
  },
};
```

The commit message includes the page path and the editor's username:

```
Admin: update content/blog/my-post/default.md (by jane)
```

Git must be available in the server's PATH. Commit failures are logged as warnings and do not block the save.

## Revision history

Every time a page is saved through the admin panel, a revision is recorded. Revisions store:
- Complete page content at that point in time
- Frontmatter snapshot
- Author who made the change
- Timestamp
- Optional change message

### Storage

Revisions are written to the runtime data directory (configured as `admin.runtimeDir`, default `.dune/admin`). Each page gets its own folder:

```
.dune/admin/history/{url-encoded-source-path}/{revision-number}.json
```

This directory is ephemeral — it should be in `.gitignore` and is not committed to version control.

> **⚠️ Deploy warning**: Because revisions live in `runtimeDir`, **they are not preserved across deployments to a fresh server**. Every cold deploy (new container, new VM, fresh clone) starts with an empty revision history. If you need persistent revision history across deploys, back up the `runtimeDir` before deployment and restore it after, or mount it on persistent storage.

### Capacity

Up to 50 revisions per page are kept by default. Older revisions are automatically pruned when a new save would exceed the limit. Configure the limit via `admin.maxRevisions`:

```yaml
admin:
  maxRevisions: 100   # keep more history (uses more disk)
```

### Accessing revisions

Revisions are accessible from the admin panel's page editor: open any page, then click **History** to browse the revision timeline, compare versions, and restore a previous version.

The admin panel also exposes revisions via its internal API (used by the panel UI):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/api/pages/{route}/history` | List all revisions for a page |
| `GET` | `/admin/api/pages/{route}/history/{n}` | Get a specific revision |
| `POST` | `/admin/api/pages/{route}/history/{n}/restore` | Restore revision `n` as the current content |

These endpoints require admin authentication (editor role or above).
