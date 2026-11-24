import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { daysWord, formatTerm, methodLabel, money, moneyDelta, moneyShort, problemText, serviceName, statusName, toBeAgreedText, variantName } from '../app/labels.ts';
import { confirmationMail } from '../app/mail.ts';
import { checkOrder, freeUnits } from '../core/availability.ts';
import type { Problem } from '../core/availability.ts';
import { amountDue, quote } from '../core/pricing.ts';
import type { Id, Service } from '../core/types.ts';
import { TermPicker } from './calendar.tsx';
import { cartOrder, emptyCart, useApp } from './store.tsx';
import { Icon, Notice, Sketch, Stepper } from './widgets.tsx';

const newKey = (): string => 'k-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function billingLabel(service: Service): string {
  if (service.billing === 'quote' || service.price === null) return 'do ustalenia';
  if (service.billing === 'perUnitPerDay') return `${moneyShort(service.price)} za sztukę za dzień`;
  if (service.billing === 'perUnit') return `${moneyShort(service.price)} za sztukę`;
  return moneyShort(service.price);
}

export function CartPage() {
  const app = useApp();
  const { catalog, cart, ctx } = app;
  const [customer, setCustomer] = useState({ name: 'Anna Przykładowa', phone: '500 100 200', email: 'anna@example.com' });
  const [address, setAddress] = useState('');
  const [consent, setConsent] = useState(false);
  const [refused, setRefused] = useState<Problem[]>([]);
  const [key, setKey] = useState(newKey);
  const [sending, setSending] = useState(false);

  const order = cartOrder(cart);
  const hasItems = cart.items.length + cart.services.length > 0;
  const check = useMemo(() => (order ? checkOrder(ctx, order, app.now) : null), [ctx, order, app.now]);
  const quoted = useMemo(() => {
    if (!order || !hasItems) return null;
    try {
      return quote(catalog, order);
    } catch {
      return null;
    }
  }, [catalog, order, hasItems]);
  const problems = (check?.problems ?? []).filter((p) => p.code !== 'empty');
  const shortageOf = (variantId: Id) => problems.find((p) => p.code === 'shortage' && p.variantId === variantId);
  const window = check?.window ?? null;

  // A refusal in the cart is lost demand: one anonymous entry per term and size in this visit.
  const shortageKey = problems.filter((p) => p.code === 'shortage').map((p) => JSON.stringify(p)).join('|') + (window ? `${window.start}-${window.end}` : '');
  useEffect(() => {
    if (!order || !shortageKey) return;
    let changed = false;
    void (async () => {
      for (const p of problems) {
        if (p.code !== 'shortage') continue;
        const saved = await app.repo.recordLostDemand(
          { source: 'shop', reason: 'unavailable', order, variantId: p.variantId, requested: p.requested, free: p.free, sessionKey: app.sessionKey },
          app.actor,
        );
        if (saved) changed = true;
      }
      if (changed) await app.reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortageKey]);

  const setQuantity = (variantId: Id, quantity: number): void =>
    app.setCart((c) => ({
      ...c,
      items: quantity < 1 ? c.items.filter((i) => i.variantId !== variantId) : c.items.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)),
    }));
  const setService = (serviceId: Id, quantity: number): void =>
    app.setCart((c) => {
      const rest = c.services.filter((s) => s.serviceId !== serviceId);
      return { ...c, services: quantity > 0 ? [...rest, { serviceId, quantity }] : rest };
    });
  const chooseOne = (categoryId: Id, serviceId: Id | null): void =>
    app.setCart((c) => {
      const inCategory = new Set(catalog.services.filter((s) => s.categoryId === categoryId && s.billing !== 'perUnitPerDay' && s.billing !== 'perUnit').map((s) => s.id));
      const rest = c.services.filter((s) => !inCategory.has(s.serviceId));
      return { ...c, services: serviceId ? [...rest, { serviceId, quantity: 1 }] : rest };
    });

  const categories = [...catalog.serviceCategories].sort((a, b) => a.order - b.order);
  const servicesOf = (categoryId: Id) => catalog.services.filter((s) => s.categoryId === categoryId && s.active).sort((a, b) => a.order - b.order);
  const needsAddress = cart.services.some((s) => catalog.services.find((x) => x.id === s.serviceId)?.needsAddress);
  const canSend = Boolean(order && hasItems && check?.ok && consent && customer.name.trim() && customer.email.trim() && (!needsAddress || address.trim()));

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!order || !canSend || sending) return;
    setSending(true);
    const result = await app.repo.createReservation(
      {
        order,
        customer: { ...customer, consentAt: new Date().toISOString() },
        source: 'shop',
        channelId: catalog.channels[0]?.id ?? null,
        notes: needsAddress ? `Adres dowozu i odbioru: ${address.trim()}` : '',
      },
      { actor: app.actor, idempotencyKey: key, sessionKey: app.sessionKey },
    );
    setSending(false);
    await app.reload();
    if (!result.ok) {
      setRefused(result.problems);
      return;
    }
    app.setLastReservation(result.reservation);
    app.setCart(() => emptyCart());
    setKey(newKey());
    app.go('potwierdzenie');
  };

  if (cart.items.length === 0 && cart.services.length === 0) {
    return (
      <div className="ra-wrap ra-panel">
        <h1>Koszyk</h1>
        <Notice kind="note">Koszyk jest pusty. Wybierz rower i rozmiar na stronie głównej.</Notice>
        <a className="ra-btn ra-btn-primary" href="#start" style={{ alignSelf: 'flex-start' }}>Przejdź do rowerów</a>
      </div>
    );
  }

  const payOnline = Boolean(quoted?.onlinePaymentAllowed);
  const sendLabel = payOnline ? 'Zarezerwuj i zapłać' : 'Wyślij rezerwację';
  const saving = quoted ? quoted.lines.reduce((sum, l) => sum + l.packageSaving, 0) : 0;

  return (
    <form className="ra-wrap ra-panel" onSubmit={submit} noValidate>
      <div className="ra-row ra-between">
        <h1>Twoja rezerwacja</h1>
        <a href="#start">Dodaj kolejny rower lub rozmiar</a>
      </div>
      <div className="ra-cart">
        <div className="ra-stack" style={{ gap: 32 }}>
          <fieldset className="ra-fieldset">
            <legend>1. Termin</legend>
            <TermPicker context={cart.items.length > 0 ? { kind: 'cart', items: cart.items } : { kind: 'none' }} />
          </fieldset>

          <fieldset className="ra-fieldset">
            <legend>2. Rowery</legend>
            <div>
              {cart.items.map((item) => {
                const free = window ? Math.max(0, freeUnits(ctx, item.variantId, window.start, window.end)) : null;
                const short = shortageOf(item.variantId);
                return (
                  <div key={item.variantId} className="ra-line" data-variant={item.variantId}>
                    <div className="ra-grow">
                      <strong>{variantName(catalog, item.variantId)}</strong>
                      <div className="ra-small" style={{ color: short ? 'var(--danger)' : 'var(--muted)' }} role={short ? 'alert' : undefined}>
                        {short ? `W tym terminie wolne: ${free}. Zmniejsz liczbę albo zmień termin.` : free === null ? 'Wybierz termin, aby zobaczyć wolne sztuki.' : `wolne w tym terminie: ${free}`}
                      </div>
                    </div>
                    <Stepper label={`Liczba sztuk: ${variantName(catalog, item.variantId)}`} value={item.quantity} min={0} max={free ?? undefined} onChange={(q) => setQuantity(item.variantId, q)} />
                    <button type="button" className="ra-btn ra-btn-link" onClick={() => setQuantity(item.variantId, 0)}>Usuń</button>
                  </div>
                );
              })}
              {cart.items.length === 0 ? <p className="ra-muted">Brak rowerów w koszyku.</p> : null}
            </div>
          </fieldset>

          {categories.map((category, index) => {
            const list = servicesOf(category.id);
            if (list.length === 0) return null;
            const counted = list.filter((s) => s.billing === 'perUnitPerDay' || s.billing === 'perUnit');
            const choices = list.filter((s) => s.billing === 'fixed' || s.billing === 'quote');
            const chosen = choices.find((s) => cart.services.some((x) => x.serviceId === s.id))?.id ?? null;
            return (
              <fieldset key={category.id} className="ra-fieldset">
                <legend>{index + 3}. {category.name}</legend>
                {counted.map((service) => (
                  <div key={service.id} className="ra-line">
                    <div className="ra-grow">
                      <strong style={{ fontWeight: 500 }}>{service.name}</strong>
                      <div className="ra-small ra-muted">{billingLabel(service)}</div>
                    </div>
                    <Stepper label={service.name} value={cart.services.find((s) => s.serviceId === service.id)?.quantity ?? 0} min={0} max={service.stock ?? undefined} onChange={(q) => setService(service.id, q)} />
                  </div>
                ))}
                {choices.length > 1 ? (
                  <div role="radiogroup" aria-label={category.name}>
                    <label className="ra-check">
                      <input type="radio" name={`choice-${category.id}`} checked={chosen === null} onChange={() => chooseOne(category.id, null)} />
                      <span className="ra-grow">{category.noneLabel}</span>
                    </label>
                    {choices.map((service) => (
                      <label key={service.id} className="ra-check">
                        <input type="radio" name={`choice-${category.id}`} checked={chosen === service.id} onChange={() => chooseOne(category.id, service.id)} />
                        <span className="ra-grow">{service.name}</span>
                        <span className={service.billing === 'quote' ? 'ra-badge ra-badge-accent' : ''}>{billingLabel(service)}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                {choices.length === 1 ? (
                  <label className="ra-check">
                    <input type="checkbox" checked={chosen !== null} onChange={(event) => chooseOne(category.id, event.target.checked ? choices[0]!.id : null)} />
                    <span className="ra-grow">{choices[0]!.name}</span>
                    <span className={choices[0]!.billing === 'quote' ? 'ra-badge ra-badge-accent' : ''}>{billingLabel(choices[0]!)}</span>
                  </label>
                ) : null}
                {needsAddress && choices.some((s) => s.needsAddress && s.id === chosen) ? (
                  <label className="ra-field">
                    Adres dowozu i odbioru
                    <input value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" />
                  </label>
                ) : null}
              </fieldset>
            );
          })}

          <fieldset className="ra-fieldset">
            <legend>{categories.filter((c) => servicesOf(c.id).length > 0).length + 3}. Dane kontaktowe</legend>
            <div className="ra-two">
              <label className="ra-field">Imię i nazwisko<input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="name" /></label>
              <label className="ra-field">Telefon<input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} autoComplete="tel" /></label>
              <label className="ra-field">E-mail<input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} autoComplete="email" /></label>
            </div>
            <label className="ra-check">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>Zgadzam się na kontakt w sprawie tej rezerwacji i akceptuję regulamin wypożyczalni.</span>
            </label>
            <Notice kind="note">Wersja pokazowa: formularz jest wypełniony przykładem. Wpisane dane zostają w tej przeglądarce i znikają po odświeżeniu strony.</Notice>
          </fieldset>
        </div>

        <aside className="ra-summary" aria-label="Podsumowanie">
          <h2>Podsumowanie</h2>
          <p className="ra-small">{order ? formatTerm(order) : 'Termin nie jest jeszcze wybrany.'}</p>
          {quoted ? (
            <>
              {quoted.lines.map((line) => (
                <div key={line.variantId} className="ra-sumrow">
                  <span>
                    {variantName(catalog, line.variantId)} × {line.quantity}
                    <small>{methodLabel(line.method)}{line.method.code === 'none' ? '' : ' · cena standardowa'}</small>
                  </span>
                  <span>{line.standardTotal === null || line.lineTotal === null ? 'do ustalenia' : money(line.standardTotal)}</span>
                </div>
              ))}
              {quoted.dateDifference !== 0 ? (
                <div className="ra-sumrow">
                  <span>Różnica terminu<small>{quoted.dateDifference < 0 ? 'w tym terminie taniej' : 'w tym terminie drożej'}</small></span>
                  <span><span className="ra-badge ra-badge-accent">{moneyDelta(quoted.dateDifference)}</span></span>
                </div>
              ) : null}
              {quoted.serviceLines.map((line) => (
                <div key={line.serviceId} className="ra-sumrow">
                  <span>
                    {serviceName(catalog, line.serviceId)}{line.quantity > 1 ? ` × ${line.quantity}` : ''}
                    {line.lineTotal !== null && catalog.services.find((s) => s.id === line.serviceId)?.billing === 'perUnitPerDay' ? <small>{daysWord(quoted.days)}</small> : null}
                  </span>
                  <span>{line.lineTotal === null ? <span className="ra-badge ra-badge-accent">do ustalenia</span> : money(line.lineTotal)}</span>
                </div>
              ))}
              {quoted.discount ? (
                <div className="ra-sumrow">
                  <span>Rabat grupowy {quoted.discount.percent}%</span>
                  <span>{money(-quoted.discount.amount)}</span>
                </div>
              ) : null}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="ra-small">{quoted.priceStatus === 'final' ? 'Razem brutto' : 'Kwota wstępna brutto'}</div>
                <div className="ra-total" data-testid="total">{money(quoted.total)}</div>
                {saving > 0 ? <div className="ra-small" style={{ color: 'var(--brand-dark)' }}>Pakiet: {moneyShort(saving)} taniej niż pojedyncze dni.</div> : null}
              </div>
              {quoted.toBeAgreed.length > 0 ? (
                <Notice kind="warn">
                  <strong>Do ustalenia</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {quoted.toBeAgreed.map((t) => (
                      <li key={`${t.code}-${t.refId}`}>{toBeAgreedText(catalog, t.code, t.refId)}</li>
                    ))}
                  </ul>
                  Potwierdzimy cenę po otrzymaniu rezerwacji. Płatność online nie jest dostępna.
                </Notice>
              ) : (
                <p className="ra-small ra-muted">Cena jest ostateczna. Sprzęt blokujemy od chwili wysłania rezerwacji.</p>
              )}
            </>
          ) : null}
          {[...problems, ...refused.filter((r) => !problems.some((p) => JSON.stringify(p) === JSON.stringify(r)))].map((problem, i) => (
            <Notice key={i} kind="error">{problemText(catalog, problem)}</Notice>
          ))}
          <button type="submit" className="ra-btn ra-btn-primary" disabled={!canSend || sending} data-testid="send">
            {sendLabel}
          </button>
          {payOnline ? <span><Sketch>płatność BLIK i mail to szkice: nic nie zostanie pobrane ani wysłane</Sketch></span> : <span><Sketch>mail z potwierdzeniem zobaczysz jako podgląd</Sketch></span>}
          {!consent && hasItems ? <p className="ra-small ra-muted">Zaznacz zgodę, aby wysłać rezerwację.</p> : null}
        </aside>
      </div>

      <div className="ra-mobilebar">
        <div>
          <div className="ra-small ra-muted">{quoted?.priceStatus === 'toBeAgreed' ? 'Kwota wstępna' : 'Razem'}</div>
          <div className="ra-total">{quoted ? money(quoted.total) : '—'}</div>
        </div>
        <button type="submit" className="ra-btn ra-btn-primary" disabled={!canSend || sending}>{sendLabel}</button>
      </div>
    </form>
  );
}

export function ConfirmationPage() {
  const app = useApp();
  const { catalog } = app;
  const reservation = app.lastReservation;
  const [paid, setPaid] = useState(false);
  if (!reservation) {
    return (
      <div className="ra-wrap ra-panel">
        <h1>Potwierdzenie</h1>
        <Notice kind="note">Nie ma jeszcze rezerwacji z tej wizyty.</Notice>
        <a className="ra-btn ra-btn-primary" href="#start" style={{ alignSelf: 'flex-start' }}>Przejdź do rowerów</a>
      </div>
    );
  }
  const mail = confirmationMail(catalog, reservation);
  const canPay = reservation.priceStatus === 'final' && catalog.settings.payments.onlineEnabled;
  return (
    <div className="ra-wrap ra-panel" style={{ maxWidth: 820 }}>
      <div className="ra-stack" style={{ gap: 8 }}>
        <span className="ra-badge ra-badge-ok" style={{ alignSelf: 'flex-start' }}><Icon name="check" size={14} />Rezerwacja przyjęta</span>
        <h1 data-testid="number">{reservation.number}</h1>
        <p>{formatTerm(reservation)} · status: <strong>{statusName(catalog, reservation.statusId)}</strong></p>
        <p className="ra-muted">Sprzęt jest zablokowany na ten termin. {reservation.priceStatus === 'final' ? `Do zapłaty: ${money(amountDue(reservation.total, reservation.manualAmount))}.` : `Kwota wstępna: ${money(reservation.total)}; ostateczną potwierdzi zespół.`}</p>
      </div>

      {canPay ? (
        <div className="ra-sketchbox">
          <div className="ra-row"><Sketch /><strong>Płatność online BLIK</strong></div>
          <p className="ra-small" id="pay-sketch-note">Po wdrożeniu klient przejdzie na stronę operatora płatności. W pokazie pole kodu jest nieaktywne, przycisk niczego nie pobiera, a dane płatnicze nigdy nie trafiają do tego systemu.</p>
          <div className="ra-row">
            <label className="ra-field" style={{ width: 160 }}>
              Kod BLIK
              <input disabled placeholder="pole nieaktywne" aria-describedby="pay-sketch-note" />
            </label>
            <button type="button" className="ra-btn ra-btn-primary" style={{ alignSelf: 'flex-end' }} onClick={() => setPaid(true)}>
              Zapłać {money(reservation.total)}
            </button>
          </div>
          {paid ? <p role="status"><strong>Szkic:</strong> nic nie zostało pobrane. Tutaj pojawi się potwierdzenie płatności i status „opłacone”.</p> : null}
        </div>
      ) : (
        <Notice kind="note">{catalog.settings.payments.onlineEnabled ? 'Ta rezerwacja ma pozycje do ustalenia, więc płatność online nie jest oferowana.' : 'Płatności online są wyłączone w ustawieniach.'}</Notice>
      )}

      <div className="ra-sketchbox">
        <div className="ra-row"><Sketch /><strong>Podgląd maila z potwierdzeniem</strong></div>
        <p className="ra-small">Treść jest prawdziwa i powstała z danych rezerwacji. W pokazie nic nie jest wysyłane.</p>
        <div className="ra-mail" data-testid="mail">
          <div className="ra-small ra-muted">Do: {mail.to}{mail.copyTo ? ` · kopia: ${mail.copyTo}` : ''}</div>
          <strong>{mail.subject}</strong>
          {'\n\n'}
          {mail.lines.join('\n')}
        </div>
      </div>
      <a className="ra-btn" href="#start" style={{ alignSelf: 'flex-start' }}>Wróć do rowerów</a>
    </div>
  );
}
