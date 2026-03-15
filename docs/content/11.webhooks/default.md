---
title: "Webhooks"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [webhooks, integrations, admin]
metadata:
  description: "Outbound webhooks for content mutation events — page create, update, delete, and workflow changes"
---

# Webhooks

Dune can POST a JSON payload to one or more URLs whenever content changes. Use webhooks to trigger external builds, invalidate CDN caches, notify Slack channels, or feed events into any other system.

Webhooks fire asynchronously and never block the editor's HTTP response.

## Configuration

Define webhook endpoints in the `admin.webhooks` array in your site configuration. Each entry is a `WebhookEndpointConfig` object.

```yaml
# site.config.yaml
admin:
  webhooks:
    - url: "https://api.example.com/hooks/pages"
      label: "Page change notifier"
      events:
        - onPageCreate
        - onPageUpdate

    - url: "https://hooks.example.com/all-events"
      label: "Full event sink"
      secret: "$WEBHOOK_SECRET_ALL"
      events:
        - onPageCreate
        - onPageUpdate
        - onPageDelete
        - onWorkflowChange
```

The second endpoint reads its signing secret from the `WEBHOOK_SECRET_ALL` environment variable. Any `secret` value prefixed with `$` is resolved from the environment at startup — the raw value is never written to disk or logs.

### Endpoint options

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `url` | `string` | Yes | — | The URL that receives POST requests. |
| `events` | `string[]` | Yes | — | One or more event names that trigger this endpoint. |
| `secret` | `string` | No | — | HMAC-SHA256 signing secret. Supports `"$ENV_VAR"` expansion. |
| `enabled` | `boolean` | No | `true` | Set to `false` to temporarily disable an endpoint without removing it. |
| `label` | `string` | No | — | Human-readable name shown in delivery logs. |

## Event reference

| Event | Fires when | Payload shape |
|-------|-----------|---------------|
| `onPageCreate` | A new page is created and the content index has been rebuilt. | `{ sourcePath: string, title: string }` |
| `onPageUpdate` | A page is saved. | `{ sourcePath: string, title: string }` |
| `onPageDelete` | A page is deleted. | `{ sourcePath: string }` |
| `onWorkflowChange` | A page's workflow status changes. | `{ sourcePath: string, from: WorkflowStatus, to: WorkflowStatus }` |

`WorkflowStatus` is one of: `"draft"`, `"in_review"`, `"published"`, `"archived"`.

## Request format

Every delivery is a `POST` with the following headers:

```
Content-Type: application/json; charset=utf-8
User-Agent: Dune-CMS/0.4
X-Dune-Signature: sha256=<hex>    (only present when a secret is configured)
```

The body is a JSON object containing the event name, the event-specific payload, and a UTC timestamp:

```json
{
  "event": "onPageUpdate",
  "payload": {
    "sourcePath": "02.blog/01.hello-world",
    "title": "Hello World"
  },
  "sentAt": "2026-03-15T10:42:00.000Z"
}
```

`sentAt` is an ISO 8601 timestamp in UTC. The shape of `payload` varies by event — see the event reference table above.

## Signature verification

When a `secret` is configured, Dune computes an HMAC-SHA256 digest of the raw request body and sends it as the `X-Dune-Signature` header in the format `sha256=<hex>`.

Always verify this signature on your receiving end before trusting the payload.

```ts
import { createHmac } from "node:crypto";

function verifySignature(body: string, secret: string, header: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return expected === header;
}
```

Compute the digest from the **raw request body bytes** before any JSON parsing. Parsing and re-serializing can produce a different byte sequence if the JSON has been reformatted, which will cause the comparison to fail even for legitimate requests.

## Retry behaviour

Webhook delivery is fire-and-forget with automatic retries. Any `2xx` HTTP response is treated as success.

| Attempt | Delay before attempt |
|---------|---------------------|
| 1 | Immediate |
| 2 | 1 second |
| 3 | 5 seconds |
| 4 | 25 seconds |

After four attempts with no success, Dune logs a warning and discards the delivery. Failures are never surfaced to the editor making the content change.

## Delivery logs

Every delivery attempt is written to disk at:

```
{admin.runtimeDir}/webhook-logs/{YYYY-MM-DD}/{id}.json
```

Each log file is a delivery record:

```json
{
  "id": "a1b2c3d4",
  "endpointUrl": "https://api.example.com/hooks/pages",
  "endpointLabel": "Page change notifier",
  "event": "onPageUpdate",
  "payload": { "sourcePath": "02.blog/01.hello-world", "title": "Hello World" },
  "attempts": [
    {
      "attemptNumber": 1,
      "timestamp": "2026-03-15T10:42:00.123Z",
      "statusCode": 503,
      "success": false
    },
    {
      "attemptNumber": 2,
      "timestamp": "2026-03-15T10:42:01.456Z",
      "statusCode": 200,
      "success": true
    }
  ],
  "finalStatus": "success",
  "createdAt": 1742032920000
}
```

`finalStatus` is one of `"success"`, `"failed"`, or `"pending"`. An `errorMessage` field is added to an attempt when a network error occurred rather than an HTTP error response.

### Querying delivery logs via the Admin API

```
GET /admin/api/webhooks/deliveries
```

Returns the 50 most recent delivery records from the last 7 days, newest first. Requires authentication with the `pages.read` permission (any authenticated user with at least the `author` role).

## Security

**Verify signatures in production.** Any endpoint exposed to the internet should validate `X-Dune-Signature` on every request. Requests without a valid signature should be rejected with `401`.

**Use HTTPS endpoints only.** Plain HTTP endpoints transmit payloads — and, in a misconfigured setup, signing secrets — in the clear.

**Use environment variables for secrets.** Set `secret: "$MY_SECRET"` in the config and define the value in your deployment environment. This keeps secrets out of your repository and out of any config files committed to version control.
