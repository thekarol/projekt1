// Builds the demo seed (src/data/seed/skybike.json) from the two data files in dane/.
// Contains transformation only: every number and name comes from those files.

import { readFileSync, writeFileSync } from 'node:fs';
import type { Catalog, DateException, Rate, Service, Unit, Variant } from '../src/core/types.ts';
import { parseTime } from '../src/core/time.ts';
import type { SeedFile, SeedReservation } from '../src/data/seed.ts';

const read = (path: string): any => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const source = read('../dane/dane-startowe.json');
const owner = read('../dane/decyzje-wlasciciela.json');

const tenantId: string = owner.najemca.id;
const rec = <T extends object>(fields: T): T & { tenantId: string; version: number } => ({
  ...fields,
  tenantId,
  version: 1,
});
const zl = (amount: number): number => Math.round(amount * 100);
const pick = (object: any, path: string): any => path.split('.').reduce((o, key) => o[key], object);

const products: Catalog['products'] = [];
const variants: Variant[] = [];
const units: Unit[] = [];
const rates: Rate[] = [];

source.flota.forEach((bike: any, index: number) => {
  const model = owner.modele[bike.id];
  if (!model) throw new Error(`No owner decision for model ${bike.id}`);
  const declared = Object.values<number>(model.rozmiary).reduce((a, b) => a + b, 0);
  if (declared !== bike.sztuk) throw new Error(`${bike.nazwa}: sizes give ${declared}, source says ${bike.sztuk}`);
  products.push(
    rec({
      id: model.id,
      name: bike.nazwa,
      codePrefix: model.prefiksKodu,
      typeLabel: bike.typ,
      audience: bike.dlaKogo,
      use: bike.zastosowanie,
      specification: bike.specyfikacja,
      image: bike.zdjecie,
      route: null,
      tileFields: ['image', 'name', 'type', 'price', 'sizes'],
      active: true,
      order: index,
    }),
  );
  Object.entries<number>(model.rozmiary).forEach(([size, count], sizeIndex) => {
    const variantId = `${model.id}-${size.toLowerCase()}`;
    variants.push(rec({ id: variantId, productId: model.id, label: size, bufferMinutes: 0, active: true, order: sizeIndex }));
    for (let n = 1; n <= count; n++) {
      const code = `${model.prefiksKodu}-${size}-${String(n).padStart(2, '0')}`;
      units.push(rec({ id: `u-${code.toLowerCase()}`, variantId, code, activeFrom: null, retiredFrom: null, note: '' }));
    }
    for (const tariff of source.taryfy) {
      for (const band of owner.progi) {
        rates.push({
          tenantId,
          tariffId: tariff.id,
          variantId,
          bandId: band.id,
          amount: zl(tariff.stawki[bike.id][band.klucz]),
        });
      }
    }
  });
});

const services: Service[] = [];
source.wyposazenieZaRowerZaDzien
  .filter((item: any) => item.cena > 0)
  .forEach((item: any, index: number) => {
    services.push(
      rec({
        id: item.id,
        categoryId: 'equipment',
        name: item.nazwa,
        billing: 'perUnitPerDay' as const,
        price: zl(item.cena),
        limitedByVehicle: false,
        stock: null,
        needsAddress: false,
        active: true,
        order: index,
      }),
    );
  });
owner.uslugiDodatkowe.forEach((item: any, index: number) => {
  services.push(
    rec({
      id: item.id,
      categoryId: item.kategoria,
      name: item.nazwa,
      billing: item.naliczanie,
      price: item.cenaZDanych ? zl(pick(source, item.cenaZDanych)) : null,
      limitedByVehicle: Boolean(item.limitAuta),
      stock: null,
      needsAddress: Boolean(item.wymagaAdresu),
      active: true,
      order: 100 + index,
    }),
  );
});

const dateExceptions: DateException[] = owner.wyjatkiDat.map((e: any) =>
  rec({
    id: e.id,
    from: e.od,
    to: e.do,
    action: e.dzialanie === 'zamkniete' ? { kind: 'closed' as const } : { kind: 'tariff' as const, tariffId: e.taryfa },
    note: e.notatka,
  }),
);

const rules = source.reguly;
const catalog: Catalog = {
  tenant: {
    id: tenantId,
    name: source.najemca.nazwa,
    address: source.najemca.adres,
    locale: 'pl-PL',
    currency: source.najemca.waluta,
    timeZone: source.najemca.strefaCzasowa,
    reservationPrefix: owner.najemca.prefiksZgloszen,
    dictionary: owner.najemca.slownik,
  },
  settings: {
    tenantId,
    version: 1,
    hourly: {
      minHours: rules.najemGodzinowy.godzinyOd,
      maxHours: rules.najemGodzinowy.godzinyDo,
      stepMinutes: owner.ustawienia.krokGodzinMinuty,
    },
    maxRentalDays: rules.najemDniowy.dniDo,
    mixedRoundingGrosze: owner.ustawienia.zaokraglenieTerminuMieszanegoGrosze,
    groupDiscount: {
      active: owner.ustawienia.rabatGrupowy.aktywny,
      minUnits: owner.ustawienia.rabatGrupowy.odSztuk,
      percent: owner.ustawienia.rabatGrupowy.procent,
      base: owner.ustawienia.rabatGrupowy.podstawa,
      marksToBeAgreed: owner.ustawienia.rabatGrupowy.oznaczaDoUstalenia,
    },
    limits: { unitsPerOrder: rules.limity.rowerowWZamowieniu, unitsPerProduct: rules.limity.sztukJednegoModelu },
    delivery: { vehicleCapacity: owner.ustawienia.limitAutaPrzyDowozie },
    payments: { onlineEnabled: owner.ustawienia.platnosciOnline },
    calendar: {
      lowStockThreshold: owner.ustawienia.progOstatnichSztuk,
      horizonDays: owner.ustawienia.horyzontKalendarzaDni,
    },
    booking: {
      sameDayDaysUntil: owner.ustawienia.najemDniowyNaDzisDoGodziny ? parseTime(owner.ustawienia.najemDniowyNaDzisDoGodziny) : null,
    },
  },
  bands: owner.progi.map((b: any, order: number) =>
    rec({ id: b.id, kind: b.rodzaj, maxHours: b.maxGodzin, days: b.dni, label: b.etykieta, order }),
  ),
  tariffs: source.taryfy.map((t: any) => {
    const season = owner.sezony[t.id];
    return rec({
      id: t.id,
      name: t.nazwa,
      isBase: season === null,
      priority: season === null ? 0 : 10,
      active: true,
      season: season === null ? null : { months: season.miesiace, weekdays: season.dniTygodnia },
    });
  }),
  rates,
  dateExceptions,
  openingRules: owner.godziny.map((h: any) =>
    rec({
      id: h.id,
      period: h.okres,
      weekdays: h.dniTygodnia,
      closed: false,
      open: parseTime(h.od),
      close: parseTime(h.do),
      priority: 0,
    }),
  ),
  products,
  variants,
  units,
  unitOutages: [],
  serviceCategories: owner.kategorieUslug.map((c: any, order: number) =>
    rec({ id: c.id, name: c.nazwa, requestType: c.rodzajZgloszenia, noneLabel: c.etykietaBez, order }),
  ),
  services,
  statuses: owner.statusy.map((s: any, order: number) =>
    rec({ id: s.id, name: s.nazwa, order, blocksStock: s.blokuje, isInitial: s.poczatkowy, tone: s.ton }),
  ),
  channels: owner.kanaly.map((c: any, order: number) => rec({ id: c.id, name: c.nazwa, order })),
  content: owner.tresci.map((c: any, order: number) => rec({ id: c.id, kind: c.rodzaj, title: c.tytul, body: c.tresc, image: c.zdjecie ?? null, active: true, order })),
  users: owner.uzytkownicy.map((u: any) => rec({ id: u.id, name: u.imie, email: u.email, role: u.rola, active: true })),
};

const reservations: SeedReservation[] = owner.przykladoweZgloszenia.map((r: any) => ({
  number: r.numer,
  createdAt: r.zgloszono,
  source: r.zrodlo,
  channelId: r.kanal,
  statusId: r.status,
  customer: { name: r.klient.imie, phone: r.klient.telefon, email: r.klient.email },
  order: {
    mode: r.tryb,
    startDate: r.od,
    endDate: r.do,
    ...(r.tryb === 'hours' ? { startMinute: parseTime(r.odGodziny), endMinute: parseTime(r.doGodziny) } : {}),
    items: r.rowery.map((i: any) => ({ variantId: i.wariant, quantity: i.ile })),
    services: r.uslugi.map((i: any) => ({ serviceId: i.usluga, quantity: i.ile })),
  },
  notes: r.notatka,
}));

const seed: SeedFile = { catalog, reservations };
const target = new URL('../src/data/seed/skybike.json', import.meta.url);
writeFileSync(target, JSON.stringify(seed, null, 2) + '\n');
console.log(
  `Seed written: ${products.length} products, ${variants.length} variants, ${units.length} units, ` +
    `${rates.length} rates, ${services.length} services, ${reservations.length} sample reservations`,
);
