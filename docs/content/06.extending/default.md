---
title: "Extending Dune"
published: true
visible: true
taxonomy:
  audience: [developer]
  difficulty: [advanced]
  topic: [extending, plugins]
metadata:
  description: "Extending Dune with plugins, hooks, and custom format handlers"
collection:
  items:
    "@self.children": true
  order:
    by: order
    dir: asc
---

# Extending Dune

Dune is designed to be extended. The hook system lets you intercept and modify behavior at every stage of the request lifecycle. Custom format handlers let you add new content types. Plugins bundle both into distributable packages.

## Extension points

| Extension | What it does | Complexity |
|-----------|-------------|------------|
| **Hooks** | Intercept lifecycle events (request, render, cache) | Low |
| **Format handlers** | Add new content formats (beyond .md and .tsx) | Medium |
| **Plugins** | Bundle hooks + config into reusable packages | Medium |
| **Theme components** | Custom templates, layouts, islands | Low-Medium |
