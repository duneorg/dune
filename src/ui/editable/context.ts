/**
 * Edit mode context — shared state for the inline editing session.
 *
 * `window.__DUNE_EDIT_MODE__` is set to `true` by the admin bootstrap script
 * injected when an admin session is active.  All `<Editable*>` components
 * check this flag before activating their edit handles.
 *
 * `window.__DUNE_EDIT_SOURCE_PATH__` carries the current page's source path
 * for the admin bar and auto-overlay.
 *
 * This module provides typed read helpers so components don't reference
 * `window` directly (keeps SSR safe).
 */

/** Returns true when the page is loaded in an admin session with edit mode enabled. */
export function isEditMode(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __DUNE_EDIT_MODE__?: boolean }).__DUNE_EDIT_MODE__ === true;
}

/** Returns the current page's source path, if set by the admin bootstrap. */
export function getEditSourcePath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __DUNE_EDIT_SOURCE_PATH__?: string }).__DUNE_EDIT_SOURCE_PATH__;
}

/** WebSocket URL for the Y.js sync endpoint. */
export function getEditWsUrl(sourcePath: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const encodedPath = encodeURIComponent(sourcePath);
  return `${protocol}//${location.host}/admin/collab/edit-ws?path=${encodedPath}`;
}
