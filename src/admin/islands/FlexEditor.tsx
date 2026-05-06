/** @jsxImportSource preact */
/**
 * Island: schema-driven flex object record editor.
 * Talks to /admin/api/flex/:type and /admin/api/flex/:type/:id.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface FieldDef {
  type: string;
  label: string;
  required?: boolean;
  default?: unknown;
  options?: Record<string, string>;
}

interface Schema {
  type: string;
  label?: string;
  fields: Record<string, FieldDef>;
}

interface Props {
  type: string;
  id: string;       // "new" or existing ID
  schema: unknown;
  record: unknown;
  prefix: string;
}

export default function FlexEditor({ type, id, schema, record, prefix }: Props) {
  const apiBase = `${prefix}/api`;
  const schemaDef = schema as Schema;
  const isNew = id === "new";

  // Initialize form from existing record or field defaults
  const initValues = (): Record<string, unknown> => {
    const existing = (record as Record<string, unknown>) ?? {};
    const vals: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schemaDef.fields ?? {})) {
      vals[key] = existing[key] ?? field.default ?? "";
    }
    return vals;
  };

  const [values, setValues] = useState<Record<string, unknown>>(initValues);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function setField(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      let res: Response;
      if (isNew) {
        res = await fetch(`${apiBase}/flex/${type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(values),
        });
      } else {
        res = await fetch(`${apiBase}/flex/${type}/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
          body: JSON.stringify(values),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      if (isNew) {
        const d = await res.json() as { id: string };
        location.href = `${prefix}/flex/${type}/${d.id}`;
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!confirm(`Delete this ${schemaDef.label ?? type} record? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`${apiBase}/flex/${type}/${id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": getCsrf() },
      });
      location.href = `${prefix}/flex/${type}`;
    } finally {
      setDeleting(false);
    }
  }

  const fields = Object.entries(schemaDef.fields ?? {});

  return (
    <form onSubmit={save}>
      {error && <div class="alert alert-error" style="margin-bottom:1rem">{error}</div>}

      {fields.length === 0 ? (
        <p style="color:#718096">This schema has no fields defined.</p>
      ) : (
        fields.map(([key, field]) => (
          <div class="form-group" key={key}>
            <label>
              {field.label}
              {field.required && <span style="color:#e53e3e;margin-left:2px">*</span>}
            </label>
            {renderField(key, field, values[key], setField)}
          </div>
        ))
      )}

      <div class="form-actions" style="margin-top:1.5rem;display:flex;gap:0.75rem;align-items:center">
        <button type="submit" class="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : (isNew ? "Create" : "Save")}
        </button>
        {!isNew && (
          <button
            type="button"
            class="btn btn-danger"
            onClick={deleteRecord}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
        {saved && <span style="color:#276749">✓ Saved</span>}
      </div>
    </form>
  );
}

function renderField(
  key: string,
  field: FieldDef,
  value: unknown,
  setField: (k: string, v: unknown) => void,
): h.JSX.Element {
  const str = String(value ?? "");

  switch (field.type) {
    case "textarea":
      return (
        <textarea
          rows={5}
          value={str}
          required={field.required}
          onInput={(e) => setField(key, (e.target as HTMLTextAreaElement).value)}
        />
      );

    case "select":
      return (
        <select
          value={str}
          required={field.required}
          onChange={(e) => setField(key, (e.target as HTMLSelectElement).value)}
        >
          {!field.required && <option value="">— select —</option>}
          {field.options &&
            Object.entries(field.options).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
        </select>
      );

    case "checkbox":
    case "bool":
      return (
        <label>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => setField(key, (e.target as HTMLInputElement).checked)}
          />
        </label>
      );

    case "number":
      return (
        <input
          type="number"
          value={str}
          required={field.required}
          onInput={(e) => setField(key, Number((e.target as HTMLInputElement).value))}
        />
      );

    case "date":
      return (
        <input
          type="date"
          value={str}
          required={field.required}
          onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
        />
      );

    case "email":
      return (
        <input
          type="email"
          value={str}
          required={field.required}
          onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
        />
      );

    case "url":
      return (
        <input
          type="url"
          value={str}
          required={field.required}
          onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
        />
      );

    default:
      return (
        <input
          type="text"
          value={str}
          required={field.required}
          onInput={(e) => setField(key, (e.target as HTMLInputElement).value)}
        />
      );
  }
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
