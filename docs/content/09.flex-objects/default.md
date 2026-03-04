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

Each Flex Object **type** is defined by a YAML schema file and gets its own admin UI section and REST API endpoint automatically. Records are stored as flat YAML files on disk.

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

**Product catalogue** — define fields like `name`, `price`, `sku`, `images`, `category`, `published`. Query via `/api/flex/products` in your theme templates.

**Team members** — fields for `name`, `role`, `bio`, `photo`, `linkedin`. Render a team page by fetching `/api/flex/team`.

**Events** — `title`, `date`, `location`, `description`, `capacity`, `tickets_url`. Sort by date in your theme using the response array.

**FAQs** — `question`, `answer` (markdown), `category`, `order`. Group by category in your template.

## Filtering and sorting

The `/api/flex/{type}` endpoint returns all records in creation order (newest first). Filtering and sorting are done in your theme code or frontend layer after fetching the full list. For large datasets, consider using a [collection query](/reference/api#collections) if your data lives in the content tree instead.
