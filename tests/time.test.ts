import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDay } from '../src/core/calendar.ts';
import {
  absMinute,
  addDays,
  dayNumber,
  daysBetweenInclusive,
  eachDate,
  formatTime,
  isValidDate,
  parseTime,
  toZoned,
  weekday,
} from '../src/core/time.ts';
import { applyPatch, seedCatalog } from './helpers.ts';

describe('czas', () => {
  it('dzień tygodnia (1 = poniedziałek)', () => {
    assert.equal(weekday('2026-11-24'), 2);
    assert.equal(weekday('2027-05-03'), 1);
    assert.equal(weekday('2027-05-27'), 4);
    assert.equal(weekday('2027-06-12'), 6);
    assert.equal(weekday('2027-06-13'), 7);
    assert.equal(weekday('1970-01-01'), 4);
  });
  it('dodawanie dni przez koniec miesiąca, roku i 29 lutego', () => {
    assert.equal(addDays('2027-08-31', 1), '2027-09-01');
    assert.equal(addDays('2027-12-31', 1), '2028-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2027-02-28', 1), '2027-03-01');
    assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  });
  it('nieistniejące daty są odrzucane', () => {
    for (const bad of ['2027-02-30', '2027-13-01', '2027-6-1', 'jutro', '', null, 20270601]) {
      assert.equal(isValidDate(bad), false, String(bad));
    }
    assert.throws(() => dayNumber('2027-02-29'));
    assert.equal(isValidDate('2028-02-29'), true);
  });
  it('zakresy dat', () => {
    assert.deepEqual(eachDate('2027-08-30', '2027-09-01'), ['2027-08-30', '2027-08-31', '2027-09-01']);
    assert.equal(daysBetweenInclusive('2027-08-30', '2027-09-01'), 3);
    assert.deepEqual(eachDate('2027-09-02', '2027-09-01'), []);
    assert.equal(absMinute('1970-01-02', 30), 1470);
  });
  it('godziny jako minuty od północy', () => {
    assert.equal(parseTime('09:00'), 540);
    assert.equal(parseTime('18:00'), 1080);
    assert.equal(formatTime(540), '9:00');
    assert.equal(formatTime(1095), '18:15');
    assert.throws(() => parseTime('25:00'));
  });
  it('chwila przeliczana na datę i godzinę w Szczyrku, latem i zimą', () => {
    assert.deepEqual(toZoned(Date.parse('2027-06-10T10:00:00Z'), 'Europe/Warsaw'), { date: '2027-06-10', minute: 720 });
    assert.deepEqual(toZoned(Date.parse('2026-12-24T23:30:00Z'), 'Europe/Warsaw'), { date: '2026-12-25', minute: 30 });
    assert.deepEqual(toZoned(Date.parse('2027-06-10T22:30:00Z'), 'Europe/Warsaw'), { date: '2027-06-11', minute: 30 });
  });
});

describe('kalendarz: skąd bierze się cena dnia', () => {
  const catalog = seedCatalog();
  const tariffOn = (date: string, c = catalog) => resolveDay(c, date).tariffId;
  it('sezony z danych startowych działają po dacie', () => {
    assert.equal(tariffOn('2027-05-04'), 'quiet');
    assert.equal(tariffOn('2027-06-30'), 'quiet');
    assert.equal(tariffOn('2027-06-11'), 'standard');
    assert.equal(tariffOn('2027-06-12'), 'standard');
    assert.equal(tariffOn('2027-07-01'), 'standard');
    assert.equal(tariffOn('2027-09-01'), 'peak');
    assert.equal(tariffOn('2027-10-31'), 'peak');
    assert.equal(tariffOn('2027-11-01'), 'standard');
    assert.equal(tariffOn('2027-04-29'), 'standard');
  });
  it('wyjątek daty ma pierwszeństwo przed sezonem', () => {
    assert.equal(tariffOn('2027-05-03'), 'standard');
    assert.equal(resolveDay(catalog, '2027-05-03').seasonalTariffId, 'quiet');
    assert.equal(tariffOn('2027-05-27'), 'standard');
  });
  it('z dwóch wyjątków wygrywa krótszy zakres', () => {
    const c = applyPatch(catalog, {
      dateExceptions: [
        { id: 'long', from: '2027-07-01', to: '2027-07-31', action: { kind: 'tariff', tariffId: 'peak' } },
        { id: 'short', from: '2027-07-15', to: '2027-07-15', action: { kind: 'tariff', tariffId: 'quiet' } },
      ],
    });
    assert.equal(tariffOn('2027-07-14', c), 'peak');
    assert.equal(tariffOn('2027-07-15', c), 'quiet');
  });
  it('nowa taryfa z własnym sezonem i wyższym priorytetem zastępuje istniejącą', () => {
    const c = JSON.parse(JSON.stringify(catalog));
    c.tariffs.push({ id: 'majowka', tenantId: 'skybike', version: 1, name: 'Majówka', isBase: false, priority: 20, active: true, season: { months: [5], weekdays: [] } });
    assert.equal(tariffOn('2027-05-04', c), 'majowka');
    assert.equal(tariffOn('2027-06-01', c), 'quiet');
  });
  it('wyłączona taryfa przestaje działać', () => {
    const c = JSON.parse(JSON.stringify(catalog));
    c.tariffs.find((t: any) => t.id === 'peak').active = false;
    assert.equal(tariffOn('2027-09-14', c), 'standard');
  });
  it('dzień zamknięty wyjątkiem nie ma godzin', () => {
    const day = resolveDay(catalog, '2026-12-24');
    assert.equal(day.hours, null);
    assert.equal(day.closedBy, 'exception');
    assert.deepEqual(resolveDay(catalog, '2026-12-23').hours, { open: 540, close: 1080 });
  });
});
