---
title: "Flex Objects"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [flex-objects, content]
metadata:
  description: "Schema-driven custom data types outside the content tree — products, team members, events, and more"
---

# Flex Objects

Flex Objects are schema-driven custom data types that live outside the normal page tree. Where pages represent documents with routes and templates, Flex Objects represent structured records: product catalogues, team member lists, event schedules, FAQs — anything that doesn't map naturally to a URL hierarchy.

## How it works

Each Flex Object **type** is defined by a YAML schema file and gets its own admin UI section, REST API endpoints, public URL routes, and collection query support — automatically. Records are stored as flat YAML files on disk.

```
flex-objects/
  products.yaml          ← schema definition
  products/
    a3f2c19d0e8b.yaml    ← individual records
    7b91e4f23c12.yaml
  team.yaml
  team/
    ...
```

## Defining a schema

Create a YAML file in the `flex-objects/` directory at your project root. The filename (without `.yaml`) becomes the type name used in the admin UI and API.

```yaml
# flex-objects/products.yaml
title: Products
icon: 🛍️
description: Product catalogue entries

fields:
  name:
    type: text
    label: Product Name
    required: true
    validate:
      max: 120
  price:
    type: number
    label: Price (CHF)
    required: true
    validate:
      min: 0
  description:
    type: textarea
    label: Description
  category:
    type: select
    label: Category
    options:
      mugs: Mugs
      prints: Prints
      accessories: Accessories
  published:
    type: toggle
    label: Published
    default: true
  tags:
    type: list
    label: Tags
```

### Schema properties

| Property | Required | Description |
|----------|----------|-------------|
| `title` | Yes | Human-readable type name shown in the admin sidebar. |
| `icon` | No | Emoji or short string used as the sidebar icon. |
| `description` | No | Short description shown on the type list page. |
| `fields` | Yes | Map of field name → field definition. |

## Field types

Flex Object fields use the same type system as [Blueprint fields](/extending/blueprints). Every type supports `label`, `required`, and `default`.

| Type | Stored as | Description |
|------|-----------|-------------|
| `text` | string | Single-line text input. |
| `textarea` | string | Multi-line text area. |
| `markdown` | string | Markdown editor with preview. |
| `number` | number | Numeric input. |
| `toggle` | boolean | On/off switch. |
| `date` | string (YYYY-MM-DD) | Date picker. |
| `select` | string | Dropdown — requires `options` map. |
| `list` | string[] | Ordered list of text values. |
| `file` | string | File path or URL. |
| `color` | string | Colour picker (#rrggbb or CSS value). |

### Field options

All fields accept:

```yaml
my_field:
  type: text
  label: My Field       # displayed in the admin form
  required: true        # validation: must be non-empty on save
  default: hello        # pre-filled value for new records
```

**`select` fields** require an `options` map (value → label):

```yaml
status:
  type: select
  label: Status
  options:
    draft: Draft
    published: Published
    archived: Archived
```

**`validate` block** for additional constraints:

```yaml
price:
  type: number
  label: Price
  validate:
    min: 0       # minimum value (number) or minimum length (text/list)
    max: 9999    # maximum value or maximum length

slug:
  type: text
  label: Slug
  validate:
    pattern: "^[a-z0-9-]+$"   # regex the value must match
```

## Admin UI

Once a schema file exists, a **Flex Objects** section appears in the admin sidebar (🗃️). Clicking it lists all defined types. From there you can:

- **Browse records** — a table auto-generated from the first few non-markdown fields.
- **Create records** — a form auto-generated from the schema fields.
- **Edit records** — same form, pre-populated with existing values.
- **Delete records** — with a confirmation prompt.

The admin UI requires authentication. `editor` and `admin` roles can create and edit records. The `author` role has read access only.

## REST API

Flex Object records are exposed as read-only endpoints on the public REST API.

### List all records

```
GET /api/flex/{type}
```

Returns all records for the type, sorted newest first (by creation time).

```json
[
  {
    "_id": "a3f2c19d0e8b",
    "_type": "products",
    "_createdAt": 1741234567890,
    "_updatedAt": 1741234567890,
    "name": "Ceramic Mug",
    "price": 24.00,
    "category": "mugs",
    "published": true,
    "tags": ["handmade", "ceramic"]
  }
]
```

Returns `404` if the type schema does not exist. Returns an empty array if the type exists but has no records.

### Get a single record

```
GET /api/flex/{type}/{id}
```

Returns one record by its 12-character ID.

```json
{
  "_id": "a3f2c19d0e8b",
  "_type": "products",
  "_createdAt": 1741234567890,
  "_updatedAt": 1741234567890,
  "name": "Ceramic Mug",
  "price": 24.00,
  "category": "mugs",
  "published": true,
  "tags": ["handmade", "ceramic"]
}
```

Returns `404` if the type or record does not exist.

## Using in collection queries

Flex Objects integrate with the standard collection system using the `@flex` source key. This lets any page render a list of flex records using exactly the same template patterns as page collections.

```yaml
# In any page's frontmatter (e.g. content/products/default.md)
collection:
  items:
    "@flex": products
  order:
    by: date
    dir: desc
  limit: 12
```

In the theme template, access records through `collection.items` — each item exposes all user-defined fields through `page.frontmatter.*`:

```tsx
// themes/default/templates/product-list.tsx
export default function ProductList({ page, collection }: TemplateProps) {
  return (
    <div class="product-grid">
      {collection?.items.map((item) => (
        <a key={item.frontmatter._id} href={`/flex/products/${item.frontmatter._id}`}>
          <h2>{item.frontmatter.name}</h2>
          <p>CHF {item.frontmatter.price}</p>
        </a>
      ))}
    </div>
  );
}
```

The `@flex` source also supports the standard `filter`, `order`, `limit`, `offset`, and `pagination` modifiers. Flex records without an explicit `published` field are treated as published.

## Public routes and theme templates

Every Flex Object type automatically gets two public-facing URLs that themes can style. No configuration required — they are active as soon as a schema file exists.

| URL | Purpose |
|-----|---------|
| `/flex/{type}` | List all records of a type |
| `/flex/{type}/{id}` | Show a single record |

### Theme templates

Place TSX template files in your theme's `templates/flex/` directory. The routing layer looks for type-specific templates first, then falls back to generic ones:

**List view** (`/flex/products` looks for, in order):
1. `themes/{theme}/templates/flex/products-list.tsx`
2. `themes/{theme}/templates/flex/list.tsx`
3. Built-in auto-generated table (always works, no template needed)

**Detail view** (`/flex/products/{id}` looks for, in order):
1. `themes/{theme}/templates/flex/products.tsx`
2. `themes/{theme}/templates/flex/detail.tsx`
3. Built-in auto-generated key/value page

### Template props

List templates receive `FlexListTemplateProps`:

```tsx
// themes/default/templates/flex/products-list.tsx
import type { FlexListTemplateProps } from "@dune/routing";

export default function ProductList({
  type,      // "products"
  schema,    // FlexSchema — title, icon, fields definition
  records,   // FlexRecord[] — all records, newest first
  site,
  config,
  nav,
  Layout,
  t,
}: FlexListTemplateProps) {
  return (
    <Layout page={null} site={site} nav={nav} pageTitle={schema.title}>
      <h1>{schema.icon} {schema.title}</h1>
      {records.map((r) => (
        <div key={r._id}>
          <a href={`/flex/${type}/${r._id}`}>{String(r.name ?? r._id)}</a>
          <span>CHF {String(r.price ?? "")}</span>
        </div>
      ))}
    </Layout>
  );
}
```

Detail templates receive `FlexDetailTemplateProps`:

```tsx
// themes/default/templates/flex/products.tsx
import type { FlexDetailTemplateProps } from "@dune/routing";

export default function ProductDetail({
  type,
  schema,
  record,   // FlexRecord — the single record
  site,
  nav,
  Layout,
}: FlexDetailTemplateProps) {
  return (
    <Layout page={null} site={site} nav={nav} pageTitle={String(record.name ?? record._id)}>
      <h1>{String(record.name)}</h1>
      <p>{String(record.description ?? "")}</p>
      <strong>CHF {String(record.price)}</strong>
    </Layout>
  );
}
```

Both prop types also include `pathname` (current URL path) and `t` (locale translation function).

## Record format on disk

Each record is a YAML file named `{id}.yaml`. The `_id`, `_createdAt`, and `_updatedAt` fields are managed automatically — do not edit them by hand.

```yaml
# flex-objects/products/a3f2c19d0e8b.yaml
_id: a3f2c19d0e8b
_createdAt: 1741234567890
_updatedAt: 1741234901234
category: mugs
description: A hand-thrown ceramic mug in matte white glaze.
name: Ceramic Mug
price: 24
published: true
tags:
  - handmade
  - ceramic
```

User-defined fields are stored alphabetically after the meta fields. The `_type` field is **not** stored — it is derived from the directory name at read time.

## Example use cases

**Product catalogue** — fields: `name`, `price`, `sku`, `category`, `published`. Use `@flex: products` in a collection to render a paginated product listing page, and `/flex/products/{id}` for detail pages.

**Team members** — fields: `name`, `role`, `bio`, `photo`, `linkedin`. Add `@flex: team` to the About page frontmatter to embed team members inline, or create a dedicated team page template.

**Events** — fields: `title`, `date`, `location`, `description`, `capacity`, `tickets_url`. Order by `date: asc` in the collection definition to list upcoming events chronologically.

**FAQs** — fields: `question`, `answer` (markdown type), `category`. Query all FAQs with `@flex: faq` in a page collection, then group by `category` in the template.

## Filtering and sorting

The `/api/flex/{type}` REST endpoint returns all records in creation order (newest first). For collection queries (`@flex`), the standard `order` and `filter` modifiers apply.

Filtering by specific field values (e.g. only published products, only events in a given category) is done in your template after loading the collection items, using the `collection.filter()` chainable method or plain JavaScript array methods. For complex filtering needs on large datasets, consider storing the data as pages instead to take advantage of the full taxonomy and frontmatter filter system.
