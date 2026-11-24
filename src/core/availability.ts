// Availability engine. Pure. Nothing is stored as a counter:
//   capacity  = units of the variant that are in the offer and not in an outage at that moment,
//   occupancy = units in reservations whose status blocks stock and whose interval covers the moment,
//   free      = the lowest (capacity - occupancy) over the requested interval.
// Intervals are half-open: a return at 13:00 and a pick-up at 13:00 do not collide (with no buffer).

import type { Catalog, Id, ISODate, Minutes, OrderInput, Reservation, Zoned } from './types.ts';
import { regularHours, resolveDay } from './calendar.ts';
import {
  absMinute,
  addDays,
  dateOfAbsMinute,
  daysBetweenInclusive,
  eachDate,
  isValidDate,
  MINUTES_PER_DAY,
} from './time.ts';

export interface AvailabilityContext {
  catalog: Catalog;
  reservations: Reservation[];
  /** Reservation being edited: its own items do not count against it. */
  excludeReservationId?: Id | null;
}

export type Problem =
  | { code: 'invalidDates' }
  | { code: 'tooLong'; maxDays: number }
  | { code: 'hoursSingleDate' }
  | { code: 'hoursRange'; minHours: number; maxHours: number }
  | { code: 'hoursStep'; stepMinutes: number }
  | { code: 'outsideHours'; open: Minutes; close: Minutes }
  | { code: 'closed'; dates: ISODate[] }
  | { code: 'past' }
  | { code: 'empty' }
  | { code: 'invalidQuantity'; refId: Id }
  | { code: 'unknownVariant'; variantId: Id }
  | { code: 'unknownService'; serviceId: Id }
  | { code: 'overOrderLimit'; limit: number }
  | { code: 'overProductLimit'; productId: Id; limit: number }
  | { code: 'shortage'; variantId: Id; requested: number; free: number }
  | { code: 'serviceShortage'; serviceId: Id; requested: number; free: number };

export interface OrderWindow {
  startDate: ISODate;
  startMinute: Minutes;
  endDate: ISODate;
  endMinute: Minutes;
  start: number;
  end: number;
}

interface Interval {
  start: number;
  end: number;
  quantity: number;
}

function blockingStatuses(catalog: Catalog): Set<Id> {
  return new Set(catalog.statuses.filter((s) => s.blocksStock).map((s) => s.id));
}

/** Units of a variant that can be rented on a date. */
export function capacityOn(catalog: Catalog, variantId: Id, date: ISODate): number {
  let count = 0;
  for (const unit of catalog.units) {
    if (unit.variantId !== variantId) continue;
    if (unit.activeFrom !== null && date < unit.activeFrom) continue;
    if (unit.retiredFrom !== null && date >= unit.retiredFrom) continue;
    const out = catalog.unitOutages.some((o) => o.unitId === unit.id && o.from <= date && date <= o.to);
    if (!out) count++;
  }
  return count;
}

function rentalIntervals(ctx: AvailabilityContext, variantId: Id): Interval[] {
  const blocking = blockingStatuses(ctx.catalog);
  const buffer = ctx.catalog.variants.find((v) => v.id === variantId)?.bufferMinutes ?? 0;
  const out: Interval[] = [];
  for (const r of ctx.reservations) {
    if (r.id === ctx.excludeReservationId || !blocking.has(r.statusId)) continue;
    for (const item of r.items) {
      if (item.kind !== 'rental' || item.refId !== variantId) continue;
      out.push({
        start: absMinute(r.startDate, r.startMinute),
        end: absMinute(r.endDate, r.endMinute) + buffer,
        quantity: item.quantity,
      });
    }
  }
  return out;
}

function serviceIntervals(ctx: AvailabilityContext, serviceId: Id): Interval[] {
  const blocking = blockingStatuses(ctx.catalog);
  const out: Interval[] = [];
  for (const r of ctx.reservations) {
    if (r.id === ctx.excludeReservationId || !blocking.has(r.statusId)) continue;
    for (const item of r.items) {
      if (item.kind !== 'service' || item.refId !== serviceId) continue;
      out.push({
        start: absMinute(r.startDate, r.startMinute),
        end: absMinute(r.endDate, r.endMinute),
        quantity: item.quantity,
      });
    }
  }
  return out;
}

function lowestFree(intervals: Interval[], a: number, b: number, capacityAt: (t: number) => number): number {
  const points = [a];
  for (const i of intervals) if (i.start > a && i.start < b) points.push(i.start);
  for (let t = (Math.floor(a / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY; t < b; t += MINUTES_PER_DAY) points.push(t);
  let lowest = Infinity;
  for (const t of points) {
    let used = 0;
    for (const i of intervals) if (i.start <= t && t < i.end) used += i.quantity;
    lowest = Math.min(lowest, capacityAt(t) - used);
  }
  return lowest;
}

/** Free units of a variant over [a, b). Negative means the variant is already overbooked there. */
export function freeUnits(ctx: AvailabilityContext, variantId: Id, a: number, b: number): number {
  return lowestFree(rentalIntervals(ctx, variantId), a, b, (t) =>
    capacityOn(ctx.catalog, variantId, dateOfAbsMinute(t)),
  );
}

/** Free pieces of a service with stock over [a, b). Null when the service has no stock limit. */
export function freeServiceUnits(ctx: AvailabilityContext, serviceId: Id, a: number, b: number): number | null {
  const stock = ctx.catalog.services.find((s) => s.id === serviceId)?.stock ?? null;
  if (stock === null) return null;
  return lowestFree(serviceIntervals(ctx, serviceId), a, b, () => stock);
}

function dateRangeOk(order: OrderInput): boolean {
  return isValidDate(order.startDate) && isValidDate(order.endDate) && order.startDate <= order.endDate;
}

/** The exact interval an order occupies. Day rentals run from opening on the first day to closing on the last. */
export function orderWindow(catalog: Catalog, order: OrderInput): OrderWindow | null {
  if (!dateRangeOk(order)) return null;
  if (order.mode === 'hours') {
    if (order.startMinute === undefined || order.endMinute === undefined) return null;
    return {
      startDate: order.startDate,
      startMinute: order.startMinute,
      endDate: order.startDate,
      endMinute: order.endMinute,
      start: absMinute(order.startDate, order.startMinute),
      end: absMinute(order.startDate, order.endMinute),
    };
  }
  const first = resolveDay(catalog, order.startDate).hours ?? regularHours(catalog, order.startDate);
  const last = resolveDay(catalog, order.endDate).hours ?? regularHours(catalog, order.endDate);
  if (!first || !last) return null;
  return {
    startDate: order.startDate,
    startMinute: first.open,
    endDate: order.endDate,
    endMinute: last.close,
    start: absMinute(order.startDate, first.open),
    end: absMinute(order.endDate, last.close),
  };
}

function totals<T extends string>(items: Array<{ quantity: number } & Record<T, Id>>, key: T): Map<Id, number> {
  const map = new Map<Id, number>();
  for (const item of items) map.set(item[key], (map.get(item[key]) ?? 0) + item.quantity);
  return map;
}

/** Rules that do not depend on other reservations: dates, hours, closed days, limits. */
export function validateOrder(catalog: Catalog, order: OrderInput, now?: Zoned): Problem[] {
  const problems: Problem[] = [];
  const settings = catalog.settings;
  if (!dateRangeOk(order)) return [{ code: 'invalidDates' }];

  const dates = eachDate(order.startDate, order.endDate);
  // A date closed by an exception blocks any rental that includes it. A day the point is
  // regularly shut (opening hours) blocks only picking up or returning on that day.
  const closed = dates.filter((d, i) => {
    const day = resolveDay(catalog, d);
    if (day.closedBy === 'exception') return true;
    return day.closedBy === 'hours' && (i === 0 || i === dates.length - 1);
  });
  if (closed.length > 0) problems.push({ code: 'closed', dates: closed });

  if (order.mode === 'hours') {
    if (order.startDate !== order.endDate) problems.push({ code: 'hoursSingleDate' });
    const start = order.startMinute;
    const end = order.endMinute;
    const { minHours, maxHours, stepMinutes } = settings.hourly;
    if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)) {
      problems.push({ code: 'hoursRange', minHours, maxHours });
    } else {
      const length = end - start;
      if (length < minHours * 60 || length > maxHours * 60) problems.push({ code: 'hoursRange', minHours, maxHours });
      const hours = resolveDay(catalog, order.startDate).hours;
      if (hours) {
        if (start < hours.open || end > hours.close) {
          problems.push({ code: 'outsideHours', open: hours.open, close: hours.close });
        } else if ((start - hours.open) % stepMinutes !== 0 || length % stepMinutes !== 0) {
          problems.push({ code: 'hoursStep', stepMinutes });
        }
      }
    }
  } else if (daysBetweenInclusive(order.startDate, order.endDate) > settings.maxRentalDays) {
    problems.push({ code: 'tooLong', maxDays: settings.maxRentalDays });
  }

  if (now) {
    const window = orderWindow(catalog, order);
    const startsAt = window ? window.start : absMinute(order.startDate, 0);
    const pastDay = order.startDate < now.date;
    const pastHour = order.mode === 'hours' && startsAt < absMinute(now.date, now.minute);
    if (pastDay || pastHour) problems.push({ code: 'past' });
  }

  if (order.items.length === 0 && order.services.length === 0) problems.push({ code: 'empty' });

  for (const item of order.items) {
    const variant = catalog.variants.find((v) => v.id === item.variantId && v.active);
    const product = variant && catalog.products.find((p) => p.id === variant.productId && p.active);
    if (!variant || !product) problems.push({ code: 'unknownVariant', variantId: item.variantId });
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      problems.push({ code: 'invalidQuantity', refId: item.variantId });
    }
  }
  for (const item of order.services) {
    if (!catalog.services.some((s) => s.id === item.serviceId && s.active)) {
      problems.push({ code: 'unknownService', serviceId: item.serviceId });
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      problems.push({ code: 'invalidQuantity', refId: item.serviceId });
    }
  }

  const units = order.items.reduce((a, i) => a + i.quantity, 0);
  if (units > settings.limits.unitsPerOrder) {
    problems.push({ code: 'overOrderLimit', limit: settings.limits.unitsPerOrder });
  }
  const perProduct = new Map<Id, number>();
  for (const item of order.items) {
    const productId = catalog.variants.find((v) => v.id === item.variantId)?.productId;
    if (productId) perProduct.set(productId, (perProduct.get(productId) ?? 0) + item.quantity);
  }
  for (const [productId, count] of perProduct) {
    if (count > settings.limits.unitsPerProduct) {
      problems.push({ code: 'overProductLimit', productId, limit: settings.limits.unitsPerProduct });
    }
  }
  return problems;
}

export interface OrderCheck {
  ok: boolean;
  problems: Problem[];
  window: OrderWindow | null;
}

/** Full check before a reservation is saved: order rules plus stock against other reservations. */
export function checkOrder(ctx: AvailabilityContext, order: OrderInput, now?: Zoned): OrderCheck {
  const problems = validateOrder(ctx.catalog, order, now);
  const window = orderWindow(ctx.catalog, order);
  if (window && window.end > window.start) {
    for (const [variantId, requested] of totals(order.items, 'variantId')) {
      if (!ctx.catalog.variants.some((v) => v.id === variantId)) continue;
      const free = freeUnits(ctx, variantId, window.start, window.end);
      if (requested > free) problems.push({ code: 'shortage', variantId, requested, free: Math.max(0, free) });
    }
    for (const [serviceId, requested] of totals(order.services, 'serviceId')) {
      const free = freeServiceUnits(ctx, serviceId, window.start, window.end);
      if (free !== null && requested > free) {
        problems.push({ code: 'serviceShortage', serviceId, requested, free: Math.max(0, free) });
      }
    }
  }
  return { ok: problems.length === 0, problems, window };
}

export interface DayAvailability {
  date: ISODate;
  /** free: the whole request fits all day. partial: only some hours or fewer units. full: nothing. */
  status: 'closed' | 'free' | 'partial' | 'full';
  /** Free, but few units would remain after this request. */
  low: boolean;
  variants: Array<{ variantId: Id; requested: number; freeAllDay: number; freeBestSlot: number }>;
}

export function dayAvailability(
  ctx: AvailabilityContext,
  date: ISODate,
  items: Array<{ variantId: Id; quantity: number }>,
): DayAvailability {
  const hours = resolveDay(ctx.catalog, date).hours;
  if (!hours) return { date, status: 'closed', low: false, variants: [] };
  const { stepMinutes, minHours } = ctx.catalog.settings.hourly;
  const slot = Math.max(stepMinutes, minHours * 60);
  const variants = [...totals(items, 'variantId')].map(([variantId, requested]) => {
    const open = absMinute(date, hours.open);
    const close = absMinute(date, hours.close);
    let best = -Infinity;
    for (let t = open; t + slot <= close; t += stepMinutes) {
      best = Math.max(best, freeUnits(ctx, variantId, t, t + slot));
    }
    const freeAllDay = Math.max(0, freeUnits(ctx, variantId, open, close));
    return { variantId, requested, freeAllDay, freeBestSlot: Math.max(0, best, freeAllDay) };
  });
  const fits = variants.every((v) => v.freeAllDay >= v.requested);
  const anything = variants.some((v) => v.freeBestSlot > 0);
  const status = fits ? 'free' : anything ? 'partial' : 'full';
  const threshold = ctx.catalog.settings.calendar.lowStockThreshold;
  const low = fits && variants.some((v) => v.freeAllDay - v.requested < threshold);
  return { date, status, low, variants };
}

/** First open date from `from` on which at least `quantity` units of any listed variant are free all day. */
export function nextAvailableDate(
  ctx: AvailabilityContext,
  variantIds: Id[],
  from: ISODate,
  quantity: number = 1,
): { date: ISODate; variantIds: Id[] } | null {
  const horizon = ctx.catalog.settings.calendar.horizonDays;
  for (let offset = 0; offset <= horizon; offset++) {
    const date = addDays(from, offset);
    const hours = resolveDay(ctx.catalog, date).hours;
    if (!hours) continue;
    const free = variantIds.filter(
      (id) => freeUnits(ctx, id, absMinute(date, hours.open), absMinute(date, hours.close)) >= quantity,
    );
    if (free.length > 0) return { date, variantIds: free };
  }
  return null;
}

/** Dates on which a variant has more blocking reservations than units. Used to warn before stock changes. */
export function findOverbookings(
  ctx: AvailabilityContext,
  variantId: Id,
  from: ISODate,
  to: ISODate,
): Array<{ date: ISODate; free: number }> {
  const out: Array<{ date: ISODate; free: number }> = [];
  for (const date of eachDate(from, to)) {
    const free = freeUnits(ctx, variantId, absMinute(date, 0), absMinute(date, 0) + MINUTES_PER_DAY);
    if (free < 0) out.push({ date, free });
  }
  return out;
}

/** Reservations that overlap a date. Used to warn before a date is closed. */
export function reservationsOnDate(ctx: AvailabilityContext, date: ISODate, blockingOnly = true): Reservation[] {
  const blocking = blockingStatuses(ctx.catalog);
  return ctx.reservations.filter(
    (r) => r.startDate <= date && date <= r.endDate && (!blockingOnly || blocking.has(r.statusId)),
  );
}

/** Last date with a blocking reservation of the variant, to bound overbooking searches. */
export function lastReservedDate(ctx: AvailabilityContext, variantId: Id): ISODate | null {
  const blocking = blockingStatuses(ctx.catalog);
  let last: ISODate | null = null;
  for (const r of ctx.reservations) {
    if (!blocking.has(r.statusId)) continue;
    if (!r.items.some((i) => i.kind === 'rental' && i.refId === variantId)) continue;
    if (last === null || r.endDate > last) last = r.endDate;
  }
  return last;
}
