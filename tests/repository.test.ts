import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capacityOn, findOverbookings } from '../src/core/availability.ts';
import { quote } from '../src/core/pricing.ts';
import type { Actor, Customer } from '../src/core/types.ts';
import { MemoryRepository } from '../src/data/memory.ts';
import type { NewReservation } from '../src/data/repository.ts';
import { days, hours, loadSeed } from './helpers.ts';

// 1 czerwca 2027, 10:00 w Szczyrku.
const NOW = Date.parse('2027-06-01T08:00:00Z');
function repo(clock: { ms: number } = { ms: NOW }): MemoryRepository {
  let n = 0;
  return new MemoryRepository(loadSeed(), { now: () => clock.ms, newId: () => `id-${++n}` });
}
const admin: Actor = { role: 'admin', name: 'Administrator' };
const team: Actor = { role: 'team', name: 'Ola z zespołu' };
const driver: Actor = { role: 'driver', name: 'Marek' };
const client: Actor = { role: 'client', name: 'klient' };
const customer: Customer = { name: 'Test Testowy', phone: '500 000 000', email: 'test@example.com', consentAt: '2027-06-01T08:00:00Z' };
const shop = (order: NewReservation['order']): NewReservation => ({ order, customer, source: 'shop', channelId: 'web' });
const D = '2027-07-06';

describe('repozytorium: dane startowe', () => {
  it('wczytuje 6 przykładowych zgłoszeń z policzonymi kwotami', async () => {
    const list = await repo().listReservations();
    assert.deepEqual(list.map((r) => r.number), ['SB-2027-0001', 'SB-2027-0002', 'SB-2027-0003', 'SB-2027-0004', 'SB-2027-0005', 'SB-2027-0006']);
    const byNumber = Object.fromEntries(list.map((r) => [r.number, r]));
    assert.equal(byNumber['SB-2027-0001']!.total, 326800);
    assert.deepEqual(byNumber['SB-2027-0001']!.toBeAgreed, ['deliveryOverVehicleLimit:delivery-city', 'groupDiscount']);
    assert.equal(byNumber['SB-2027-0004']!.total, 34000);
    assert.equal(byNumber['SB-2027-0004']!.priceStatus, 'final');
    assert.equal(byNumber['SB-2027-0005']!.total, 60000);
    assert.equal(byNumber['SB-2027-0006']!.total, 205200);
    assert.equal(byNumber['SB-2027-0006']!.priceStatus, 'toBeAgreed');
  });
  it('przykładowe zgłoszenia nie przekraczają stanu', async () => {
    const r = repo();
    const catalog = await r.getCatalog();
    const reservations = await r.listReservations();
    for (const variant of catalog.variants) {
      assert.deepEqual(findOverbookings({ catalog, reservations }, variant.id, '2027-06-01', '2027-06-30'), []);
    }
  });
  it('najem dzienny zapisuje godziny otwarcia jako początek i koniec', async () => {
    const first = (await repo().listReservations())[0]!;
    assert.deepEqual([first.startDate, first.startMinute, first.endDate, first.endMinute], ['2027-06-05', 540, '2027-06-06', 1080]);
  });
  it('katalog oddawany na zewnątrz jest kopią', async () => {
    const r = repo();
    const copy = await r.getCatalog();
    copy.units.length = 0;
    copy.settings.delivery.vehicleCapacity = 99;
    const again = await r.getCatalog();
    assert.equal(again.units.length, 16);
    assert.equal(again.settings.delivery.vehicleCapacity, 4);
  });
});

describe('repozytorium: zapis rezerwacji w jednej operacji', () => {
  it('przyjęta rezerwacja dostaje numer, status początkowy i kwotę z silnika cen', async () => {
    const r = repo();
    const order = days(D, '2027-07-07', [['ns-s', 1], ['ns-m', 2]]);
    const result = await r.createReservation(shop(order), { actor: client, idempotencyKey: 'k1' });
    assert.ok(result.ok);
    assert.equal(result.reservation.number, 'SB-2027-0007');
    assert.equal(result.reservation.statusId, 'new');
    assert.equal(result.reservation.total, quote(await r.getCatalog(), order).total);
    assert.equal(result.reservation.total, 135000);
    assert.equal(result.reservation.source, 'shop');
    assert.equal((await r.listReservations()).length, 7);
  });
  it('powtórzone wysłanie z tym samym kluczem nie tworzy duplikatu', async () => {
    const r = repo();
    const input = shop(days(D, D, [['ns-m', 1]]));
    const a = await r.createReservation(input, { actor: client, idempotencyKey: 'same' });
    const b = await r.createReservation(input, { actor: client, idempotencyKey: 'same' });
    assert.ok(a.ok && b.ok);
    assert.equal(b.repeated, true);
    assert.equal(b.reservation.id, a.reservation.id);
    assert.equal((await r.listReservations()).length, 7);
  });
  it('dwie osoby rezerwują ostatnią sztukę w tej samej chwili: jedna przechodzi, druga dostaje brak', async () => {
    const r = repo();
    const input = shop(days(D, D, [['cannondale-l', 1]]));
    const results = await Promise.all([
      r.createReservation(input, { actor: client, idempotencyKey: 'a' }),
      r.createReservation(input, { actor: client, idempotencyKey: 'b' }),
    ]);
    assert.deepEqual(results.map((x) => x.ok).sort(), [false, true]);
    const refused = results.find((x) => !x.ok);
    assert.ok(refused && !refused.ok);
    assert.deepEqual(refused.problems, [{ code: 'shortage', variantId: 'cannondale-l', requested: 1, free: 0 }]);
  });
  it('100 jednoczesnych prób na 3 sztuki: przechodzą dokładnie 3', async () => {
    const r = repo();
    const attempts = Array.from({ length: 100 }, (_, i) =>
      r.createReservation(shop(days(D, D, [['ns-m', 1]])), { actor: client, idempotencyKey: `k${i}` }),
    );
    const results = await Promise.all(attempts);
    assert.equal(results.filter((x) => x.ok).length, 3);
    const catalog = await r.getCatalog();
    assert.deepEqual(findOverbookings({ catalog, reservations: await r.listReservations() }, 'ns-m', D, D), []);
  });
  it('rezerwacja ze sklepu wstecz jest odrzucana, zgłoszenie ręczne z dzisiejszego ranka przechodzi', async () => {
    const r = repo();
    const earlier = hours('2027-06-01', 9, 11, [['ns-s', 1]]);
    const fromShop = await r.createReservation(shop(earlier), { actor: client, idempotencyKey: null });
    assert.ok(!fromShop.ok);
    assert.deepEqual(fromShop.problems.map((p) => p.code), ['past']);
    const manual = await r.createReservation({ ...shop(earlier), source: 'manual', channelId: 'phone' }, { actor: team, idempotencyKey: null });
    assert.ok(manual.ok);
  });
  it('ręcznie dodane zgłoszenie zmniejsza dostępność tak samo jak zgłoszenie ze sklepu', async () => {
    const r = repo();
    await r.createReservation({ ...shop(days(D, D, [['cannondale-l', 1]])), source: 'manual', channelId: 'phone' }, { actor: team, idempotencyKey: null });
    const second = await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null });
    assert.equal(second.ok, false);
  });
  it('numeracja zaczyna się od nowa w kolejnym roku', async () => {
    const clock = { ms: Date.parse('2028-01-02T10:00:00Z') };
    const result = await repo(clock).createReservation(shop(days('2028-02-01', '2028-02-01', [['ns-m', 1]])), { actor: client, idempotencyKey: null });
    assert.ok(result.ok);
    assert.equal(result.reservation.number, 'SB-2028-0001');
  });
});

describe('repozytorium: statusy, wersje, uprawnienia', () => {
  it('anulowanie zwalnia sprzęt dla następnej rezerwacji', async () => {
    const r = repo();
    const first = await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null });
    assert.ok(first.ok);
    assert.equal((await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null })).ok, false);
    const cancelled = await r.changeReservationStatus(first.reservation.id, 'cancelled', { actor: team, expectedVersion: 1 });
    assert.ok(cancelled.ok);
    assert.equal(cancelled.reservation.version, 2);
    assert.equal((await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null })).ok, true);
  });
  it('„Komunikacja z klientem” nadal blokuje sprzęt', async () => {
    const r = repo();
    const first = await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null });
    assert.ok(first.ok);
    await r.changeReservationStatus(first.reservation.id, 'contact', { actor: team, expectedVersion: 1 });
    assert.equal((await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null })).ok, false);
  });
  it('przywrócenie anulowanego zgłoszenia jest odmawiane, gdy sprzęt zajął ktoś inny', async () => {
    const r = repo();
    const first = await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null });
    assert.ok(first.ok);
    await r.changeReservationStatus(first.reservation.id, 'cancelled', { actor: team, expectedVersion: 1 });
    await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null });
    const back = await r.changeReservationStatus(first.reservation.id, 'confirmed', { actor: team, expectedVersion: 2 });
    assert.ok(!back.ok);
    assert.equal(back.error.code, 'unavailable');
  });
  it('równoczesna edycja: druga zmiana ze starą wersją jest odrzucana', async () => {
    const r = repo();
    const id = (await r.listReservations())[4]!.id;
    assert.ok((await r.changeReservationStatus(id, 'contact', { actor: team, expectedVersion: 1 })).ok);
    const stale = await r.changeReservationStatus(id, 'confirmed', { actor: team, expectedVersion: 1 });
    assert.ok(!stale.ok);
    assert.deepEqual(stale.error, { code: 'versionConflict', currentVersion: 2 });
  });
  it('historia zgłoszenia zapisuje kto i co zmienił', async () => {
    const r = repo();
    const id = (await r.listReservations())[4]!.id;
    const changed = await r.changeReservationStatus(id, 'contact', { actor: team, expectedVersion: 1, note: 'telefon do klienta' });
    assert.ok(changed.ok);
    const last = changed.reservation.history.at(-1)!;
    assert.equal(last.by, 'Ola z zespołu');
    assert.match(last.text, /Nowe -> Komunikacja z klientem \(telefon do klienta\)/);
  });
  it('kwota ręczna zapisuje autora, czas i powód, a suma z silnika zostaje', async () => {
    const r = repo();
    const before = (await r.listReservations())[4]!;
    const result = await r.setManualAmount(before.id, 55000, 'stały klient', { actor: team, expectedVersion: 1 });
    assert.ok(result.ok);
    assert.deepEqual(result.reservation.manualAmount, { amount: 55000, by: 'Ola z zespołu', at: '2027-06-01T08:00:00.000Z', reason: 'stały klient' });
    assert.equal(result.reservation.total, before.total);
  });
  it('kierowca nie zmienia statusu zgłoszenia ani oferty, zespół nie zmienia oferty', async () => {
    const r = repo();
    const id = (await r.listReservations())[0]!.id;
    const catalog = await r.getCatalog();
    const byDriver = await r.changeReservationStatus(id, 'cancelled', { actor: driver, expectedVersion: 1 });
    assert.ok(!byDriver.ok && byDriver.error.code === 'forbidden');
    for (const actor of [driver, team, client]) {
      const put = await r.putRecord('units', catalog.units[0]!, { actor, expectedVersion: 1 });
      assert.ok(!put.ok && put.error.code === 'forbidden');
      const settings = await r.updateSettings({ delivery: { vehicleCapacity: 9 } }, { actor, expectedVersion: 1 });
      assert.ok(!settings.ok && settings.error.code === 'forbidden');
    }
  });
});

describe('repozytorium: zmiany oferty przez administratora', () => {
  it('nowy egzemplarz z własnym kodem i datą zakupu zwiększa pojemność od tej daty i trafia do historii', async () => {
    const r = repo();
    const added = await r.putRecord(
      'units',
      { id: 'u-ns-m-04', tenantId: 'skybike', version: 0, variantId: 'ns-m', code: 'NS-M-04', activeFrom: '2027-07-01', retiredFrom: null, note: 'zakup przed sezonem' },
      { actor: admin, note: 'dodano NS-M-04 od 1.07' },
    );
    assert.ok(added.ok);
    const catalog = await r.getCatalog();
    assert.equal(capacityOn(catalog, 'ns-m', '2027-06-30'), 3);
    assert.equal(capacityOn(catalog, 'ns-m', '2027-07-01'), 4);
    const audit = await r.listAudit();
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0]!.entity, audit[0]!.action, audit[0]!.actor.name, audit[0]!.summary], ['units', 'create', 'Administrator', 'dodano NS-M-04 od 1.07']);
  });
  it('kod egzemplarza musi być unikalny', async () => {
    const r = repo();
    const result = await r.putRecord(
      'units',
      { id: 'u-new', tenantId: 'skybike', version: 0, variantId: 'ns-m', code: 'NS-M-01', activeFrom: null, retiredFrom: null, note: '' },
      { actor: admin },
    );
    assert.ok(!result.ok && result.error.code === 'invalid');
    assert.equal((await r.getCatalog()).units.length, 16);
  });
  it('wyłączenie egzemplarza do serwisu pokazuje dni ponad stan i niczego nie anuluje', async () => {
    const r = repo();
    // SB-2027-0006 zajmuje wszystkie 4 sztuki KTM L w dniach 18-20 czerwca.
    const result = await r.putRecord(
      'unitOutages',
      { id: 'out-1', tenantId: 'skybike', version: 0, unitId: 'u-ktm-l-02', from: '2027-06-19', to: '2027-06-22', reason: 'serwis' },
      { actor: admin, note: 'KTM-L-02: serwis 19-22.06' },
    );
    assert.ok(result.ok);
    assert.deepEqual(result.impact.overbookings, [
      { variantId: 'ktm-l', date: '2027-06-19', free: -1 },
      { variantId: 'ktm-l', date: '2027-06-20', free: -1 },
    ]);
    assert.equal((await r.listReservations()).length, 6);
    assert.equal((await r.listReservations())[5]!.statusId, 'contact');
  });
  it('podgląd skutków zmiany niczego nie zapisuje', async () => {
    const r = repo();
    const unit = (await r.getCatalog()).units.find((u) => u.code === 'KTM-L-01')!;
    const impact = await r.previewRecord('units', { ...unit, retiredFrom: '2027-06-18' });
    assert.equal(impact.overbookings.length, 3);
    assert.equal((await r.getCatalog()).units.find((u) => u.code === 'KTM-L-01')!.retiredFrom, null);
    assert.equal((await r.listAudit()).length, 0);
  });
  it('zamknięcie dnia z istniejącymi zgłoszeniami: ostrzeżenie z numerami, nic nie jest anulowane, nowe rezerwacje zablokowane', async () => {
    const r = repo();
    const result = await r.putRecord(
      'dateExceptions',
      { id: 'ex-closed', tenantId: 'skybike', version: 0, from: '2027-06-13', to: '2027-06-13', action: { kind: 'closed' }, note: 'zawody' },
      { actor: admin },
    );
    assert.ok(result.ok);
    assert.deepEqual(result.impact.closedDatesWithReservations, [{ date: '2027-06-13', reservationNumbers: ['SB-2027-0005'] }]);
    assert.equal((await r.listReservations())[4]!.statusId, 'new');
    const attempt = await r.createReservation(shop(days('2027-06-13', '2027-06-13', [['ktm-l', 1]])), { actor: client, idempotencyKey: null });
    assert.ok(!attempt.ok);
    assert.deepEqual(attempt.problems, [{ code: 'closed', dates: ['2027-06-13'] }]);
  });
  it('zmiana rekordu ze starą wersją jest odrzucana', async () => {
    const r = repo();
    const unit = (await r.getCatalog()).units[0]!;
    assert.ok((await r.putRecord('units', { ...unit, note: 'a' }, { actor: admin, expectedVersion: 1 })).ok);
    const stale = await r.putRecord('units', { ...unit, note: 'b' }, { actor: admin, expectedVersion: 1 });
    assert.ok(!stale.ok);
    assert.deepEqual(stale.error, { code: 'versionConflict', currentVersion: 2 });
  });
  it('zmiana stawki w panelu od razu zmienia wycenę', async () => {
    const r = repo();
    const order = days(D, D, [['ns-m', 1]]);
    assert.equal(quote(await r.getCatalog(), order).total, 25000);
    const saved = await r.setRates([{ tariffId: 'standard', variantId: 'ns-m', bandId: 'day', amount: 26000, manuallyEdited: true }], { actor: admin });
    assert.ok(saved.ok);
    assert.equal(quote(await r.getCatalog(), order).total, 26000);
    assert.equal((await r.getCatalog()).rates.length, 72);
    assert.equal((await r.listAudit())[0]!.entity, 'rates');
  });
  it('limit auta i próg rabatu zmieniane w ustawieniach działają od razu', async () => {
    const r = repo();
    const order = { ...days(D, D, [['ns-m', 3], ['ns-l', 2]]), services: [{ serviceId: 'delivery-city', quantity: 1 }] };
    assert.equal(quote(await r.getCatalog(), order).priceStatus, 'toBeAgreed');
    const saved = await r.updateSettings({ delivery: { vehicleCapacity: 6 }, groupDiscount: { minUnits: 6 } }, { actor: admin, expectedVersion: 1 });
    assert.ok(saved.ok);
    assert.equal(saved.record.version, 2);
    const q = quote(await r.getCatalog(), order);
    assert.equal(q.priceStatus, 'final');
    assert.equal(q.total, 135000);
  });
  it('ustawienia z błędną wartością są odrzucane', async () => {
    const result = await repo().updateSettings({ groupDiscount: { percent: 140 } }, { actor: admin, expectedVersion: 1 });
    assert.ok(!result.ok && result.error.code === 'invalid');
  });
  it('rozmiaru użytego w zgłoszeniach nie da się usunąć', async () => {
    const r = repo();
    const variant = (await r.getCatalog()).variants.find((v) => v.id === 'ktm-l')!;
    const result = await r.removeRecord('variants', variant.id, { actor: admin, expectedVersion: variant.version });
    assert.ok(!result.ok && result.error.code === 'invalid');
  });
  it('nowy model z rozmiarem, egzemplarzem i stawką da się zarezerwować bez zmian w kodzie', async () => {
    const r = repo();
    const base = { tenantId: 'skybike', version: 0 };
    assert.ok((await r.putRecord('products', { ...base, id: 'kid', name: 'Rower dziecięcy', codePrefix: 'KID', typeLabel: 'MTB 24″', audience: '', use: '', specification: '', image: null, route: null, tileFields: ['name', 'price'], active: true, order: 9 }, { actor: admin })).ok);
    assert.ok((await r.putRecord('variants', { ...base, id: 'kid-one', productId: 'kid', label: 'uniwersalny', bufferMinutes: 0, active: true, order: 0 }, { actor: admin })).ok);
    assert.ok((await r.putRecord('units', { ...base, id: 'u-kid-01', variantId: 'kid-one', code: 'KID-01', activeFrom: null, retiredFrom: null, note: '' }, { actor: admin })).ok);
    assert.ok((await r.setRates([{ tariffId: 'standard', variantId: 'kid-one', bandId: 'day', amount: 9000 }], { actor: admin })).ok);
    const ok = await r.createReservation(shop(days(D, D, [['kid-one', 1]])), { actor: client, idempotencyKey: null });
    assert.ok(ok.ok);
    assert.equal(ok.reservation.total, 9000);
    const second = await r.createReservation(shop(days(D, D, [['kid-one', 1]])), { actor: client, idempotencyKey: null });
    assert.equal(second.ok, false);
  });
});

describe('repozytorium: nieudane rezerwacje (utracony popyt)', () => {
  it('odmowa z braku sprzętu zapisuje anonimowy wpis z szacowaną wartością', async () => {
    const r = repo();
    await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null });
    await r.createReservation(shop(days(D, D, [['cannondale-l', 1]])), { actor: client, idempotencyKey: null, sessionKey: 's1' });
    const lost = await r.listLostDemand();
    assert.equal(lost.length, 1);
    const entry = lost[0]!;
    assert.deepEqual(
      [entry.source, entry.reason, entry.variantId, entry.productId, entry.requested, entry.free, entry.missing, entry.estimatedValue],
      ['shop', 'unavailable', 'cannondale-l', 'cannondale', 1, 0, 1, 19000],
    );
    assert.ok(!JSON.stringify(entry).includes('Test Testowy'), 'wpis zawiera dane klienta');
  });
  it('ta sama odmowa w jednej wizycie liczy się raz, w innej wizycie osobno', async () => {
    const r = repo();
    const order = days(D, D, [['ns-m', 4]]);
    await r.createReservation(shop(order), { actor: client, idempotencyKey: null, sessionKey: 's1' });
    await r.createReservation(shop(order), { actor: client, idempotencyKey: null, sessionKey: 's1' });
    await r.createReservation(shop(order), { actor: client, idempotencyKey: null, sessionKey: 's2' });
    const lost = await r.listLostDemand();
    assert.equal(lost.length, 2);
    assert.deepEqual([lost[0]!.requested, lost[0]!.free, lost[0]!.missing, lost[0]!.estimatedValue], [4, 3, 1, 25000]);
  });
  it('odmowa w koszyku (przed wysłaniem) i wpis ręczny zespołu trafiają do tej samej listy', async () => {
    const r = repo();
    const fromCart = await r.recordLostDemand(
      { source: 'shop', reason: 'unavailable', order: days(D, '2027-07-07', []), variantId: 'ktm-l', requested: 6, free: 4, sessionKey: 's1' },
      client,
    );
    assert.equal(fromCart?.estimatedValue, 74000);
    const manual = await r.recordLostDemand(
      { source: 'manual', reason: 'unavailable', order: days('2027-07-10', '2027-07-10', []), variantId: 'ns-l', requested: 2, free: 0, note: 'telefon, grupa 2 osób' },
      team,
    );
    assert.equal(manual?.createdBy, 'Ola z zespołu');
    assert.equal(manual?.estimatedValue, 50000);
    assert.deepEqual((await r.listLostDemand()).map((l) => l.source), ['shop', 'manual']);
  });
  it('próba rezerwacji w dniu zamkniętym też jest zapisywana', async () => {
    const clock = { ms: Date.parse('2026-12-01T10:00:00Z') };
    const r = repo(clock);
    await r.createReservation(shop(days('2026-12-24', '2026-12-24', [['ns-m', 2]])), { actor: client, idempotencyKey: null });
    const lost = await r.listLostDemand();
    assert.deepEqual([lost[0]!.reason, lost[0]!.requested], ['closed', 2]);
  });
});

describe('repozytorium: powrót do danych startowych', () => {
  it('reset usuwa nowe zgłoszenia, zmiany oferty, historię i wpisy utraconego popytu', async () => {
    const r = repo();
    await r.createReservation(shop(days(D, D, [['ns-m', 4]])), { actor: client, idempotencyKey: null });
    await r.createReservation(shop(days(D, D, [['ns-m', 1]])), { actor: client, idempotencyKey: 'k' });
    await r.updateSettings({ delivery: { vehicleCapacity: 9 } }, { actor: admin, expectedVersion: 1 });
    await r.reset();
    assert.equal((await r.listReservations()).length, 6);
    assert.equal((await r.getCatalog()).settings.delivery.vehicleCapacity, 4);
    assert.equal((await r.listAudit()).length, 0);
    assert.equal((await r.listLostDemand()).length, 0);
    const again = await r.createReservation(shop(days(D, D, [['ns-m', 1]])), { actor: client, idempotencyKey: 'k' });
    assert.ok(again.ok && again.repeated === false);
  });
});
