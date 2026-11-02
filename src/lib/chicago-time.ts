/** America/Chicago calendar helpers for daily betting slates. */

export function chicagoDayKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function chicagoHour(date: Date): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    }).format(date)
  );
  // Node/ICU may return 24 for midnight with hour12: false.
  return hour === 24 ? 0 : hour;
}

/** UTC instant of midnight at the start of a Chicago calendar day (YYYY-MM-DD). */
export function chicagoMidnightUtcIso(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let offsetHours = -14; offsetHours <= 14; offsetHours++) {
    const candidate = new Date(base + offsetHours * 3_600_000);
    if (chicagoDayKey(candidate) === dayKey && chicagoHour(candidate) === 0) {
      return candidate.toISOString();
    }
  }
  throw new Error(`Could not resolve Chicago midnight for ${dayKey}`);
}

function chicagoNextDayKey(dayKey: string): string {
  const startMs = Date.parse(chicagoMidnightUtcIso(dayKey));
  return chicagoDayKey(new Date(startMs + 36 * 3_600_000));
}

/** Only YouTube uploads from the current Chicago calendar day (not rolling 24h). */
export function chicagoTodayUploadWindow(now = new Date()): {
  publishedAfter: string;
  publishedBefore: string;
  label: string;
} {
  const dayKey = chicagoDayKey(now);
  const publishedAfter = chicagoMidnightUtcIso(dayKey);
  const publishedBefore = chicagoMidnightUtcIso(chicagoNextDayKey(dayKey));
  return {
    publishedAfter,
    publishedBefore,
    label: `today (${dayKey}, Central Time)`,
  };
}

/** Rolling lookback — kept for non-daily tooling if needed. */
export function rollingUploadWindow(hours: number): { publishedAfter: string; label: string } {
  const now = new Date();
  const start = new Date(now.getTime() - hours * 3_600_000);
  return {
    publishedAfter: start.toISOString(),
    label: `the last ${hours} hours`,
  };
}
