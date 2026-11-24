// A made-up second rental (kayaks) with a different fleet, thresholds, hours, statuses and
// discount. If these tests pass, nothing in the engines is tied to SKY BIKE.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capacityOn, checkOrder, dayAvailability } from '../src/core/availability.ts';
import { quote } from '../src/core/pricing.ts';
import type { Catalog, Unit } from '../src/core/types.ts';
import { validateCatalog } from '../src/core/validate.ts';
import { MemoryRepository } from '../src/data/memory.ts';
import { days, hours } from './helpers.ts';

const t = 'kajaki';
const rec = <T extends object>(fields: T): T & { tenantId: string; version: number } => ({ ...fields, tenantId: t, version: 1 });
const units: Unit[] = [
  ...Array.from({ length: 12 }, (_, i) => rec({ id: `k2-${i + 1}`, variantId: 'k2', code: `K2-${String(i + 1).padStart(3, '0')}`, activeFrom: null, retiredFrom: null, note: '' })),
  ...Array.from({ length: 2 }, (_, i) => rec({ id: `k1-${i + 1}`, variantId: 'k1', code: `K1-${String(i + 1).padStart(3, '0')}`, activeFrom: null, retiredFrom: null, note: '' })),
];
const catalog: Catalog = {
  tenant: { id: t, name: 'Przystań Kajakowa', address: 'ul. Rzeczna 1', locale: 'pl-PL', currency: 'PLN', timeZone: 'Europe/Warsaw', reservationPrefix: 'KJ', dictionary: { unit: 'kajak' } },
  settings: {
    tenantId: t,
    version: 1,
    hourly: { minHours: 1, maxHours: 12, stepMinutes: 30 },
    maxRentalDays: 14,
    mixedRoundingGrosze: 500,
    groupDiscount: { active: true, minUnits: 6, percent: 10, base: 'rental', marksToBeAgreed: false },
    limits: { unitsPerOrder: 20, unitsPerProduct: 20 },
    delivery: { vehicleCapacity: 8 },
    payments: { onlineEnabled: true },
    calendar: { lowStockThreshold: 2, horizonDays: 60 },
    booking: { sameDayDaysUntil: null },
  },
  bands: [
    rec({ id: 'h2', kind: 'hours' as const, maxHours: 2, label: 'Do 2 h', order: 0 }),
    rec({ id: 'h6', kind: 'hours' as const, maxHours: 6, label: 'Do 6 h', order: 1 }),
    rec({ id: 'd', kind: 'day' as const, label: 'Dzień', order: 2 }),
    rec({ id: 'w', kind: 'days' as const, days: 5, label: 'Spływ 5 dni', order: 3 }),
  ],
  tariffs: [
    rec({ id: 'zwykla', name: 'Zwykła', isBase: true, priority: 0, active: true, season: null }),
    rec({ id: 'weekend', name: 'Weekend', isBase: false, priority: 5, active: true, season: { months: [], weekdays: [6, 7] } }),
  ],
  rates: [
    ['zwykla', 'k2', 'h2', 4000], ['zwykla', 'k2', 'h6', 7000], ['zwykla', 'k2', 'd', 9000], ['zwykla', 'k2', 'w', 36000],
    ['weekend', 'k2', 'h2', 5000], ['weekend', 'k2', 'h6', 9000], ['weekend', 'k2', 'd', 12000], ['weekend', 'k2', 'w', 45000],
    ['zwykla', 'k1', 'h2', 3000], ['zwykla', 'k1', 'h6', 5000], ['zwykla', 'k1', 'd', 7000], ['zwykla', 'k1', 'w', 28000],
    ['weekend', 'k1', 'h2', 4000], ['weekend', 'k1', 'h6', 6000], ['weekend', 'k1', 'd', 9000], ['weekend', 'k1', 'w', 35000],
  ].map(([tariffId, variantId, bandId, amount]) => ({ tenantId: t, tariffId, variantId, bandId, amount }) as Catalog['rates'][number]),
  dateExceptions: [],
  openingRules: [rec({ id: 'o', period: null, weekdays: [1, 2, 3, 4, 5, 6, 7], closed: false, open: 480, close: 1200, priority: 0 })],
  products: [rec({ id: 'kajak', name: 'Kajak', codePrefix: 'K', typeLabel: 'turystyczny', audience: '', use: '', specification: '', image: null, route: null, tileFields: ['name'], active: true, order: 0 })],
  variants: [
    rec({ id: 'k2', productId: 'kajak', label: '2-osobowy', bufferMinutes: 30, active: true, order: 0 }),
    rec({ id: 'k1', productId: 'kajak', label: '1-osobowy', bufferMinutes: 30, active: true, order: 1 }),
  ],
  units,
  unitOutages: [],
  serviceCategories: [rec({ id: 'transport', name: 'Transport', requestType: 'Transport', noneLabel: 'Bez transportu', order: 0 })],
  services: [rec({ id: 'bus', categoryId: 'transport', name: 'Powrót busem', billing: 'perUnit' as const, price: 1500, limitedByVehicle: false, stock: null, needsAddress: false, active: true, order: 0 })],
  statuses: [
    rec({ id: 'zapytanie', name: 'Zapytanie', order: 0, blocksStock: false, isInitial: true, tone: 'new' as const }),
    rec({ id: 'zadatek', name: 'Zadatek wpłacony', order: 1, blocksStock: true, isInitial: false, tone: 'ok' as const }),
  ],
  channels: [rec({ id: 'tel', name: 'Telefon', order: 0 })],
  content: [],
  users: [],
};

describe('drugi najemca: inna flota, progi, godziny, statusy i rabat', () => {
  it('katalog jest poprawny', () => {
    assert.deepEqual(validateCatalog(catalog), { errors: [], warnings: [] });
    assert.equal(capacityOn(catalog, 'k2', '2027-07-06'), 12);
  });
  it('dwa progi godzinowe: 2 h, 5 h i 8 h trafiają do właściwych cen', () => {
    const price = (from: number, to: number) => quote(catalog, hours('2027-07-06', from, to, [['k2', 1]])).total;
    assert.equal(price(8, 10), 4000);
    assert.equal(price(8, 13), 7000);
    assert.equal(price(8, 16), 9000);
  });
  it('pakiet 5 dni przez weekend: proporcja i zaokrąglenie do 5 zł', () => {
    // pon-pt: 5 dni zwykłych = 360 zł. śr-nd: 3/5 x 360 + 2/5 x 450 = 396 -> 395 zł.
    assert.equal(quote(catalog, days('2027-07-05', '2027-07-09', [['k2', 1]])).total, 36000);
    assert.equal(quote(catalog, days('2027-07-07', '2027-07-11', [['k2', 1]])).total, 39500);
  });
  it('2 dni nie mają pakietu: do ustalenia', () => {
    const q = quote(catalog, days('2027-07-06', '2027-07-07', [['k2', 1]]));
    assert.deepEqual(q.toBeAgreed, [{ code: 'noPackageForLength', refId: 'k2' }]);
  });
  it('rabat od 6 sztuk, 10% tylko od sprzętu, bez oznaczenia do ustalenia', () => {
    const q = quote(catalog, { ...days('2027-07-06', '2027-07-06', [['k2', 5], ['k1', 1]]), services: [{ serviceId: 'bus', quantity: 11 }] });
    assert.equal(q.rentalSubtotal, 52000);
    assert.equal(q.servicesSubtotal, 16500);
    assert.deepEqual(q.discount, { percent: 10, base: 52000, amount: 5200 });
    assert.equal(q.total, 63300);
    assert.equal(q.priceStatus, 'final');
  });
  it('12 kajaków: trzynasty nie przejdzie, a godziny 8:00-20:00 i krok 30 minut działają', () => {
    assert.ok(checkOrder({ catalog, reservations: [] }, days('2027-07-06', '2027-07-06', [['k2', 12]])).ok);
    const tooMany = checkOrder({ catalog, reservations: [] }, days('2027-07-06', '2027-07-06', [['k2', 13]]));
    assert.deepEqual(tooMany.problems, [{ code: 'shortage', variantId: 'k2', requested: 13, free: 12 }]);
    const evening = { ...hours('2027-07-06', 18, 20, [['k1', 1]]), startMinute: 18 * 60 + 30 };
    assert.ok(checkOrder({ catalog, reservations: [] }, evening).ok);
    assert.equal(dayAvailability({ catalog, reservations: [] }, '2027-07-06', [{ variantId: 'k1', quantity: 1 }]).low, true);
  });
  it('status początkowy „Zapytanie” nie blokuje sprzętu, „Zadatek wpłacony” blokuje', async () => {
    const repo = new MemoryRepository({ catalog, reservations: [] }, { now: () => Date.parse('2027-07-01T08:00:00Z') });
    const customer = { name: 'Test', phone: '', email: 'test@example.com', consentAt: null };
    const order = days('2027-07-06', '2027-07-06', [['k1', 2]]);
    const actor = { role: 'team' as const, name: 'obsługa' };
    const first = await repo.createReservation({ order, customer, source: 'manual', channelId: 'tel' }, { actor, idempotencyKey: null });
    assert.ok(first.ok);
    assert.equal(first.reservation.number, 'KJ-2027-0001');
    const second = await repo.createReservation({ order, customer, source: 'manual', channelId: 'tel' }, { actor, idempotencyKey: null });
    assert.ok(second.ok, 'zapytanie nie powinno blokować');
    assert.ok((await repo.changeReservationStatus(first.reservation.id, 'zadatek', { actor, expectedVersion: 1 })).ok);
    const blocked = await repo.changeReservationStatus(second.reservation.id, 'zadatek', { actor, expectedVersion: 1 });
    assert.ok(!blocked.ok && blocked.error.code === 'unavailable');
  });
});
