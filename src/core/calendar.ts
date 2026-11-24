// What applies on a given date: opening hours, closed days, and where prices come from.

import type { Catalog, DateException, Id, ISODate, Minutes, OpeningRule, Tariff } from './types.ts';
import { dayNumber, monthDay, monthOf, weekday } from './time.ts';

export interface DayInfo {
  date: ISODate;
  weekday: number;
  /** Null when the point is closed that day. */
  hours: { open: Minutes; close: Minutes } | null;
  closedBy: 'exception' | 'hours' | null;
  closedExceptionId: Id | null;
  /** Tariff that prices this date (exception tariff, else season, else base). */
  tariffId: Id;
  /** Tariff the season rules alone would give. */
  seasonalTariffId: Id;
  /** Exception that changes the price on this date, if any. */
  priceExceptionId: Id | null;
  /** Identifies the price source, to tell whether two days are priced the same way. */
  priceKey: string;
}

export function baseTariff(catalog: Catalog): Tariff {
  const base = catalog.tariffs.find((t) => t.isBase && t.active);
  if (!base) throw new Error('Catalog has no active base tariff');
  return base;
}

function inList(list: number[], value: number): boolean {
  return list.length === 0 || list.includes(value);
}

export function seasonalTariff(catalog: Catalog, date: ISODate): Tariff {
  const month = monthOf(date);
  const day = weekday(date);
  let best: Tariff | null = null;
  for (const tariff of catalog.tariffs) {
    if (!tariff.active || tariff.isBase || !tariff.season) continue;
    if (!inList(tariff.season.months, month) || !inList(tariff.season.weekdays, day)) continue;
    if (!best || tariff.priority > best.priority) best = tariff;
  }
  return best ?? baseTariff(catalog);
}

function covers(exception: DateException, date: ISODate): boolean {
  return exception.from <= date && date <= exception.to;
}

function span(exception: DateException): number {
  return dayNumber(exception.to) - dayNumber(exception.from);
}

/** The most specific exception wins: the shortest range, then the one added last. */
function mostSpecific(list: DateException[]): DateException | null {
  let best: DateException | null = null;
  for (const exception of list) {
    if (!best || span(exception) <= span(best)) best = exception;
  }
  return best;
}

function periodMatches(rule: OpeningRule, date: ISODate): boolean {
  const period = rule.period;
  if (!period) return true;
  if (period.kind === 'dates') return period.from <= date && date <= period.to;
  const md = monthDay(date);
  return period.from <= period.to
    ? period.from <= md && md <= period.to
    : md >= period.from || md <= period.to;
}

function specificity(rule: OpeningRule): number {
  if (!rule.period) return 0;
  return rule.period.kind === 'yearly' ? 1 : 2;
}

/** Dated periods beat yearly ones, which beat always-on rules; then priority, then the later rule. */
export function openingRuleFor(catalog: Catalog, date: ISODate): OpeningRule | null {
  const day = weekday(date);
  let best: OpeningRule | null = null;
  for (const rule of catalog.openingRules) {
    if (!rule.weekdays.includes(day) || !periodMatches(rule, date)) continue;
    if (
      !best ||
      specificity(rule) > specificity(best) ||
      (specificity(rule) === specificity(best) && rule.priority >= best.priority)
    ) {
      best = rule;
    }
  }
  return best;
}

export function resolveDay(catalog: Catalog, date: ISODate): DayInfo {
  const covering = catalog.dateExceptions.filter((e) => covers(e, date));
  const closing = mostSpecific(covering.filter((e) => e.action.kind === 'closed'));
  const pricing = mostSpecific(covering.filter((e) => e.action.kind !== 'closed'));
  const seasonal = seasonalTariff(catalog, date);

  let tariffId = seasonal.id;
  let priceKey = `tariff:${seasonal.id}`;
  if (pricing && pricing.action.kind === 'tariff') {
    tariffId = pricing.action.tariffId;
    priceKey = `tariff:${tariffId}`;
  } else if (pricing && pricing.action.kind === 'customPrices') {
    priceKey = `exception:${pricing.id}`;
  }

  const rule = openingRuleFor(catalog, date);
  const open = rule && !rule.closed && rule.close > rule.open;
  const closedBy = closing ? 'exception' : open ? null : 'hours';

  return {
    date,
    weekday: weekday(date),
    hours: closedBy === null && rule ? { open: rule.open, close: rule.close } : null,
    closedBy,
    closedExceptionId: closing ? closing.id : null,
    tariffId,
    seasonalTariffId: seasonal.id,
    priceExceptionId: pricing ? pricing.id : null,
    priceKey,
  };
}

/** Hours the point would keep on this date if no closing exception applied. */
export function regularHours(catalog: Catalog, date: ISODate): { open: Minutes; close: Minutes } | null {
  const rule = openingRuleFor(catalog, date);
  return rule && !rule.closed && rule.close > rule.open ? { open: rule.open, close: rule.close } : null;
}
