// The single doorway to data. Views and use cases talk to this interface only.
// Today it is implemented in memory; later by a server (PHP plugin or Node + PostgreSQL)
// where createReservation becomes one database transaction.

import type {
  Actor,
  AuditEntry,
  Catalog,
  Customer,
  Grosze,
  Id,
  ISODate,
  LostDemand,
  OrderInput,
  Rate,
  Reservation,
  Settings,
} from '../core/types.ts';
import type { Problem } from '../core/availability.ts';
import type { Quote } from '../core/pricing.ts';

export type CollectionName =
  | 'bands'
  | 'tariffs'
  | 'dateExceptions'
  | 'openingRules'
  | 'products'
  | 'variants'
  | 'units'
  | 'unitOutages'
  | 'serviceCategories'
  | 'services'
  | 'statuses'
  | 'channels';

export type RecordOf<K extends CollectionName> = Catalog[K][number];

export interface WriteOptions {
  actor: Actor;
  /** Version the caller last saw. Required when the record already exists. */
  expectedVersion?: number;
  note?: string;
}

/** What a change would do to existing reservations. Nothing is ever cancelled automatically. */
export interface Impact {
  overbookings: Array<{ variantId: Id; date: ISODate; free: number }>;
  closedDatesWithReservations: Array<{ date: ISODate; reservationNumbers: string[] }>;
}

export type WriteError =
  | { code: 'versionConflict'; currentVersion: number }
  | { code: 'notFound' }
  | { code: 'invalid'; errors: string[] }
  | { code: 'forbidden' };

export type WriteResult<T> = { ok: true; record: T; impact: Impact } | { ok: false; error: WriteError };

export interface NewReservation {
  order: OrderInput;
  customer: Customer;
  source: 'shop' | 'manual';
  channelId: Id | null;
  notes?: string;
}

export interface CreateOptions {
  actor: Actor;
  /** The same key sent twice returns the first reservation instead of creating a second one. */
  idempotencyKey: string | null;
  /** Identifies one visit, so a repeated refusal is logged as lost demand only once. */
  sessionKey?: string | null;
}

export type CreateResult =
  | { ok: true; reservation: Reservation; quote: Quote; repeated: boolean }
  | { ok: false; problems: Problem[] };

export type ReservationResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; error: WriteError | { code: 'unavailable'; problems: Problem[] } };

export interface NewLostDemand {
  source: 'shop' | 'manual';
  reason: LostDemand['reason'];
  order: Pick<OrderInput, 'mode' | 'startDate' | 'endDate' | 'startMinute' | 'endMinute'>;
  variantId: Id | null;
  requested: number;
  free: number;
  estimatedValue?: Grosze | null;
  note?: string;
  sessionKey?: string | null;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Repository {
  getCatalog(): Promise<Catalog>;

  putRecord<K extends CollectionName>(collection: K, record: RecordOf<K>, options: WriteOptions): Promise<WriteResult<RecordOf<K>>>;
  removeRecord(collection: CollectionName, id: Id, options: WriteOptions): Promise<WriteResult<null>>;
  setRates(rates: Array<Omit<Rate, 'tenantId'>>, options: WriteOptions): Promise<WriteResult<null>>;
  updateSettings(patch: DeepPartial<Omit<Settings, 'tenantId' | 'version'>>, options: WriteOptions): Promise<WriteResult<Settings>>;
  /** Shows what a change would do without saving it. */
  previewRecord<K extends CollectionName>(collection: K, record: RecordOf<K>): Promise<Impact>;

  listReservations(): Promise<Reservation[]>;
  getReservation(id: Id): Promise<Reservation | null>;
  /** Checks availability and saves in one indivisible step. */
  createReservation(input: NewReservation, options: CreateOptions): Promise<CreateResult>;
  changeReservationStatus(id: Id, statusId: Id, options: WriteOptions): Promise<ReservationResult>;
  setManualAmount(id: Id, amount: Grosze | null, reason: string, options: WriteOptions): Promise<ReservationResult>;

  recordLostDemand(entry: NewLostDemand, actor: Actor): Promise<LostDemand | null>;
  listLostDemand(): Promise<LostDemand[]>;
  listAudit(): Promise<AuditEntry[]>;

  /** Back to the seed data. */
  reset(): Promise<void>;
}
