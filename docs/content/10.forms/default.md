---
title: "Forms"
published: true
visible: true
taxonomy:
  audience: [webmaster, developer]
  difficulty: [intermediate]
  topic: [forms, content]
metadata:
  description: "Blueprint-driven contact forms with validation, file uploads, and email/webhook notifications"
---

# Forms

Dune includes a blueprint-driven form system. You define forms as YAML files and the engine handles validation, spam protection, file uploads, email notifications, and submission storage — no backend code required.

## Creating a form

Create a YAML file in the `forms/` directory at your site root:

```
forms/
  contact.yaml
  job-application.yaml
  newsletter.yaml
```

Each file defines one form. The filename (without extension) is the form's identifier.

### Basic example

```yaml
# forms/contact.yaml
title: "Contact Us"
success_url: "/contact/thanks"
honeypot: _email_confirm   # hidden field — bots fill it, humans don't

fields:
  name:
    type: text
    label: "Your name"
    required: true
    minlength: 2

  email:
    type: email
    label: "Email address"
    required: true

  subject:
    type: select
    label: "Subject"
    required: true
    options:
      general: "General enquiry"
      support: "Technical support"
      billing: "Billing question"

  message:
    type: textarea
    label: "Message"
    required: true
    minlength: 20
    maxlength: 5000
```

### With notifications

```yaml
# forms/contact.yaml
title: "Contact Us"
success_url: "/thanks"

notifications:
  email: "hello@example.com"        # override To: for this form only
  webhook: "https://hooks.example.com/contact"   # POST JSON payload

fields:
  # ...
```

The `notifications.email` value overrides the `To:` address for this specific form — the global SMTP configuration (host, port, credentials) is still used. Configure global SMTP in your admin settings.

## Field types

| Type | Description |
|------|-------------|
| `text` | Single-line text input |
| `email` | Email address (validated format) |
| `tel` | Phone number |
| `textarea` | Multi-line text |
| `number` | Numeric input |
| `select` | Dropdown — requires `options` map |
| `checkbox` | Boolean on/off |
| `file` | File upload |
| `hidden` | Hidden field with a fixed value |

## Field options

| Option | Types | Description |
|--------|-------|-------------|
| `label` | all | Human-readable label |
| `required` | all | Field must be present and non-empty |
| `minlength` | text, email, tel, textarea | Minimum character count |
| `maxlength` | text, email, tel, textarea | Maximum character count |
| `min` | number | Minimum numeric value |
| `max` | number | Maximum numeric value |
| `pattern` | text, email, tel | Regex the value must match |
| `options` | select | Map of `value: label` pairs |
| `value` | hidden | Fixed value for hidden fields |

## The API endpoint

Each form in `forms/` is automatically served at two endpoints:

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/forms/{name}` | Returns the public form schema as JSON |
| `POST` | `/api/forms/{name}` | Submits the form |

### GET — fetch schema

```http
GET /api/forms/contact
```

```json
{
  "title": "Contact Us",
  "success_url": "/thanks",
  "honeypot": "_email_confirm",
  "fields": {
    "name": { "type": "text", "label": "Your name", "required": true, "minlength": 2 },
    "email": { "type": "email", "label": "Email address", "required": true },
    "message": { "type": "textarea", "label": "Message", "required": true }
  }
}
```

Sensitive keys (`notifications.email`, `notifications.webhook`) are omitted from the public schema.

### POST — submit

Send `multipart/form-data` (required for file uploads) or `application/x-www-form-urlencoded`:

```html
<form method="POST" action="/api/forms/contact" enctype="multipart/form-data">
  <input type="text" name="name" required>
  <input type="email" name="email" required>
  <textarea name="message" required></textarea>
  <!-- Honeypot: hide this with CSS, don't remove it -->
  <input type="text" name="_email_confirm" style="display:none" tabindex="-1" autocomplete="off">
  <button type="submit">Send</button>
</form>
```

**Success response** (`303 See Other`):

```
Location: /thanks
```

**Validation error response** (`422 Unprocessable Entity`):

```json
{
  "errors": [
    { "field": "email", "message": "Invalid email address" },
    { "field": "message", "message": "Must be at least 20 characters" }
  ]
}
```

**Rate limit response** (`429 Too Many Requests`):

```json
{ "error": "Too many submissions — please wait before trying again" }
```

## Accessing submissions

All submissions are stored in `admin.dataDir` (default `data/`) and are viewable from the admin panel under **Form Submissions**. Each submission records:

- Timestamp
- IP address (hashed for privacy)
- All submitted field values
- Any uploaded file references

Submissions are stored as JSON in `data/submissions/{form-name}/`. This directory is git-tracked, so submissions are preserved across deploys.

## Spam protection

Dune applies two spam prevention layers:

**Honeypot field**: Add a `honeypot` key to your form definition. The engine generates a hidden field with that name. Automated bots typically fill every field — if the honeypot field is non-empty, the submission is silently rejected (returns success to avoid training bots).

**Rate limiting**: A per-IP rate limit is applied to all form submissions. By default, submissions from the same IP are limited to a few requests per minute.

## File uploads

Add a `file` field to accept attachments:

```yaml
fields:
  resume:
    type: file
    label: "Upload your CV"
    required: true
```

Uploaded files are stored in `admin.dataDir/uploads/` and referenced from the submission record by filename. The admin panel displays uploaded files with download links.

> **Note**: There is currently no built-in file size or type restriction in the form schema — apply restrictions at the infrastructure level (reverse proxy upload size limits) or validate in a `onApiRequest` hook.

## Using forms with JavaScript

For single-page applications or fetch-based submissions, you can use the JSON API directly:

```javascript
// Fetch the form schema
const schema = await fetch("/api/forms/contact").then(r => r.json());

// Build FormData from user input
const body = new FormData();
body.append("name", "Jane Smith");
body.append("email", "jane@example.com");
body.append("message", "Hello from the JS client!");

// Submit
const res = await fetch("/api/forms/contact", { method: "POST", body });

if (res.status === 303) {
  // Success — redirect to success_url or show inline message
  window.location.href = schema.success_url ?? "/";
} else if (res.status === 422) {
  const { errors } = await res.json();
  // Display field errors
}
```

## Disabling a form

Remove the YAML file to disable a form entirely — requests to its endpoint will return `404`. There is no `enabled: false` toggle; the presence of the file is the gate.
