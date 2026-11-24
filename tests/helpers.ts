import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Catalog, Id, OrderInput, Reservation } from '../src/core/types.ts';
import { orderWindow } from '../src/core/availability.ts';
import type { SeedFile } from '../src/data/seed.ts';

export const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

export function loadSeed(): SeedFile {
  return readJson<SeedFile>('../src/data/seed/skybike.json');
}

export function seedCatalog(): Catalog {
  return loadSeed().catalog;
}

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
      value !== null && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object'
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

/** Asserts that every field listed in `expected` has that value in `actual`. Arrays must match in length. */
export function assertSubset(actual: any, expected: any, path = ''): void {
  if (expected === null || typeof expected !== 'object') {
    assert.deepStrictEqual(actual, expected, `${path || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected an array`);
    assert.equal(actual.length, expected.length, `${path}: expected ${expected.length} items, got ${actual.length}`);
    expected.forEach((item, i) => assertSubset(actual[i], item, `${path}[${i}]`));
    return;
  }
  assert.ok(actual !== null && typeof actual === 'object', `${path}: expected an object, got ${JSON.stringify(actual)}`);
  for (const [key, value] of Object.entries(expected)) assertSubset(actual[key], value, path ? `${path}.${key}` : key);
}

let counter = 0;

/** Builds a stored reservation for availability tests. */
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

export const days = (startDate: string, endDate: string, items: Array<[Id, number]>): OrderInput => ({
  mode: 'days',
  startDate,
  endDate,
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
  services: [],
});

export const hours = (date: string, from: number, to: number, items: Array<[Id, number]>): OrderInput => ({
  mode: 'hours',
  startDate: date,
  endDate: date,
  startMinute: from * 60,
  endMinute: to * 60,
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
  services: [],
});
