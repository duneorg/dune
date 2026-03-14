/**
 * Form definition system — public API.
 *
 * Form YAML files live at `forms/{name}.yaml` in the project root and define
 * the fields, validation rules, and behaviour for public-facing forms.
 *
 * ## Public API endpoints (registered by the admin server)
 *
 *   GET  /api/forms/:name   Return the form schema as JSON (for JS-driven forms)
 *   POST /api/forms/:name   Accept and validate a form submission
 *
 * ## Example form definition
 *
 * ```yaml
 * # forms/contact.yaml
 * title: Contact Form
 * success_url: /thank-you
 * fields:
 *   name:
 *     type: text
 *     label: Your Name
 *     required: true
 *   email:
 *     type: email
 *     label: Email Address
 *     required: true
 *   message:
 *     type: textarea
 *     label: Message
 *     required: true
 *     validate:
 *       min: 10
 *       max: 2000
 * ```
 */

export { loadForms, loadForm } from "./loader.ts";
export { validateFormSubmission } from "./validator.ts";
export type {
  FormDefinition,
  FormField,
  FormFieldType,
  FormFieldValidation,
  FormMap,
  FormValidationError,
} from "./types.ts";
