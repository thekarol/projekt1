// Domain model. Every record belongs to a tenant; nothing here is specific to bikes.
// Availability is never stored: it is derived from units, outages and reservations.

export type Id = string;
/** Calendar date in the tenant's time zone, `YYYY-MM-DD`. */
export type ISODate = string;
/** Minutes from midnight in the tenant's time zone. */
export type Minutes = number;
/** Amount in the smallest currency unit (grosze). Always an integer. */
export type Grosze = number;

export interface Versioned {
  id: Id;
  tenantId: Id;
  version: number;
}

export interface Tenant {
  id: Id;
  name: string;
  address: string;
  locale: string;
  currency: string;
  timeZone: string;
  reservationPrefix: string;
  /** Tenant vocabulary, e.g. unit: "rower". */
  dictionary: Record<string, string>;
}

export interface Settings {
  tenantId: Id;
  version: number;
  hourly: { minHours: number; maxHours: number; stepMinutes: number };
  maxRentalDays: number;
  /** A rental whose days fall in more than one price is rounded per unit to this amount. */
  mixedRoundingGrosze: Grosze;
  groupDiscount: {
    active: boolean;
    minUnits: number;
    percent: number;
    /** What the percentage is taken from. */
    base: 'order' | 'rental';
    marksToBeAgreed: boolean;
  };
  limits: { unitsPerOrder: number; unitsPerProduct: number };
  delivery: { vehicleCapacity: number };
  payments: { onlineEnabled: boolean };
  calendar: { lowStockThreshold: number; horizonDays: number };
  booking: {
    /** A day rental starting today can be booked in the shop until this minute. Null = not at all. */
    sameDayDaysUntil: Minutes | null;
  };
}

/** A price threshold: short hourly rental, a single day, or a package of N days. */
export interface PriceBand extends Versioned {
  kind: 'hours' | 'day' | 'days';
  /** kind = hours: rentals up to this many hours use this band. */
  maxHours?: number;
  /** kind = days: package of exactly this many consecutive days. */
  days?: number;
  label: string;
  order: number;
}

export interface Tariff extends Versioned {
  /** Internal name. Never shown to the customer. */
  name: string;
  isBase: boolean;
  priority: number;
  active: boolean;
  /** Empty arrays mean "every month" / "every weekday". Null = no season (base or exception-only). */
  season: { months: number[]; weekdays: number[] } | null;
}

export interface Rate {
  tenantId: Id;
  tariffId: Id;
  variantId: Id;
  bandId: Id;
  amount: Grosze;
  manuallyEdited?: boolean;
}

export type DateExceptionAction =
  | { kind: 'closed' }
  | { kind: 'tariff'; tariffId: Id }
  | { kind: 'customPrices'; prices: Array<{ variantId: Id; bandId: Id; amount: Grosze }> };

export interface DateException extends Versioned {
  from: ISODate;
  to: ISODate;
  action: DateExceptionAction;
  note: string;
}

export type OpeningPeriod =
  | null
  | { kind: 'dates'; from: ISODate; to: ISODate }
  /** Repeats every year, `MM-DD`. May wrap around the new year. */
  | { kind: 'yearly'; from: string; to: string };

export interface OpeningRule extends Versioned {
  period: OpeningPeriod;
  /** 1 = Monday ... 7 = Sunday. */
  weekdays: number[];
  closed: boolean;
  open: Minutes;
  close: Minutes;
  priority: number;
}

export interface Product extends Versioned {
  name: string;
  /** Prefix for unit codes, e.g. "NS". */
  codePrefix: string;
  typeLabel: string;
  audience: string;
  use: string;
  specification: string;
  image: string | null;
  route: { name: string; url: string } | null;
  /** Which elements the shop tile shows. */
  tileFields: string[];
  active: boolean;
  order: number;
}

export interface Variant extends Versioned {
  productId: Id;
  label: string;
  bufferMinutes: Minutes;
  active: boolean;
  order: number;
}

/** One physical item with its own code. The variant's stock is the number of its active units. */
export interface Unit extends Versioned {
  variantId: Id;
  code: string;
  /** First day in the offer (purchase). Null = always. */
  activeFrom: ISODate | null;
  /** First day out of the offer (sale, write-off). Null = never. */
  retiredFrom: ISODate | null;
  note: string;
}

/** A unit taken out for a period (service, repair). Both dates inclusive. */
export interface UnitOutage extends Versioned {
  unitId: Id;
  from: ISODate;
  to: ISODate;
  reason: string;
}

export interface ServiceCategory extends Versioned {
  name: string;
  /** Name of the request type created by this category, e.g. "Dowóz". */
  requestType: string;
  /** Label of the "none of these" choice in the cart, e.g. "Odbiór własny". */
  noneLabel: string;
  order: number;
}

export interface Service extends Versioned {
  categoryId: Id;
  name: string;
  billing: 'perUnitPerDay' | 'perUnit' | 'fixed' | 'quote';
  price: Grosze | null;
  /** Fixed price holds only up to settings.delivery.vehicleCapacity rented units. */
  limitedByVehicle: boolean;
  /** Optional stock. Null = unlimited. */
  stock: number | null;
  /** The customer must give an address (delivery). */
  needsAddress: boolean;
  active: boolean;
  order: number;
}

export interface Status extends Versioned {
  name: string;
  order: number;
  blocksStock: boolean;
  isInitial: boolean;
  tone: 'new' | 'progress' | 'ok' | 'out' | 'done' | 'off';
}

export interface Channel extends Versioned {
  name: string;
  order: number;
}

/** Editable text on the customer page: hero, benefit sections, questions. */
export interface ContentSection extends Versioned {
  kind: 'hero' | 'benefit' | 'faq';
  title: string;
  body: string;
  /** Image file name; used by the hero section. */
  image: string | null;
  active: boolean;
  order: number;
}

export interface User extends Versioned {
  name: string;
  email: string;
  role: 'team' | 'driver' | 'admin';
  active: boolean;
}

/** Everything the engines need to price and check an order. Pure data. */
export interface Catalog {
  tenant: Tenant;
  settings: Settings;
  bands: PriceBand[];
  tariffs: Tariff[];
  rates: Rate[];
  dateExceptions: DateException[];
  openingRules: OpeningRule[];
  products: Product[];
  variants: Variant[];
  units: Unit[];
  unitOutages: UnitOutage[];
  serviceCategories: ServiceCategory[];
  services: Service[];
  statuses: Status[];
  channels: Channel[];
  content: ContentSection[];
  users: User[];
}

export type RentalMode = 'days' | 'hours';

export interface OrderInput {
  mode: RentalMode;
  startDate: ISODate;
  endDate: ISODate;
  /** Hours mode only. */
  startMinute?: Minutes;
  endMinute?: Minutes;
  items: Array<{ variantId: Id; quantity: number }>;
  services: Array<{ serviceId: Id; quantity: number }>;
  individualTerms?: boolean;
}

export interface Zoned {
  date: ISODate;
  minute: Minutes;
}

export interface Actor {
  role: 'client' | 'team' | 'driver' | 'admin' | 'system';
  name: string;
}

export interface Customer {
  name: string;
  phone: string;
  email: string;
  consentAt: string | null;
}

export interface ReservationItem {
  kind: 'rental' | 'service';
  /** variantId or serviceId. */
  refId: Id;
  quantity: number;
  unitPrice: Grosze | null;
  lineTotal: Grosze | null;
}

export interface ManualAmount {
  amount: Grosze;
  by: string;
  at: string;
  reason: string;
}

export interface HistoryEntry {
  at: string;
  by: string;
  text: string;
}

export interface Reservation extends Versioned {
  number: string;
  createdAt: string;
  source: 'shop' | 'manual';
  channelId: Id | null;
  statusId: Id;
  customer: Customer;
  mode: RentalMode;
  startDate: ISODate;
  startMinute: Minutes;
  endDate: ISODate;
  endMinute: Minutes;
  items: ReservationItem[];
  total: Grosze;
  priceStatus: 'final' | 'toBeAgreed';
  toBeAgreed: string[];
  calcVersion: string;
  manualAmount: ManualAmount | null;
  notes: string;
  history: HistoryEntry[];
  idempotencyKey: string | null;
}

/** A booking that did not happen because stock was missing or the day was closed. Anonymous. */
export interface LostDemand extends Versioned {
  at: string;
  source: 'shop' | 'manual';
  reason: 'unavailable' | 'closed' | 'other';
  mode: RentalMode;
  startDate: ISODate;
  endDate: ISODate;
  startMinute: Minutes | null;
  endMinute: Minutes | null;
  variantId: Id | null;
  productId: Id | null;
  requested: number;
  free: number;
  missing: number;
  estimatedValue: Grosze | null;
  sessionKey: string | null;
  note: string;
  createdBy: string;
}

export interface AuditEntry {
  id: Id;
  tenantId: Id;
  at: string;
  actor: Actor;
  entity: string;
  entityId: Id;
  action: 'create' | 'update' | 'delete';
  summary: string;
  before: unknown;
  after: unknown;
}
