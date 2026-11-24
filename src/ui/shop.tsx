import { useMemo, useState } from 'react';
import { formatDay, formatTerm, methodLabel, moneyDelta, moneyShort, variantName } from '../app/labels.ts';
import { freeUnits, nextAvailableDate, orderWindow } from '../core/availability.ts';
import { resolveDay } from '../core/calendar.ts';
import { dayPrice, quote } from '../core/pricing.ts';
import { absMinute, addDays } from '../core/time.ts';
import type { Id, ISODate, OrderInput, Product } from '../core/types.ts';
import type { CalendarContext } from './calendar.tsx';
import { TermPicker } from './calendar.tsx';
import { cartOrder, useApp } from './store.tsx';
import { Dialog, Icon, Notice, Stepper } from './widgets.tsx';

/** First date a day rental can start in the shop: today until the configured hour, otherwise tomorrow. */
export function firstBookableDate(app: ReturnType<typeof useApp>): ISODate {
  const until = app.catalog.settings.booking.sameDayDaysUntil;
  return until !== null && app.now.minute <= until ? app.now.date : addDays(app.now.date, 1);
}

function ProductCard(props: { product: Product; onTerm: (productId: Id) => void; onDetails: (productId: Id) => void }) {
  const app = useApp();
  const { catalog, cart, ctx } = app;
  const { product } = props;
  const variants = useMemo(
    () => catalog.variants.filter((v) => v.productId === product.id && v.active).sort((a, b) => a.order - b.order),
    [catalog, product.id],
  );
  const [selected, setSelected] = useState<Id | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const show = (field: string): boolean => product.tileFields.includes(field);

  const order = cart.termChosen ? cartOrder(cart) : null;
  const window = order ? orderWindow(catalog, order) : null;
  const nearest = useMemo(
    () => (variants.length > 0 ? nextAvailableDate(ctx, variants.map((v) => v.id), firstBookableDate(app)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, variants, app.now.date],
  );

  const freeOf = (variantId: Id): number => {
    const inCart = cart.items.find((i) => i.variantId === variantId)?.quantity ?? 0;
    if (window) return Math.max(0, freeUnits(ctx, variantId, window.start, window.end) - inCart);
    if (!nearest) return 0;
    const hours = resolveDay(catalog, nearest.date).hours;
    if (!hours) return 0;
    return Math.max(0, freeUnits(ctx, variantId, absMinute(nearest.date, hours.open), absMinute(nearest.date, hours.close)) - inCart);
  };

  const first = variants[0];
  let price: number | null = null;
  let difference: number | null = null;
  let caption = 'Brak wolnych terminów w kalendarzu';
  if (first && order && window) {
    const line = quote(catalog, { ...order, items: [{ variantId: first.id, quantity: 1 }], services: [] }).lines[0];
    price = line?.unitPrice ?? null;
    difference = line?.dateDifference ?? null;
    caption = `${line ? methodLabel(line.method) : ''} · ${formatTerm(order)}`;
  } else if (first && nearest) {
    const day = dayPrice(catalog, nearest.date, first.id);
    price = day.price;
    difference = day.delta;
    caption = `za dzień · najbliższy wolny termin: ${formatDay(nearest.date)}`;
  }

  const selectedFree = selected ? freeOf(selected) : 0;
  const inCart = cart.items.filter((i) => variants.some((v) => v.id === i.variantId));

  const add = (): void => {
    if (!selected || selectedFree < 1) return;
    const amount = Math.min(quantity, selectedFree);
    app.setCart((c) => {
      const term = c.termChosen || !nearest ? {} : { termChosen: true, mode: 'days' as const, startDate: nearest.date, endDate: nearest.date };
      const existing = c.items.find((i) => i.variantId === selected);
      const items = existing
        ? c.items.map((i) => (i.variantId === selected ? { ...i, quantity: i.quantity + amount } : i))
        : [...c.items, { variantId: selected, quantity: amount }];
      return { ...c, ...term, items };
    });
    app.toast(
      `Dodano do koszyka: ${variantName(catalog, selected)} × ${amount}.` +
        (!cart.termChosen && nearest ? ` Termin: ${formatDay(nearest.date)}, zmienisz go w koszyku.` : ''),
    );
    setQuantity(1);
    setMessage('');
  };

  const overflow = (): void => {
    if (!selected) return;
    setMessage(`W tym terminie wolne: ${selectedFree}.`);
    const term: OrderInput | null = order ?? (nearest ? { mode: 'days', startDate: nearest.date, endDate: nearest.date, items: [], services: [] } : null);
    if (term) {
      void app.repo
        .recordLostDemand(
          { source: 'shop', reason: 'unavailable', order: term, variantId: selected, requested: quantity + 1, free: selectedFree, sessionKey: app.sessionKey },
          app.actor,
        )
        .then(() => app.reload());
    }
  };

  return (
    <article className="ra-product" data-product={product.id}>
      {show('image') ? (
        <div className="ra-photo">{product.image ? <img src={app.assets + product.image} alt={product.name} loading="lazy" /> : <span className="ra-muted ra-small">Brak zdjęcia</span>}</div>
      ) : null}
      <div className="ra-product-head">
        {show('name') ? <h3>{product.name}</h3> : null}
        {show('type') && product.typeLabel ? <span className="ra-type ra-badge">{product.typeLabel}</span> : null}
        {show('audience') && product.audience ? <p className="ra-small ra-muted">{product.audience}</p> : null}
      </div>
      {show('price') ? (
        <div>
          <div className="ra-row">
            <span className="ra-price">{price === null ? 'Cena do ustalenia' : moneyShort(price)}</span>
            {difference ? <span className="ra-badge ra-badge-accent">{moneyDelta(difference)}</span> : null}
          </div>
          <span className="ra-small ra-muted">{caption}</span>
        </div>
      ) : null}
      {show('sizes') ? (
        <div className="ra-stack" style={{ gap: 8 }}>
          <span className="ra-small" style={{ fontWeight: 500 }}>Rozmiar</span>
          <div className="ra-sizes">
            {variants.map((variant) => {
              const free = freeOf(variant.id);
              return (
                <button
                  key={variant.id}
                  type="button"
                  className="ra-size"
                  aria-pressed={selected === variant.id}
                  disabled={free < 1}
                  onClick={() => {
                    setSelected(variant.id);
                    setQuantity(1);
                    setMessage('');
                  }}
                >
                  <strong>{variant.label}</strong>
                  <span>{free < 1 ? 'brak' : `wolne ${free}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="ra-row ra-between" style={{ marginTop: 'auto' }}>
        <Stepper label="Liczba sztuk" value={quantity} min={1} max={Math.max(1, selectedFree)} onChange={setQuantity} onOverflow={overflow} />
        <button type="button" className="ra-btn ra-btn-primary" disabled={!selected || selectedFree < 1} onClick={add}>
          {selected ? 'Dodaj do koszyka' : 'Wybierz rozmiar'}
        </button>
      </div>
      {message ? <p className="ra-small" role="status" style={{ color: 'var(--danger)' }}>{message}</p> : null}
      {inCart.length > 0 ? (
        <p className="ra-small" style={{ color: 'var(--brand-dark)' }}>
          W koszyku: {inCart.map((i) => `${catalog.variants.find((v) => v.id === i.variantId)?.label} × ${i.quantity}`).join(', ')}
        </p>
      ) : null}
      <div className="ra-row">
        <button type="button" className="ra-btn-link ra-btn" onClick={() => props.onDetails(product.id)}>Szczegóły</button>
        <button type="button" className="ra-btn-link ra-btn" onClick={() => props.onTerm(product.id)}>{cart.termChosen ? 'Zmień termin' : 'Sprawdź terminy'}</button>
      </div>
    </article>
  );
}

function ProductDetails(props: { productId: Id; onClose: () => void }) {
  const app = useApp();
  const { catalog } = app;
  const product = catalog.products.find((p) => p.id === props.productId);
  const variant = catalog.variants.find((v) => v.productId === props.productId && v.active);
  if (!product) return null;
  const date = app.cart.termChosen && app.cart.startDate ? app.cart.startDate : firstBookableDate(app);
  const hours = resolveDay(catalog, date).hours;
  const rows = variant
    ? [...catalog.bands]
        .sort((a, b) => a.order - b.order)
        .map((band) => {
          let order: OrderInput | null = null;
          if (band.kind === 'hours' && hours) {
            order = { mode: 'hours', startDate: date, endDate: date, startMinute: hours.open, endMinute: Math.min(hours.close, hours.open + (band.maxHours ?? 1) * 60), items: [{ variantId: variant.id, quantity: 1 }], services: [] };
          } else if (band.kind !== 'hours') {
            order = { mode: 'days', startDate: date, endDate: addDays(date, (band.kind === 'days' ? (band.days ?? 1) : 1) - 1), items: [{ variantId: variant.id, quantity: 1 }], services: [] };
          }
          const unit = order ? quote(catalog, order).lines[0]?.unitPrice ?? null : null;
          return { label: band.label, unit };
        })
    : [];
  return (
    <Dialog open onClose={props.onClose} title={product.name}>
      {product.image ? <div className="ra-photo" style={{ maxWidth: 360 }}><img src={app.assets + product.image} alt={product.name} /></div> : null}
      {product.typeLabel ? <span className="ra-badge" style={{ alignSelf: 'flex-start' }}>{product.typeLabel}</span> : null}
      {product.audience ? <p>{product.audience}</p> : null}
      {product.use ? <p>{product.use}</p> : null}
      {product.specification ? <p className="ra-small ra-muted">{product.specification}</p> : null}
      {product.route ? (
        <p>
          Proponowana trasa: <a href={product.route.url} target="_blank" rel="noreferrer">{product.route.name}</a>
        </p>
      ) : null}
      <div className="ra-tablebox">
        <table className="ra-table">
          <thead>
            <tr><th>Najem od {formatDay(date)}</th><th>Cena za rower</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}><td>{row.label}</td><td>{row.unit === null ? 'do ustalenia' : moneyShort(row.unit)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

export function Home() {
  const app = useApp();
  const { catalog, cart } = app;
  const [termFor, setTermFor] = useState<Id | 'all' | null>(null);
  const [details, setDetails] = useState<Id | null>(null);
  const content = (kind: string) => catalog.content.filter((c) => c.kind === kind && c.active).sort((a, b) => a.order - b.order);
  const hero = content('hero')[0];
  const products = catalog.products.filter((p) => p.active).sort((a, b) => a.order - b.order);
  const order = cart.termChosen ? cartOrder(cart) : null;

  const context: CalendarContext =
    cart.items.length > 0
      ? { kind: 'cart', items: cart.items }
      : termFor && termFor !== 'all'
        ? { kind: 'product', variantIds: catalog.variants.filter((v) => v.productId === termFor && v.active).map((v) => v.id) }
        : { kind: 'none' };

  return (
    <>
      {hero ? (
        <section className="ra-hero">
          {hero.image ? <img src={app.assets + hero.image} alt="" /> : null}
          <div className="ra-wrap">
            <h1>{hero.title}</h1>
            <p>{hero.body}</p>
            <div className="ra-hero-actions">
              <button type="button" className="ra-btn ra-btn-primary ra-btn-big" onClick={() => setTermFor('all')}>
                {order ? 'Zmień termin' : 'Wybierz termin'}
                <Icon name="arrow" />
              </button>
              <button type="button" className="ra-btn ra-btn-light ra-btn-big" onClick={() => document.getElementById('ra-rowery')?.scrollIntoView({ block: 'start' })}>
                Zobacz rowery
              </button>
            </div>
            <span className="ra-hero-term">{order ? `Twój termin: ${formatTerm(order)}` : 'Ceny i wolne sztuki od razu po wyborze terminu'}</span>
          </div>
        </section>
      ) : null}
      {app.role === 'driver' ? (
        <div className="ra-wrap" style={{ paddingTop: 24 }}>
          <Notice kind="note">Panel kierowcy z listą dowozów powstanie w Fazie 2. Na razie kierowca widzi tylko ofertę.</Notice>
        </div>
      ) : null}

      <section className="ra-section" id="ra-rowery" style={{ scrollMarginTop: 'var(--header-h)' }}>
        <div className="ra-wrap ra-stack" style={{ gap: 28 }}>
          <div className="ra-sectionhead">
            <span className="ra-eyebrow">Oferta</span>
            <h2>Wybierz rower i rozmiar</h2>
            <p>
              {order ? `Ceny i wolne sztuki dla terminu: ${formatTerm(order)}.` : 'Bez wybranego terminu pokazujemy cenę i wolne sztuki dla najbliższego wolnego dnia.'}{' '}
              {hero ? null : (
                <button type="button" className="ra-btn ra-btn-link" onClick={() => setTermFor('all')}>{order ? 'Zmień termin' : 'Wybierz termin'}</button>
              )}
            </p>
          </div>
          {products.length === 0 ? <Notice kind="note">Oferta jest pusta. Dodaj produkty w panelu administratora.</Notice> : null}
          <div className="ra-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} onTerm={setTermFor} onDetails={setDetails} />
            ))}
          </div>
        </div>
      </section>

      {content('benefit').length > 0 ? (
        <section id="ra-korzysci" style={{ scrollMarginTop: 'var(--header-h)' }}>
          <div className="ra-wrap">
            <div className="ra-benefits">
              {content('benefit').map((item) => (
                <div key={item.id} className="ra-stack" style={{ gap: 8 }}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {content('faq').length > 0 ? (
        <section className="ra-section" id="ra-pytania" style={{ scrollMarginTop: 'var(--header-h)' }}>
          <div className="ra-wrap ra-stack" style={{ gap: 20 }}>
            <div className="ra-sectionhead">
              <span className="ra-eyebrow">Zanim wyjedziesz</span>
              <h2>Najczęściej zadawane pytania</h2>
            </div>
            <div className="ra-faq">
              {content('faq').map((item) => (
                <details key={item.id}>
                  <summary>{item.title}</summary>
                  <p>{item.body}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="ra-footer">
        <div className="ra-wrap">
          <div className="ra-stack" style={{ gap: 6 }}>
            <strong>{catalog.tenant.name}</strong>
            <span>{catalog.tenant.address}</span>
          </div>
          <a href="#o-pokazie">O pokazie: co działa, a co jest szkicem</a>
        </div>
        <div className="ra-footer-bar">Wersja pokazowa na przykładowych danych</div>
      </footer>

      <Dialog open={termFor !== null} onClose={() => setTermFor(null)} title="Wybierz termin">
        <TermPicker context={context} />
        <div className="ra-row ra-between">
          <span className="ra-small ra-muted">{order ? formatTerm(order) : 'Wskaż dzień w kalendarzu.'}</span>
          <button type="button" className="ra-btn ra-btn-primary" onClick={() => setTermFor(null)}>
            <Icon name="check" />Gotowe
          </button>
        </div>
      </Dialog>
      {details ? <ProductDetails productId={details} onClose={() => setDetails(null)} /> : null}
    </>
  );
}
