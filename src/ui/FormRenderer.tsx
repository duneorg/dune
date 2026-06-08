/** @jsxImportSource preact */
/**
 * FormRenderer — client-side island.
 *
 * Fetches form schema from GET /api/forms/{formName}, renders fields
 * dynamically, and submits via POST /api/forms/{formName}. Handles
 * loading, validation errors, and success states. Gracefully falls back to
 * a "not available" message when the form returns 404.
 */

import { h, Fragment } from "preact";
import type { JSX } from "preact";
import { useState, useEffect } from "preact/hooks";

/** Props for the {@link FormRenderer} island component. */
export interface FormRendererProps {
  formName: string;
  successMessage?: string;
  className?: string;
}

interface FormField {
  type: "text" | "email" | "tel" | "textarea" | "number" | "select" | "checkbox" | "file" | "hidden";
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: Record<string, string>;
  validate?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

interface FormSchema {
  name: string;
  title: string;
  success_url?: string;
  honeypot?: string;
  fields: Record<string, FormField>;
}

export default function FormRenderer({
  formName,
  successMessage = "Thank you! Your submission has been received.",
  className,
}: FormRendererProps): JSX.Element | null {
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/forms/${encodeURIComponent(formName)}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setLoadError("Failed to load form.");
          return;
        }
        const data = await res.json() as FormSchema;
        setSchema(data);
        // Initialize values
        const initial: Record<string, string> = {};
        for (const key of Object.keys(data.fields ?? {})) {
          initial[key] = "";
        }
        setValues(initial);
      } catch {
        setLoadError("Unable to load form.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [formName]);

  function handleChange(fieldName: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
    // Clear field error on change
    if (fieldErrors[fieldName]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!schema) return;

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    try {
      // Build submission payload
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        payload[key] = value;
      }
      // Include honeypot field (empty) if schema specifies one
      if (schema.honeypot) {
        payload[schema.honeypot] = "";
      }

      const res = await fetch(`/api/forms/${encodeURIComponent(formName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSubmitted(true);
        // Redirect to success_url if configured and it's a relative path
        if (schema.success_url && schema.success_url.startsWith("/")) {
          globalThis.location.href = schema.success_url;
        }
        return;
      }

      if (res.status === 422 || res.status === 400) {
        const data = await res.json().catch(() => ({})) as {
          error?: string;
          errors?: Array<{ field: string; message: string }>;
        };
        if (data.errors && Array.isArray(data.errors)) {
          const errs: Record<string, string> = {};
          for (const e of data.errors) {
            errs[e.field] = e.message;
          }
          setFieldErrors(errs);
          return;
        }
        setSubmitError(data.error ?? "Please check your submission and try again.");
        return;
      }

      if (res.status === 429) {
        setSubmitError("Too many submissions. Please wait a moment and try again.");
        return;
      }

      setSubmitError("Submission failed. Please try again.");
    } catch {
      setSubmitError("Unable to submit form. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div class={`dune-form-renderer${className ? ` ${className}` : ""}`}>
        <p class="dune-form-renderer__loading" aria-live="polite">Loading form…</p>
      </div>
    );
  }

  if (notFound || loadError) {
    return (
      <div class={`dune-form-renderer${className ? ` ${className}` : ""}`}>
        <p class="dune-form-renderer__unavailable">
          {loadError ?? "This form is not available."}
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div class={`dune-form-renderer${className ? ` ${className}` : ""}`}>
        <p class="dune-form-renderer__success" role="status">
          {successMessage}
        </p>
      </div>
    );
  }

  if (!schema) return null;

  return (
    <div class={`dune-form-renderer${className ? ` ${className}` : ""}`}>
      {schema.title && (
        <h2 class="dune-form-renderer__title">{schema.title}</h2>
      )}

      <form
        class="dune-form-renderer__form"
        onSubmit={handleSubmit}
        noValidate
        aria-label={schema.title}
      >
        {submitError && (
          <p class="dune-form-renderer__error" role="alert">
            {submitError}
          </p>
        )}

        {Object.entries(schema.fields).map(([fieldName, field]) => (
          <FormField
            key={fieldName}
            fieldName={fieldName}
            field={field}
            value={values[fieldName] ?? ""}
            error={fieldErrors[fieldName]}
            onChange={(v) => handleChange(fieldName, v)}
          />
        ))}

        {/* Honeypot field — hidden from humans, filled by bots */}
        {schema.honeypot && (
          <div style="position:absolute;left:-9999px;top:-9999px" aria-hidden="true">
            <input
              type="text"
              name={schema.honeypot}
              tabIndex={-1}
              autoComplete="off"
              value=""
            />
          </div>
        )}

        <button
          type="submit"
          class="dune-form-renderer__submit"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </div>
  );
}

// ── Field renderer ──────────────────────────────────────────────────────────

interface FormFieldProps {
  fieldName: string;
  field: FormField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

function FormField({ fieldName, field, value, error, onChange }: FormFieldProps) {
  if (field.type === "hidden") {
    return <input type="hidden" name={fieldName} value={value} />;
  }

  const id = `dune-form-field-${fieldName}`;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div class={`dune-form-renderer__field${error ? " dune-form-renderer__field--error" : ""}`}>
      {field.type !== "checkbox" && (
        <label class="dune-form-renderer__label" for={id}>
          {field.label}
          {field.required && <span class="dune-form-renderer__required" aria-hidden="true"> *</span>}
        </label>
      )}

      {field.type === "textarea" ? (
        <textarea
          id={id}
          class="dune-form-renderer__textarea"
          name={fieldName}
          required={field.required}
          placeholder={field.placeholder}
          rows={4}
          minLength={field.validate?.min}
          maxLength={field.validate?.max}
          value={value}
          onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={errorId}
        />
      ) : field.type === "select" ? (
        <select
          id={id}
          class="dune-form-renderer__select"
          name={fieldName}
          required={field.required}
          value={value}
          onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={errorId}
        >
          <option value="">-- Select --</option>
          {Object.entries(field.options ?? {}).map(([optValue, optLabel]) => (
            <option key={optValue} value={optValue}>
              {optLabel}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <label class="dune-form-renderer__checkbox-label" for={id}>
          <input
            id={id}
            class="dune-form-renderer__checkbox"
            type="checkbox"
            name={fieldName}
            required={field.required}
            checked={value === "on" || value === "true"}
            onChange={(e) => onChange((e.target as HTMLInputElement).checked ? "on" : "")}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={errorId}
          />
          {field.label}
          {field.required && <span class="dune-form-renderer__required" aria-hidden="true"> *</span>}
        </label>
      ) : (
        <input
          id={id}
          class="dune-form-renderer__input"
          type={field.type}
          name={fieldName}
          required={field.required}
          placeholder={field.placeholder}
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          min={field.type === "number" ? field.validate?.min : undefined}
          max={field.type === "number" ? field.validate?.max : undefined}
          minLength={field.type !== "number" ? field.validate?.min : undefined}
          maxLength={field.type !== "number" ? field.validate?.max : undefined}
          pattern={field.validate?.pattern}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={errorId}
        />
      )}

      {error && (
        <p id={errorId} class="dune-form-renderer__field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
