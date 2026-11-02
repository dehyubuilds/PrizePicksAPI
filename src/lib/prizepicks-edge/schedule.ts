export const PICKS_BOT_TZ = "America/Chicago";
export const PICKS_BOT_SLOTS = [
  { hour: 8, minute: 30 },
  { hour: 12, minute: 30 },
  { hour: 16, minute: 30 },
] as const;

export function picksScheduleCopy(): string {
  return "8:30 AM, 12:30 PM, and 4:30 PM CT so the board is ready around 9:00 AM, 1:00 PM, and 5:00 PM";
}

export function picksScheduleChips(): string[] {
  return ["8:30 AM CT", "12:30 PM CT", "4:30 PM CT"];
}

function chicagoParts(now: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PICKS_BOT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: num("year"), month: num("month"), day: num("day"), hour: num("hour"), minute: num("minute") };
}

function addChicagoDays(parts: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days);
  const next = new Date(utc);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/** Map a Chicago wall clock to a UTC Date. */
export function chicagoWallClockToDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  let guess = Date.UTC(year, month - 1, day, hour + 5, minute);
  for (let i = 0; i < 4; i += 1) {
    const seen = chicagoParts(new Date(guess));
    const seenMin = seen.hour * 60 + seen.minute;
    const wantMin = hour * 60 + minute;
    const dayDiff =
      Date.UTC(year, month - 1, day) - Date.UTC(seen.year, seen.month - 1, seen.day);
    guess += dayDiff + (wantMin - seenMin) * 60_000;
  }
  return new Date(guess);
}

export function nextScheduledRun(now = new Date()): Date {
  const current = chicagoParts(now);
  const nowMin = current.hour * 60 + current.minute;
  for (const slot of PICKS_BOT_SLOTS) {
    if (slot.hour * 60 + slot.minute > nowMin) {
      return chicagoWallClockToDate(current.year, current.month, current.day, slot.hour, slot.minute);
    }
  }
  const next = addChicagoDays(current, 1);
  return chicagoWallClockToDate(next.year, next.month, next.day, PICKS_BOT_SLOTS[0].hour, PICKS_BOT_SLOTS[0].minute);
}

export function formatBotRunLabel(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: PICKS_BOT_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
