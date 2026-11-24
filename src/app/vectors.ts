// Test cases as data, runnable in Node tests and in the browser ("O pokazie").

import { checkOrder, orderWindow } from '../core/availability.ts';
import { quote } from '../core/pricing.ts';
import type { Catalog, Id, OrderInput, Reservation } from '../core/types.ts';

/** A change an administrator could make in the panel, applied to a copy of the catalog. */
export interface CatalogPatch {
  settings?: Record<string, any>;
  bands?: Array<Record<string, any> & { id: Id }>;
  rates?: Array<{ tariffId: Id; variantId: Id; bandId: Id; amount: number }>;
  dateExceptions?: Array<Record<string, any> & { id: Id }>;
  openingRules?: Array<Record<string, any> & { id: Id }>;
  services?: Array<Record<string, any> & { id: Id }>;
  statuses?: Array<Record<string, any> & { id: Id }>;
  units?: Array<Record<string, any> & { id: Id }>;
  unitOutages?: Array<Record<string, any> & { id: Id }>;
  variants?: Array<Record<string, any> & { id: Id }>;
}

function deepMerge(target: any, patch: any): any {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && out[key] !== null
        ? deepMerge(out[key], value)
        : value;
  }
  return out;
}

function upsert(list: any[], items: any[] | undefined, tenantId: Id, defaults: Record<string, any> = {}): any[] {
  if (!items) return list;
  const out = [...list];
  for (const item of items) {
    const index = out.findIndex((x) => x.id === item.id);
    if (index >= 0) out[index] = { ...out[index], ...item };
    else out.push({ tenantId, version: 1, ...defaults, ...item });
  }
  return out;
}

export function applyPatch(catalog: Catalog, patch: CatalogPatch | undefined): Catalog {
  if (!patch) return catalog;
  const t = catalog.tenant.id;
  const next: Catalog = JSON.parse(JSON.stringify(catalog));
  if (patch.settings) next.settings = deepMerge(next.settings, patch.settings);
  next.bands = upsert(next.bands, patch.bands, t);
  next.dateExceptions = upsert(next.dateExceptions, patch.dateExceptions, t, { note: '' });
  if (patch.openingRules) next.openingRules = upsert([], patch.openingRules, t, { period: null, closed: false, priority: 0 });
  next.services = upsert(next.services, patch.services, t);
  next.statuses = upsert(next.statuses, patch.statuses, t);
  next.units = upsert(next.units, patch.units, t, { activeFrom: null, retiredFrom: null, note: '' });
  next.unitOutages = upsert(next.unitOutages, patch.unitOutages, t, { reason: '' });
  next.variants = upsert(next.variants, patch.variants, t);
  for (const rate of patch.rates ?? []) {
    next.rates = next.rates.filter(
      (r) => !(r.tariffId === rate.tariffId && r.variantId === rate.variantId && r.bandId === rate.bandId),
    );
    next.rates.push({ tenantId: t, ...rate });
  }
  return next;
}

/** Null when every field listed in `expected` has that value in `actual`; otherwise the first difference. */
export function subsetDiff(actual: any, expected: any, path = ''): string | null {
  if (expected === null || typeof expected !== 'object') {
    return Object.is(actual, expected) ? null : `${path || 'wartość'}: oczekiwano ${JSON.stringify(expected)}, jest ${JSON.stringify(actual)}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: oczekiwano listy`;
    if (actual.length !== expected.length) return `${path}: oczekiwano ${expected.length} pozycji, jest ${actual.length}`;
    for (let i = 0; i < expected.length; i++) {
      const diff = subsetDiff(actual[i], expected[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (actual === null || typeof actual !== 'object') return `${path}: oczekiwano obiektu, jest ${JSON.stringify(actual)}`;
  for (const [key, value] of Object.entries(expected)) {
    const diff = subsetDiff(actual[key], value, path ? `${path}.${key}` : key);
    if (diff) return diff;
  }
  return null;
}

let counter = 0;

/** Builds a stored reservation from an order, for checks that need existing bookings. */
export function makeReservation(
  catalog: Catalog,
  order: Partial<OrderInput> & { startDate: string; items?: OrderInput['items'] },
  statusId: Id = 'new',
): Reservation {
  const full: OrderInput = {
    mode: order.mode ?? 'days',
    startDate: order.startDate,
    endDate: order.endDate ?? order.startDate,
    startMinute: order.startMinute,
    endMinute: order.endMinute,
    items: order.items ?? [],
    services: order.services ?? [],
  };
  const window = orderWindow(catalog, full);
  if (!window) throw new Error('makeReservation: order has no window');
  counter += 1;
  return {
    id: `r${counter}`,
    tenantId: catalog.tenant.id,
    version: 1,
    number: `T-${counter}`,
    createdAt: '2027-01-01T00:00:00.000Z',
    source: 'manual',
    channelId: null,
    statusId,
    customer: { name: 'Test', phone: '', email: '', consentAt: null },
    mode: full.mode,
    startDate: window.startDate,
    startMinute: window.startMinute,
    endDate: window.endDate,
    endMinute: window.endMinute,
    items: [
      ...full.items.map((i) => ({ kind: 'rental' as const, refId: i.variantId, quantity: i.quantity, unitPrice: null, lineTotal: null })),
      ...full.services.map((i) => ({ kind: 'service' as const, refId: i.serviceId, quantity: i.quantity, unitPrice: null, lineTotal: null })),
    ],
    total: 0,
    priceStatus: 'final',
    toBeAgreed: [],
    calcVersion: 'test',
    manualAmount: null,
    notes: '',
    history: [],
    idempotencyKey: null,
  };
}

export interface CheckResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

interface Vectors {
  baseline: { cases: Array<{ name: string; order: OrderInput; expectedTotal: number }> };
  scenarios: { cases: Array<{ name: string; order: OrderInput; patch?: CatalogPatch; expect: any }> };
}

/** Runs the engine checks against a catalog. Used by the "O pokazie" page with the seed catalog. */
export function runSelfCheck(catalog: Catalog, vectors: Vectors): CheckResult[] {
  const results: CheckResult[] = [];
  const attempt = (group: string, name: string, run: () => string | null): void => {
    try {
      const diff = run();
      results.push({ group, name, ok: diff === null, detail: diff ?? '' });
    } catch (error) {
      results.push({ group, name, ok: false, detail: String(error) });
    }
  };
  for (const c of vectors.baseline.cases) {
    attempt('Ceny: tabela bazowa', c.name, () => subsetDiff(quote(catalog, c.order), { total: c.expectedTotal, priceStatus: 'final' }));
  }
  for (const c of vectors.scenarios.cases) {
    attempt('Ceny: reguły', c.name, () => subsetDiff(quote(applyPatch(catalog, c.patch), c.order), c.expect));
  }

  const blocking = catalog.statuses.filter((s) => s.blocksStock);
  const open = catalog.statuses.filter((s) => !s.blocksStock);
  const variant = catalog.variants.find((v) => v.active);
  if (variant) {
    const date = '2031-07-08';
    const capacity = catalog.units.filter((u) => u.variantId === variant.id && u.activeFrom === null && u.retiredFrom === null).length;
    const one = (quantity: number): OrderInput => ({ mode: 'days', startDate: date, endDate: date, items: [{ variantId: variant.id, quantity }], services: [] });
    const ok = (reservations: Reservation[], order: OrderInput): boolean => checkOrder({ catalog, reservations }, order).ok;
    const expect = (name: string, actual: boolean, wanted: boolean): void =>
      attempt('Dostępność', name, () => (actual === wanted ? null : `oczekiwano ${wanted ? 'zgody' : 'odmowy'}`));
    expect('Bez rezerwacji wolne są wszystkie sztuki', ok([], one(capacity)), true);
    expect('Więcej sztuk, niż jest w ofercie: odmowa', ok([], one(capacity + 1)), false);
    for (const status of blocking) {
      const taken = makeReservation(catalog, one(capacity), status.id);
      expect(`Status „${status.name}” blokuje sprzęt`, ok([taken], one(1)), false);
    }
    for (const status of open) {
      const taken = makeReservation(catalog, one(capacity), status.id);
      expect(`Status „${status.name}” nie blokuje sprzętu`, ok([taken], one(1)), true);
    }
    const hoursOrder = (from: number, to: number, quantity: number): OrderInput => ({
      mode: 'hours', startDate: date, endDate: date, startMinute: from * 60, endMinute: to * 60,
      items: [{ variantId: variant.id, quantity }], services: [],
    });
    const hoursOf = catalog.openingRules.find((r) => !r.closed);
    if (hoursOf && blocking[0]) {
      const start = Math.ceil(hoursOf.open / 60);
      const morning = makeReservation(catalog, hoursOrder(start, start + 2, capacity), blocking[0].id);
      expect('Zwrot i wydanie o tej samej godzinie nie kolidują', ok([morning], hoursOrder(start + 2, start + 4, capacity)), true);
      expect('Nakładające się godziny: odmowa', ok([morning], hoursOrder(start + 1, start + 3, 1)), false);
    }
  }
  return results;
}
