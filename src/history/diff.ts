/**
 * Line-based diff computation and application.
 *
 * Uses a simple LCS (Longest Common Subsequence) approach to produce
 * unified diff output between two text strings.
 */

import type { ContentDiff } from "../workflow/types.ts";

/**
 * Compute a diff between two strings.
 */
export function computeDiff(oldText: string, newText: string): ContentDiff {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const hunks = diffLines(oldLines, newLines);
  const patch = formatUnifiedDiff(hunks, oldLines, newLines);

  let additions = 0;
  let deletions = 0;

  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.type === "add") additions++;
      else if (change.type === "remove") deletions++;
    }
  }

  return { additions, deletions, patch };
}

/**
 * Apply a simple line-based patch to text.
 * This is a best-effort apply — for exact reconstruction, use the revision content directly.
 */
export function applyPatch(original: string, diff: ContentDiff): string {
  // Parse the unified diff to extract changes
  const lines = diff.patch.split("\n");
  const result = original.split("\n");

  // For simplicity, we track line-level operations
  const operations: Array<{ type: "add" | "remove"; lineNum: number; text?: string }> = [];
  let currentOldLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)/);
      if (match) {
        currentOldLine = parseInt(match[1], 10) - 1;
      }
    } else if (line.startsWith("-")) {
      operations.push({ type: "remove", lineNum: currentOldLine });
      currentOldLine++;
    } else if (line.startsWith("+")) {
      operations.push({ type: "add", lineNum: currentOldLine, text: line.slice(1) });
    } else if (line.startsWith(" ")) {
      currentOldLine++;
    }
  }

  // Apply operations in reverse to avoid index shifting
  let offset = 0;
  for (const op of operations) {
    const idx = op.lineNum + offset;
    if (op.type === "remove") {
      result.splice(idx, 1);
      offset--;
    } else if (op.type === "add") {
      result.splice(idx, 0, op.text ?? "");
      offset++;
    }
  }

  return result.join("\n");
}

// === Internal diff algorithm ===

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  changes: DiffChange[];
}

interface DiffChange {
  type: "add" | "remove" | "context";
  content: string;
}

/**
 * Compute diff hunks between two line arrays using Myers-like approach.
 */
function diffLines(oldLines: string[], newLines: string[]): DiffHunk[] {
  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;

  // Optimize for common prefix/suffix
  let prefixLen = 0;
  while (prefixLen < m && prefixLen < n && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < (m - prefixLen) &&
    suffixLen < (n - prefixLen) &&
    oldLines[m - 1 - suffixLen] === newLines[n - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldTrimmed = oldLines.slice(prefixLen, m - suffixLen);
  const newTrimmed = newLines.slice(prefixLen, n - suffixLen);

  // LCS on trimmed portion
  const lcs = computeLCS(oldTrimmed, newTrimmed);

  // Build changes from LCS
  const changes: Array<{ type: "add" | "remove" | "equal"; oldIdx: number; newIdx: number; content: string }> = [];

  let oi = 0;
  let ni = 0;
  let li = 0;

  while (oi < oldTrimmed.length || ni < newTrimmed.length) {
    if (li < lcs.length && oi < oldTrimmed.length && ni < newTrimmed.length && oldTrimmed[oi] === lcs[li] && newTrimmed[ni] === lcs[li]) {
      changes.push({ type: "equal", oldIdx: prefixLen + oi, newIdx: prefixLen + ni, content: oldTrimmed[oi] });
      oi++;
      ni++;
      li++;
    } else if (oi < oldTrimmed.length && (li >= lcs.length || oldTrimmed[oi] !== lcs[li])) {
      changes.push({ type: "remove", oldIdx: prefixLen + oi, newIdx: prefixLen + ni, content: oldTrimmed[oi] });
      oi++;
    } else if (ni < newTrimmed.length) {
      changes.push({ type: "add", oldIdx: prefixLen + oi, newIdx: prefixLen + ni, content: newTrimmed[ni] });
      ni++;
    }
  }

  // Group changes into hunks
  return groupIntoHunks(changes, prefixLen);
}

/**
 * Compute LCS of two string arrays.
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;

  // Use standard DP approach
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Group changes into unified diff hunks with context lines.
 */
function groupIntoHunks(
  changes: Array<{ type: "add" | "remove" | "equal"; oldIdx: number; newIdx: number; content: string }>,
  prefixLen: number,
): DiffHunk[] {
  if (changes.length === 0) return [];

  const CONTEXT = 3;
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let lastChangeIdx = -CONTEXT - 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (change.type !== "equal") {
      // Start a new hunk if gap is too large
      if (i - lastChangeIdx > CONTEXT * 2) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          oldStart: change.oldIdx + 1,
          oldCount: 0,
          newStart: change.newIdx + 1,
          newCount: 0,
          changes: [],
        };

        // Add leading context
        for (let c = Math.max(0, i - CONTEXT); c < i; c++) {
          if (changes[c].type === "equal") {
            currentHunk.changes.push({ type: "context", content: changes[c].content });
            currentHunk.oldStart = Math.min(currentHunk.oldStart, changes[c].oldIdx + 1);
            currentHunk.newStart = Math.min(currentHunk.newStart, changes[c].newIdx + 1);
            currentHunk.oldCount++;
            currentHunk.newCount++;
          }
        }
      }

      if (!currentHunk) {
        currentHunk = {
          oldStart: change.oldIdx + 1,
          oldCount: 0,
          newStart: change.newIdx + 1,
          newCount: 0,
          changes: [],
        };
      }

      if (change.type === "remove") {
        currentHunk.changes.push({ type: "remove", content: change.content });
        currentHunk.oldCount++;
      } else if (change.type === "add") {
        currentHunk.changes.push({ type: "add", content: change.content });
        currentHunk.newCount++;
      }

      lastChangeIdx = i;
    } else {
      // Equal line — add as context if within range
      if (currentHunk && i - lastChangeIdx <= CONTEXT) {
        currentHunk.changes.push({ type: "context", content: change.content });
        currentHunk.oldCount++;
        currentHunk.newCount++;
      }
    }
  }

  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}

/**
 * Format hunks into unified diff format.
 */
function formatUnifiedDiff(hunks: DiffHunk[], _oldLines: string[], _newLines: string[]): string {
  if (hunks.length === 0) return "";

  const parts: string[] = [];

  for (const hunk of hunks) {
    parts.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);

    for (const change of hunk.changes) {
      switch (change.type) {
        case "context":
          parts.push(` ${change.content}`);
          break;
        case "add":
          parts.push(`+${change.content}`);
          break;
        case "remove":
          parts.push(`-${change.content}`);
          break;
      }
    }
  }

  return parts.join("\n");
}
