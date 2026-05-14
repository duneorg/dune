/** @jsxImportSource preact */
/**
 * SearchBar — client-side island.
 *
 * Calls GET /api/search?q={query}&limit={limit}. Renders an accessible
 * combobox input with a dropdown of results. Keyboard-navigable (↑↓ to
 * move through items, Enter to navigate, Esc to close). Debounces 200ms.
 */

import { h } from "preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

export interface SearchBarProps {
  placeholder?: string;
  limit?: number;
  className?: string;
}

interface SearchResult {
  route: string;
  title: string;
  excerpt?: string;
  score?: number;
}

/** Debounce helper — returns a stable callback that defers `fn` by `delay` ms. */
export function debounce(
  fn: (...args: unknown[]) => void,
  delay: number,
): (...args: unknown[]) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: unknown[]) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export default function SearchBar({
  placeholder = "Search...",
  limit = 5,
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Perform search — debounced 200ms
  const search = useCallback(
    (q: string) => {
      debouncedSearch(q);
    },
    [limit],
  );

  const debouncedSearch = debounce(async (...args: unknown[]) => {
    const q = args[0] as string;
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const url = `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) {
        setResults([]);
        setOpen(false);
        return;
      }
      const data = await res.json() as { items: SearchResult[] };
      const items = data.items ?? [];
      setResults(items);
      setOpen(items.length > 0);
      setActiveIndex(-1);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, 200);

  useEffect(() => {
    search(query);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKeyDown(e: KeyboardEvent) {
    if (!open && results.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && results[activeIndex]) {
          navigate(results[activeIndex].route);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        inputRef.current?.blur();
        break;
    }
  }

  function navigate(route: string) {
    setOpen(false);
    setQuery("");
    setResults([]);
    globalThis.location.href = route;
  }

  const listboxId = "dune-search-listbox";

  return (
    <div
      ref={containerRef}
      class={`dune-search-bar${className ? ` ${className}` : ""}`}
      style="position:relative"
    >
      <input
        ref={inputRef}
        type="search"
        class="dune-search-bar__input"
        placeholder={placeholder}
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          activeIndex >= 0 ? `dune-search-item-${activeIndex}` : undefined
        }
        autocomplete="off"
        spellcheck={false}
      />
      {loading && (
        <span class="dune-search-bar__loading" aria-live="polite" aria-label="Searching…" />
      )}
      {open && results.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          class="dune-search-bar__dropdown"
          role="listbox"
          aria-label="Search results"
          style="position:absolute;top:100%;left:0;right:0;z-index:100;margin:2px 0 0;padding:0;list-style:none;background:#fff;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.1)"
        >
          {results.map((result, idx) => (
            <li
              key={result.route}
              id={`dune-search-item-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              class={`dune-search-bar__result${idx === activeIndex ? " dune-search-bar__result--active" : ""}`}
              style={`padding:0.6rem 0.9rem;cursor:pointer;background:${idx === activeIndex ? "#f0f4ff" : "transparent"};border-bottom:${idx < results.length - 1 ? "1px solid #f0f0f0" : "none"}`}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                navigate(result.route);
              }}
            >
              <div class="dune-search-bar__result-title" style="font-size:0.9rem;font-weight:500;color:#1a202c">
                {result.title}
              </div>
              {result.excerpt && (
                <div
                  class="dune-search-bar__result-excerpt"
                  style="font-size:0.8rem;color:#718096;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis"
                >
                  {result.excerpt}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
