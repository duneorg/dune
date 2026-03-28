---
title: "Audit Log"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [administration, security, compliance]
metadata:
  description: "Track every admin action — who did what, when, and from where — with Dune's append-only audit log"
---

# Audit Log

The audit log records every significant action performed through the admin panel: page changes, user management, configuration updates, media operations, and system events. Each entry captures the actor, timestamp, IP address, and outcome.

Audit logging is **enabled by default** and writes to an append-only JSONL file in the server's runtime directory.

---

## Viewing the audit log

Navigate to **Admin → Audit Log** to see a filterable table of recent events.

The table shows:

| Column | Description |
|--------|-------------|
| **Timestamp** | When the action occurred (local time) |
| **Event** | The action type (e.g. `page.update`) |
| **Actor** | Username of the admin who performed the action |
| **Target** | Resource affected (page path, user ID, etc.) |
| **IP** | Client IP address |
| **Outcome** | `success` or `failure` |

Use the filter controls to narrow by event type or actor.

---

## Configuration

```yaml
# config/admin.yaml (or admin: block in dune.config.ts)
admin:
  audit:
    enabled: true          # boolean — Enable audit logging (default: true)
    logFile: "audit.log"   # string  — Log file path, relative to runtimeDir (default: "audit.log")
```

The default log file is `{runtimeDir}/audit.log` (typically `.dune/admin/audit.log`). This path is outside version control and persists across restarts.

To disable audit logging entirely:

```yaml
admin:
  audit:
    enabled: false
```

---

## Logged events

| Event | Trigger |
|-------|---------|
| `auth.login` | Successful login |
| `auth.login_failed` | Failed login attempt |
| `auth.logout` | Logout |
| `page.create` | Page created |
| `page.update` | Page content or frontmatter saved |
| `page.delete` | Page deleted |
| `page.publish` | Page published (workflow transition) |
| `page.workflow` | Workflow status changed |
| `config.update` | Site, system, or theme config saved |
| `user.create` | Admin user created |
| `user.update` | Admin user updated |
| `user.delete` | Admin user deleted |
| `user.password` | Password changed |
| `media.upload` | File uploaded |
| `media.delete` | File deleted |
| `plugin.config_update` | Plugin configuration saved |
| `flex.create` | Flex object created |
| `flex.update` | Flex object updated |
| `flex.delete` | Flex object deleted |
| `system.rebuild` | Content re-indexed (via incoming webhook or manual trigger) |
| `system.cache_purge` | Image/page cache cleared |

---

## REST API

The audit log is accessible via the admin API. Requires **admin role**.

### Query entries

```
GET /admin/api/audit
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Entries per page (max 200, default 50) |
| `offset` | number | Pagination offset (default 0) |
| `event` | string | Filter by event type (e.g. `page.update`) |
| `actorId` | string | Filter by user ID |
| `from` | ISO date | Entries at or after this date |
| `to` | ISO date | Entries at or before this date |
| `outcome` | string | `success` or `failure` |

**Response:**

```json
{
  "entries": [
    {
      "id": "3f2a1b4c-...",
      "ts": "2026-03-28T14:32:11.042Z",
      "event": "page.update",
      "actor": {
        "userId": "u_1",
        "username": "alice",
        "name": "Alice Smith"
      },
      "ip": "203.0.113.42",
      "userAgent": "Mozilla/5.0 ...",
      "target": {
        "type": "page",
        "id": "content/blog/my-post/default.md"
      },
      "detail": {},
      "outcome": "success"
    }
  ],
  "total": 847
}
```

---

## Log file format

The log file is plain **JSONL** (one JSON object per line). This makes it easy to process with standard tools:

```bash
# Show all failed login attempts
grep '"event":"auth.login_failed"' .dune/admin/audit.log | jq .

# Count events by type
jq -r '.event' .dune/admin/audit.log | sort | uniq -c | sort -rn

# All actions by a specific user
jq 'select(.actor.username == "alice")' .dune/admin/audit.log
```

The log is **append-only** — entries are never modified or deleted by Dune. Rotate or archive it externally if needed.

---

## Notes

- Audit log access via the admin UI and API is restricted to the **admin role**.
- System events (`system.rebuild`, `system.cache_purge`) triggered by incoming webhooks are logged with `actor: null`.
- Login failures record the attempted username in `detail.username` to help identify brute-force attempts.
- Audit logging is fire-and-forget — a log write failure never fails the underlying admin action.
