// Pricing engine. Pure: order + catalog in, quote out. All amounts in grosze.
//
// Order of calculation:
//  1. each date gets its price source: date exception, else season tariff, else base tariff,
//  2. the rental length picks a band (short hours, day, package of N days),
//  3. a rental longer than the longest package has no automatic price ("to be agreed"),
//  4. days priced differently are mixed proportionally: each day brings 1/N of its band price,
//  5. services (equipment, delivery, on-request work) are added,
//  6. group discount from the configured number of units,
//  7. anything without an automatic price marks the order "to be agreed".

import type { Catalog, Grosze, Id, ISODate, ManualAmount, OrderInput, PriceBand, Rate } from './types.ts';
import { baseTariff, resolveDay } from './calendar.ts';
import type { DayInfo } from './calendar.ts';
import { percentOf, roundHalfUp } from './money.ts';
import { daysBetweenInclusive, eachDate } from './time.ts';

export const CALC_VERSION = 'core-1.0.0';

export type ToBeAgreedCode =
  | 'longerThanPackages'
  | 'noPackageForLength'
  | 'missingRate'
  | 'serviceQuote'
  | 'deliveryOverVehicleLimit'
  | 'groupDiscount'
  | 'individualTerms';

export interface ToBeAgreed {
  code: ToBeAgreedCode;
  refId: Id | null;
}

export type PricingMethod =
  | { code: 'short'; maxHours: number }
  | { code: 'dayByHours' }
  | { code: 'day' }
  | { code: 'package'; days: number }
  | { code: 'none' };

export interface RentalDayShare {
  date: ISODate;
  priceKey: string;
  tariffId: Id;
  /** This day's contribution to the price of one unit, before rounding. */
  share: number | null;
  /** The same day at the base tariff. */
  standardShare: number | null;
}

export interface RentalLine {
  kind: 'rental';
  variantId: Id;
  productId: Id;
  quantity: number;
  bandId: Id | null;
  method: PricingMethod;
  unitPrice: Grosze | null;
  lineTotal: Grosze | null;
  /** Price of one unit at the base tariff for the same length. */
  standardUnit: Grosze | null;
  standardTotal: Grosze | null;
  /** lineTotal - standardTotal: what the chosen dates change. */
  dateDifference: Grosze | null;
  /** Saving of the package against single days, for the whole line. */
  packageSaving: Grosze;
  /** True when the days of this rental do not all cost the same. */
  mixed: boolean;
  days: RentalDayShare[];
}

export interface ServiceLine {
  kind: 'service';
  serviceId: Id;
  categoryId: Id;
  quantity: number;
  unitPrice: Grosze | null;
  lineTotal: Grosze | null;
}

export interface Quote {
  calcVersion: string;
  currency: string;
  mode: OrderInput['mode'];
  days: number;
  hours: number | null;
  units: number;
  lines: RentalLine[];
  serviceLines: ServiceLine[];
  standardSubtotal: Grosze;
  dateDifference: Grosze;
  rentalSubtotal: Grosze;
  servicesSubtotal: Grosze;
  discount: { percent: number; base: Grosze; amount: Grosze } | null;
  total: Grosze;
  priceStatus: 'final' | 'toBeAgreed';
  toBeAgreed: ToBeAgreed[];
  onlinePaymentAllowed: boolean;
  /** For the team only: which tariffs or exceptions priced which dates. */
  sources: Array<{ priceKey: string; tariffId: Id; exceptionId: Id | null; dates: ISODate[] }>;
}

const rateCache = new WeakMap<Rate[], Map<string, Grosze>>();

function rateOf(catalog: Catalog, tariffId: Id, variantId: Id, bandId: Id): Grosze | null {
  let index = rateCache.get(catalog.rates);
  if (!index) {
    index = new Map();
    for (const rate of catalog.rates) index.set(`${rate.tariffId}|${rate.variantId}|${rate.bandId}`, rate.amount);
    rateCache.set(catalog.rates, index);
  }
  return index.get(`${tariffId}|${variantId}|${bandId}`) ?? null;
}

/** Price of one unit of a variant in a band on a date. Null when no price is defined. */
export function bandPriceOn(catalog: Catalog, day: DayInfo, variantId: Id, bandId: Id): Grosze | null {
  if (day.priceExceptionId) {
    const exception = catalog.dateExceptions.find((e) => e.id === day.priceExceptionId);
    if (exception && exception.action.kind === 'customPrices') {
      const custom = exception.action.prices.find((p) => p.variantId === variantId && p.bandId === bandId);
      if (custom) return custom.amount;
    }
  }
  // A tariff without its own price for this size and band falls back to the base tariff.
  return rateOf(catalog, day.tariffId, variantId, bandId) ?? rateOf(catalog, baseTariff(catalog).id, variantId, bandId);
}

export function dayBand(catalog: Catalog): PriceBand | null {
  return catalog.bands.find((b) => b.kind === 'day') ?? null;
}

function longestPackage(catalog: Catalog): number {
  return catalog.bands.reduce((max, b) => (b.kind === 'days' && b.days ? Math.max(max, b.days) : max), 1);
}

interface BandChoice {
  band: PriceBand | null;
  method: PricingMethod;
  reason: ToBeAgreedCode | null;
}

export function chooseBand(catalog: Catalog, mode: OrderInput['mode'], days: number, hours: number | null): BandChoice {
  if (mode === 'hours') {
    const short = catalog.bands
      .filter((b) => b.kind === 'hours' && b.maxHours !== undefined && (hours ?? 0) <= b.maxHours)
      .sort((a, b) => (a.maxHours ?? 0) - (b.maxHours ?? 0))[0];
    if (short) return { band: short, method: { code: 'short', maxHours: short.maxHours ?? 0 }, reason: null };
    const day = dayBand(catalog);
    return day
      ? { band: day, method: { code: 'dayByHours' }, reason: null }
      : { band: null, method: { code: 'none' }, reason: 'missingRate' };
  }
  if (days === 1) {
    const day = dayBand(catalog);
    return day
      ? { band: day, method: { code: 'day' }, reason: null }
      : { band: null, method: { code: 'none' }, reason: 'missingRate' };
  }
  const pack = catalog.bands.find((b) => b.kind === 'days' && b.days === days);
  if (pack) return { band: pack, method: { code: 'package', days }, reason: null };
  return {
    band: null,
    method: { code: 'none' },
    reason: days > longestPackage(catalog) ? 'longerThanPackages' : 'noPackageForLength',
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function quote(catalog: Catalog, order: OrderInput): Quote {
  const dates = eachDate(order.startDate, order.endDate);
  if (dates.length === 0) throw new RangeError('Order end date is before its start date');
  const days = order.mode === 'hours' ? 1 : daysBetweenInclusive(order.startDate, order.endDate);
  const hours =
    order.mode === 'hours' ? ((order.endMinute ?? 0) - (order.startMinute ?? 0)) / 60 : null;
  const dayInfos = (order.mode === 'hours' ? dates.slice(0, 1) : dates).map((d) => resolveDay(catalog, d));
  const base = baseTariff(catalog);
  const single = dayBand(catalog);
  const choice = chooseBand(catalog, order.mode, days, hours);
  const toBeAgreed: ToBeAgreed[] = [];
  const flag = (code: ToBeAgreedCode, refId: Id | null): void => {
    if (!toBeAgreed.some((t) => t.code === code && t.refId === refId)) toBeAgreed.push({ code, refId });
  };

  const lines: RentalLine[] = order.items.map((item) => {
    const variant = catalog.variants.find((v) => v.id === item.variantId);
    if (!variant) throw new Error(`Unknown variant: ${item.variantId}`);
    const band = choice.band;
    const n = dayInfos.length;
    const prices = band ? dayInfos.map((d) => bandPriceOn(catalog, d, variant.id, band.id)) : [];
    const standardUnit = band ? rateOf(catalog, base.id, variant.id, band.id) : null;
    const complete = band !== null && prices.every((p) => p !== null);

    let unitPrice: Grosze | null = null;
    let mixed = false;
    if (complete) {
      const known = prices as Grosze[];
      mixed = new Set(known).size > 1;
      unitPrice = mixed ? roundHalfUp(sum(known) / n, catalog.settings.mixedRoundingGrosze) : known[0]!;
    } else {
      flag(choice.reason ?? 'missingRate', variant.id);
    }

    let packageSaving = 0;
    if (unitPrice !== null && order.mode === 'days' && n > 1 && single) {
      const singles = dayInfos.map((d) => bandPriceOn(catalog, d, variant.id, single.id));
      if (singles.every((p) => p !== null)) {
        packageSaving = Math.max(0, sum(singles as Grosze[]) - unitPrice) * item.quantity;
      }
    }

    const lineTotal = unitPrice === null ? null : unitPrice * item.quantity;
    const standardTotal = standardUnit === null ? null : standardUnit * item.quantity;
    return {
      kind: 'rental',
      variantId: variant.id,
      productId: variant.productId,
      quantity: item.quantity,
      bandId: band ? band.id : null,
      method: choice.method,
      unitPrice,
      lineTotal,
      standardUnit,
      standardTotal,
      dateDifference: lineTotal !== null && standardTotal !== null ? lineTotal - standardTotal : null,
      packageSaving,
      mixed,
      days: dayInfos.map((d, i) => ({
        date: d.date,
        priceKey: d.priceKey,
        tariffId: d.tariffId,
        share: prices[i] === null || prices[i] === undefined ? null : (prices[i] as Grosze) / n,
        standardShare: standardUnit === null ? null : standardUnit / n,
      })),
    };
  });

  const units = sum(lines.map((l) => l.quantity));

  const serviceLines: ServiceLine[] = order.services.map((item) => {
    const service = catalog.services.find((s) => s.id === item.serviceId);
    if (!service) throw new Error(`Unknown service: ${item.serviceId}`);
    let unitPrice: Grosze | null = service.price;
    let lineTotal: Grosze | null = null;
    if (service.billing === 'quote' || service.price === null) {
      unitPrice = null;
      flag('serviceQuote', service.id);
    } else if (service.limitedByVehicle && units > catalog.settings.delivery.vehicleCapacity) {
      unitPrice = null;
      flag('deliveryOverVehicleLimit', service.id);
    } else if (service.billing === 'perUnitPerDay') {
      lineTotal = service.price * item.quantity * days;
    } else if (service.billing === 'perUnit') {
      lineTotal = service.price * item.quantity;
    } else {
      lineTotal = service.price;
    }
    return {
      kind: 'service',
      serviceId: service.id,
      categoryId: service.categoryId,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    };
  });

  if (order.individualTerms) flag('individualTerms', null);

  const rentalSubtotal = sum(lines.map((l) => l.lineTotal ?? 0));
  const servicesSubtotal = sum(serviceLines.map((l) => l.lineTotal ?? 0));
  const standardSubtotal = sum(lines.map((l) => (l.lineTotal === null ? 0 : (l.standardTotal ?? 0))));
  const dateDifference = sum(lines.map((l) => (l.dateDifference === null ? 0 : l.dateDifference)));

  const rule = catalog.settings.groupDiscount;
  let discount: Quote['discount'] = null;
  if (rule.active && units >= rule.minUnits && rule.percent > 0) {
    const discountBase = rule.base === 'order' ? rentalSubtotal + servicesSubtotal : rentalSubtotal;
    discount = { percent: rule.percent, base: discountBase, amount: percentOf(discountBase, rule.percent) };
    if (rule.marksToBeAgreed) flag('groupDiscount', null);
  }

  const total = rentalSubtotal + servicesSubtotal - (discount ? discount.amount : 0);
  const priceStatus = toBeAgreed.length > 0 ? 'toBeAgreed' : 'final';

  const sources: Quote['sources'] = [];
  for (const day of dayInfos) {
    const found = sources.find((s) => s.priceKey === day.priceKey);
    if (found) found.dates.push(day.date);
    else {
      sources.push({
        priceKey: day.priceKey,
        tariffId: day.tariffId,
        exceptionId: day.priceExceptionId,
        dates: [day.date],
      });
    }
  }

  return {
    calcVersion: CALC_VERSION,
    currency: catalog.tenant.currency,
    mode: order.mode,
    days,
    hours,
    units,
    lines,
    serviceLines,
    standardSubtotal,
    dateDifference,
    rentalSubtotal,
    servicesSubtotal,
    discount,
    total,
    priceStatus,
    toBeAgreed,
    onlinePaymentAllowed: priceStatus === 'final' && catalog.settings.payments.onlineEnabled && total > 0,
    sources,
  };
}

/** Price of a single day for one unit on a date, and its difference from the base tariff. */
export function dayPrice(
  catalog: Catalog,
  date: ISODate,
  variantId: Id,
): { price: Grosze | null; standard: Grosze | null; delta: Grosze | null } {
  const band = dayBand(catalog);
  if (!band) return { price: null, standard: null, delta: null };
  const price = bandPriceOn(catalog, resolveDay(catalog, date), variantId, band.id);
  const standard = rateOf(catalog, baseTariff(catalog).id, variantId, band.id);
  return { price, standard, delta: price !== null && standard !== null ? price - standard : null };
}

/** Difference shown on a calendar tile: how much one day on this date differs from the base price. */
export function dayPriceDelta(
  catalog: Catalog,
  date: ISODate,
  items: Array<{ variantId: Id; quantity: number }>,
): Grosze | null {
  let total = 0;
  for (const item of items) {
    const { delta } = dayPrice(catalog, date, item.variantId);
    if (delta === null) return null;
    total += delta * item.quantity;
  }
  return total;
}

/** A team member's manual amount replaces the calculated total; the quote itself is kept. */
export function amountDue(total: Grosze, manual: ManualAmount | null): Grosze {
  return manual ? manual.amount : total;
}

/** Rates for a tariff derived from the base tariff: a percentage or a fixed amount per cell, rounded to `unit`. */
export function ratesFromBase(
  catalog: Catalog,
  tariffId: Id,
  adjust: { kind: 'percent' | 'amount'; value: number },
  unit: Grosze = 100,
): Rate[] {
  const base = baseTariff(catalog);
  return catalog.rates
    .filter((r) => r.tariffId === base.id)
    .map((r) => ({
      tenantId: r.tenantId,
      tariffId,
      variantId: r.variantId,
      bandId: r.bandId,
      amount: Math.max(
        0,
        roundHalfUp(adjust.kind === 'percent' ? r.amount * (1 + adjust.value / 100) : r.amount + adjust.value, unit),
      ),
    }));
}
