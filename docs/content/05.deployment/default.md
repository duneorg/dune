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

| Target | Cache driver | Content source | Best for |
|--------|-------------|----------------|----------|
| **Deno Deploy** | `kv` | Deno KV (synced) | Global edge, zero-ops |
| **VPS / Server** | `filesystem` | Local filesystem | Full control, existing infra |
| **Docker** | `filesystem` | Mounted volume | Containerized deployments |

## Quick deploy

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
