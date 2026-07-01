/** @jsxImportSource preact */
/**
 * CommentSection — client-side island.
 *
 * Fetches GET /api/comments?where[pageRoute]={pageRoute} and renders a list.
 * Shows a form to POST new comments. Handles loading/error states.
 * Gracefully handles 404 (comments model not configured) with a friendly message.
 */

import type { JSX } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";

/** Props for the {@link CommentSection} island component. */
export interface CommentSectionProps {
  pageRoute: string;
  className?: string;
}

interface Comment {
  id: string;
  author?: string;
  body: string;
  createdAt?: string;
  [key: string]: unknown;
}

export default function CommentSection({ pageRoute, className }: CommentSectionProps): JSX.Element {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  // New comment form state
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/comments?where[pageRoute]=${encodeURIComponent(pageRoute)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        setNotConfigured(true);
        return;
      }
      if (!res.ok) {
        setError("Failed to load comments.");
        return;
      }
      const data = await res.json() as { items?: Comment[] } | Comment[];
      // Support both { items: [...] } and direct array responses
      const items = Array.isArray(data) ? data : (data.items ?? []);
      setComments(items as Comment[]);
    } catch {
      setError("Unable to load comments.");
    } finally {
      setLoading(false);
    }
  }, [pageRoute]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!body.trim()) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageRoute, author: author.trim() || undefined, body: body.trim() }),
      });
      if (res.status === 404) {
        setSubmitError("Comments are not available for this page.");
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError((d as { error?: string }).error ?? "Failed to post comment.");
        return;
      }
      setBody("");
      setAuthor("");
      setSubmitSuccess(true);
      await load();
    } catch {
      setSubmitError("Failed to post comment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (notConfigured) {
    return (
      <div class={`dune-comment-section${className ? ` ${className}` : ""}`}>
        <p class="dune-comment-section__unavailable">Comments not available.</p>
      </div>
    );
  }

  return (
    <div class={`dune-comment-section${className ? ` ${className}` : ""}`}>
      <h2 class="dune-comment-section__heading">Comments</h2>

      {/* Comment list */}
      {loading && (
        <p class="dune-comment-section__loading" aria-live="polite">Loading comments…</p>
      )}
      {!loading && error && (
        <p class="dune-comment-section__error" role="alert">{error}</p>
      )}
      {!loading && !error && comments.length === 0 && (
        <p class="dune-comment-section__empty">No comments yet. Be the first!</p>
      )}
      {!loading && !error && comments.length > 0 && (
        <ol class="dune-comment-section__list" aria-label="Comments">
          {comments.map((c) => (
            <li key={c.id} class="dune-comment-section__item">
              <div class="dune-comment-section__meta">
                <span class="dune-comment-section__author">
                  {c.author ?? "Anonymous"}
                </span>
                {c.createdAt && (
                  <time
                    class="dune-comment-section__date"
                    dateTime={c.createdAt}
                  >
                    {formatDate(c.createdAt)}
                  </time>
                )}
              </div>
              <div class="dune-comment-section__body">{String(c.body ?? "")}</div>
            </li>
          ))}
        </ol>
      )}

      {/* New comment form */}
      <form
        class="dune-comment-section__form"
        onSubmit={handleSubmit}
        aria-label="Post a comment"
        noValidate
      >
        <h3 class="dune-comment-section__form-heading">Leave a comment</h3>

        {submitSuccess && (
          <p class="dune-comment-section__success" role="status">
            Your comment has been posted.
          </p>
        )}
        {submitError && (
          <p class="dune-comment-section__submit-error" role="alert">
            {submitError}
          </p>
        )}

        <div class="dune-comment-section__field">
          <label class="dune-comment-section__label" for="dune-comment-author">
            Name (optional)
          </label>
          <input
            id="dune-comment-author"
            class="dune-comment-section__input"
            type="text"
            value={author}
            onInput={(e) => setAuthor((e.target as HTMLInputElement).value)}
            placeholder="Your name"
            autocomplete="name"
            maxLength={100}
          />
        </div>

        <div class="dune-comment-section__field">
          <label class="dune-comment-section__label" for="dune-comment-body">
            Comment <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="dune-comment-body"
            class="dune-comment-section__textarea"
            value={body}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
            required
            rows={4}
            maxLength={5000}
            placeholder="Write your comment…"
          />
        </div>

        <button
          type="submit"
          class="dune-comment-section__submit"
          disabled={submitting || !body.trim()}
          aria-busy={submitting}
        >
          {submitting ? "Posting…" : "Post comment"}
        </button>
      </form>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
