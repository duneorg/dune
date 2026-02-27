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

This directory is ephemeral — it should be in `.gitignore` and is not committed to version control. Revisions are lost if the runtime directory is deleted.

### Capacity

Up to 50 revisions per page are kept. Older revisions are automatically pruned when a new revision would exceed the limit. The capacity is set by the `admin.runtimeDir` configuration and currently cannot be changed per-page.

### Accessing revisions

Revisions are accessible from the admin panel's page editor: open any page, then click **History** to browse the revision timeline, compare versions, and restore a previous version.

The admin panel also exposes revisions via its internal API (used by the panel UI):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/api/pages/{route}/history` | List all revisions for a page |
| `GET` | `/admin/api/pages/{route}/history/{n}` | Get a specific revision |
| `POST` | `/admin/api/pages/{route}/history/{n}/restore` | Restore revision `n` as the current content |

These endpoints require admin authentication (editor role or above).
