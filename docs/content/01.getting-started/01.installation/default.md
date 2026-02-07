---
title: "Installation"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [beginner]
  topic: [setup]
metadata:
  description: "Install Deno and create your first Dune project"
---

# Installation

## Install Deno

Dune runs on Deno 2.x. If you don't have it yet:

```bash
# macOS / Linux
curl -fsSL https://deno.land/install.sh | sh

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex

# Homebrew
brew install deno
```

Verify your installation:

```bash
deno --version
# deno 2.x.x
```

## Create a new site

```bash
dune new my-site
cd my-site
```

This scaffolds a minimal Dune site:

```
my-site/
├── dune.config.ts          # Site configuration (programmatic)
├── content/                # Your content lives here
│   └── 01.home/
│       └── default.md      # Your homepage
├── config/
│   ├── site.yaml           # Site identity (title, URL, taxonomies)
│   └── system.yaml         # Engine behavior (cache, debug, languages)
└── themes/
    └── default/            # Starter theme with JSX templates
        ├── templates/
        │   └── default.tsx
        └── theme.yaml
```

## Start the dev server

```bash
dune dev
```

Open `http://localhost:8000`. You should see your homepage.

The dev server watches for changes — edit `content/01.home/default.md` and your browser will refresh automatically.

## What just happened?

1. Dune scanned the `content/` directory and built a **content index** — a lightweight map of every page, its route, and its frontmatter
2. It loaded `config/site.yaml` and `config/system.yaml`, merging them with defaults
3. It started a Fresh 2 server with a catch-all route that resolves URLs against the content index
4. When you visited `/`, Dune found `01.home/default.md`, loaded its Markdown, rendered it to HTML, and injected it into the `default.tsx` template from your theme
