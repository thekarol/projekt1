import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { amountDue, dayPrice, dayPriceDelta, quote } from '../src/core/pricing.ts';
import { roundHalfUp } from '../src/core/money.ts';
import { applyPatch, assertSubset, days, readJson, seedCatalog } from './helpers.ts';

const catalog = seedCatalog();

describe('ceny: tabela bazowa (36 kwot ze specyfikacji)', () => {
  const baseline = readJson('./vectors/pricing-baseline.json');
  assert.equal(baseline.cases.length, 36);
  for (const c of baseline.cases) {
    it(c.name, () => {
      const q = quote(catalog, c.order);
      assert.equal(q.total, c.expectedTotal);
      assert.equal(q.priceStatus, 'final');
    });
  }
});

describe('ceny: każdy rozmiar modelu ma ceny z dane-startowe.json', () => {
  const source = readJson('../dane/dane-startowe.json');
  const owner = readJson('../dane/decyzje-wlasciciela.json');
  for (const tariff of source.taryfy) {
    for (const [sourceId, model] of Object.entries<any>(owner.modele)) {
      for (const size of Object.keys(model.rozmiary)) {
        const variantId = `${model.id}-${size.toLowerCase()}`;
        it(`${tariff.nazwa} / ${variantId}`, () => {
          for (const band of owner.progi) {
            const rate = catalog.rates.find(
              (r) => r.tariffId === tariff.id && r.variantId === variantId && r.bandId === band.id,
            );
            assert.ok(rate, `brak stawki ${band.id}`);
            assert.equal(rate.amount, tariff.stawki[sourceId][band.klucz] * 100);
          }
        });
      }
    }
  }
});

describe('ceny: reguły', () => {
  const scenarios = readJson('./vectors/pricing-scenarios.json');
  for (const c of scenarios.cases) {
    it(c.name, () => {
      assertSubset(quote(applyPatch(catalog, c.patch), c.order), c.expect);
    });
  }
});

describe('ceny: różnica względem ceny bazowej na kafelku kalendarza', () => {
  it('dzień w Wolnych terminach: −20 zł za NS', () => {
    assert.equal(dayPriceDelta(catalog, '2027-06-08', [{ variantId: 'ns-m', quantity: 1 }]), -2000);
  });
  it('dzień w Dużym popycie: +20 zł za NS, +40 zł za dwa', () => {
    assert.equal(dayPriceDelta(catalog, '2027-09-14', [{ variantId: 'ns-m', quantity: 1 }]), 2000);
    assert.equal(dayPriceDelta(catalog, '2027-09-14', [{ variantId: 'ns-m', quantity: 2 }]), 4000);
  });
  it('dzień w cenie Bazowej: brak różnicy', () => {
    assert.equal(dayPriceDelta(catalog, '2027-07-06', [{ variantId: 'ns-m', quantity: 1 }]), 0);
  });
  it('różnica sumuje się po koszyku z różnymi modelami', () => {
    const items = [
      { variantId: 'ns-m', quantity: 1 },
      { variantId: 'cannondale-m', quantity: 1 },
      { variantId: 'ktm-l', quantity: 1 },
    ];
    assert.equal(dayPriceDelta(catalog, '2027-06-08', items), -2000 - 1000 - 2000);
  });
  it('cena dnia i cena standardowa dla wariantu', () => {
    assert.deepEqual(dayPrice(catalog, '2027-09-14', 'ktm-l'), { price: 21000, standard: 20000, delta: 1000 });
  });
});

describe('ceny: zachowanie ogólne', () => {
  it('klient nie dostaje nazwy taryfy w żadnym polu wyceny poza polem dla zespołu', () => {
    const q = quote(catalog, days('2027-06-08', '2027-06-09', [['ns-m', 1]]));
    const { sources, ...forCustomer } = q;
    const text = JSON.stringify(forCustomer);
    for (const tariff of catalog.tariffs) assert.ok(!text.includes(tariff.name), `nazwa taryfy ${tariff.name} w wycenie`);
    assert.equal(sources.length, 1);
  });
  it('pole dla zespołu pokazuje, które taryfy wyceniły które dni', () => {
    const q = quote(catalog, days('2027-08-30', '2027-09-01', [['ns-m', 1]]));
    assert.deepEqual(
      q.sources.map((s) => [s.tariffId, s.dates]),
      [
        ['standard', ['2027-08-30', '2027-08-31']],
        ['peak', ['2027-09-01']],
      ],
    );
  });
  it('wszystkie kwoty wyceny są całkowitymi groszami', () => {
    const q = quote(catalog, {
      ...days('2027-06-10', '2027-06-12', [['ns-m', 3], ['cannondale-l', 1]]),
      services: [{ serviceId: 'mtb', quantity: 3 }],
    });
    for (const value of [q.total, q.rentalSubtotal, q.servicesSubtotal, q.standardSubtotal, q.dateDifference, q.discount?.amount ?? 0]) {
      assert.ok(Number.isInteger(value), `kwota ${value} nie jest całkowita`);
    }
  });
  it('wynik nie zależy od kolejności pozycji', () => {
    const a = quote(catalog, days('2027-06-10', '2027-06-12', [['ns-m', 2], ['ktm-l', 1]]));
    const b = quote(catalog, days('2027-06-10', '2027-06-12', [['ktm-l', 1], ['ns-m', 2]]));
    assert.equal(a.total, b.total);
  });
  it('koniec przed początkiem jest błędem, nie ceną', () => {
    assert.throws(() => quote(catalog, days('2027-06-12', '2027-06-10', [['ns-m', 1]])));
  });
  it('kwota ręczna zespołu zastępuje sumę', () => {
    assert.equal(amountDue(25000, null), 25000);
    assert.equal(amountDue(25000, { amount: 20000, by: 'Ola', at: '2027-06-01T10:00:00Z', reason: 'stały klient' }), 20000);
  });
  it('zaokrąglanie: połówki w górę, do wskazanej jednostki', () => {
    assert.equal(roundHalfUp(64333.33, 100), 64300);
    assert.equal(roundHalfUp(45050, 100), 45100);
    assert.equal(roundHalfUp(45049, 100), 45000);
    assert.equal(roundHalfUp(2.5, 1), 3);
  });
});
