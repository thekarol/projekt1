// In-memory repository for the demo. Data lives in this object only; reset() restores the seed.
// Every method body runs synchronously, so "check availability and save" cannot be interleaved.

import type {
  Actor,
  AuditEntry,
  Catalog,
  Grosze,
  Id,
  LostDemand,
  OrderInput,
  Rate,
  Reservation,
  ReservationItem,
  Settings,
  Versioned,
} from '../core/types.ts';
import {
  checkOrder,
  findOverbookings,
  freeUnits,
  lastReservedDate,
  orderWindow,
  reservationsOnDate,
} from '../core/availability.ts';
import type { AvailabilityContext, OrderWindow, Problem } from '../core/availability.ts';
import { quote } from '../core/pricing.ts';
import type { Quote } from '../core/pricing.ts';
import { absMinute, eachDate, toZoned } from '../core/time.ts';
import { validateCatalog } from '../core/validate.ts';
import type {
  CollectionName,
  CreateOptions,
  CreateResult,
  DeepPartial,
  Impact,
  NewLostDemand,
  NewReservation,
  RecordOf,
  Repository,
  ReservationResult,
  WriteError,
  WriteOptions,
  WriteResult,
} from './repository.ts';
import type { SeedFile, SeedReservation } from './seed.ts';

export interface MemoryOptions {
  /** Current time as epoch milliseconds. Injected so tests are repeatable. */
  now?: () => number;
  newId?: () => string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function defaultId(): string {
  const api = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (api?.randomUUID) return api.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function merge<T>(target: T, patch: DeepPartial<T>): T {
  const out: any = Array.isArray(target) ? [...(target as any)] : { ...(target as any) };
  for (const [key, value] of Object.entries(patch as object)) {
    if (value === undefined) continue;
    out[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object'
        ? merge(out[key], value)
        : value;
  }
  return out as T;
}

const CATALOG_ROLES = new Set<Actor['role']>(['admin', 'system']);
const TEAM_ROLES = new Set<Actor['role']>(['team', 'admin', 'system']);

export class MemoryRepository implements Repository {
  #seed: SeedFile;
  #catalog!: Catalog;
  #reservations: Reservation[] = [];
  #lost: LostDemand[] = [];
  #audit: AuditEntry[] = [];
  #sequence = new Map<string, number>();
  #keys = new Map<string, Id>();
  #now: () => number;
  #newId: () => string;

  constructor(seed: SeedFile, options: MemoryOptions = {}) {
    this.#seed = clone(seed);
    this.#now = options.now ?? (() => Date.now());
    this.#newId = options.newId ?? defaultId;
    this.#load();
  }

  #load(): void {
    this.#catalog = clone(this.#seed.catalog);
    this.#reservations = [];
    this.#lost = [];
    this.#audit = [];
    this.#sequence = new Map();
    this.#keys = new Map();
    for (const sample of this.#seed.reservations) this.#reservations.push(this.#hydrate(sample));
  }

  #hydrate(sample: SeedReservation): Reservation {
    const window = orderWindow(this.#catalog, sample.order);
    if (!window) throw new Error(`Seed reservation ${sample.number} has no valid dates`);
    const match = /-(\d{4})-(\d+)$/.exec(sample.number);
    if (match) {
      const year = match[1]!;
      this.#sequence.set(year, Math.max(this.#sequence.get(year) ?? 0, Number(match[2])));
    }
    return this.#build({
      number: sample.number,
      createdAt: sample.createdAt,
      source: sample.source,
      channelId: sample.channelId,
      statusId: sample.statusId,
      customer: { ...sample.customer, consentAt: sample.createdAt },
      order: sample.order,
      window,
      quoted: quote(this.#catalog, sample.order),
      notes: sample.notes,
      idempotencyKey: null,
      by: 'dane startowe',
    });
  }

  #build(input: {
    number: string;
    createdAt: string;
    source: Reservation['source'];
    channelId: Id | null;
    statusId: Id;
    customer: Reservation['customer'];
    order: OrderInput;
    window: OrderWindow;
    quoted: Quote;
    notes: string;
    idempotencyKey: string | null;
    by: string;
  }): Reservation {
    const q = input.quoted;
    const items: ReservationItem[] = [
      ...q.lines.map((l) => ({
        kind: 'rental' as const,
        refId: l.variantId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
      ...q.serviceLines.map((l) => ({
        kind: 'service' as const,
        refId: l.serviceId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    ];
    return {
      id: this.#newId(),
      tenantId: this.#catalog.tenant.id,
      version: 1,
      number: input.number,
      createdAt: input.createdAt,
      source: input.source,
      channelId: input.channelId,
      statusId: input.statusId,
      customer: input.customer,
      mode: input.order.mode,
      startDate: input.window.startDate,
      startMinute: input.window.startMinute,
      endDate: input.window.endDate,
      endMinute: input.window.endMinute,
      items,
      total: q.total,
      priceStatus: q.priceStatus,
      toBeAgreed: q.toBeAgreed.map((t) => (t.refId ? `${t.code}:${t.refId}` : t.code)),
      calcVersion: q.calcVersion,
      manualAmount: null,
      notes: input.notes,
      history: [{ at: input.createdAt, by: input.by, text: 'created' }],
      idempotencyKey: input.idempotencyKey,
    };
  }

  #ctx(catalog: Catalog = this.#catalog, excludeReservationId: Id | null = null): AvailabilityContext {
    return { catalog, reservations: this.#reservations, excludeReservationId };
  }

  #today(): string {
    return toZoned(this.#now(), this.#catalog.tenant.timeZone).date;
  }

  #impact(catalog: Catalog): Impact {
    const ctx = this.#ctx(catalog);
    const today = this.#today();
    const impact: Impact = { overbookings: [], closedDatesWithReservations: [] };
    for (const variant of catalog.variants) {
      const last = lastReservedDate(ctx, variant.id);
      if (!last || last < today) continue;
      for (const hit of findOverbookings(ctx, variant.id, today, last)) {
        impact.overbookings.push({ variantId: variant.id, date: hit.date, free: hit.free });
      }
    }
    for (const exception of catalog.dateExceptions) {
      if (exception.action.kind !== 'closed') continue;
      for (const date of eachDate(exception.from, exception.to).slice(0, 366)) {
        const hit = reservationsOnDate(ctx, date);
        if (hit.length > 0) {
          impact.closedDatesWithReservations.push({ date, reservationNumbers: hit.map((r) => r.number) });
        }
      }
    }
    return impact;
  }

  #log(actor: Actor, entity: string, entityId: Id, action: AuditEntry['action'], before: unknown, after: unknown, note?: string): void {
    this.#audit.push({
      id: this.#newId(),
      tenantId: this.#catalog.tenant.id,
      at: new Date(this.#now()).toISOString(),
      actor,
      entity,
      entityId,
      action,
      summary: note ?? '',
      before: clone(before ?? null),
      after: clone(after ?? null),
    });
  }

  #commit(candidate: Catalog): WriteError | null {
    const check = validateCatalog(candidate);
    if (check.errors.length > 0) return { code: 'invalid', errors: check.errors };
    this.#catalog = candidate;
    return null;
  }

  async getCatalog(): Promise<Catalog> {
    return clone(this.#catalog);
  }

  async currentImpact(): Promise<Impact> {
    return this.#impact(this.#catalog);
  }

  async previewRecord<K extends CollectionName>(collection: K, record: RecordOf<K>): Promise<Impact> {
    const list = this.#catalog[collection] as Versioned[];
    const next = list.some((r) => r.id === record.id)
      ? list.map((r) => (r.id === record.id ? (record as Versioned) : r))
      : [...list, record as Versioned];
    return this.#impact({ ...this.#catalog, [collection]: next } as Catalog);
  }

  async putRecord<K extends CollectionName>(collection: K, record: RecordOf<K>, options: WriteOptions): Promise<WriteResult<RecordOf<K>>> {
    if (!CATALOG_ROLES.has(options.actor.role)) return { ok: false, error: { code: 'forbidden' } };
    const list = this.#catalog[collection] as Versioned[];
    const current = list.find((r) => r.id === record.id) ?? null;
    if (current && options.expectedVersion !== current.version) {
      return { ok: false, error: { code: 'versionConflict', currentVersion: current.version } };
    }
    const saved = {
      ...clone(record),
      tenantId: this.#catalog.tenant.id,
      version: current ? current.version + 1 : 1,
    } as Versioned;
    const next = current ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved];
    const candidate = { ...this.#catalog, [collection]: next } as Catalog;
    const error = this.#commit(candidate);
    if (error) return { ok: false, error };
    this.#log(options.actor, collection, saved.id, current ? 'update' : 'create', current, saved, options.note);
    return { ok: true, record: clone(saved) as RecordOf<K>, impact: this.#impact(candidate) };
  }

  async removeRecord(collection: CollectionName, id: Id, options: WriteOptions): Promise<WriteResult<null>> {
    if (!CATALOG_ROLES.has(options.actor.role)) return { ok: false, error: { code: 'forbidden' } };
    const list = this.#catalog[collection] as Versioned[];
    const current = list.find((r) => r.id === id);
    if (!current) return { ok: false, error: { code: 'notFound' } };
    if (options.expectedVersion !== current.version) {
      return { ok: false, error: { code: 'versionConflict', currentVersion: current.version } };
    }
    const used =
      (collection === 'variants' && this.#reservations.some((r) => r.items.some((i) => i.kind === 'rental' && i.refId === id))) ||
      (collection === 'services' && this.#reservations.some((r) => r.items.some((i) => i.kind === 'service' && i.refId === id))) ||
      (collection === 'statuses' && this.#reservations.some((r) => r.statusId === id)) ||
      (collection === 'channels' && this.#reservations.some((r) => r.channelId === id));
    if (used) return { ok: false, error: { code: 'invalid', errors: [`${collection}/${id}: used by reservations`] } };
    const candidate = { ...this.#catalog, [collection]: list.filter((r) => r.id !== id) } as Catalog;
    // Rows that only make sense with the removed record go with it.
    if (collection === 'bands') candidate.rates = candidate.rates.filter((r) => r.bandId !== id);
    if (collection === 'tariffs') candidate.rates = candidate.rates.filter((r) => r.tariffId !== id);
    if (collection === 'variants') {
      candidate.rates = candidate.rates.filter((r) => r.variantId !== id);
      const gone = new Set(candidate.units.filter((u) => u.variantId === id).map((u) => u.id));
      candidate.units = candidate.units.filter((u) => !gone.has(u.id));
      candidate.unitOutages = candidate.unitOutages.filter((o) => !gone.has(o.unitId));
    }
    if (collection === 'units') candidate.unitOutages = candidate.unitOutages.filter((o) => o.unitId !== id);
    const error = this.#commit(candidate);
    if (error) return { ok: false, error };
    this.#log(options.actor, collection, id, 'delete', current, null, options.note);
    return { ok: true, record: null, impact: this.#impact(candidate) };
  }

  async setRates(rates: Array<Omit<Rate, 'tenantId'>>, options: WriteOptions): Promise<WriteResult<null>> {
    if (!CATALOG_ROLES.has(options.actor.role)) return { ok: false, error: { code: 'forbidden' } };
    const key = (r: Omit<Rate, 'tenantId'>): string => `${r.tariffId}|${r.variantId}|${r.bandId}`;
    const incoming = new Map(rates.map((r) => [key(r), r]));
    const before = this.#catalog.rates.filter((r) => incoming.has(key(r)));
    const kept = this.#catalog.rates.filter((r) => !incoming.has(key(r)));
    const added: Rate[] = rates.map((r) => ({ ...r, tenantId: this.#catalog.tenant.id }));
    const candidate: Catalog = { ...this.#catalog, rates: [...kept, ...added] };
    const error = this.#commit(candidate);
    if (error) return { ok: false, error };
    this.#log(options.actor, 'rates', `${rates.length}`, before.length > 0 ? 'update' : 'create', before, added, options.note);
    return { ok: true, record: null, impact: this.#impact(candidate) };
  }

  async updateSettings(patch: DeepPartial<Omit<Settings, 'tenantId' | 'version'>>, options: WriteOptions): Promise<WriteResult<Settings>> {
    if (!CATALOG_ROLES.has(options.actor.role)) return { ok: false, error: { code: 'forbidden' } };
    const current = this.#catalog.settings;
    if (options.expectedVersion !== current.version) {
      return { ok: false, error: { code: 'versionConflict', currentVersion: current.version } };
    }
    const next: Settings = { ...merge(current, patch as DeepPartial<Settings>), tenantId: current.tenantId, version: current.version + 1 };
    const errors: string[] = [];
    if (!(next.groupDiscount.percent >= 0 && next.groupDiscount.percent <= 100)) errors.push('groupDiscount.percent');
    if (!(Number.isInteger(next.groupDiscount.minUnits) && next.groupDiscount.minUnits >= 1)) errors.push('groupDiscount.minUnits');
    if (!(Number.isInteger(next.delivery.vehicleCapacity) && next.delivery.vehicleCapacity >= 0)) errors.push('delivery.vehicleCapacity');
    if (!(next.hourly.stepMinutes > 0 && next.hourly.minHours > 0 && next.hourly.maxHours >= next.hourly.minHours)) errors.push('hourly');
    const until = next.booking.sameDayDaysUntil;
    if (until !== null && !(Number.isInteger(until) && until >= 0 && until <= 1440)) errors.push('booking.sameDayDaysUntil');
    if (!(next.maxRentalDays >= 1) || !(next.mixedRoundingGrosze >= 1)) errors.push('maxRentalDays/mixedRoundingGrosze');
    if (errors.length > 0) return { ok: false, error: { code: 'invalid', errors } };
    const candidate: Catalog = { ...this.#catalog, settings: next };
    const error = this.#commit(candidate);
    if (error) return { ok: false, error };
    this.#log(options.actor, 'settings', current.tenantId, 'update', current, next, options.note);
    return { ok: true, record: clone(next), impact: this.#impact(candidate) };
  }

  async listReservations(): Promise<Reservation[]> {
    return clone(this.#reservations);
  }

  async getReservation(id: Id): Promise<Reservation | null> {
    const found = this.#reservations.find((r) => r.id === id);
    return found ? clone(found) : null;
  }

  async createReservation(input: NewReservation, options: CreateOptions): Promise<CreateResult> {
    if (options.idempotencyKey) {
      const existingId = this.#keys.get(options.idempotencyKey);
      const existing = existingId ? this.#reservations.find((r) => r.id === existingId) : null;
      if (existing) {
        return { ok: true, reservation: clone(existing), quote: quote(this.#catalog, input.order), repeated: true };
      }
    }
    const nowMs = this.#now();
    const zoned = toZoned(nowMs, this.#catalog.tenant.timeZone);
    // Walk-ins and phone bookings entered by the team may start earlier today.
    const check = checkOrder(this.#ctx(), input.order, input.source === 'shop' ? zoned : undefined);
    if (!check.ok || !check.window) {
      const problems: Problem[] = check.problems.length > 0 ? check.problems : [{ code: 'invalidDates' }];
      this.#logRefusal(input, problems, options);
      return { ok: false, problems };
    }
    const initial = this.#catalog.statuses.find((s) => s.isInitial);
    if (!initial) return { ok: false, problems: [{ code: 'invalidDates' }] };

    const quoted = quote(this.#catalog, input.order);
    const year = zoned.date.slice(0, 4);
    const next = (this.#sequence.get(year) ?? 0) + 1;
    this.#sequence.set(year, next);
    const reservation = this.#build({
      number: `${this.#catalog.tenant.reservationPrefix}-${year}-${String(next).padStart(4, '0')}`,
      createdAt: new Date(nowMs).toISOString(),
      source: input.source,
      channelId: input.channelId,
      statusId: initial.id,
      customer: input.customer,
      order: input.order,
      window: check.window,
      quoted,
      notes: input.notes ?? '',
      idempotencyKey: options.idempotencyKey,
      by: options.actor.name,
    });
    this.#reservations.push(reservation);
    if (options.idempotencyKey) this.#keys.set(options.idempotencyKey, reservation.id);
    return { ok: true, reservation: clone(reservation), quote: quoted, repeated: false };
  }

  #logRefusal(input: NewReservation, problems: Problem[], options: CreateOptions): void {
    const order = input.order;
    for (const problem of problems) {
      if (problem.code === 'shortage') {
        this.#storeLost(
          { source: input.source, reason: 'unavailable', order, variantId: problem.variantId, requested: problem.requested, free: problem.free, sessionKey: options.sessionKey ?? null },
          options.actor,
        );
      } else if (problem.code === 'closed') {
        const units = order.items.reduce((a, i) => a + i.quantity, 0);
        this.#storeLost(
          { source: input.source, reason: 'closed', order, variantId: null, requested: units, free: 0, sessionKey: options.sessionKey ?? null },
          options.actor,
        );
      }
    }
  }

  #estimate(order: NewLostDemand['order'], variantId: Id, quantity: number): Grosze | null {
    if (quantity <= 0) return null;
    try {
      const line = quote(this.#catalog, { ...order, items: [{ variantId, quantity }], services: [] }).lines[0];
      return line ? line.lineTotal : null;
    } catch {
      return null;
    }
  }

  #storeLost(entry: NewLostDemand, actor: Actor): LostDemand | null {
    const o = entry.order;
    const sessionKey = entry.sessionKey ?? null;
    if (sessionKey) {
      const duplicate = this.#lost.some(
        (l) =>
          l.sessionKey === sessionKey &&
          l.variantId === entry.variantId &&
          l.reason === entry.reason &&
          l.startDate === o.startDate &&
          l.endDate === o.endDate &&
          l.startMinute === (o.startMinute ?? null) &&
          l.endMinute === (o.endMinute ?? null),
      );
      if (duplicate) return null;
    }
    const missing = Math.max(0, entry.requested - Math.max(0, entry.free));
    const record: LostDemand = {
      id: this.#newId(),
      tenantId: this.#catalog.tenant.id,
      version: 1,
      at: new Date(this.#now()).toISOString(),
      source: entry.source,
      reason: entry.reason,
      mode: o.mode,
      startDate: o.startDate,
      endDate: o.endDate,
      startMinute: o.startMinute ?? null,
      endMinute: o.endMinute ?? null,
      variantId: entry.variantId,
      productId: this.#catalog.variants.find((v) => v.id === entry.variantId)?.productId ?? null,
      requested: entry.requested,
      free: Math.max(0, entry.free),
      missing,
      estimatedValue:
        entry.estimatedValue !== undefined
          ? entry.estimatedValue
          : entry.variantId
            ? this.#estimate(o, entry.variantId, missing)
            : null,
      sessionKey,
      note: entry.note ?? '',
      createdBy: actor.name,
    };
    this.#lost.push(record);
    return clone(record);
  }

  async changeReservationStatus(id: Id, statusId: Id, options: WriteOptions): Promise<ReservationResult> {
    if (!TEAM_ROLES.has(options.actor.role)) return { ok: false, error: { code: 'forbidden' } };
    const reservation = this.#reservations.find((r) => r.id === id);
    if (!reservation) return { ok: false, error: { code: 'notFound' } };
    if (options.expectedVersion !== reservation.version) {
      return { ok: false, error: { code: 'versionConflict', currentVersion: reservation.version } };
    }
    const next = this.#catalog.statuses.find((s) => s.id === statusId);
    const previous = this.#catalog.statuses.find((s) => s.id === reservation.statusId);
    if (!next) return { ok: false, error: { code: 'invalid', errors: [`unknown status ${statusId}`] } };
    if (next.blocksStock && !previous?.blocksStock) {
      // Coming back from a non-blocking status needs the stock to still be there.
      const ctx = this.#ctx(this.#catalog, reservation.id);
      const start = absMinute(reservation.startDate, reservation.startMinute);
      const end = absMinute(reservation.endDate, reservation.endMinute);
      const problems: Problem[] = [];
      for (const item of reservation.items) {
        if (item.kind !== 'rental') continue;
        const free = freeUnits(ctx, item.refId, start, end);
        if (item.quantity > free) {
          problems.push({ code: 'shortage', variantId: item.refId, requested: item.quantity, free: Math.max(0, free) });
        }
      }
      if (problems.length > 0) return { ok: false, error: { code: 'unavailable', problems } };
    }
    reservation.statusId = next.id;
    reservation.version += 1;
    reservation.history.push({
      at: new Date(this.#now()).toISOString(),
      by: options.actor.name,
      text: `status: ${previous?.name ?? '?'} -> ${next.name}${options.note ? ` (${options.note})` : ''}`,
    });
    return { ok: true, reservation: clone(reservation) };
  }

  async setManualAmount(id: Id, amount: Grosze | null, reason: string, options: WriteOptions): Promise<ReservationResult> {
    if (!TEAM_ROLES.has(options.actor.role)) return { ok: false, error: { code: 'forbidden' } };
    const reservation = this.#reservations.find((r) => r.id === id);
    if (!reservation) return { ok: false, error: { code: 'notFound' } };
    if (options.expectedVersion !== reservation.version) {
      return { ok: false, error: { code: 'versionConflict', currentVersion: reservation.version } };
    }
    if (amount !== null && (!Number.isInteger(amount) || amount < 0)) {
      return { ok: false, error: { code: 'invalid', errors: ['amount must be whole grosze'] } };
    }
    const at = new Date(this.#now()).toISOString();
    reservation.manualAmount = amount === null ? null : { amount, by: options.actor.name, at, reason };
    reservation.version += 1;
    reservation.history.push({
      at,
      by: options.actor.name,
      text: amount === null ? 'manual amount removed' : `manual amount ${amount} (${reason})`,
    });
    return { ok: true, reservation: clone(reservation) };
  }

  async recordLostDemand(entry: NewLostDemand, actor: Actor): Promise<LostDemand | null> {
    return this.#storeLost(entry, actor);
  }

  async listLostDemand(): Promise<LostDemand[]> {
    return clone(this.#lost);
  }

  async listAudit(): Promise<AuditEntry[]> {
    return clone(this.#audit);
  }

  async reset(): Promise<void> {
    this.#load();
  }
}
