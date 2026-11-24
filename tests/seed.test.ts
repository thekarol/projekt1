import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capacityOn } from '../src/core/availability.ts';
import { validateCatalog } from '../src/core/validate.ts';
import { loadSeed, readJson } from './helpers.ts';

const seed = loadSeed();
const catalog = seed.catalog;
const source = readJson('../dane/dane-startowe.json');
const owner = readJson('../dane/decyzje-wlasciciela.json');

describe('dane startowe', () => {
  it('przechodzą walidację bez błędów i bez ostrzeżeń', () => {
    assert.deepEqual(validateCatalog(catalog), { errors: [], warnings: [] });
  });
  it('liczby sztuk w rozmiarach są zgodne z decyzją właściciela', () => {
    const at = '2027-06-01';
    assert.deepEqual(
      catalog.variants.map((v) => [v.id, capacityOn(catalog, v.id, at)]),
      [['ktm-l', 4], ['ns-s', 3], ['ns-m', 3], ['ns-l', 3], ['cannondale-m', 2], ['cannondale-l', 1]],
    );
  });
  it('suma egzemplarzy każdego modelu zgadza się z dane-startowe.json', () => {
    for (const bike of source.flota) {
      const productId = owner.modele[bike.id].id;
      const variantIds = catalog.variants.filter((v) => v.productId === productId).map((v) => v.id);
      assert.equal(catalog.units.filter((u) => variantIds.includes(u.variantId)).length, bike.sztuk, bike.nazwa);
    }
  });
  it('każdy egzemplarz ma unikalny kod w formacie prefiks-rozmiar-numer', () => {
    const codes = catalog.units.map((u) => u.code);
    assert.equal(new Set(codes).size, 16);
    for (const code of codes) assert.match(code, /^(NS|CJ|KTM)-(S|M|L)-\d{2}$/);
    assert.ok(codes.includes('NS-M-02') && codes.includes('KTM-L-04') && codes.includes('CJ-L-01'));
  });
  it('status „Komunikacja z klientem” stoi między „Nowe” a „Potwierdzone” i blokuje sprzęt', () => {
    assert.deepEqual(catalog.statuses.map((s) => s.name), ['Nowe', 'Komunikacja z klientem', 'Potwierdzone', 'Wydane', 'Zwrócone', 'Odrzucone', 'Anulowane']);
    assert.equal(catalog.statuses[1]!.blocksStock, true);
    assert.equal(catalog.statuses.filter((s) => s.isInitial).length, 1);
  });
  it('kanały pozyskania zawierają e-mail', () => {
    assert.deepEqual(catalog.channels.map((c) => c.name), ['Strona internetowa', 'Telefon', 'Wizyta w punkcie', 'E-mail']);
  });
  it('ustawienia startowe: limit auta 4, rabat od 4 sztuk 5% od całego zamówienia, progi do 4 h, 2 i 3 dni', () => {
    assert.equal(catalog.settings.delivery.vehicleCapacity, 4);
    assert.deepEqual(catalog.settings.groupDiscount, { active: true, minUnits: 4, percent: 5, base: 'order', marksToBeAgreed: true });
    assert.deepEqual(catalog.bands.map((b) => [b.kind, b.maxHours ?? b.days ?? null]), [['hours', 4], ['day', null], ['days', 2], ['days', 3]]);
    assert.deepEqual(catalog.settings.limits, { unitsPerOrder: 100, unitsPerProduct: 50 });
    assert.deepEqual(catalog.settings.hourly, { minHours: 1, maxHours: 9, stepMinutes: 60 });
  });
  it('wyjątki dat: 3 i 27 maja 2027 w cenie Bazowej, 24 grudnia 2026 zamknięte', () => {
    assert.deepEqual(
      catalog.dateExceptions.map((e) => [e.from, e.to, e.action.kind]),
      [['2027-05-03', '2027-05-03', 'tariff'], ['2027-05-27', '2027-05-27', 'tariff'], ['2026-12-24', '2026-12-24', 'closed']],
    );
  });
  it('usługi: wyposażenie za sztukę za dzień, dowóz w Szczyrku 100 zł z limitem auta, reszta do ustalenia', () => {
    const byId = Object.fromEntries(catalog.services.map((s) => [s.id, s]));
    assert.deepEqual(
      ['mtb', 'fullface', 'pads', 'fullkit'].map((id) => [byId[id]!.billing, byId[id]!.price]),
      [['perUnitPerDay', 2000], ['perUnitPerDay', 3000], ['perUnitPerDay', 3000], ['perUnitPerDay', 5000]],
    );
    assert.deepEqual([byId['delivery-city']!.billing, byId['delivery-city']!.price, byId['delivery-city']!.limitedByVehicle], ['fixed', 10000, true]);
    assert.equal(byId['delivery-outside']!.billing, 'quote');
    assert.equal(byId['service-help']!.billing, 'quote');
    assert.deepEqual(catalog.serviceCategories.map((c) => c.requestType), ['Wyposażenie', 'Dowóz', 'Serwis']);
  });
  it('każdy rekord należy do najemcy', () => {
    for (const [name, value] of Object.entries(catalog)) {
      if (!Array.isArray(value)) continue;
      for (const record of value) assert.equal((record as any).tenantId, 'skybike', name);
    }
  });
  it('przykładowe zgłoszenia mają zmyślone osoby', () => {
    for (const r of seed.reservations) assert.match(r.customer.email, /@example\.com$/);
  });
});
