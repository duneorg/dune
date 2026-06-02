/**
 * Minimal cron expression parser.
 *
 * Supports standard 5-field cron: minute hour dom month dow
 * Field syntax: * (any), *\/n (step), n-m (range), n,m (list), named dow (MON-SUN).
 *
 * Does NOT support: @ macros, seconds field, L/W/# extensions.
 * Covers all patterns in the Dune skill docs and common CMS use cases.
 */

const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};
const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function parseValue(s: string, names: Record<string, number>): number {
  const upper = s.toUpperCase();
  if (upper in names) return names[upper];
  return parseInt(s, 10);
}

function matchField(
  field: string,
  value: number,
  names: Record<string, number> = {},
): boolean {
  if (field === "*") return true;

  // Step: */n or start/n
  if (field.includes("/")) {
    const [rangeStr, stepStr] = field.split("/");
    const step = parseInt(stepStr, 10);
    if (rangeStr === "*") return value % step === 0;
    // n/step means start at n, every step thereafter (unusual but valid)
    const start = parseValue(rangeStr, names);
    return value >= start && (value - start) % step === 0;
  }

  // Comma list
  if (field.includes(",")) {
    return field.split(",").some((f) => matchField(f.trim(), value, names));
  }

  // Range: n-m
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map((f) => parseValue(f.trim(), names));
    return value >= lo && value <= hi;
  }

  // Literal
  const literal = parseValue(field, names);
  // Day-of-week: treat 7 as 0 (Sunday)
  if (names === DOW_NAMES && literal === 7) return value === 0;
  return value === literal;
}

/**
 * Returns true if the given date matches the 5-field cron expression.
 * Seconds are ignored — cron fires at the start of a matching minute.
 */
export function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minuteF, hourF, domF, monthF, dowF] = parts;

  return (
    matchField(minuteF, date.getMinutes()) &&
    matchField(hourF, date.getHours()) &&
    matchField(domF, date.getDate()) &&
    matchField(monthF, date.getMonth() + 1, MONTH_NAMES) &&
    matchField(dowF, date.getDay(), DOW_NAMES)
  );
}

/**
 * Compute the next time (inclusive of now+1min) that the cron expression fires.
 * Returns null if no match is found within one year.
 */
export function nextRunAfter(expr: string, from: Date): Date | null {
  const candidate = new Date(from);
  // Round up to the start of the next minute
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 366 days × 24h × 60min ahead
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(expr, candidate)) return new Date(candidate);
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}
