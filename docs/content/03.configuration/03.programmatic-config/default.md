---
title: "Programmatic Configuration"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [intermediate]
  topic: [configuration]
metadata:
  description: "Advanced configuration with dune.config.ts"
---

# Programmatic Configuration

For configuration that goes beyond YAML — computed values, environment-dependent logic, or TypeScript type safety — use `dune.config.ts`.

## Basic usage

```typescript
// dune.config.ts
import type { DuneConfig } from "dune";

export default {
  site: {
    title: "My Site",
    url: Deno.env.get("SITE_URL") ?? "http://localhost:8000",
  },
  system: {
    debug: Deno.env.get("DUNE_ENV") !== "production",
  },
} satisfies Partial<DuneConfig>;
```

## Async configuration

Export a function for async configuration (e.g., fetching secrets):

```typescript
// dune.config.ts
export default async function () {
  const apiKey = Deno.env.get("API_KEY");

  return {
    site: {
      metadata: {
        "analytics-id": apiKey ?? "",
      },
    },
  };
}
```

## When to use dune.config.ts

| Scenario | Use YAML | Use dune.config.ts |
|----------|----------|-------------------|
| Static values | ✓ | |
| Environment variables | ✓ (via env/ overrides) | ✓ (more flexible) |
| Computed values | | ✓ |
| Conditional logic | | ✓ |
| Type safety | | ✓ |
| External secrets | | ✓ |
| Non-developers manage it | ✓ | |

Most sites only need YAML. Use `dune.config.ts` when you outgrow it.

## Merge behavior

`dune.config.ts` is layer 4 in the merge hierarchy. It overrides YAML config but is itself overridden by page frontmatter. The merge is deep — you only need to specify the fields you want to change.
