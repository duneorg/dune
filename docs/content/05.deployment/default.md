---
title: "Deployment"
published: true
visible: true
taxonomy:
  audience: [webmaster]
  difficulty: [intermediate]
  topic: [deployment]
metadata:
  description: "Deploying Dune to production"
collection:
  items:
    "@self.children": true
  order:
    by: order
    dir: asc
---

# Deployment

Dune is designed to deploy anywhere Deno runs — from a traditional VPS to Deno Deploy's global edge network.

## Deployment options

| Target | Command | Content source | Best for |
|--------|---------|----------------|----------|
| **Static hosts** | `dune build --static` | Files in `dist/` | Netlify, Cloudflare Pages, S3, GitHub Pages |
| **Deno Deploy** | `deployctl deploy` | Deno KV (synced) | Global edge, zero-ops |
| **VPS / Server** | `dune serve` | Local filesystem | Full control, existing infra |
| **Docker** | `dune serve` | Mounted volume | Containerised deployments |

## Quick deploy

### Static site (Netlify, Cloudflare Pages, S3, …)

```bash
# Generate the static site into dist/
dune build --static --base-url https://example.com

# Deploy (example: Netlify CLI)
netlify deploy --dir=dist --prod
```

See [Static Site Generation](/deployment/static) for full options including incremental builds and hybrid mode.

### Traditional server

```bash
# Build the content index
dune build

# Start the production server
DUNE_ENV=production dune serve
```

### Deno Deploy

```bash
# Sync local content to Deno KV
dune sync

# Deploy via GitHub integration or deployctl
deployctl deploy --project=my-site src/main.ts
```

The `dune sync` command pushes your local content files into Deno KV, enabling local authoring with edge serving.
