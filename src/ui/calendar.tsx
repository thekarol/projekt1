import { useMemo, useState } from 'react';
import { formatDateLong, formatDay, MONTHS, moneyDelta, WEEKDAYS_SHORT } from '../app/labels.ts';
import { dayAvailability } from '../core/availability.ts';
import { resolveDay } from '../core/calendar.ts';
import { dayPrice, dayPriceDelta } from '../core/pricing.ts';
import { addDays, dayNumber, daysBetweenInclusive, eachDate, formatTime, weekday } from '../core/time.ts';
import type { Id, ISODate } from '../core/types.ts';
import { useApp } from './store.tsx';
import { Icon, Segment } from './widgets.tsx';

/** What the calendar describes: the whole cart, one product being viewed, or nothing in particular. */
export type CalendarContext =
  | { kind: 'cart'; items: Array<{ variantId: Id; quantity: number }> }
  | { kind: 'product'; variantIds: Id[] }
  | { kind: 'none' };

type DayState = 'past' | 'closed' | 'full' | 'partial' | 'low' | 'free';

const STATE_LABEL: Record<DayState, string> = {
  past: 'termin miniony',
  closed: 'punkt nieczynny',
  full: 'brak wolnych sztuk',
  partial: 'częściowo wolny',
  low: 'ostatnie sztuki',
  free: 'wolny',
};

function useDayInfo(context: CalendarContext, mode: 'days' | 'hours') {
  const app = useApp();
  return (date: ISODate): { state: DayState; delta: number | null } => {
    const horizon = addDays(app.now.date, app.catalog.settings.calendar.horizonDays);
    if (date < app.now.date || date > horizon) return { state: 'past', delta: null };
    // Day rentals for today close at the hour set in the panel.
    const until = app.catalog.settings.booking.sameDayDaysUntil;
    if (mode === 'days' && date === app.now.date && (until === null || app.now.minute > until)) return { state: 'past', delta: null };
    if (!resolveDay(app.catalog, date).hours) return { state: 'closed', delta: null };
    let state: DayState = 'free';
    let delta: number | null = null;
    if (context.kind === 'cart') {
      const day = dayAvailability(app.ctx, date, context.items);
      state = day.status === 'free' ? (day.low ? 'low' : 'free') : day.status === 'closed' ? 'closed' : day.status;
      delta = dayPriceDelta(app.catalog, date, context.items);
    } else if (context.kind === 'product') {
      const perVariant = context.variantIds.map((variantId) => dayAvailability(app.ctx, date, [{ variantId, quantity: 1 }]));
      if (perVariant.some((d) => d.status === 'free')) {
        const left = perVariant.reduce((sum, d) => sum + (d.variants[0]?.freeAllDay ?? 0), 0);
        state = left <= app.catalog.settings.calendar.lowStockThreshold ? 'low' : 'free';
      } else {
        state = perVariant.some((d) => d.status === 'partial') ? 'partial' : 'full';
      }
      delta = context.variantIds[0] ? dayPrice(app.catalog, date, context.variantIds[0]).delta : null;
    }
    return { state, delta };
  };
}

export function Calendar(props: {
  context: CalendarContext;
  mode: 'days' | 'hours';
  start: ISODate | null;
  end: ISODate | null;
  onPick: (start: ISODate, end: ISODate) => void;
}) {
  const app = useApp();
  const [month, setMonth] = useState((props.start ?? app.now.date).slice(0, 7));
  const info = useDayInfo(props.context, props.mode);
  const first = `${month}-01`;
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const nextMonth = monthIndex === 12 ? `${year + 1}-01` : `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const prevMonth = monthIndex === 1 ? `${year - 1}-12` : `${year}-${String(monthIndex - 1).padStart(2, '0')}`;
  const dates = useMemo(() => eachDate(first, addDays(`${nextMonth}-01`, -1)), [first, nextMonth]);
  const cells = dates.map((date) => ({ date, ...info(date) }));
  const canGoBack = month > app.now.date.slice(0, 7);

  const pick = (date: ISODate): void => {
    const { start, end } = props;
    // A second click extends the term; a click far away starts a new one instead of an impossible range.
    const tooLong = start !== null && date > start && daysBetweenInclusive(start, date) > app.catalog.settings.maxRentalDays;
    if (props.mode === 'hours' || !start || !end || start !== end || date < start || tooLong) props.onPick(date, date);
    else props.onPick(start, date);
  };

  return (
    <div className="ra-cal">
      <div className="ra-cal-head">
        <button type="button" className="ra-btn ra-btn-small" aria-label="Poprzedni miesiąc" disabled={!canGoBack} onClick={() => setMonth(prevMonth)}>
          <Icon name="left" />
        </button>
        <strong aria-live="polite">
          {MONTHS[monthIndex - 1]} {year}
        </strong>
        <button type="button" className="ra-btn ra-btn-small" aria-label="Następny miesiąc" onClick={() => setMonth(nextMonth)}>
          <Icon name="right" />
        </button>
      </div>
      <div className="ra-cal-grid" aria-hidden="true">
        {WEEKDAYS_SHORT.map((name) => (
          <span key={name} className="ra-cal-week">
            {name}
          </span>
        ))}
      </div>
      <div className="ra-cal-grid">
        {Array.from({ length: weekday(first) - 1 }, (_, i) => (
          <span key={`pad-${i}`} />
        ))}
        {cells.map((cell) => {
          const selected = props.start !== null && props.end !== null && props.start <= cell.date && cell.date <= props.end;
          const disabled = cell.state === 'past' || cell.state === 'closed' || cell.state === 'full';
          const showDelta = cell.delta !== null && cell.delta !== 0 && cell.state !== 'past' && cell.state !== 'closed';
          return (
            <button
              key={cell.date}
              type="button"
              className="ra-day"
              data-state={cell.state}
              data-selected={selected}
              data-date={cell.date}
              aria-pressed={selected}
              aria-label={`${formatDateLong(cell.date)}, ${STATE_LABEL[cell.state]}${showDelta ? `, ${moneyDelta(cell.delta ?? 0)} za dzień` : ''}`}
              disabled={disabled}
              onClick={() => pick(cell.date)}
            >
              <span className="ra-num">{Number(cell.date.slice(8))}</span>
              {showDelta ? <span className="ra-delta">{moneyDelta(cell.delta ?? 0)}</span> : null}
              {cell.state === 'closed' ? <span className="ra-mark"><Icon name="lock" size={11} />zamkn.</span> : null}
              {cell.state === 'full' ? <span className="ra-mark"><Icon name="x" size={11} />brak</span> : null}
              {cell.state === 'partial' ? <span className="ra-mark"><Icon name="half" size={11} />część</span> : null}
              {cell.state === 'low' ? <span className="ra-mark"><Icon name="warn" size={11} />ostatnie</span> : null}
            </button>
          );
        })}
      </div>
      <div className="ra-legend">
        <span><i className="ra-swatch" />wolny</span>
        <span><i className="ra-swatch" style={{ borderColor: 'var(--accent)' }} />ostatnie sztuki</span>
        <span><i className="ra-swatch" style={{ borderStyle: 'dashed', borderColor: '#8a6a2a' }} />częściowo wolny</span>
        <span><i className="ra-swatch" style={{ background: 'repeating-linear-gradient(135deg,#f0f1ee 0 4px,#d9dbd5 4px 8px)' }} />brak lub zamknięte</span>
        <span><i className="ra-swatch" style={{ background: 'var(--brand-dark)', borderColor: 'var(--brand-dark)' }} />Twój termin</span>
        <span><b className="ra-delta" style={{ fontSize: 12, color: 'var(--accent-ink)', background: 'var(--accent-soft)', borderRadius: 999, padding: '0 6px' }}>±zł</b>różnica ceny za dzień</span>
      </div>
    </div>
  );
}

/** Sentence shown when the chosen days do not all cost the same. */
export function priceChangeSentence(deltas: Array<{ date: ISODate; delta: number | null }>): string | null {
  const known = deltas.filter((d) => d.delta !== null);
  if (known.length < 2 || new Set(known.map((d) => d.delta)).size < 2) return null;
  const groups: Array<{ from: ISODate; to: ISODate; delta: number }> = [];
  for (const day of known) {
    const last = groups[groups.length - 1];
    if (last && last.delta === day.delta && dayNumber(day.date) === dayNumber(last.to) + 1) last.to = day.date;
    else groups.push({ from: day.date, to: day.date, delta: day.delta as number });
  }
  const part = (g: { from: ISODate; to: ISODate; delta: number }): string =>
    `${g.from === g.to ? formatDay(g.from) : `${formatDay(g.from)} – ${formatDay(g.to)}`}: ${g.delta === 0 ? 'cena standardowa' : `${moneyDelta(g.delta)} za dzień`}`;
  return `W wybranym terminie cena dnia się zmienia. ${groups.map(part).join('; ')}.`;
}

/** Mode switch, calendar and hour selection, bound to the cart's term. */
export function TermPicker(props: { context: CalendarContext }) {
  const app = useApp();
  const { cart, catalog } = app;
  const { minHours, maxHours, stepMinutes } = catalog.settings.hourly;
  const hours = cart.startDate ? resolveDay(catalog, cart.startDate).hours : null;

  const fromOptions: number[] = [];
  const toOptions: number[] = [];
  if (hours) {
    for (let t = hours.open; t + minHours * 60 <= hours.close; t += stepMinutes) fromOptions.push(t);
    for (let t = cart.startMinute + minHours * 60; t <= Math.min(hours.close, cart.startMinute + maxHours * 60); t += stepMinutes) toOptions.push(t);
  }

  const setTerm = (start: ISODate, end: ISODate): void =>
    app.setCart((c) => {
      const day = resolveDay(catalog, start).hours;
      let startMinute = c.startMinute;
      let endMinute = c.endMinute;
      if (c.mode === 'hours' && day) {
        startMinute = Math.min(Math.max(startMinute, day.open), day.close - minHours * 60);
        endMinute = Math.min(Math.max(endMinute, startMinute + minHours * 60), day.close, startMinute + maxHours * 60);
      }
      return { ...c, termChosen: true, startDate: start, endDate: c.mode === 'hours' ? start : end, startMinute, endMinute };
    });

  const deltas =
    cart.mode === 'days' && cart.startDate && cart.endDate && cart.startDate !== cart.endDate
      ? eachDate(cart.startDate, cart.endDate).map((date) => ({
          date,
          delta:
            props.context.kind === 'cart'
              ? dayPriceDelta(catalog, date, props.context.items)
              : props.context.kind === 'product' && props.context.variantIds[0]
                ? dayPrice(catalog, date, props.context.variantIds[0]).delta
                : null,
        }))
      : [];
  const sentence = priceChangeSentence(deltas);

  return (
    <div className="ra-stack">
      <Segment
        label="Rodzaj najmu"
        value={cart.mode}
        options={[
          { value: 'days', label: 'Dni' },
          { value: 'hours', label: 'Godziny' },
        ]}
        onChange={(mode) => app.setCart((c) => ({ ...c, mode, endDate: mode === 'hours' ? c.startDate : c.endDate }))}
      />
      <Calendar context={props.context} mode={cart.mode} start={cart.startDate} end={cart.mode === 'hours' ? cart.startDate : cart.endDate} onPick={setTerm} />
      {cart.mode === 'hours' && cart.startDate && hours ? (
        <div className="ra-row">
          <label className="ra-field" style={{ width: 140 }}>
            Od godziny
            <select
              value={cart.startMinute}
              onChange={(event) => {
                const startMinute = Number(event.target.value);
                app.setCart((c) => ({
                  ...c,
                  startMinute,
                  endMinute: Math.min(Math.max(c.endMinute, startMinute + minHours * 60), hours.close, startMinute + maxHours * 60),
                }));
              }}
            >
              {fromOptions.map((t) => (
                <option key={t} value={t}>{formatTime(t)}</option>
              ))}
            </select>
          </label>
          <label className="ra-field" style={{ width: 140 }}>
            Do godziny
            <select value={cart.endMinute} onChange={(event) => app.setCart((c) => ({ ...c, endMinute: Number(event.target.value) }))}>
              {toOptions.map((t) => (
                <option key={t} value={t}>{formatTime(t)}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {cart.mode === 'days' && cart.startDate && cart.startDate === cart.endDate ? (
        <p className="ra-small ra-muted">Na kilka dni: wskaż w kalendarzu ostatni dzień najmu.</p>
      ) : null}
      {sentence ? <p className="ra-badge ra-badge-accent" style={{ whiteSpace: 'normal', borderRadius: 12, padding: '8px 12px' }}>{sentence}</p> : null}
    </div>
  );
}
