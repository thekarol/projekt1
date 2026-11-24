import { useState } from 'react';
import { formatDate, formatDay, formatTerm, MONTHS, money, moneyShort, statusName, toBeAgreedText, variantName, WEEKDAYS_SHORT } from '../app/labels.ts';
import { capacityOn } from '../core/availability.ts';
import { amountDue, ratesFromBase } from '../core/pricing.ts';
import { formatTime, toZoned } from '../core/time.ts';
import type { Catalog, DateException, Id, OpeningRule, Rate, Reservation, Settings, Tariff, Unit } from '../core/types.ts';
import { Chips, Crud, moneyInput, parseMoney } from './crud.tsx';
import type { FieldDef } from './crud.tsx';
import { useApp } from './store.tsx';
import { Icon, Notice, Sketch } from './widgets.tsx';

const yesNo = (value: boolean): string => (value ? 'tak' : 'nie');
const stamp = (iso: string, timeZone: string): string => {
  const z = toZoned(Date.parse(iso), timeZone);
  return `${formatDay(z.date)} ${formatTime(z.minute)}`;
};

function suggestCode(catalog: Catalog, variantId: Id): string {
  const variant = catalog.variants.find((v) => v.id === variantId);
  const product = variant && catalog.products.find((p) => p.id === variant.productId);
  if (!variant || !product) return '';
  const prefix = `${product.codePrefix}-${variant.label}-`;
  const used = catalog.units.filter((u) => u.code.startsWith(prefix)).map((u) => Number(u.code.slice(prefix.length)) || 0);
  return prefix + String(Math.max(0, ...used) + 1).padStart(2, '0');
}

function unitState(catalog: Catalog, unit: Unit, today: string): string {
  if (unit.retiredFrom && unit.retiredFrom <= today) return `wycofany od ${formatDay(unit.retiredFrom)}`;
  if (unit.activeFrom && unit.activeFrom > today) return `w ofercie od ${formatDay(unit.activeFrom)}`;
  const outage = catalog.unitOutages.find((o) => o.unitId === unit.id && o.from <= today && today <= o.to);
  if (outage) return `wyłączony do ${formatDay(outage.to)}`;
  const next = catalog.unitOutages.filter((o) => o.unitId === unit.id && o.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
  if (next) return `aktywny, wyłączenie ${formatDay(next.from)} – ${formatDay(next.to)}`;
  return unit.retiredFrom ? `aktywny do ${formatDay(unit.retiredFrom)}` : 'aktywny';
}

export function OfferPage() {
  const app = useApp();
  const { catalog } = app;
  const today = app.now.date;
  const products = [...catalog.products].sort((a, b) => a.order - b.order);
  const [productId, setProductId] = useState<Id | null>(products[0]?.id ?? null);
  const current = products.find((p) => p.id === productId) ?? products[0] ?? null;
  const variants = catalog.variants.filter((v) => v.productId === current?.id).sort((a, b) => a.order - b.order);
  const variantIds = new Set(variants.map((v) => v.id));
  const units = catalog.units.filter((u) => variantIds.has(u.variantId));
  const unitIds = new Set(units.map((u) => u.id));
  const variantOptions = variants.map((v) => ({ value: v.id, label: v.label }));
  const unitOptions = units.map((u) => ({ value: u.id, label: u.code }));
  const history = app.audit.filter((a) => ['products', 'variants', 'units', 'unitOutages'].includes(a.entity)).slice().reverse();
  const tileOptions = [['image', 'zdjęcie'], ['name', 'nazwa'], ['type', 'typ'], ['audience', 'opis „dla kogo”'], ['price', 'cena'], ['sizes', 'rozmiary']] as const;

  const productFields: FieldDef[] = [
    { key: 'name', label: 'Nazwa', type: 'text' },
    { key: 'typeLabel', label: 'Typ (plakietka)', type: 'text' },
    { key: 'codePrefix', label: 'Prefiks kodów egzemplarzy', type: 'text', hint: 'np. NS; kody: NS-M-01' },
    { key: 'image', label: 'Plik zdjęcia', type: 'text', nullable: true, hint: 'nazwa pliku w katalogu zdjęć' },
    { key: 'audience', label: 'Dla kogo', type: 'textarea' },
    { key: 'use', label: 'Zastosowanie', type: 'textarea' },
    { key: 'specification', label: 'Specyfikacja', type: 'textarea' },
    {
      key: 'route', label: 'Trasa', type: 'custom',
      render: (draft, set) => (
        <div className="ra-form">
          <label className="ra-field">Proponowana trasa: nazwa<input value={draft.route?.name ?? ''} onChange={(e) => set({ route: e.target.value || draft.route?.url ? { name: e.target.value, url: draft.route?.url ?? '' } : null })} /></label>
          <label className="ra-field">Proponowana trasa: link<input value={draft.route?.url ?? ''} onChange={(e) => set({ route: e.target.value || draft.route?.name ? { name: draft.route?.name ?? '', url: e.target.value } : null })} /></label>
        </div>
      ),
    },
    {
      key: 'tileFields', label: 'Elementy kafelka', type: 'custom',
      render: (draft, set) => (
        <div className="ra-field">
          Elementy widoczne na kafelku w sklepie
          <div className="ra-chips">
            {tileOptions.map(([key, label]) => {
              const on = (draft.tileFields ?? []).includes(key);
              return (
                <button key={key} type="button" className="ra-chip" aria-pressed={on} onClick={() => set({ tileFields: on ? draft.tileFields.filter((f: string) => f !== key) : [...(draft.tileFields ?? []), key] })}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ),
    },
    { key: 'order', label: 'Kolejność', type: 'number' },
    { key: 'active', label: 'Widoczny w sklepie', type: 'bool' },
  ];

  return (
    <div className="ra-wrap ra-panel">
      <h1>Oferta: produkty i flota</h1>
      <Crud
        collection="products"
        title="Produkty"
        addLabel="Dodaj produkt"
        fields={productFields}
        columns={[
          { label: 'Nazwa', cell: (p) => <strong>{p.name}</strong> },
          { label: 'Typ', cell: (p) => p.typeLabel },
          { label: 'Sztuk dziś', cell: (p) => catalog.variants.filter((v) => v.productId === p.id).reduce((sum, v) => sum + capacityOn(catalog, v.id, today), 0) },
          { label: 'W sklepie', cell: (p) => yesNo(p.active) },
        ]}
        create={() => ({ name: '', codePrefix: '', typeLabel: '', audience: '', use: '', specification: '', image: null, route: null, tileFields: ['image', 'name', 'type', 'price', 'sizes'], active: true, order: products.length })}
        describe={(p) => `produkt ${p.name}`}
        removable={(p) => !catalog.variants.some((v) => v.productId === p.id)}
        hint="Sklep buduje się z tych danych. Produkt z rozmiarami usuniesz po usunięciu jego rozmiarów; częściej wystarczy wyłączyć „Widoczny w sklepie”."
      />

      <div className="ra-stack">
        <h2>Flota produktu</h2>
        <div className="ra-list" role="tablist" aria-label="Produkt" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {products.map((p) => (
            <button key={p.id} type="button" aria-current={p.id === current?.id} onClick={() => setProductId(p.id)}>{p.name}</button>
          ))}
        </div>
      </div>

      {current ? (
        <>
          <Crud
            collection="variants"
            title={`Rozmiary: ${current.name}`}
            addLabel="Dodaj rozmiar"
            filter={(v) => v.productId === current.id}
            fields={[
              { key: 'label', label: 'Rozmiar (etykieta)', type: 'text' },
              { key: 'bufferMinutes', label: 'Bufor po zwrocie (minuty)', type: 'number', hint: 'czas na przegląd i czyszczenie' },
              { key: 'order', label: 'Kolejność', type: 'number' },
              { key: 'active', label: 'Dostępny w sklepie', type: 'bool' },
            ]}
            columns={[
              { label: 'Rozmiar', cell: (v) => <strong>{v.label}</strong> },
              { label: 'Sztuk dziś', cell: (v) => capacityOn(catalog, v.id, today) },
              { label: 'Egzemplarzy', cell: (v) => catalog.units.filter((u) => u.variantId === v.id).length },
              { label: 'Bufor', cell: (v) => `${v.bufferMinutes} min` },
              { label: 'W sklepie', cell: (v) => yesNo(v.active) },
            ]}
            create={() => ({ productId: current.id, label: '', bufferMinutes: 0, active: true, order: variants.length })}
            describe={(v) => `rozmiar ${v.label} (${current.name})`}
            hint="Liczba sztuk nie jest wpisywana: wynika z listy egzemplarzy poniżej. Nowy rozmiar potrzebuje jeszcze cen w zakładce Cennik."
          />
          <Crud
            collection="units"
            title="Egzemplarze"
            addLabel="Dodaj egzemplarz"
            filter={(u) => variantIds.has(u.variantId)}
            sort={(a, b) => a.code.localeCompare(b.code)}
            fields={[
              { key: 'variantId', label: 'Rozmiar', type: 'select', options: variantOptions },
              {
                key: 'code', label: 'Kod', type: 'custom',
                render: (draft, set) => (
                  <div className="ra-field">
                    <label htmlFor="unit-code">Kod egzemplarza (unikalny)</label>
                    <div className="ra-row">
                      <input id="unit-code" className="ra-input" style={{ flex: '1 1 140px' }} value={draft.code ?? ''} onChange={(e) => set({ code: e.target.value })} />
                      <button type="button" className="ra-btn ra-btn-small" onClick={() => set({ code: suggestCode(catalog, draft.variantId) })}>Zaproponuj</button>
                    </div>
                  </div>
                ),
              },
              { key: 'activeFrom', label: 'W ofercie od (zakup)', type: 'date', nullable: true, hint: 'puste = od zawsze' },
              { key: 'retiredFrom', label: 'Wycofany od (sprzedaż)', type: 'date', nullable: true, hint: 'puste = bez końca' },
              { key: 'note', label: 'Notatka', type: 'text' },
            ]}
            columns={[
              { label: 'Kod', cell: (u) => <strong>{u.code}</strong> },
              { label: 'Rozmiar', cell: (u) => catalog.variants.find((v) => v.id === u.variantId)?.label },
              { label: 'Stan', cell: (u) => unitState(catalog, u, today) },
              { label: 'Notatka', cell: (u) => u.note },
            ]}
            create={variants[0] ? () => ({ variantId: variants[0]!.id, code: suggestCode(catalog, variants[0]!.id), activeFrom: null, retiredFrom: null, note: '' }) : undefined}
            describe={(u) => `egzemplarz ${u.code}${u.activeFrom ? ` od ${formatDay(u.activeFrom)}` : ''}${u.retiredFrom ? `, wycofany od ${formatDay(u.retiredFrom)}` : ''}`}
            hint="Każdy rower ma własny kod. Zakup i sprzedaż planujesz datami; klient nadal rezerwuje liczbę sztuk w rozmiarze, nie konkretny egzemplarz."
          />
          <Crud
            collection="unitOutages"
            title="Wyłączenia (serwis, naprawa)"
            addLabel="Dodaj wyłączenie"
            filter={(o) => unitIds.has(o.unitId)}
            sort={(a, b) => a.from.localeCompare(b.from)}
            fields={[
              { key: 'unitId', label: 'Egzemplarz', type: 'select', options: unitOptions },
              { key: 'from', label: 'Od', type: 'date' },
              { key: 'to', label: 'Do (włącznie)', type: 'date' },
              { key: 'reason', label: 'Powód', type: 'text' },
            ]}
            columns={[
              { label: 'Egzemplarz', cell: (o) => <strong>{catalog.units.find((u) => u.id === o.unitId)?.code}</strong> },
              { label: 'Od', cell: (o) => formatDate(o.from) },
              { label: 'Do', cell: (o) => formatDate(o.to) },
              { label: 'Powód', cell: (o) => o.reason },
            ]}
            create={units[0] ? () => ({ unitId: units[0]!.id, from: today, to: today, reason: 'serwis' }) : undefined}
            describe={(o) => `wyłączenie ${catalog.units.find((u) => u.id === o.unitId)?.code ?? ''} ${formatDay(o.from)} – ${formatDay(o.to)}${o.reason ? ` (${o.reason})` : ''}`}
            hint="Wyłączony egzemplarz zmniejsza dostępność tylko w podanym okresie. Jeśli w tym czasie są rezerwacje ponad stan, zobaczysz ostrzeżenie przed zapisem."
          />
        </>
      ) : null}

      <section className="ra-stack">
        <h3>Historia zmian floty</h3>
        {history.length === 0 ? <p className="ra-muted ra-small">Brak zmian od wczytania danych startowych.</p> : (
          <div className="ra-tablebox">
            <table className="ra-table">
              <thead><tr><th>Kiedy</th><th>Kto</th><th>Co</th></tr></thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}><td>{stamp(entry.at, catalog.tenant.timeZone)}</td><td>{entry.actor.name}</td><td>{entry.summary}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function seasonText(tariff: Tariff): string {
  if (tariff.isBase) return 'zawsze, gdy nic innego nie pasuje';
  if (!tariff.season) return 'bez sezonu (tylko wyjątki dat)';
  const months = tariff.season.months.length === 0 ? 'cały rok' : tariff.season.months.map((m) => MONTHS[m - 1]).join(', ');
  const days = tariff.season.weekdays.length === 0 ? 'każdy dzień' : tariff.season.weekdays.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ');
  return `${months} · ${days}`;
}

function RatesGrid() {
  const app = useApp();
  const { catalog } = app;
  const tariffs = [...catalog.tariffs].sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.name.localeCompare(b.name));
  const [tariffId, setTariffId] = useState(tariffs[0]?.id ?? '');
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [fill, setFill] = useState({ value: '10', kind: 'percent' as 'percent' | 'amount' });
  const [confirm, setConfirm] = useState<{ text: string; rates: Array<Omit<Rate, 'tenantId'>>; note: string } | null>(null);
  const tariff = catalog.tariffs.find((t) => t.id === tariffId);
  const bands = [...catalog.bands].sort((a, b) => a.order - b.order);
  const rateOf = (variantId: Id, bandId: Id) => catalog.rates.find((r) => r.tariffId === tariffId && r.variantId === variantId && r.bandId === bandId);

  const write = async (rates: Array<Omit<Rate, 'tenantId'>>, note: string): Promise<void> => {
    const result = await app.repo.setRates(rates, { actor: app.actor, note });
    setConfirm(null);
    await app.reload();
    app.toast(result.ok ? 'Zapisano ceny.' : 'Nie udało się zapisać cen.');
  };

  /** Asks first when the change would overwrite a price someone edited by hand. */
  const guarded = (rates: Array<Omit<Rate, 'tenantId'>>, note: string): void => {
    const overwritten = rates.filter((r) => {
      const current = rateOf(r.variantId, r.bandId);
      return current?.manuallyEdited && current.amount !== r.amount;
    });
    if (overwritten.length === 0) void write(rates, note);
    else {
      setConfirm({
        rates,
        note,
        text: `Ta zmiana nadpisze ${overwritten.length} ${overwritten.length === 1 ? 'cenę zmienioną' : 'ceny zmienione'} ręcznie: ${overwritten.map((r) => `${variantName(catalog, r.variantId)} / ${bands.find((b) => b.id === r.bandId)?.label}`).join('; ')}.`,
      });
    }
  };

  if (!tariff) return null;
  // A size without a price in some tariff is "do ustalenia" on that tariff's days; say so before a customer finds out.
  const missing = tariffs
    .filter((t) => t.active)
    .map((t) => ({
      tariff: t,
      variants: catalog.variants.filter((v) => v.active && bands.some((b) => !catalog.rates.some((r) => r.tariffId === t.id && r.variantId === v.id && r.bandId === b.id))),
    }))
    .filter((m) => m.variants.length > 0);
  return (
    <section className="ra-stack">
      {missing.length > 0 ? (
        <div data-testid="missing-rates">
          <Notice kind="warn">
            <strong>Brakuje cen.</strong> W dniach tych taryf najem będzie „do ustalenia”, bez płatności online:
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {missing.map((m) => (
                <li key={m.tariff.id}>{m.tariff.name}: {m.variants.map((v) => variantName(catalog, v.id)).join(', ')}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
      <div className="ra-row">
        <label className="ra-field" style={{ minWidth: 240 }}>
          Taryfa (nazwa wewnętrzna, klient jej nie widzi)
          <select value={tariffId} onChange={(e) => { setTariffId(e.target.value); setBulk({}); setConfirm(null); }}>
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (wyłączona)'}</option>
            ))}
          </select>
        </label>
        <span className="ra-small ra-muted">Obowiązuje: {seasonText(tariff)}</span>
      </div>
      {!tariff.isBase ? (
        <div className="ra-card ra-row">
          <strong>Wypełnij z Bazowej:</strong>
          <input className="ra-input" style={{ width: 90 }} inputMode="decimal" aria-label="Wartość korekty" value={fill.value} onChange={(e) => setFill({ ...fill, value: e.target.value })} />
          <select className="ra-input" style={{ width: 110 }} aria-label="Rodzaj korekty" value={fill.kind} onChange={(e) => setFill({ ...fill, kind: e.target.value as 'percent' | 'amount' })}>
            <option value="percent">%</option>
            <option value="amount">zł</option>
          </select>
          <button
            type="button"
            className="ra-btn"
            onClick={() => {
              const value = Number(fill.value.replace(',', '.'));
              if (!Number.isFinite(value)) return;
              const rates = ratesFromBase(catalog, tariffId, { kind: fill.kind, value: fill.kind === 'amount' ? Math.round(value * 100) : value });
              guarded(rates.map(({ tenantId: _t, ...r }) => ({ ...r, manuallyEdited: false })), `taryfa ${tariff.name}: wypełniono z Bazowej ${value > 0 ? '+' : ''}${fill.value}${fill.kind === 'percent' ? '%' : ' zł'}`);
            }}
          >
            Wypełnij
          </button>
          <span className="ra-small ra-muted">Korekta ujemna obniża ceny. Wynik zaokrąglamy do pełnych złotych, potem możesz poprawić pojedyncze komórki.</span>
        </div>
      ) : null}
      {confirm ? (
        <Notice kind="warn">
          {confirm.text}
          <div className="ra-row" style={{ marginTop: 8 }}>
            <button type="button" className="ra-btn ra-btn-primary ra-btn-small" onClick={() => void write(confirm.rates, confirm.note)}>Nadpisz</button>
            <button type="button" className="ra-btn ra-btn-small" onClick={() => setConfirm(null)}>Anuluj</button>
          </div>
        </Notice>
      ) : null}
      <div className="ra-tablebox">
        <table className="ra-table" data-testid="rates">
          <thead>
            <tr><th>Rozmiar</th>{bands.map((b) => <th key={b.id}>{b.label}</th>)}<th /></tr>
          </thead>
          <tbody>
            {catalog.products.slice().sort((a, b) => a.order - b.order).map((product) => {
              const variants = catalog.variants.filter((v) => v.productId === product.id).sort((a, b) => a.order - b.order);
              if (variants.length === 0) return null;
              return [
                <tr key={product.id} style={{ background: 'var(--surface)' }}>
                  <td><strong>{product.name}</strong><div className="ra-small ra-muted">wszystkie rozmiary naraz</div></td>
                  {bands.map((band) => (
                    <td key={band.id}>
                      <input className="ra-cell" inputMode="decimal" aria-label={`${product.name}, wszystkie rozmiary, ${band.label}`} value={bulk[`${product.id}|${band.id}`] ?? ''} onChange={(e) => setBulk({ ...bulk, [`${product.id}|${band.id}`]: e.target.value })} />
                    </td>
                  ))}
                  <td className="ra-actions">
                    <button
                      type="button"
                      className="ra-btn ra-btn-small"
                      onClick={() => {
                        const rates: Array<Omit<Rate, 'tenantId'>> = [];
                        for (const band of bands) {
                          const amount = parseMoney(bulk[`${product.id}|${band.id}`] ?? '');
                          if (amount === null) continue;
                          for (const v of variants) rates.push({ tariffId, variantId: v.id, bandId: band.id, amount, manuallyEdited: false });
                        }
                        if (rates.length > 0) guarded(rates, `taryfa ${tariff.name}: ${product.name}, cena dla wszystkich rozmiarów`);
                        setBulk({});
                      }}
                    >
                      Wpisz wszystkim
                    </button>
                  </td>
                </tr>,
                ...variants.map((variant) => (
                  <tr key={variant.id}>
                    <td>{variant.label}</td>
                    {bands.map((band) => {
                      const rate = rateOf(variant.id, band.id);
                      return (
                        <td key={`${band.id}-${rate?.amount ?? 'none'}`}>
                          <input
                            className="ra-cell"
                            inputMode="decimal"
                            title={rate?.manuallyEdited ? 'Cena zmieniona ręcznie' : undefined}
                            data-edited={Boolean(rate?.manuallyEdited)}
                            aria-label={`${product.name} ${variant.label}, ${band.label}${rate?.manuallyEdited ? ', zmieniona ręcznie' : ''}`}
                            defaultValue={moneyInput(rate?.amount)}
                            placeholder="brak"
                            onBlur={(e) => {
                              const amount = parseMoney(e.target.value);
                              if (amount === null || amount === rate?.amount) return;
                              void write([{ tariffId, variantId: variant.id, bandId: band.id, amount, manuallyEdited: true }], `taryfa ${tariff.name}: ${product.name} ${variant.label}, ${band.label} = ${moneyShort(amount)}`);
                            }}
                          />
                          {rate?.manuallyEdited ? <div className="ra-small ra-muted">ręcznie</div> : null}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="ra-small ra-muted">Komórka z pomarańczową ramką i dopiskiem „ręcznie” została zmieniona ręcznie. Pusta komórka oznacza brak ceny: taki najem jest „do ustalenia”.</p>
    </section>
  );
}

function exceptionText(catalog: Catalog, exception: DateException): string {
  if (exception.action.kind === 'closed') return 'zamknięte';
  if (exception.action.kind === 'tariff') {
    const id = exception.action.tariffId;
    return `taryfa: ${catalog.tariffs.find((t) => t.id === id)?.name ?? id}`;
  }
  return `własne kwoty (${exception.action.prices.length})`;
}

export function PricingPage() {
  const app = useApp();
  const { catalog } = app;
  const [tab, setTab] = useState<'stawki' | 'taryfy' | 'progi' | 'wyjatki'>('stawki');
  const bands = [...catalog.bands].sort((a, b) => a.order - b.order);
  const tabs = [['stawki', 'Stawki'], ['taryfy', 'Taryfy i sezony'], ['progi', 'Progi cennika'], ['wyjatki', 'Wyjątki dat']] as const;
  return (
    <div className="ra-wrap ra-panel">
      <h1>Cennik</h1>
      <div className="ra-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'stawki' ? <RatesGrid /> : null}
      {tab === 'taryfy' ? (
        <Crud
          collection="tariffs"
          title="Taryfy"
          addLabel="Dodaj taryfę"
          sort={(a, b) => Number(b.isBase) - Number(a.isBase) || b.priority - a.priority}
          fields={[
            { key: 'name', label: 'Nazwa wewnętrzna', type: 'text', hint: 'klient jej nie widzi' },
            { key: 'priority', label: 'Priorytet', type: 'number', hint: 'gdy dwie taryfy pasują do daty, wygrywa wyższy', show: (d) => !d.isBase },
            {
              key: 'season', label: 'Sezon', type: 'custom', show: (d) => !d.isBase,
              render: (draft, set) => (
                <div className="ra-stack" style={{ gap: 8 }}>
                  <label className="ra-check">
                    <input type="checkbox" checked={draft.season !== null} onChange={(e) => set({ season: e.target.checked ? { months: [], weekdays: [] } : null })} />
                    <span>Działa automatycznie w sezonie <span className="ra-small ra-muted">· bez tego taryfa działa tylko przez wyjątki dat</span></span>
                  </label>
                  {draft.season ? (
                    <>
                      <div className="ra-field">Miesiące (nic nie zaznaczone = cały rok)<Chips label="Miesiące" labels={['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']} value={draft.season.months} onChange={(months) => set({ season: { ...draft.season, months } })} /></div>
                      <div className="ra-field">Dni tygodnia (nic nie zaznaczone = każdy dzień)<Chips label="Dni tygodnia" labels={WEEKDAYS_SHORT} value={draft.season.weekdays} onChange={(weekdays) => set({ season: { ...draft.season, weekdays } })} /></div>
                    </>
                  ) : null}
                </div>
              ),
            },
            { key: 'active', label: 'Aktywna', type: 'bool', show: (d) => !d.isBase },
          ]}
          columns={[
            { label: 'Nazwa', cell: (t) => <strong>{t.name}</strong> },
            { label: 'Kiedy obowiązuje', cell: (t) => seasonText(t) },
            { label: 'Priorytet', cell: (t) => (t.isBase ? '—' : t.priority) },
            { label: 'Aktywna', cell: (t) => yesNo(t.active) },
          ]}
          create={() => ({ name: '', isBase: false, priority: 10, active: true, season: { months: [], weekdays: [] } })}
          describe={(t) => `taryfa ${t.name}`}
          removable={(t) => !t.isBase}
          hint="Po dodaniu taryfy przejdź do zakładki Stawki i użyj „Wypełnij z Bazowej”. Daty wyjątków (święta, wydarzenia) ustawiasz w zakładce Wyjątki dat i mają one pierwszeństwo przed sezonem."
        />
      ) : null}
      {tab === 'progi' ? (
        <Crud
          collection="bands"
          title="Progi cennika"
          addLabel="Dodaj próg"
          fields={[
            { key: 'label', label: 'Etykieta', type: 'text' },
            { key: 'kind', label: 'Rodzaj', type: 'select', options: [{ value: 'hours', label: 'najem godzinowy do N godzin' }, { value: 'days', label: 'pakiet N dni' }, { value: 'day', label: 'jeden dzień' }] },
            { key: 'maxHours', label: 'Do ilu godzin', type: 'number', show: (d) => d.kind === 'hours', hint: 'dłuższy najem godzinowy kosztuje tyle, co dzień' },
            { key: 'days', label: 'Liczba dni pakietu', type: 'number', show: (d) => d.kind === 'days' },
            { key: 'order', label: 'Kolejność', type: 'number' },
          ]}
          columns={[
            { label: 'Etykieta', cell: (b) => <strong>{b.label}</strong> },
            { label: 'Reguła', cell: (b) => (b.kind === 'hours' ? `najem do ${b.maxHours} godzin` : b.kind === 'days' ? `pakiet ${b.days} kolejnych dni` : 'jeden dzień') },
          ]}
          create={() => ({ kind: 'days', days: 4, label: '4 dni', order: bands.length })}
          describe={(b) => `próg ${b.label}`}
          removable={(b) => b.kind !== 'day'}
          hint="Najem dłuższy niż najdłuższy pakiet oraz długość bez pakietu są „do ustalenia”. Nowy próg potrzebuje cen w zakładce Stawki; usunięcie progu usuwa jego ceny."
        />
      ) : null}
      {tab === 'wyjatki' ? (
        <Crud
          collection="dateExceptions"
          title="Wyjątki dat"
          addLabel="Dodaj wyjątek"
          sort={(a, b) => a.from.localeCompare(b.from)}
          fields={[
            { key: 'from', label: 'Od', type: 'date' },
            { key: 'to', label: 'Do (włącznie)', type: 'date' },
            { key: 'note', label: 'Notatka', type: 'text' },
            {
              key: 'action', label: 'Działanie', type: 'custom',
              render: (draft, set) => {
                const action = draft.action;
                return (
                  <div className="ra-stack" style={{ gap: 4 }}>
                    <strong className="ra-small">Co dzieje się w tych dniach</strong>
                    <label className="ra-check"><input type="radio" name="ex-kind" checked={action.kind === 'tariff'} onChange={() => set({ action: { kind: 'tariff', tariffId: catalog.tariffs.find((t) => t.isBase)?.id ?? '' } })} /><span>Obowiązuje wybrana taryfa</span></label>
                    {action.kind === 'tariff' ? (
                      <label className="ra-field" style={{ maxWidth: 320 }}>Taryfa
                        <select value={action.tariffId} onChange={(e) => set({ action: { kind: 'tariff', tariffId: e.target.value } })}>
                          {catalog.tariffs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="ra-check"><input type="radio" name="ex-kind" checked={action.kind === 'customPrices'} onChange={() => set({ action: { kind: 'customPrices', prices: [] } })} /><span>Własne kwoty <span className="ra-small ra-muted">· puste komórki biorą cenę z taryfy, która i tak by obowiązywała</span></span></label>
                    {action.kind === 'customPrices' ? (
                      <div className="ra-tablebox">
                        <table className="ra-table">
                          <thead><tr><th>Rozmiar</th>{bands.map((b) => <th key={b.id}>{b.label}</th>)}</tr></thead>
                          <tbody>
                            {catalog.variants.filter((v) => v.active).map((v) => (
                              <tr key={v.id}>
                                <td>{variantName(catalog, v.id)}</td>
                                {bands.map((b) => {
                                  const found = action.prices.find((p: any) => p.variantId === v.id && p.bandId === b.id);
                                  return (
                                    <td key={b.id}>
                                      <input
                                        className="ra-cell"
                                        inputMode="decimal"
                                        aria-label={`${variantName(catalog, v.id)}, ${b.label}`}
                                        defaultValue={moneyInput(found?.amount)}
                                        onChange={(e) => {
                                          const amount = parseMoney(e.target.value);
                                          const rest = action.prices.filter((p: any) => !(p.variantId === v.id && p.bandId === b.id));
                                          set({ action: { kind: 'customPrices', prices: amount === null ? rest : [...rest, { variantId: v.id, bandId: b.id, amount }] } });
                                        }}
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    <label className="ra-check"><input type="radio" name="ex-kind" checked={action.kind === 'closed'} onChange={() => set({ action: { kind: 'closed' } })} /><span>Zamknięte <span className="ra-small ra-muted">· blokuje nowe rezerwacje; istniejących nie anuluje</span></span></label>
                  </div>
                );
              },
            },
          ]}
          columns={[
            { label: 'Od', cell: (e) => formatDate(e.from) },
            { label: 'Do', cell: (e) => formatDate(e.to) },
            { label: 'Działanie', cell: (e) => exceptionText(catalog, e) },
            { label: 'Notatka', cell: (e) => e.note },
          ]}
          create={() => ({ from: app.now.date, to: app.now.date, note: '', action: { kind: 'tariff', tariffId: catalog.tariffs.find((t) => t.isBase)?.id ?? '' } })}
          describe={(e) => `wyjątek ${formatDay(e.from)} – ${formatDay(e.to)}: ${exceptionText(catalog, e)}`}
          hint="Wyjątek ma pierwszeństwo przed sezonem. Gdy dwa wyjątki obejmują tę samą datę, wygrywa krótszy zakres."
        />
      ) : null}
    </div>
  );
}

export function ContentPage() {
  const section = (kind: string, title: string, canAdd: boolean, hint: string) => (
    <Crud
      collection="content"
      title={title}
      filter={(c) => c.kind === kind}
      fields={[
        { key: 'title', label: kind === 'faq' ? 'Pytanie' : 'Tytuł', type: 'text', wide: true },
        { key: 'body', label: kind === 'faq' ? 'Odpowiedź' : 'Treść', type: 'textarea' },
        ...(kind === 'hero' ? [{ key: 'image', label: 'Plik zdjęcia w tle', type: 'text' as const, nullable: true, hint: 'nazwa pliku w katalogu zdjęć' }] : []),
        { key: 'order', label: 'Kolejność', type: 'number' },
        { key: 'active', label: 'Widoczne na stronie', type: 'bool' },
      ]}
      columns={[
        { label: kind === 'faq' ? 'Pytanie' : 'Tytuł', cell: (c) => <strong>{c.title}</strong> },
        { label: 'Treść', cell: (c) => <span className="ra-small">{c.body}</span> },
        { label: 'Widoczne', cell: (c) => yesNo(c.active) },
      ]}
      create={canAdd ? () => ({ kind, title: '', body: '', image: null, active: true, order: 99 }) : undefined}
      describe={(c) => `treść „${c.title}”`}
      removable={() => canAdd}
      hint={hint}
    />
  );
  return (
    <div className="ra-wrap ra-panel">
      <h1>Treści strony</h1>
      {section('hero', 'Nagłówek strony głównej', false, 'Jeden nagłówek i jedno zdanie pod nim.')}
      {section('benefit', 'Sekcje: pakiety, grupy, dowóz i serwis', true, 'Pokazywane pod sklepem. Tekst powinien zgadzać się z regułami w Ustawieniach.')}
      {section('faq', 'Najczęściej zadawane pytania', true, 'Kolejność ustawiasz liczbą.')}
    </div>
  );
}

function periodText(rule: OpeningRule): string {
  if (!rule.period) return 'cały rok';
  return rule.period.kind === 'yearly' ? `co rok ${rule.period.from} – ${rule.period.to}` : `${formatDay(rule.period.from)} – ${formatDate(rule.period.to)}`;
}

function SettingsForm() {
  const app = useApp();
  const [draft, setDraft] = useState<Settings>(app.catalog.settings);
  const [errors, setErrors] = useState<string[]>([]);
  const num = (value: number, onChange: (n: number) => void, label: string, hint?: string) => (
    <label className="ra-field">{label}<input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />{hint ? <span className="ra-hint">{hint}</span> : null}</label>
  );
  const save = async (): Promise<void> => {
    const { tenantId: _t, id: _id, version, ...patch } = draft as Settings & { id?: string };
    const result = await app.repo.updateSettings(patch, { actor: app.actor, expectedVersion: version, note: 'zmieniono ustawienia' });
    if (!result.ok) {
      setErrors(result.error.code === 'invalid' ? result.error.errors.map((e) => `Błędna wartość: ${e}`) : ['Ustawienia zostały w międzyczasie zmienione. Odśwież i spróbuj ponownie.']);
      return;
    }
    setErrors([]);
    setDraft(result.record);
    await app.reload();
    app.toast('Zapisano ustawienia.');
  };
  const until = draft.booking.sameDayDaysUntil;
  return (
    <section className="ra-stack" data-testid="settings">
      <h3>Reguły</h3>
      <div className="ra-card ra-stack">
        <strong>Rabat grupowy</strong>
        <div className="ra-form">
          <label className="ra-check"><input type="checkbox" checked={draft.groupDiscount.active} onChange={(e) => setDraft({ ...draft, groupDiscount: { ...draft.groupDiscount, active: e.target.checked } })} /><span>Rabat grupowy włączony</span></label>
          {num(draft.groupDiscount.minUnits, (n) => setDraft({ ...draft, groupDiscount: { ...draft.groupDiscount, minUnits: n } }), 'Od ilu sztuk')}
          {num(draft.groupDiscount.percent, (n) => setDraft({ ...draft, groupDiscount: { ...draft.groupDiscount, percent: n } }), 'Procent rabatu')}
          <label className="ra-field">Od czego liczony
            <select value={draft.groupDiscount.base} onChange={(e) => setDraft({ ...draft, groupDiscount: { ...draft.groupDiscount, base: e.target.value as 'order' | 'rental' } })}>
              <option value="order">od całego zamówienia</option>
              <option value="rental">tylko od sprzętu</option>
            </select>
          </label>
          <label className="ra-check"><input type="checkbox" checked={draft.groupDiscount.marksToBeAgreed} onChange={(e) => setDraft({ ...draft, groupDiscount: { ...draft.groupDiscount, marksToBeAgreed: e.target.checked } })} /><span>Zamówienie z rabatem jest „do ustalenia” <span className="ra-small ra-muted">· bez płatności online</span></span></label>
        </div>
      </div>
      <div className="ra-card ra-stack">
        <strong>Dowóz, terminy i płatności</strong>
        <div className="ra-form">
          {num(draft.delivery.vehicleCapacity, (n) => setDraft({ ...draft, delivery: { vehicleCapacity: n } }), 'Liczba rowerów mieszczących się w aucie przy dowozie', 'powyżej tej liczby dowóz jest „do ustalenia”')}
          <label className="ra-field">Najem dniowy na dziś przyjmowany do godziny
            <input type="time" value={until === null ? '' : formatTime(until).padStart(5, '0')} onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); setDraft({ ...draft, booking: { sameDayDaysUntil: e.target.value === '' ? null : (h ?? 0) * 60 + (m ?? 0) } }); }} />
            <span className="ra-hint">puste = najem dniowy najwcześniej od jutra</span>
          </label>
          {num(draft.maxRentalDays, (n) => setDraft({ ...draft, maxRentalDays: n }), 'Najdłuższy najem w dniach')}
          {num(draft.hourly.minHours, (n) => setDraft({ ...draft, hourly: { ...draft.hourly, minHours: n } }), 'Najem godzinowy: od ilu godzin')}
          {num(draft.hourly.maxHours, (n) => setDraft({ ...draft, hourly: { ...draft.hourly, maxHours: n } }), 'Najem godzinowy: do ilu godzin')}
          {num(draft.hourly.stepMinutes, (n) => setDraft({ ...draft, hourly: { ...draft.hourly, stepMinutes: n } }), 'Krok wyboru godzin (minuty)')}
          {num(draft.limits.unitsPerOrder, (n) => setDraft({ ...draft, limits: { ...draft.limits, unitsPerOrder: n } }), 'Najwięcej sztuk w zamówieniu')}
          {num(draft.limits.unitsPerProduct, (n) => setDraft({ ...draft, limits: { ...draft.limits, unitsPerProduct: n } }), 'Najwięcej sztuk jednego modelu')}
          {num(draft.mixedRoundingGrosze / 100, (n) => setDraft({ ...draft, mixedRoundingGrosze: Math.round(n * 100) }), 'Zaokrąglenie terminu w kilku cenach (zł)')}
          {num(draft.calendar.lowStockThreshold, (n) => setDraft({ ...draft, calendar: { ...draft.calendar, lowStockThreshold: n } }), 'Próg „ostatnie sztuki” w kalendarzu')}
          {num(draft.calendar.horizonDays, (n) => setDraft({ ...draft, calendar: { ...draft.calendar, horizonDays: n } }), 'Ile dni naprzód można rezerwować')}
          <label className="ra-check"><input type="checkbox" checked={draft.payments.onlineEnabled} onChange={(e) => setDraft({ ...draft, payments: { onlineEnabled: e.target.checked } })} /><span>Płatności online włączone <Sketch>w pokazie płatność nic nie pobiera</Sketch></span></label>
        </div>
      </div>
      {errors.map((e) => <Notice key={e} kind="error">{e}</Notice>)}
      <button type="button" className="ra-btn ra-btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => void save()}>Zapisz reguły</button>
    </section>
  );
}

export function SettingsPage() {
  const app = useApp();
  const { catalog } = app;
  const categories = catalog.serviceCategories.map((c) => ({ value: c.id, label: c.name }));
  const billing = [{ value: 'perUnitPerDay', label: 'za sztukę za dzień' }, { value: 'perUnit', label: 'za sztukę' }, { value: 'fixed', label: 'stała kwota' }, { value: 'quote', label: 'wycena indywidualna (do ustalenia)' }];
  const billingName = (id: string) => billing.find((b) => b.value === id)?.label ?? id;
  return (
    <div className="ra-wrap ra-panel">
      <h1>Ustawienia</h1>
      <SettingsForm key={catalog.settings.version} />
      <Crud
        collection="openingRules"
        title="Godziny działania"
        addLabel="Dodaj regułę godzin"
        sort={(a, b) => (a.period ? 1 : 0) - (b.period ? 1 : 0) || b.priority - a.priority}
        fields={[
          { key: 'weekdays', label: 'Dni tygodnia', type: 'weekdays' },
          { key: 'closed', label: 'Punkt nieczynny w te dni', type: 'bool' },
          { key: 'open', label: 'Otwarcie', type: 'time', show: (d) => !d.closed },
          { key: 'close', label: 'Zamknięcie', type: 'time', show: (d) => !d.closed },
          {
            key: 'period', label: 'Okres', type: 'custom',
            render: (draft, set) => (
              <div className="ra-form">
                <label className="ra-field">Okres obowiązywania
                  <select value={draft.period?.kind ?? ''} onChange={(e) => set({ period: e.target.value === '' ? null : e.target.value === 'yearly' ? { kind: 'yearly', from: '05-01', to: '09-30' } : { kind: 'dates', from: app.now.date, to: app.now.date } })}>
                    <option value="">cały rok</option>
                    <option value="yearly">sezon powtarzany co rok</option>
                    <option value="dates">konkretne daty</option>
                  </select>
                </label>
                {draft.period?.kind === 'yearly' ? (
                  <>
                    <label className="ra-field">Od (miesiąc-dzień)<input value={draft.period.from} placeholder="05-01" onChange={(e) => set({ period: { ...draft.period, from: e.target.value } })} /></label>
                    <label className="ra-field">Do (miesiąc-dzień)<input value={draft.period.to} placeholder="09-30" onChange={(e) => set({ period: { ...draft.period, to: e.target.value } })} /></label>
                  </>
                ) : null}
                {draft.period?.kind === 'dates' ? (
                  <>
                    <label className="ra-field">Od<input type="date" value={draft.period.from} onChange={(e) => set({ period: { ...draft.period, from: e.target.value } })} /></label>
                    <label className="ra-field">Do<input type="date" value={draft.period.to} onChange={(e) => set({ period: { ...draft.period, to: e.target.value } })} /></label>
                  </>
                ) : null}
              </div>
            ),
          },
          { key: 'priority', label: 'Priorytet', type: 'number', hint: 'przy dwóch regułach tego samego rodzaju wygrywa wyższy' },
        ]}
        columns={[
          { label: 'Dni', cell: (r) => (r.weekdays.length === 7 ? 'codziennie' : r.weekdays.map((d: number) => WEEKDAYS_SHORT[d - 1]).join(', ')) },
          { label: 'Godziny', cell: (r) => (r.closed ? 'nieczynne' : `${formatTime(r.open)}–${formatTime(r.close)}`) },
          { label: 'Okres', cell: (r) => periodText(r) },
        ]}
        create={() => ({ period: null, weekdays: [1, 2, 3, 4, 5, 6, 7], closed: false, open: 540, close: 1080, priority: 0 })}
        describe={(r) => `godziny ${r.closed ? 'nieczynne' : `${formatTime(r.open)}–${formatTime(r.close)}`} (${periodText(r)})`}
        hint="Reguła dla konkretnych dat wygrywa z sezonem, a sezon z regułą całoroczną. Pojedynczy dzień zamknięty ustawiasz w Cenniku jako wyjątek daty."
      />
      <Crud
        collection="statuses"
        title="Statusy zgłoszeń"
        addLabel="Dodaj status"
        fields={[
          { key: 'name', label: 'Nazwa', type: 'text' },
          { key: 'order', label: 'Kolejność', type: 'number' },
          { key: 'blocksStock', label: 'Blokuje sprzęt', type: 'bool', hint: 'zgłoszenie w tym statusie zajmuje sztuki w swoim terminie' },
          { key: 'isInitial', label: 'Status początkowy nowych zgłoszeń', type: 'bool' },
          { key: 'tone', label: 'Wygląd plakietki', type: 'select', options: [{ value: 'new', label: 'nowe' }, { value: 'progress', label: 'w toku' }, { value: 'ok', label: 'potwierdzone' }, { value: 'out', label: 'wydane' }, { value: 'done', label: 'zakończone' }, { value: 'off', label: 'nieaktualne' }] },
        ]}
        columns={[
          { label: 'Nazwa', cell: (s) => <strong>{s.name}</strong> },
          { label: 'Blokuje sprzęt', cell: (s) => yesNo(s.blocksStock) },
          { label: 'Początkowy', cell: (s) => yesNo(s.isInitial) },
        ]}
        create={() => ({ name: '', order: catalog.statuses.length, blocksStock: true, isInitial: false, tone: 'progress' })}
        describe={(s) => `status ${s.name}`}
      />
      <Crud
        collection="channels"
        title="Kanały pozyskania"
        addLabel="Dodaj kanał"
        fields={[{ key: 'name', label: 'Nazwa', type: 'text' }, { key: 'order', label: 'Kolejność', type: 'number' }]}
        columns={[{ label: 'Nazwa', cell: (c) => c.name }]}
        create={() => ({ name: '', order: catalog.channels.length })}
        describe={(c) => `kanał ${c.name}`}
      />
      <Crud
        collection="serviceCategories"
        title="Kategorie usług i rodzaje zgłoszeń"
        addLabel="Dodaj kategorię"
        fields={[
          { key: 'name', label: 'Nazwa kategorii', type: 'text' },
          { key: 'requestType', label: 'Rodzaj zgłoszenia', type: 'text', hint: 'tworzy się automatycznie, gdy zgłoszenie zawiera usługę z tej kategorii' },
          { key: 'noneLabel', label: 'Etykieta „bez tej usługi” w koszyku', type: 'text' },
          { key: 'order', label: 'Kolejność', type: 'number' },
        ]}
        columns={[{ label: 'Kategoria', cell: (c) => <strong>{c.name}</strong> }, { label: 'Rodzaj zgłoszenia', cell: (c) => c.requestType }]}
        create={() => ({ name: '', requestType: '', noneLabel: 'Nie, dziękuję', order: catalog.serviceCategories.length })}
        describe={(c) => `kategoria ${c.name}`}
        removable={(c) => !catalog.services.some((s) => s.categoryId === c.id)}
      />
      <Crud
        collection="services"
        title="Usługi dodatkowe"
        addLabel="Dodaj usługę"
        fields={[
          { key: 'name', label: 'Nazwa', type: 'text' },
          { key: 'categoryId', label: 'Kategoria', type: 'select', options: categories },
          { key: 'billing', label: 'Naliczanie', type: 'select', options: billing },
          { key: 'price', label: 'Cena (zł)', type: 'money', nullable: true, show: (d) => d.billing !== 'quote' },
          { key: 'stock', label: 'Stan sztuk', type: 'number', nullable: true, hint: 'puste = bez limitu' },
          { key: 'limitedByVehicle', label: 'Cena pewna tylko do limitu auta', type: 'bool', hint: 'limit ustawiasz w Regułach' },
          { key: 'needsAddress', label: 'Wymaga adresu od klienta', type: 'bool' },
          { key: 'order', label: 'Kolejność', type: 'number' },
          { key: 'active', label: 'Dostępna w koszyku', type: 'bool' },
        ]}
        columns={[
          { label: 'Usługa', cell: (s) => <strong>{s.name}</strong> },
          { label: 'Kategoria', cell: (s) => catalog.serviceCategories.find((c) => c.id === s.categoryId)?.name },
          { label: 'Cena', cell: (s) => (s.billing === 'quote' || s.price === null ? 'do ustalenia' : `${moneyShort(s.price)} · ${billingName(s.billing)}`) },
          { label: 'W koszyku', cell: (s) => yesNo(s.active) },
        ]}
        create={() => ({ name: '', categoryId: categories[0]?.value ?? '', billing: 'perUnitPerDay', price: 0, limitedByVehicle: false, stock: null, needsAddress: false, active: true, order: catalog.services.length })}
        describe={(s) => `usługa ${s.name}`}
        prepare={(s) => (s.billing === 'quote' ? { ...s, price: null } : s)}
      />
      <Crud
        collection="users"
        title="Użytkownicy i role"
        addLabel="Dodaj użytkownika"
        sort={(a, b) => a.name.localeCompare(b.name)}
        fields={[
          { key: 'name', label: 'Imię', type: 'text' },
          { key: 'email', label: 'E-mail', type: 'text' },
          { key: 'role', label: 'Rola', type: 'select', options: [{ value: 'team', label: 'zespół' }, { value: 'driver', label: 'kierowca' }, { value: 'admin', label: 'administrator' }] },
          { key: 'active', label: 'Konto aktywne', type: 'bool' },
        ]}
        columns={[
          { label: 'Imię', cell: (u) => <strong>{u.name}</strong> },
          { label: 'E-mail', cell: (u) => u.email },
          { label: 'Rola', cell: (u) => ({ team: 'zespół', driver: 'kierowca', admin: 'administrator' })[u.role as 'team' | 'driver' | 'admin'] },
        ]}
        create={() => ({ name: '', email: '', role: 'team', active: true })}
        describe={(u) => `użytkownik ${u.name}`}
        hint={<><Sketch>logowanie</Sketch> W pokazie role przełącza się w pasku u góry. Konta, hasła i logowanie powstaną przy wdrożeniu.</>}
      />
    </div>
  );
}

function requestTypes(catalog: Catalog, reservation: Reservation): string {
  const types = new Set<string>();
  if (reservation.items.some((i) => i.kind === 'rental')) types.add('Wypożyczenie');
  for (const item of reservation.items) {
    if (item.kind !== 'service') continue;
    const category = catalog.serviceCategories.find((c) => c.id === catalog.services.find((s) => s.id === item.refId)?.categoryId);
    if (category) types.add(category.requestType);
  }
  return [...types].join(', ');
}

const TONE_CLASS: Record<string, string> = { new: 'ra-badge ra-badge-accent', progress: 'ra-badge ra-badge-blue', ok: 'ra-badge ra-badge-ok', out: 'ra-badge ra-badge-blue', done: 'ra-badge', off: 'ra-badge ra-badge-off' };

export function RequestsPage() {
  const app = useApp();
  const { catalog } = app;
  const [error, setError] = useState('');
  const [lost, setLost] = useState({ from: app.now.date, to: app.now.date, variantId: catalog.variants[0]?.id ?? '', requested: 1, note: '' });
  const list = [...app.reservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const change = async (reservation: Reservation, statusId: Id): Promise<void> => {
    const result = await app.repo.changeReservationStatus(reservation.id, statusId, { actor: app.actor, expectedVersion: reservation.version });
    if (!result.ok) {
      setError(
        result.error.code === 'unavailable'
          ? `${reservation.number}: nie można przywrócić, sprzęt w tym terminie jest już zajęty.`
          : result.error.code === 'versionConflict'
            ? `${reservation.number}: zgłoszenie zmienił ktoś inny. Dane zostały odświeżone.`
            : `${reservation.number}: nie udało się zmienić statusu.`,
      );
    } else setError('');
    await app.reload();
  };

  return (
    <div className="ra-wrap ra-panel">
      <div className="ra-stack" style={{ gap: 4 }}>
        <h1>Zgłoszenia</h1>
        <p className="ra-muted ra-small">Prosty podgląd na potrzeby Fazy 1: zmiana statusu od razu zwalnia albo blokuje sprzęt w sklepie. Kalendarz, filtry, szczegóły i ręczne dodawanie zgłoszeń powstaną w Fazie 2.</p>
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div className="ra-tablebox">
        <table className="ra-table ra-cards" data-testid="requests">
          <thead><tr><th>Numer</th><th>Zgłoszono</th><th>Termin</th><th>Rodzaj</th><th>Pozycje</th><th>Kwota</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((r) => {
              const status = catalog.statuses.find((s) => s.id === r.statusId);
              return (
                <tr key={r.id} data-number={r.number}>
                  <td data-label="Numer"><div><strong>{r.number}</strong><div className="ra-small ra-muted">{r.customer.name}</div></div></td>
                  <td data-label="Zgłoszono">{stamp(r.createdAt, catalog.tenant.timeZone)}</td>
                  <td data-label="Termin">{formatTerm(r)}</td>
                  <td data-label="Rodzaj">{requestTypes(catalog, r)}</td>
                  <td data-label="Pozycje" className="ra-small" style={{ minWidth: 210 }}><div>{r.items.filter((i) => i.kind === 'rental').map((i) => <div key={i.refId}>{variantName(catalog, i.refId)} × {i.quantity}</div>)}</div></td>
                  <td data-label="Kwota">
                    <div>
                      {money(amountDue(r.total, r.manualAmount))}
                      {r.priceStatus === 'toBeAgreed' ? <div className="ra-small" title={r.toBeAgreed.map((t) => { const [c, ref] = t.split(':'); return toBeAgreedText(catalog, c ?? '', ref ?? null); }).join('; ')}><span className="ra-badge ra-badge-accent">do ustalenia</span></div> : null}
                    </div>
                  </td>
                  <td data-label="Status">
                    <div>
                    <span className={TONE_CLASS[status?.tone ?? 'new']}><Icon name={status?.blocksStock ? 'lock' : 'check'} size={14} />{status?.blocksStock ? 'blokuje sprzęt' : 'nie blokuje'}</span>
                    <select className="ra-input" style={{ marginTop: 4, minWidth: 210, display: 'block' }} aria-label={`Status zgłoszenia ${r.number}`} value={r.statusId} onChange={(e) => void change(r, e.target.value)}>
                      {catalog.statuses.slice().sort((a, b) => a.order - b.order).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="ra-stack">
        <h2>Nieudane rezerwacje</h2>
        <p className="ra-muted ra-small">Wpisy są anonimowe. System dodaje je sam, gdy klient dostaje odmowę z braku sprzętu; zespół może dopisać wpis ręcznie (np. po telefonie). Trafią do analizy rentowności modeli w Fazie 2.</p>
        <form
          className="ra-card ra-form"
          onSubmit={(event) => {
            event.preventDefault();
            void app.repo
              .recordLostDemand({ source: 'manual', reason: 'unavailable', order: { mode: 'days', startDate: lost.from, endDate: lost.to < lost.from ? lost.from : lost.to }, variantId: lost.variantId, requested: lost.requested, free: 0, note: lost.note }, app.actor)
              .then(() => app.reload())
              .then(() => app.toast('Dodano wpis.'));
          }}
        >
          <label className="ra-field">Od<input type="date" value={lost.from} onChange={(e) => setLost({ ...lost, from: e.target.value })} /></label>
          <label className="ra-field">Do<input type="date" value={lost.to} onChange={(e) => setLost({ ...lost, to: e.target.value })} /></label>
          <label className="ra-field">Rower i rozmiar
            <select value={lost.variantId} onChange={(e) => setLost({ ...lost, variantId: e.target.value })}>
              {catalog.variants.map((v) => <option key={v.id} value={v.id}>{variantName(catalog, v.id)}</option>)}
            </select>
          </label>
          <label className="ra-field">Ile sztuk zabrakło<input type="number" min={1} value={lost.requested} onChange={(e) => setLost({ ...lost, requested: Math.max(1, Number(e.target.value)) })} /></label>
          <label className="ra-field">Notatka<input value={lost.note} onChange={(e) => setLost({ ...lost, note: e.target.value })} /></label>
          <button type="submit" className="ra-btn" style={{ alignSelf: 'end' }}>Dodaj wpis ręcznie</button>
        </form>
        <div className="ra-tablebox">
          <table className="ra-table ra-cards" data-testid="lost">
            <thead><tr><th>Kiedy</th><th>Źródło</th><th>Termin</th><th>Rower</th><th>Chciano</th><th>Wolne</th><th>Szacowana wartość</th><th>Notatka</th></tr></thead>
            <tbody>
              {[...app.lost].reverse().map((l) => (
                <tr key={l.id}>
                  <td data-label="Kiedy">{stamp(l.at, catalog.tenant.timeZone)}</td>
                  <td data-label="Źródło">{l.source === 'shop' ? 'sklep' : 'ręcznie'}{l.reason === 'closed' ? ' · dzień zamknięty' : ''}</td>
                  <td data-label="Termin">{formatTerm({ mode: l.mode, startDate: l.startDate, endDate: l.endDate, startMinute: l.startMinute, endMinute: l.endMinute })}</td>
                  <td data-label="Rower">{l.variantId ? variantName(catalog, l.variantId) : '—'}</td>
                  <td data-label="Chciano">{l.requested}</td>
                  <td data-label="Wolne">{l.free}</td>
                  <td data-label="Szacowana wartość">{l.estimatedValue === null ? '—' : money(l.estimatedValue)}</td>
                  <td data-label="Notatka">{l.note}</td>
                </tr>
              ))}
              {app.lost.length === 0 ? <tr><td colSpan={8} className="ra-muted">Brak wpisów.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
