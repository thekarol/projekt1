import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDate, formatTerm, methodLabel, money, moneyDelta, moneyShort, problemText } from '../src/app/labels.ts';
import { confirmationMail } from '../src/app/mail.ts';
import { canView, viewsFor } from '../src/app/permissions.ts';
import { runSelfCheck } from '../src/app/vectors.ts';
import { quote, ratesFromBase } from '../src/core/pricing.ts';
import { MemoryRepository } from '../src/data/memory.ts';
import { days, loadSeed, readJson, seedCatalog } from './helpers.ts';

const catalog = seedCatalog();

describe('aplikacja: teksty', () => {
  it('daty, terminy i kwoty po polsku', () => {
    assert.equal(formatDate('2027-06-11'), 'pt 11.06.2027');
    assert.equal(formatTerm({ mode: 'days', startDate: '2027-06-11', endDate: '2027-06-12' }), 'pt 11.06 – sob 12.06.2027 · 2 dni');
    assert.equal(formatTerm({ mode: 'days', startDate: '2027-06-13', endDate: '2027-06-13' }), 'niedz 13.06.2027 · 1 dzień');
    assert.equal(formatTerm({ mode: 'hours', startDate: '2027-06-12', endDate: '2027-06-12', startMinute: 600, endMinute: 840 }), 'sob 12.06.2027 · 10:00–14:00');
    assert.equal(money(194000), '1 940,00 zł');
    assert.equal(moneyShort(45000), '450 zł');
    assert.equal(moneyShort(64333), '643,33 zł');
    assert.equal(moneyDelta(2000), '+20 zł');
    assert.equal(moneyDelta(-2000), '−20 zł');
    assert.equal(methodLabel({ code: 'package', days: 2 }), 'Pakiet 2 dni');
  });
  it('odmowa z braku sprzętu podaje wolną liczbę i nie zdradza taryfy', () => {
    assert.equal(
      problemText(catalog, { code: 'shortage', variantId: 'ns-m', requested: 3, free: 2 }),
      'NS Bikes E-Fine 1 · rozmiar M: w tym terminie wolne: 2.',
    );
  });
});

describe('aplikacja: role', () => {
  it('kierowca nie widzi panelu administratora ani zgłoszeń, klient nie widzi paneli', () => {
    for (const view of ['oferta', 'cennik', 'tresci', 'ustawienia', 'zgloszenia'] as const) {
      assert.equal(canView('driver', view), false, view);
      assert.equal(canView('client', view), false, view);
    }
    assert.equal(canView('team', 'zgloszenia'), true);
    assert.equal(canView('team', 'oferta'), false);
    assert.deepEqual(viewsFor('admin').length, 9);
  });
});

describe('aplikacja: potwierdzenie mailem (szkic wysyłki, prawdziwa treść)', () => {
  it('mail zawiera numer, termin, pozycje, kwotę i status', async () => {
    const repo = new MemoryRepository(loadSeed(), { now: () => Date.parse('2027-06-01T08:00:00Z') });
    const customer = { name: 'Anna Przykładowa', phone: '500 100 200', email: 'anna@example.com', consentAt: null };
    const order = { ...days('2027-07-06', '2027-07-07', [['ns-s', 1], ['ns-m', 2]]), services: [{ serviceId: 'mtb', quantity: 3 }] };
    const created = await repo.createReservation({ order, customer, source: 'shop', channelId: 'web' }, { actor: { role: 'client', name: 'klient' }, idempotencyKey: null });
    assert.ok(created.ok);
    const mail = confirmationMail(await repo.getCatalog(), created.reservation);
    const text = mail.lines.join('\n');
    assert.equal(mail.to, 'anna@example.com');
    assert.equal(mail.subject, 'Rezerwacja SB-2027-0007: wt 6.07 – śr 7.07.2027 · 2 dni');
    assert.match(text, /Termin: wt 6\.07 – śr 7\.07\.2027 · 2 dni/);
    assert.match(text, /Status: Nowe/);
    assert.match(text, /NS Bikes E-Fine 1 · rozmiar M × 2: 900,00 zł/);
    assert.match(text, /Kask MTB × 3: 120,00 zł/);
    assert.match(text, /Do zapłaty: 1 470,00 zł/);
    for (const tariff of catalog.tariffs) assert.ok(!text.includes(tariff.name));
  });
  it('zamówienie do ustalenia: kwota wstępna i lista rzeczy do potwierdzenia', async () => {
    const repo = new MemoryRepository(loadSeed());
    const first = (await repo.listReservations())[0]!;
    const text = confirmationMail(await repo.getCatalog(), first).lines.join('\n');
    assert.match(text, /Kwota wstępna: 3 268,00 zł/);
    assert.match(text, /Rabat grupowy/);
    assert.match(text, /Dowóz z odbiorem w Szczyrku: liczba kursów/);
  });
});

describe('aplikacja: nowa taryfa wypełniana z Bazowej', () => {
  it('+10% zaokrąglone do pełnych złotych', () => {
    const rates = ratesFromBase(catalog, 'majowka', { kind: 'percent', value: 10 });
    assert.equal(rates.length, 24);
    const cell = (variantId: string, bandId: string) => rates.find((r) => r.variantId === variantId && r.bandId === bandId)!.amount;
    assert.deepEqual([cell('ns-m', 'short'), cell('ns-m', 'day'), cell('ns-m', 'days2'), cell('ns-m', 'days3')], [22000, 27500, 49500, 71500]);
    assert.deepEqual([cell('cannondale-m', 'day'), cell('ktm-l', 'days3')], [20900, 59400]);
  });
  it('korekta kwotą i użycie taryfy przez wyjątek daty', () => {
    const c = JSON.parse(JSON.stringify(catalog));
    c.tariffs.push({ id: 'event', tenantId: 'skybike', version: 1, name: 'Zawody', isBase: false, priority: 0, active: true, season: null });
    c.rates.push(...ratesFromBase(catalog, 'event', { kind: 'amount', value: 3000 }));
    c.dateExceptions.push({ id: 'x', tenantId: 'skybike', version: 1, from: '2027-07-10', to: '2027-07-10', action: { kind: 'tariff', tariffId: 'event' }, note: '' });
    assert.equal(quote(c, days('2027-07-10', '2027-07-10', [['ns-m', 1]])).total, 28000);
    assert.equal(quote(c, days('2027-07-11', '2027-07-11', [['ns-m', 1]])).total, 25000);
  });
});

describe('aplikacja: testy silników uruchamiane w przeglądarce', () => {
  it('wszystkie przechodzą na danych startowych', () => {
    const results = runSelfCheck(catalog, {
      baseline: readJson('./vectors/pricing-baseline.json'),
      scenarios: readJson('./vectors/pricing-scenarios.json'),
    });
    assert.ok(results.length >= 36 + 30 + 10, `tylko ${results.length} sprawdzeń`);
    assert.deepEqual(results.filter((r) => !r.ok), []);
  });
});
