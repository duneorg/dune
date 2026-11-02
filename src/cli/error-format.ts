/**
 * Render an error for the CLI's final handler: the message, then one
 * `caused by:` line per entry on the `cause` chain. Messages only — stacks
 * stay behind `--debug`. Causes whose message repeats the one above are
 * skipped, so a wrapper that already embeds its cause's text isn't printed
 * twice.
 */
const MAX_CAUSE_DEPTH = 5;

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : String(value);
}

export function formatErrorChain(err: unknown): string[] {
  let shown = messageOf(err);
  const lines = [shown];
  const seen = new Set<unknown>([err]);
  let current: unknown = err instanceof Error ? err.cause : undefined;
  for (let depth = 0; current !== undefined && depth < MAX_CAUSE_DEPTH; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const message = messageOf(current);
    if (message && !shown.includes(message)) {
      lines.push(`  caused by: ${message}`);
      shown = message;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines;
}
