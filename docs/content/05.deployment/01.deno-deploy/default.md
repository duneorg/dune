---
title: "Deno Deploy"
published: true
visible: true
taxonomy:
  audience: [webmaster]
  difficulty: [intermediate]
  topic: [deployment, deno-deploy]
metadata:
  description: "Deploying Dune to Deno Deploy's global edge network"
---

# Deno Deploy

Deno Deploy runs your site on a global edge network — your content is served from the region closest to each visitor.

## How it works

1. You write and preview content locally (filesystem)
2. `dune sync` pushes content into Deno KV
3. Deno Deploy reads from KV, serves globally
4. Content index and taxonomy map are cached in KV

## Setup

### 1. Configure for KV storage

`config/env/production/system.yaml`:
```yaml
cache:
  driver: "kv"
  check: "hash"
```

Dune auto-detects Deno Deploy via the `DENO_DEPLOYMENT_ID` environment variable. When present, it switches to the KV storage adapter automatically.

### 2. Sync content

```bash
dune sync
```

This scans your local `content/` directory and pushes every file — content, media, and metadata — into Deno KV with the appropriate key schema.

### 3. Deploy

Connect your GitHub repo to Deno Deploy, or use `deployctl`:

```bash
deployctl deploy --project=my-site --prod src/main.ts
```

## Updating content

After editing content locally:

```bash
# Preview locally
dune dev

# Sync to production
dune sync

# Changes are live immediately — no redeploy needed
```

Because content lives in KV (not in the deployed code), `dune sync` updates your site without triggering a new deployment. This is ideal for content-heavy sites where the code rarely changes but content updates frequently.

## Environment auto-detection

Dune detects it's running on Deno Deploy and adjusts automatically:

- Storage adapter → KV adapter
- Cache driver → KV
- File watching → disabled (not applicable on edge)
- Environment → `"production"` (unless `DUNE_ENV` is set)
