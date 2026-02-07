---
title: "Hook System"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [advanced]
  topic: [extending, hooks]
metadata:
  description: "Intercepting Dune's lifecycle with hooks"
---

# Hook System

Hooks let you run code at specific points in Dune's lifecycle — when a page loads, before rendering, after cache events, and more.

## Available hooks

### Startup hooks

| Hook | When it fires | Use case |
|------|--------------|----------|
| `onConfigLoaded` | Config fully merged and validated | Modify config, set up external services |
| `onStorageReady` | Storage adapter initialized | Verify connectivity, warm caches |
| `onContentIndexReady` | Content index built/loaded | Build search index, generate sitemap |

### Request lifecycle hooks

| Hook | When it fires | Use case |
|------|--------------|----------|
| `onRequest` | Incoming request (before routing) | Analytics, auth, rate limiting |
| `onRouteResolved` | Route matched to a page | URL rewriting, A/B testing |
| `onPageLoaded` | Full page object loaded | Content transformation |
| `onCollectionResolved` | Collection query executed | Modify collection results |
| `onBeforeRender` | Before JSX rendering | Inject data, modify props |
| `onAfterRender` | After rendering (HTML available) | Post-processing, minification |
| `onResponse` | Before response sent | Headers, compression |

### Content processing hooks

| Hook | When it fires | Use case |
|------|--------------|----------|
| `onMarkdownProcess` | Before markdown → HTML | Custom syntax, shortcodes |
| `onMarkdownProcessed` | After markdown → HTML | HTML post-processing |
| `onMediaDiscovered` | Media files found for page | Image optimization triggers |

### Cache hooks

| Hook | When it fires | Use case |
|------|--------------|----------|
| `onCacheHit` | Serving from cache | Analytics, cache headers |
| `onCacheMiss` | Cache miss, will process | Performance monitoring |
| `onCacheInvalidate` | Cache entry invalidated | CDN purging |

### API hooks

| Hook | When it fires | Use case |
|------|--------------|----------|
| `onApiRequest` | Before API request is handled | Auth, rate limiting, request logging |
| `onApiResponse` | After API response is built | Response transformation, headers |

## Registering hooks

```typescript
// plugins/my-hooks.ts
import type { DunePlugin } from "dune/types";

export default {
  name: "my-hooks",
  version: "1.0.0",
  hooks: {
    onRequest: async ({ data, config }) => {
      // Log every request
      console.log(`[${new Date().toISOString()}] ${data.req.method} ${data.req.url}`);
    },

    onMarkdownProcess: async ({ data, setData }) => {
      // Replace custom shortcodes before markdown processing
      const modified = data.raw.replace(
        /\{\{youtube\s+(\w+)\}\}/g,
        '<iframe src="https://youtube.com/embed/$1"></iframe>',
      );
      setData({ ...data, raw: modified });
    },

    onAfterRender: async ({ data }) => {
      // Add reading time to rendered HTML
      const wordCount = data.html.split(/\s+/).length;
      const minutes = Math.ceil(wordCount / 200);
      data.html = data.html.replace(
        "</article>",
        `<p class="reading-time">${minutes} min read</p></article>`,
      );
    },
  },
} satisfies DunePlugin;
```

## Hook context

Every hook handler receives a `HookContext` object:

```typescript
interface HookContext<T> {
  event: HookEvent;           // which hook is firing
  data: T;                    // event-specific data
  config: DuneConfig;         // full merged config
  storage: StorageAdapter;    // storage access
  stopPropagation(): void;    // stop further hooks for this event
  setData(data: T): void;     // replace event data
}
```

`stopPropagation()` prevents subsequent hooks from running for this event. Use it when a hook fully handles something (like a custom 404 page or an auth redirect).

`setData()` replaces the data flowing through the hook chain. The next hook receives the modified data.

## Hook execution order

Hooks fire in the order they're registered. If multiple plugins register the same hook, they run sequentially. Each hook sees the data as modified by previous hooks.
