---
title: "Comments & Annotations"
published: true
visible: true
taxonomy:
  audience: [editor, developer]
  difficulty: [beginner]
  topic: [admin, comments, workflow]
metadata:
  description: "Page comments and editorial annotations for team collaboration — threaded replies, @mentions, and resolve workflow"
---

# Comments & Annotations

Dune's comment system lets your editorial team leave notes directly on pages in the admin panel. Comments are stored in `data/comments/` alongside your content, visible only inside the admin, and never exposed on the public site.

Because comment files are git-tracked, they survive deploys, appear in your repository history, and are included in content backups. They are the right place to record editorial decisions, flag issues for a teammate, and track sign-off across a review cycle.

## Leaving a comment

Open any page in the admin editor and find the **Comments** panel in the sidebar. Type your message and press **Post**. Comment bodies support Markdown formatting.

To reply to an existing comment, click **Reply** beneath it. Threads nest one level deep — replies to replies are not supported.

## @mentions

Type `@` followed by a username anywhere in your comment body to notify a team member. When the comment is saved, Dune extracts all usernames matching `[a-zA-Z0-9_-]+` and stores them in the `mentions` field. Mentioned users see an unread count badge in the admin navigation.

Editing a comment re-extracts mentions from the updated body, so adding or removing an `@username` from an edit is reflected immediately.

## Resolve workflow

Any team member can mark a comment thread as **resolved** to indicate the issue has been addressed or the discussion is closed. Resolved comments remain visible in the panel but are visually de-emphasised.

Resolving a comment sets `resolved: true` and records the resolver's username in `resolvedBy` and the resolution timestamp in `resolvedAt`. A resolved thread can be reopened by posting a reply or toggling the resolved state directly.

## Editing and deleting

Users can edit or delete their own comments. Users with the `editor` or `admin` role can edit or delete any comment on the site.

## Storage

| Data | Location | Persisted |
|------|----------|-----------|
| Comment records | `{admin.dataDir}/comments/{encodedPath}.json` | Yes — git-tracked |
| Mention read state | `{admin.runtimeDir}/mention-reads/{username}.json` | No — ephemeral |

`encodedPath` is derived from the page's `sourcePath` by replacing `/` with `__` and `.` with `-dot-`. For example, `02.blog/01.hello-world` becomes `02-dot-blog__01-dot-hello-world`.

Mention read state is machine-local and does not need to be committed or backed up.

## Comment structure

```typescript
interface PageComment {
  id: string;              // hex ID
  pageSourcePath: string;
  author: string;          // display name
  authorUsername: string;
  body: string;            // Markdown-compatible
  createdAt: number;       // Unix ms
  updatedAt: number;       // Unix ms
  resolved: boolean;
  resolvedBy?: string;     // username of resolver
  resolvedAt?: number;     // Unix ms
  parentId?: string;       // set on replies; omitted on top-level comments
  mentions?: string[];     // @usernames extracted at save time
}
```

## API reference

All endpoints require authentication. The `{path}` segment is the URL-encoded `sourcePath` of the page — for example, `02.blog%2F01.hello-world`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/api/pages/{path}/comments` | List all comments for a page. |
| `POST` | `/admin/api/pages/{path}/comments` | Create a new comment. |
| `PATCH` | `/admin/api/pages/{path}/comments/{id}` | Edit a comment body. Requires own comment or `editor`/`admin` role. |
| `DELETE` | `/admin/api/pages/{path}/comments/{id}` | Delete a comment. Requires own comment or `editor`/`admin` role. |
| `POST` | `/admin/api/pages/{path}/comments/{id}/resolve` | Toggle the resolved state of a comment. |
| `GET` | `/admin/api/comments/mentions` | List all @mentions for the authenticated user. |
| `POST` | `/admin/api/comments/mentions/read` | Mark a set of mention IDs as read. |

### Create a comment

```
POST /admin/api/pages/02.blog%2F01.hello-world/comments
```

```json
{
  "body": "This intro paragraph needs revision. @jane can you rewrite it?",
  "parentId": null
}
```

`parentId` is optional. Omit it or set it to `null` for a top-level comment. Set it to an existing comment's `id` to post a reply.

### List comments response

```json
{
  "items": [
    {
      "id": "a1b2c3d4e5f6",
      "pageSourcePath": "02.blog/01.hello-world",
      "author": "Bob Smith",
      "authorUsername": "bob",
      "body": "This intro needs revision. @jane can you rewrite it?",
      "createdAt": 1742000000000,
      "updatedAt": 1742000000000,
      "resolved": false,
      "mentions": ["jane"]
    }
  ],
  "total": 1
}
```

### Mentions

```
GET /admin/api/comments/mentions
```

Returns all comments in which the authenticated user is mentioned, each wrapped in a read-state envelope:

```json
[
  {
    "comment": {
      "id": "a1b2c3d4e5f6",
      "pageSourcePath": "02.blog/01.hello-world",
      "author": "Bob Smith",
      "authorUsername": "bob",
      "body": "This intro needs revision. @jane can you rewrite it?",
      "createdAt": 1742000000000,
      "updatedAt": 1742000000000,
      "resolved": false,
      "mentions": ["jane"]
    },
    "read": false
  }
]
```

To mark mentions as read, POST an array of comment IDs:

```
POST /admin/api/comments/mentions/read
```

```json
{ "ids": ["a1b2c3d4e5f6"] }
```
