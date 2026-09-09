/**
 * Date display for the packet (Directions §3.4 recipes: `D MMM YYYY`,
 * `D MMM YYYY, HH:mm`, `Weekday D Mon[, HH:mm]`, and the capture date range).
 *
 * A timestamp that carries a nonzero UTC offset (the Directions' reference input
 * uses `-04:00`) is shown in that offset. UTC timestamps (`Z` or `+00:00`,
 * including Supabase serialization) use `time_zone` (default America/New_York: the trial
 * is Allen County, IN. DEFAULT pending Melissa). Nothing here rounds or
 * guesses; an unparseable timestamp returns null and the caller drops the
 * value rather than printing a wrong one.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
  /** Milliseconds since the epoch of the instant itself, for sorting. */
  epoch_ms: number;
}

const OFFSET_RE = /([+-])(\d{2}):?(\d{2})$/;

export function wallClock(iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE): WallClock | null {
  if (!iso) return null;
  const epoch = Date.parse(iso);
  if (Number.isNaN(epoch)) return null;
  const offset = OFFSET_RE.exec(iso);
  if (offset && (Number(offset[2]) !== 0 || Number(offset[3]) !== 0) && /T/.test(iso)) {
    const sign = offset[1] === "-" ? -1 : 1;
    const minutes = sign * (Number(offset[2]) * 60 + Number(offset[3]));
    const shifted = new Date(epoch + minutes * 60_000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      weekday: shifted.getUTCDay(),
      epoch_ms: epoch,
    };
  }
  if (!/T/.test(iso)) {
    // A bare date: no time of day, no zone — take it as written.
    const d = new Date(`${iso}T00:00:00Z`);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: 0,
      minute: 0,
      weekday: d.getUTCDay(),
      epoch_ms: d.getTime(),
    };
  }
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(epoch)).map((p) => [p.type, p.value]));
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
      weekday: WEEKDAYS.indexOf(parts.weekday),
      epoch_ms: epoch,
    };
  } catch {
    return null;
  }
}

const two = (n: number) => String(n).padStart(2, "0");

/** `3 Sep 2026` */
export function dateShort(w: WallClock): string {
  return `${w.day} ${MONTHS[w.month - 1]} ${w.year}`;
}

/** `3 Sep 2026, 11:42` */
export function dateTime(w: WallClock): string {
  return `${dateShort(w)}, ${two(w.hour)}:${two(w.minute)}`;
}

/** `Wed 3 Sep` or `Wed 3 Sep, 11:20` */
export function weekdayDayMon(w: WallClock, withTime: boolean): string {
  const base = `${WEEKDAYS[w.weekday]} ${w.day} ${MONTHS[w.month - 1]}`;
  return withTime ? `${base}, ${two(w.hour)}:${two(w.minute)}` : base;
}

/** `2–3 Sep`, `30 Aug – 3 Sep`, or `3 Sep` when one day. En dash. */
export function dateRange(earliest: WallClock, latest: WallClock): string {
  if (earliest.year === latest.year && earliest.month === latest.month) {
    if (earliest.day === latest.day) return `${latest.day} ${MONTHS[latest.month - 1]}`;
    return `${earliest.day}–${latest.day} ${MONTHS[latest.month - 1]}`;
  }
  return `${earliest.day} ${MONTHS[earliest.month - 1]} – ${latest.day} ${MONTHS[latest.month - 1]}`;
}

/** `YYYY-MM-DD` of a wall clock. */
export function isoDate(w: WallClock): string {
  return `${w.year}-${two(w.month)}-${two(w.day)}`;
}

/** The wall clock `days` days before another, same time of day. */
export function daysBefore(w: WallClock, days: number): WallClock {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day - days, w.hour, w.minute));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: w.hour,
    minute: w.minute,
    weekday: d.getUTCDay(),
    epoch_ms: w.epoch_ms - days * 86_400_000,
  };
}
