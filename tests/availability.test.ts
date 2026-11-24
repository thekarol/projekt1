import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capacityOn,
  checkOrder,
  dayAvailability,
  findOverbookings,
  freeUnits,
  nextAvailableDate,
  orderWindow,
  reservationsOnDate,
  validateOrder,
} from '../src/core/availability.ts';
import type { AvailabilityContext, Problem } from '../src/core/availability.ts';
import { resolveDay } from '../src/core/calendar.ts';
import { absMinute, addDays } from '../src/core/time.ts';
import type { Catalog, Reservation } from '../src/core/types.ts';
import { applyPatch, days, hours, makeReservation, seedCatalog } from './helpers.ts';

const catalog = seedCatalog();
const ctx = (reservations: Reservation[] = [], c: Catalog = catalog): AvailabilityContext => ({ catalog: c, reservations });
const codes = (problems: Problem[]): string[] => problems.map((p) => p.code);
const shortage = (problems: Problem[]) => problems.find((p) => p.code === 'shortage') as Extract<Problem, { code: 'shortage' }> | undefined;
const D = '2027-07-06';

describe('dostępność: pojemność wynika z egzemplarzy', () => {
  it('liczba sztuk rozmiaru to liczba jego egzemplarzy', () => {
    assert.equal(capacityOn(catalog, 'ns-s', D), 3);
    assert.equal(capacityOn(catalog, 'ns-m', D), 3);
    assert.equal(capacityOn(catalog, 'cannondale-m', D), 2);
    assert.equal(capacityOn(catalog, 'cannondale-l', D), 1);
    assert.equal(capacityOn(catalog, 'ktm-l', D), 4);
  });
  it('egzemplarz kupiony od daty podnosi pojemność od tego dnia', () => {
    const c = applyPatch(catalog, { units: [{ id: 'u-ns-m-04', variantId: 'ns-m', code: 'NS-M-04', activeFrom: '2027-05-01' }] });
    assert.equal(capacityOn(c, 'ns-m', '2027-04-30'), 3);
    assert.equal(capacityOn(c, 'ns-m', '2027-05-01'), 4);
  });
  it('egzemplarz wycofany od daty obniża pojemność od tego dnia', () => {
    const c = applyPatch(catalog, { units: [{ id: 'u-ns-m-03', retiredFrom: '2027-11-01' }] });
    assert.equal(capacityOn(c, 'ns-m', '2027-10-31'), 3);
    assert.equal(capacityOn(c, 'ns-m', '2027-11-01'), 2);
  });
  it('wyłączenie do serwisu zmniejsza pojemność tylko w swoim okresie', () => {
    const c = applyPatch(catalog, { unitOutages: [{ id: 'o1', unitId: 'u-ns-m-02', from: '2027-06-10', to: '2027-06-14', reason: 'serwis' }] });
    assert.equal(capacityOn(c, 'ns-m', '2027-06-09'), 3);
    assert.equal(capacityOn(c, 'ns-m', '2027-06-10'), 2);
    assert.equal(capacityOn(c, 'ns-m', '2027-06-14'), 2);
    assert.equal(capacityOn(c, 'ns-m', '2027-06-15'), 3);
  });
  it('wyłączenie w środku najmu ogranicza cały najem', () => {
    const c = applyPatch(catalog, { unitOutages: [{ id: 'o1', unitId: 'u-ns-m-02', from: '2027-06-11', to: '2027-06-11' }] });
    const check = checkOrder(ctx([], c), days('2027-06-10', '2027-06-12', [['ns-m', 3]]));
    assert.equal(shortage(check.problems)?.free, 2);
  });
});

describe('dostępność: rezerwacje i przedziały', () => {
  it('bez rezerwacji wolne są wszystkie sztuki', () => {
    assert.ok(checkOrder(ctx(), days(D, D, [['ns-m', 3]])).ok);
  });
  it('zostały 2 sztuki M, prośba o 3 kończy się odmową z informacją „wolne: 2”', () => {
    const taken = makeReservation(catalog, days(D, D, [['ns-m', 1]]));
    const check = checkOrder(ctx([taken]), days(D, D, [['ns-m', 3]]));
    assert.equal(check.ok, false);
    assert.deepEqual(shortage(check.problems), { code: 'shortage', variantId: 'ns-m', requested: 3, free: 2 });
    assert.ok(checkOrder(ctx([taken]), days(D, D, [['ns-m', 2]])).ok);
  });
  it('ten sam rozmiar w dwóch pozycjach zamówienia jest sumowany', () => {
    const check = checkOrder(ctx(), days(D, D, [['ns-m', 2], ['ns-m', 2]]));
    assert.equal(shortage(check.problems)?.requested, 4);
  });
  it('inne rozmiary i inne modele nie blokują się nawzajem', () => {
    const taken = makeReservation(catalog, days(D, D, [['ns-m', 3]]));
    assert.ok(checkOrder(ctx([taken]), days(D, D, [['ns-s', 3], ['ns-l', 3], ['ktm-l', 4]])).ok);
  });
  it('zwrot o 13:00 i wydanie o 13:00 nie kolidują', () => {
    const morning = makeReservation(catalog, hours(D, 9, 13, [['cannondale-l', 1]]));
    assert.ok(checkOrder(ctx([morning]), hours(D, 13, 17, [['cannondale-l', 1]])).ok);
    assert.equal(checkOrder(ctx([morning]), hours(D, 12, 14, [['cannondale-l', 1]])).ok, false);
  });
  it('bufor po zwrocie przesuwa najbliższe wydanie', () => {
    const c = applyPatch(catalog, { variants: [{ id: 'cannondale-l', bufferMinutes: 30 }] });
    const morning = makeReservation(c, hours(D, 9, 13, [['cannondale-l', 1]]));
    assert.equal(checkOrder(ctx([morning], c), hours(D, 13, 15, [['cannondale-l', 1]])).ok, false);
    assert.ok(checkOrder(ctx([morning], c), hours(D, 14, 16, [['cannondale-l', 1]])).ok);
  });
  it('najem dzienny blokuje każdy najem godzinowy tego dnia i odwrotnie', () => {
    const day = makeReservation(catalog, days(D, D, [['cannondale-l', 1]]));
    assert.equal(checkOrder(ctx([day]), hours(D, 15, 17, [['cannondale-l', 1]])).ok, false);
    const hour = makeReservation(catalog, hours(D, 15, 17, [['cannondale-l', 1]]));
    assert.equal(checkOrder(ctx([hour]), days(D, D, [['cannondale-l', 1]])).ok, false);
  });
  it('najem kilkudniowy blokuje dni w środku i nie blokuje dnia po zwrocie', () => {
    const trip = makeReservation(catalog, days('2027-07-05', '2027-07-07', [['cannondale-l', 1]]));
    assert.equal(checkOrder(ctx([trip]), days('2027-07-06', '2027-07-06', [['cannondale-l', 1]])).ok, false);
    assert.equal(checkOrder(ctx([trip]), days('2027-07-04', '2027-07-05', [['cannondale-l', 1]])).ok, false);
    assert.ok(checkOrder(ctx([trip]), days('2027-07-08', '2027-07-08', [['cannondale-l', 1]])).ok);
    assert.ok(checkOrder(ctx([trip]), days('2027-07-04', '2027-07-04', [['cannondale-l', 1]])).ok);
  });
  it('liczy się chwila największego zajęcia w przedziale', () => {
    const a = makeReservation(catalog, hours(D, 9, 12, [['ktm-l', 1]]));
    const b = makeReservation(catalog, hours(D, 11, 14, [['ktm-l', 2]]));
    const c = makeReservation(catalog, hours(D, 15, 18, [['ktm-l', 1]]));
    const free = (from: number, to: number) => freeUnits(ctx([a, b, c]), 'ktm-l', absMinute(D, from * 60), absMinute(D, to * 60));
    assert.equal(free(9, 18), 1);
    assert.equal(free(12, 14), 2);
    assert.equal(free(14, 15), 4);
    assert.equal(free(9, 11), 3);
  });
  it('edytowane zgłoszenie nie blokuje samego siebie', () => {
    const own = makeReservation(catalog, days(D, D, [['cannondale-l', 1]]));
    const context: AvailabilityContext = { catalog, reservations: [own], excludeReservationId: own.id };
    assert.ok(checkOrder(context, days(D, D, [['cannondale-l', 1]])).ok);
  });
});

describe('dostępność: status decyduje, czy zgłoszenie blokuje sprzęt', () => {
  const expected: Record<string, boolean> = {
    new: true,
    contact: true,
    confirmed: true,
    issued: true,
    returned: false,
    rejected: false,
    cancelled: false,
  };
  for (const status of catalog.statuses) {
    it(`${status.name}: ${expected[status.id] ? 'blokuje' : 'nie blokuje'}`, () => {
      assert.equal(status.blocksStock, expected[status.id]);
      const taken = makeReservation(catalog, days(D, D, [['cannondale-l', 1]]), status.id);
      assert.equal(checkOrder(ctx([taken]), days(D, D, [['cannondale-l', 1]])).ok, !expected[status.id]);
    });
  }
  it('odznaczenie „blokuje sprzęt” przy statusie w panelu zwalnia sprzęt', () => {
    const c = applyPatch(catalog, { statuses: [{ id: 'confirmed', blocksStock: false }] });
    const taken = makeReservation(c, days(D, D, [['cannondale-l', 1]]), 'confirmed');
    assert.ok(checkOrder(ctx([taken], c), days(D, D, [['cannondale-l', 1]])).ok);
  });
});

describe('dostępność: dni zamknięte i godziny działania', () => {
  it('dzień zamknięty wyjątkiem blokuje rezerwację', () => {
    const check = checkOrder(ctx(), days('2026-12-24', '2026-12-24', [['ns-m', 1]]));
    assert.deepEqual(check.problems.find((p) => p.code === 'closed'), { code: 'closed', dates: ['2026-12-24'] });
  });
  it('dzień zamknięty wyjątkiem blokuje też najem, który go tylko obejmuje', () => {
    const check = checkOrder(ctx(), days('2026-12-23', '2026-12-25', [['ns-m', 1]]));
    assert.deepEqual(check.problems.find((p) => p.code === 'closed'), { code: 'closed', dates: ['2026-12-24'] });
  });
  it('dzień zamknięty z godzin działania blokuje tylko odbiór i zwrot', () => {
    const c = applyPatch(catalog, {
      openingRules: [
        { id: 'open', weekdays: [2, 3, 4, 5, 6, 7], open: 540, close: 1080 },
        { id: 'monday', weekdays: [1], closed: true, open: 0, close: 0 },
      ],
    });
    assert.equal(resolveDay(c, '2027-07-05').closedBy, 'hours');
    assert.ok(checkOrder(ctx([], c), days('2027-07-04', '2027-07-06', [['ns-m', 1]])).ok);
    assert.deepEqual(codes(checkOrder(ctx([], c), days('2027-07-05', '2027-07-06', [['ns-m', 1]])).problems), ['closed']);
    assert.deepEqual(codes(checkOrder(ctx([], c), days('2027-07-04', '2027-07-05', [['ns-m', 1]])).problems), ['closed']);
  });
  it('godziny osobno dla dni tygodnia', () => {
    const c = applyPatch(catalog, {
      openingRules: [
        { id: 'week', weekdays: [1, 2, 3, 4, 5], open: 540, close: 1020 },
        { id: 'weekend', weekdays: [6, 7], open: 480, close: 1200 },
      ],
    });
    assert.deepEqual(resolveDay(c, '2027-07-06').hours, { open: 540, close: 1020 });
    assert.deepEqual(resolveDay(c, '2027-07-10').hours, { open: 480, close: 1200 });
    assert.ok(checkOrder(ctx([], c), hours('2027-07-10', 18, 20, [['ns-m', 1]])).ok);
    assert.deepEqual(codes(checkOrder(ctx([], c), hours('2027-07-06', 16, 18, [['ns-m', 1]])).problems), ['outsideHours']);
  });
  it('godziny dla okresu powtarzanego co rok (sezon) mają pierwszeństwo przed ogólnymi', () => {
    const c = applyPatch(catalog, {
      openingRules: [
        { id: 'default', weekdays: [1, 2, 3, 4, 5, 6, 7], open: 540, close: 1080 },
        { id: 'summer', period: { kind: 'yearly', from: '07-01', to: '08-31' }, weekdays: [1, 2, 3, 4, 5, 6, 7], open: 480, close: 1200 },
      ],
    });
    assert.deepEqual(resolveDay(c, '2027-06-30').hours, { open: 540, close: 1080 });
    assert.deepEqual(resolveDay(c, '2027-07-01').hours, { open: 480, close: 1200 });
    assert.deepEqual(resolveDay(c, '2028-08-31').hours, { open: 480, close: 1200 });
    const window = orderWindow(c, days('2027-07-01', '2027-07-02', [['ns-m', 1]]));
    assert.equal(window?.startMinute, 480);
    assert.equal(window?.endMinute, 1200);
  });
  it('okres zimowy przechodzący przez nowy rok', () => {
    const c = applyPatch(catalog, {
      openingRules: [
        { id: 'default', weekdays: [1, 2, 3, 4, 5, 6, 7], open: 540, close: 1080 },
        { id: 'winter', period: { kind: 'yearly', from: '11-15', to: '03-15' }, weekdays: [1, 2, 3, 4, 5, 6, 7], open: 600, close: 960 },
      ],
    });
    assert.deepEqual(resolveDay(c, '2027-01-10').hours, { open: 600, close: 960 });
    assert.deepEqual(resolveDay(c, '2027-12-01').hours, { open: 600, close: 960 });
    assert.deepEqual(resolveDay(c, '2027-04-01').hours, { open: 540, close: 1080 });
  });
  it('okres z konkretnymi datami wygrywa z sezonem', () => {
    const c = applyPatch(catalog, {
      openingRules: [
        { id: 'default', weekdays: [1, 2, 3, 4, 5, 6, 7], open: 540, close: 1080 },
        { id: 'summer', period: { kind: 'yearly', from: '07-01', to: '08-31' }, weekdays: [1, 2, 3, 4, 5, 6, 7], open: 480, close: 1200 },
        { id: 'event', period: { kind: 'dates', from: '2027-07-10', to: '2027-07-11' }, weekdays: [1, 2, 3, 4, 5, 6, 7], open: 420, close: 1260 },
      ],
    });
    assert.deepEqual(resolveDay(c, '2027-07-10').hours, { open: 420, close: 1260 });
    assert.deepEqual(resolveDay(c, '2027-07-12').hours, { open: 480, close: 1200 });
  });
});

describe('dostępność: reguły zamówienia', () => {
  it('najem godzinowy: od 1 do 9 godzin, w godzinach działania, w pełnych krokach', () => {
    assert.deepEqual(codes(validateOrder(catalog, hours(D, 10, 10, [['ns-m', 1]]))), ['hoursRange']);
    assert.deepEqual(codes(validateOrder(catalog, hours(D, 8, 12, [['ns-m', 1]]))), ['outsideHours']);
    assert.deepEqual(codes(validateOrder(catalog, hours(D, 15, 19, [['ns-m', 1]]))), ['outsideHours']);
    assert.deepEqual(codes(validateOrder(catalog, { ...hours(D, 10, 12, [['ns-m', 1]]), startMinute: 630 })), ['hoursStep']);
    assert.deepEqual(codes(validateOrder(catalog, { ...hours(D, 10, 12, [['ns-m', 1]]), endDate: addDays(D, 1) })), ['hoursSingleDate']);
    assert.deepEqual(validateOrder(catalog, hours(D, 9, 18, [['ns-m', 1]])), []);
  });
  it('krok godzin ustawiony na 30 minut dopuszcza 10:30', () => {
    const c = applyPatch(catalog, { settings: { hourly: { stepMinutes: 30 } } });
    assert.deepEqual(validateOrder(c, { ...hours(D, 10, 12, [['ns-m', 1]]), startMinute: 630 }), []);
  });
  it('najem dłuższy niż limit dni', () => {
    assert.deepEqual(codes(validateOrder(catalog, days('2027-07-01', '2027-07-31', [['ns-m', 1]]))), ['tooLong']);
    assert.deepEqual(validateOrder(catalog, days('2027-07-01', '2027-07-30', [['ns-m', 1]])), []);
  });
  it('błędne daty, pusty koszyk, zła ilość, nieznany rozmiar', () => {
    assert.deepEqual(codes(validateOrder(catalog, days('2027-02-30', '2027-03-01', [['ns-m', 1]]))), ['invalidDates']);
    assert.deepEqual(codes(validateOrder(catalog, days('2027-07-07', '2027-07-06', [['ns-m', 1]]))), ['invalidDates']);
    assert.deepEqual(codes(validateOrder(catalog, days(D, D, []))), ['empty']);
    assert.deepEqual(codes(validateOrder(catalog, days(D, D, [['ns-m', 0]]))), ['invalidQuantity']);
    assert.deepEqual(codes(validateOrder(catalog, days(D, D, [['ns-xl', 1]]))), ['unknownVariant']);
  });
  it('limity sztuk w zamówieniu i na model są ustawieniami', () => {
    const c = applyPatch(catalog, { settings: { limits: { unitsPerOrder: 5, unitsPerProduct: 3 } } });
    assert.deepEqual(codes(validateOrder(c, days(D, D, [['ns-m', 2], ['ns-l', 2], ['ktm-l', 2]]))), ['overOrderLimit', 'overProductLimit']);
    assert.deepEqual(validateOrder(c, days(D, D, [['ns-m', 3], ['ktm-l', 2]])), []);
  });
  it('rezerwacja wstecz jest odrzucana, dzisiejsza przyszła godzina przechodzi', () => {
    const now = { date: '2027-07-06', minute: 12 * 60 };
    assert.deepEqual(codes(validateOrder(catalog, days('2027-07-05', '2027-07-05', [['ns-m', 1]]), now)), ['past']);
    assert.deepEqual(codes(validateOrder(catalog, hours(D, 10, 12, [['ns-m', 1]]), now)), ['past']);
    assert.deepEqual(validateOrder(catalog, hours(D, 13, 15, [['ns-m', 1]]), now), []);
    assert.deepEqual(validateOrder(catalog, days('2027-07-07', '2027-07-08', [['ns-m', 1]]), now), []);
  });
  it('najem dniowy na dziś: w sklepie do godziny ustawionej w panelu (start 12:00)', () => {
    const order = days('2027-07-06', '2027-07-06', [['ns-m', 1]]);
    assert.deepEqual(validateOrder(catalog, order, { date: '2027-07-06', minute: 12 * 60 }), []);
    assert.deepEqual(validateOrder(catalog, order, { date: '2027-07-06', minute: 12 * 60 + 1 }), [{ code: 'sameDayClosed', until: 720 }]);
    const later = applyPatch(catalog, { settings: { booking: { sameDayDaysUntil: 15 * 60 } } });
    assert.deepEqual(validateOrder(later, order, { date: '2027-07-06', minute: 14 * 60 }), []);
    const never = applyPatch(catalog, { settings: { booking: { sameDayDaysUntil: null } } });
    assert.deepEqual(codes(validateOrder(never, order, { date: '2027-07-06', minute: 8 * 60 })), ['sameDayClosed']);
    assert.deepEqual(validateOrder(catalog, hours('2027-07-06', 15, 17, [['ns-m', 1]]), { date: '2027-07-06', minute: 14 * 60 }), []);
  });
});

describe('dostępność: kalendarz', () => {
  const one = [{ variantId: 'cannondale-l', quantity: 1 }];
  it('wolny: całe żądanie mieści się przez cały dzień', () => {
    const day = dayAvailability(ctx(), D, [{ variantId: 'ns-m', quantity: 2 }]);
    assert.equal(day.status, 'free');
    assert.equal(day.low, false);
    assert.deepEqual(day.variants, [{ variantId: 'ns-m', requested: 2, freeAllDay: 3, freeBestSlot: 3 }]);
  });
  it('ostatnie sztuki: po tym żądaniu nie zostaje nic', () => {
    assert.equal(dayAvailability(ctx(), D, [{ variantId: 'ns-m', quantity: 3 }]).low, true);
  });
  it('częściowo wolny: wolne są tylko niektóre godziny', () => {
    const morning = makeReservation(catalog, hours(D, 9, 13, one.map((i) => [i.variantId, 1] as [string, number])));
    const day = dayAvailability(ctx([morning]), D, one);
    assert.equal(day.status, 'partial');
    assert.deepEqual(day.variants, [{ variantId: 'cannondale-l', requested: 1, freeAllDay: 0, freeBestSlot: 1 }]);
  });
  it('częściowo wolny: jest mniej sztuk, niż chce klient', () => {
    const taken = makeReservation(catalog, days(D, D, [['ns-m', 2]]));
    assert.equal(dayAvailability(ctx([taken]), D, [{ variantId: 'ns-m', quantity: 2 }]).status, 'partial');
  });
  it('zajęty: nie ma żadnej sztuki w żadnej godzinie', () => {
    const taken = makeReservation(catalog, days(D, D, [['cannondale-l', 1]]));
    assert.equal(dayAvailability(ctx([taken]), D, one).status, 'full');
  });
  it('zamknięty: dzień z wyjątku', () => {
    assert.equal(dayAvailability(ctx(), '2026-12-24', one).status, 'closed');
  });
  it('najbliższy wolny termin pomija dni zamknięte i zajęte', () => {
    const taken = makeReservation(catalog, days('2026-12-22', '2026-12-23', [['cannondale-l', 1]]));
    assert.deepEqual(nextAvailableDate(ctx([taken]), ['cannondale-l'], '2026-12-22'), { date: '2026-12-25', variantIds: ['cannondale-l'] });
    assert.deepEqual(nextAvailableDate(ctx([taken]), ['cannondale-m', 'cannondale-l'], '2026-12-22'), { date: '2026-12-22', variantIds: ['cannondale-m'] });
  });
  it('zgłoszenia obejmujące datę (do ostrzeżenia przed zamknięciem dnia)', () => {
    const a = makeReservation(catalog, days('2027-07-05', '2027-07-07', [['ns-m', 1]]));
    const b = makeReservation(catalog, days('2027-07-06', '2027-07-06', [['ns-m', 1]]), 'cancelled');
    assert.deepEqual(reservationsOnDate(ctx([a, b]), '2027-07-06').map((r) => r.id), [a.id]);
    assert.equal(reservationsOnDate(ctx([a, b]), '2027-07-06', false).length, 2);
  });
  it('wycofanie egzemplarza przy istniejących rezerwacjach pokazuje dni ponad stan', () => {
    const taken = makeReservation(catalog, days('2027-07-05', '2027-07-06', [['ns-m', 3]]));
    const c = applyPatch(catalog, { units: [{ id: 'u-ns-m-03', retiredFrom: '2027-07-06' }] });
    assert.deepEqual(findOverbookings(ctx([taken], c), 'ns-m', '2027-07-04', '2027-07-08'), [{ date: '2027-07-06', free: -1 }]);
  });
});

describe('dostępność: usługa z ograniczonym stanem', () => {
  it('wyposażenie bez podanego stanu nie ma limitu, z podanym jest pilnowane', () => {
    const order = { ...days(D, D, [['ns-m', 1]]), services: [{ serviceId: 'mtb', quantity: 50 }] };
    assert.ok(checkOrder(ctx(), order).ok);
    const c = applyPatch(catalog, { services: [{ id: 'mtb', stock: 2 }] });
    const taken = makeReservation(c, { ...days(D, D, [['ns-s', 1]]), services: [{ serviceId: 'mtb', quantity: 2 }] });
    const check = checkOrder(ctx([taken], c), { ...days(D, D, [['ns-m', 1]]), services: [{ serviceId: 'mtb', quantity: 1 }] });
    assert.deepEqual(check.problems, [{ code: 'serviceShortage', serviceId: 'mtb', requested: 1, free: 0 }]);
  });
});

describe('dostępność: test losowy (zajętość nigdy nie przekracza pojemności)', () => {
  // Deterministic generator, so a failure can be repeated.
  function generator(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const variantIds = catalog.variants.map((v) => v.id);
  const blocking = new Set(catalog.statuses.filter((s) => s.blocksStock).map((s) => s.id));
  const statusIds = catalog.statuses.map((s) => s.id);
  const first = '2027-07-01';
  const span = 12;

  // Independent check: count, hour by hour, units held by blocking reservations.
  function worstHour(reservations: Reservation[], variantId: string): number {
    let worst = 0;
    for (let d = 0; d < span + 4; d++) {
      for (let h = 0; h < 24; h++) {
        const t = absMinute(addDays(first, d), h * 60);
        let used = 0;
        for (const r of reservations) {
          if (!blocking.has(r.statusId)) continue;
          if (absMinute(r.startDate, r.startMinute) <= t && t < absMinute(r.endDate, r.endMinute)) {
            for (const item of r.items) if (item.refId === variantId) used += item.quantity;
          }
        }
        worst = Math.max(worst, used);
      }
    }
    return worst;
  }

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`ziarno ${seed}: 400 losowych prób rezerwacji`, () => {
      const random = generator(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
      const accepted: Reservation[] = [];
      let refused = 0;
      for (let i = 0; i < 400; i++) {
        const start = addDays(first, Math.floor(random() * span));
        const items: Array<[string, number]> = [[pick(variantIds), 1 + Math.floor(random() * 3)]];
        if (random() < 0.3) items.push([pick(variantIds), 1 + Math.floor(random() * 2)]);
        let order;
        if (random() < 0.5) {
          const from = 9 + Math.floor(random() * 8);
          const to = Math.min(18, from + 1 + Math.floor(random() * 5));
          order = hours(start, from, to, items);
        } else {
          order = days(start, addDays(start, Math.floor(random() * 3)), items);
        }
        const check = checkOrder(ctx(accepted), order);
        if (check.ok) accepted.push(makeReservation(catalog, order, pick(statusIds)));
        else refused++;
      }
      for (const variantId of variantIds) {
        const capacity = capacityOn(catalog, variantId, first);
        assert.ok(worstHour(accepted, variantId) <= capacity, `${variantId}: zajętość ponad pojemność`);
      }
      assert.ok(accepted.length > 30, 'za mało przyjętych rezerwacji, test nic nie sprawdza');
      assert.ok(refused > 30, 'za mało odmów, test nie dochodzi do granicy pojemności');
    });
  }

  it('wolne sztuki z silnika zgadzają się z liczeniem godzina po godzinie', () => {
    const random = generator(99);
    const reservations: Reservation[] = [];
    for (let i = 0; i < 60; i++) {
      const start = addDays(first, Math.floor(random() * span));
      const from = 9 + Math.floor(random() * 8);
      const order = random() < 0.5
        ? hours(start, from, Math.min(18, from + 1 + Math.floor(random() * 4)), [['ktm-l', 1]])
        : days(start, addDays(start, Math.floor(random() * 2)), [['ktm-l', 1]]);
      if (checkOrder(ctx(reservations), order).ok) reservations.push(makeReservation(catalog, order));
    }
    for (let i = 0; i < 200; i++) {
      const date = addDays(first, Math.floor(random() * span));
      const from = 9 + Math.floor(random() * 8);
      const to = from + 1 + Math.floor(random() * (18 - from));
      let worst = 0;
      for (let h = from; h < to; h++) {
        const t = absMinute(date, h * 60);
        let used = 0;
        for (const r of reservations) {
          if (absMinute(r.startDate, r.startMinute) <= t && t < absMinute(r.endDate, r.endMinute)) used += r.items[0]!.quantity;
        }
        worst = Math.max(worst, used);
      }
      assert.equal(freeUnits(ctx(reservations), 'ktm-l', absMinute(date, from * 60), absMinute(date, to * 60)), 4 - worst);
    }
  });
});
