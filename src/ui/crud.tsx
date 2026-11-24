// One generic list-and-form editor for every catalog collection in the admin panel.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { formatDay, variantName, WEEKDAYS_SHORT } from '../app/labels.ts';
import { formatTime, parseTime } from '../core/time.ts';
import type { Catalog } from '../core/types.ts';
import type { CollectionName, Impact } from '../data/repository.ts';
import { useApp } from './store.tsx';
import { Dialog, Notice } from './widgets.tsx';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'bool' | 'select' | 'date' | 'time' | 'weekdays' | 'months' | 'custom';
  options?: Array<{ value: string; label: string }>;
  nullable?: boolean;
  hint?: string;
  wide?: boolean;
  show?: (draft: any) => boolean;
  render?: (draft: any, set: (patch: any) => void) => ReactNode;
}

export interface Column {
  label: string;
  cell: (record: any) => ReactNode;
}

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

export function Chips(props: { labels: string[]; value: number[]; onChange: (value: number[]) => void; label: string }) {
  return (
    <div className="ra-chips" role="group" aria-label={props.label}>
      {props.labels.map((label, index) => {
        const n = index + 1;
        const on = props.value.includes(n);
        return (
          <button key={n} type="button" className="ra-chip" aria-pressed={on} onClick={() => props.onChange(on ? props.value.filter((v) => v !== n) : [...props.value, n].sort((a, b) => a - b))}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export const moneyInput = (grosze: number | null | undefined): string =>
  grosze === null || grosze === undefined ? '' : (grosze / 100).toFixed(grosze % 100 === 0 ? 0 : 2).replace('.', ',');

function FieldInput(props: { field: FieldDef; draft: any; set: (patch: any) => void }) {
  const { field, draft, set } = props;
  const value = draft[field.key];
  const change = (next: any): void => set({ [field.key]: next });
  switch (field.type) {
    case 'custom':
      return <>{field.render?.(draft, set)}</>;
    case 'bool':
      return (
        <label className="ra-check">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => change(e.target.checked)} />
          <span>{field.label}{field.hint ? <span className="ra-small ra-muted"> · {field.hint}</span> : null}</span>
        </label>
      );
    case 'weekdays':
      return (
        <div className="ra-field">
          {field.label}
          <Chips label={field.label} labels={WEEKDAYS_SHORT} value={value ?? []} onChange={change} />
          {field.hint ? <span className="ra-hint">{field.hint}</span> : null}
        </div>
      );
    case 'months':
      return (
        <div className="ra-field">
          {field.label}
          <Chips label={field.label} labels={MONTHS_SHORT} value={value ?? []} onChange={change} />
          {field.hint ? <span className="ra-hint">{field.hint}</span> : null}
        </div>
      );
    default:
      break;
  }
  let input: ReactNode;
  if (field.type === 'textarea') {
    input = <textarea value={value ?? ''} onChange={(e) => change(e.target.value)} />;
  } else if (field.type === 'select') {
    input = (
      <select value={value ?? ''} onChange={(e) => change(e.target.value === '' && field.nullable ? null : e.target.value)}>
        {field.nullable ? <option value="">—</option> : null}
        {(field.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  } else if (field.type === 'number') {
    input = <input type="number" value={value ?? ''} onChange={(e) => change(e.target.value === '' ? (field.nullable ? null : 0) : Number(e.target.value))} />;
  } else if (field.type === 'money') {
    input = <MoneyField value={value} nullable={field.nullable} onChange={change} />;
  } else if (field.type === 'date') {
    input = <input type="date" value={value ?? ''} onChange={(e) => change(e.target.value === '' ? null : e.target.value)} />;
  } else if (field.type === 'time') {
    input = (
      <input
        type="time"
        value={value === null || value === undefined ? '' : formatTime(value).padStart(5, '0')}
        onChange={(e) => change(e.target.value === '' ? (field.nullable ? null : 0) : parseTime(e.target.value))}
      />
    );
  } else {
    input = <input value={value ?? ''} onChange={(e) => change(e.target.value)} />;
  }
  return (
    <label className="ra-field">
      {field.label}
      {input}
      {field.hint ? <span className="ra-hint">{field.hint}</span> : null}
    </label>
  );
}

function MoneyField(props: { value: number | null; nullable?: boolean; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(moneyInput(props.value));
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={props.nullable ? 'do ustalenia' : ''}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseMoney(e.target.value);
        if (parsed !== null) props.onChange(parsed);
        else if (e.target.value.trim() === '' && props.nullable) props.onChange(null);
      }}
    />
  );
}

export function impactIsEmpty(impact: Impact): boolean {
  return impact.overbookings.length === 0 && impact.closedDatesWithReservations.length === 0;
}

/** Issues the change would add on top of what already exists. */
export function newIssues(before: Impact, after: Impact): Impact {
  const seenOver = new Set(before.overbookings.map((o) => `${o.variantId}|${o.date}|${o.free}`));
  const seenClosed = new Set(before.closedDatesWithReservations.map((c) => c.date));
  return {
    overbookings: after.overbookings.filter((o) => !seenOver.has(`${o.variantId}|${o.date}|${o.free}`)),
    closedDatesWithReservations: after.closedDatesWithReservations.filter((c) => !seenClosed.has(c.date)),
  };
}

export function ImpactList(props: { impact: Impact; catalog: Catalog }) {
  const byVariant = new Map<string, Array<{ date: string; free: number }>>();
  for (const o of props.impact.overbookings) byVariant.set(o.variantId, [...(byVariant.get(o.variantId) ?? []), o]);
  return (
    <div className="ra-stack" style={{ gap: 8 }}>
      {byVariant.size > 0 ? (
        <div>
          <strong>Więcej rezerwacji niż sztuk:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {[...byVariant].map(([variantId, list]) => (
              <li key={variantId}>
                {variantName(props.catalog, variantId)}: {list.map((o) => `${formatDay(o.date)} (brakuje ${-o.free})`).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.impact.closedDatesWithReservations.length > 0 ? (
        <div>
          <strong>Dni zamknięte z istniejącymi zgłoszeniami:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {props.impact.closedDatesWithReservations.map((c) => (
              <li key={c.date}>{formatDay(c.date)}: {c.reservationNumbers.join(', ')}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <span>Nic nie zostanie anulowane automatycznie. Skontaktuj się z klientami z tych zgłoszeń.</span>
    </div>
  );
}

export function Crud(props: {
  collection: CollectionName;
  title: string;
  addLabel?: string;
  fields: FieldDef[];
  columns: Column[];
  filter?: (record: any) => boolean;
  sort?: (a: any, b: any) => number;
  create?: () => any;
  describe: (record: any) => string;
  removable?: (record: any) => boolean;
  hint?: ReactNode;
  prepare?: (record: any) => any;
}) {
  const app = useApp();
  const [draft, setDraft] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<Impact | null>(null);
  const records = (app.catalog[props.collection] as any[]).filter(props.filter ?? (() => true)).sort(props.sort ?? ((a, b) => (a.order ?? 0) - (b.order ?? 0)));

  const close = (): void => {
    setDraft(null);
    setErrors([]);
    setPending(null);
  };

  const fail = async (error: { code: string; errors?: string[] }): Promise<void> => {
    if (error.code === 'versionConflict') {
      setErrors(['Ten rekord został w międzyczasie zmieniony. Dane zostały odświeżone, wprowadź zmianę ponownie.']);
      await app.reload();
    } else if (error.code === 'forbidden') setErrors(['Ta rola nie może zmieniać oferty.']);
    else setErrors(error.errors ?? ['Nie udało się zapisać.']);
  };

  const save = async (force: boolean): Promise<void> => {
    const record = props.prepare ? props.prepare(draft) : draft;
    if (!force) {
      const issues = newIssues(await app.repo.currentImpact(), await app.repo.previewRecord(props.collection, record));
      if (!impactIsEmpty(issues)) {
        setPending(issues);
        return;
      }
    }
    const result = await app.repo.putRecord(props.collection, record, {
      actor: app.actor,
      expectedVersion: isNew ? undefined : record.version,
      note: `${isNew ? 'dodano' : 'zmieniono'}: ${props.describe(record)}`,
    });
    if (!result.ok) {
      setPending(null);
      await fail(result.error);
      return;
    }
    close();
    await app.reload();
    app.toast('Zapisano.');
  };

  const remove = async (record: any): Promise<void> => {
    const result = await app.repo.removeRecord(props.collection, record.id, { actor: app.actor, expectedVersion: record.version, note: `usunięto: ${props.describe(record)}` });
    if (!result.ok) {
      app.toast(result.error.code === 'invalid' ? 'Nie można usunąć: rekord jest używany (np. przez zgłoszenia). Wyłącz go zamiast usuwać.' : 'Nie udało się usunąć.');
      return;
    }
    await app.reload();
    app.toast('Usunięto.');
  };

  return (
    <section className="ra-stack" data-crud={props.collection}>
      <div className="ra-row ra-between">
        <h3>{props.title}</h3>
        {props.create ? (
          <button
            type="button"
            className="ra-btn ra-btn-small"
            onClick={() => {
              setIsNew(true);
              setDraft({ id: `${props.collection}-${Math.random().toString(36).slice(2, 8)}`, tenantId: app.catalog.tenant.id, version: 0, ...props.create!() });
            }}
          >
            {props.addLabel ?? 'Dodaj'}
          </button>
        ) : null}
      </div>
      {props.hint ? <p className="ra-small ra-muted">{props.hint}</p> : null}
      <div className="ra-tablebox">
        <table className="ra-table ra-cards">
          <thead>
            <tr>
              {props.columns.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
              <th><span className="ra-sr">Działania</span></th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                {props.columns.map((c) => (
                  <td key={c.label} data-label={c.label}>{c.cell(record)}</td>
                ))}
                <td className="ra-actions">
                  <button type="button" className="ra-btn ra-btn-small" onClick={() => { setIsNew(false); setDraft({ ...record }); }}>Edytuj</button>{' '}
                  {(props.removable ?? (() => true))(record) ? (
                    <button type="button" className="ra-btn ra-btn-small" onClick={() => void remove(record)}>Usuń</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {records.length === 0 ? (
              <tr><td colSpan={props.columns.length + 1} className="ra-muted">Brak pozycji.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={draft !== null} onClose={close} title={`${isNew ? 'Nowa pozycja' : 'Edycja'}: ${props.title}`}>
        {draft ? (
          <form
            className="ra-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void save(false);
            }}
          >
            <div className="ra-form">
              {props.fields
                .filter((f) => !f.show || f.show(draft))
                .map((field) => (
                  <div key={field.key} className={field.wide || field.type === 'textarea' || field.type === 'custom' || field.type === 'months' || field.type === 'weekdays' ? 'ra-wide' : ''}>
                    <FieldInput field={field} draft={draft} set={(patch) => setDraft((d: any) => ({ ...d, ...patch }))} />
                  </div>
                ))}
            </div>
            {errors.map((e) => (
              <Notice key={e} kind="error">{e}</Notice>
            ))}
            {pending ? (
              <Notice kind="warn">
                <ImpactList impact={pending} catalog={app.catalog} />
              </Notice>
            ) : null}
            <div className="ra-row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="ra-btn" onClick={close}>Anuluj</button>
              {pending ? (
                <button type="button" className="ra-btn ra-btn-primary" onClick={() => void save(true)}>Zapisz mimo to</button>
              ) : (
                <button type="submit" className="ra-btn ra-btn-primary">Zapisz</button>
              )}
            </div>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
