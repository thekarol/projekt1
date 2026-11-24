// Calendar arithmetic on plain dates. No Date objects and no dependence on the
// machine's time zone: every date and minute is already in the tenant's zone.

import type { ISODate, Minutes, Zoned } from './types.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MINUTES_PER_DAY = 1440;

function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

/** Days since 1970-01-01. Throws on anything that is not a real calendar date. */
export function dayNumber(date: ISODate): number {
  const match = typeof date === 'string' ? DATE_RE.exec(date) : null;
  if (!match) throw new RangeError(`Invalid date: ${String(date)}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const n = daysFromCivil(y, m, d);
  const back = civilFromDays(n);
  if (back.y !== y || back.m !== m || back.d !== d) throw new RangeError(`Invalid date: ${date}`);
  return n;
}

export function isValidDate(date: unknown): date is ISODate {
  try {
    dayNumber(date as ISODate);
    return true;
  } catch {
    return false;
  }
}

export function dateFromDayNumber(n: number): ISODate {
  const { y, m, d } = civilFromDays(n);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return dateFromDayNumber(dayNumber(date) + days);
}

/** 1 = Monday ... 7 = Sunday. */
export function weekday(date: ISODate): number {
  return ((((dayNumber(date) + 3) % 7) + 7) % 7) + 1;
}

export function monthOf(date: ISODate): number {
  return Number(date.slice(5, 7));
}

/** `MM-DD` part, for rules that repeat every year. */
export function monthDay(date: ISODate): string {
  return date.slice(5);
}

/** Every date from `from` to `to`, both inclusive. Empty when `to` is before `from`. */
export function eachDate(from: ISODate, to: ISODate): ISODate[] {
  const a = dayNumber(from);
  const b = dayNumber(to);
  const out: ISODate[] = [];
  for (let n = a; n <= b; n++) out.push(dateFromDayNumber(n));
  return out;
}

export function daysBetweenInclusive(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** A point in time as minutes since 1970-01-01 00:00 in the tenant's zone. */
export function absMinute(date: ISODate, minute: Minutes): number {
  return dayNumber(date) * MINUTES_PER_DAY + minute;
}

export function dateOfAbsMinute(t: number): ISODate {
  return dateFromDayNumber(Math.floor(t / MINUTES_PER_DAY));
}

export function parseTime(text: string): Minutes {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) throw new RangeError(`Invalid time: ${text}`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m > 0)) throw new RangeError(`Invalid time: ${text}`);
  return h * 60 + m;
}

export function formatTime(minute: Minutes): string {
  return `${Math.floor(minute / 60)}:${pad(minute % 60)}`;
}

/** Converts a real instant to the tenant's calendar date and minute. */
export function toZoned(epochMs: number, timeZone: string): Zoned {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}
