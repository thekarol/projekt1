import type { Catalog, Id, OrderInput } from '../core/types.ts';

export interface SeedReservation {
  number: string;
  createdAt: string;
  source: 'shop' | 'manual';
  channelId: Id | null;
  statusId: Id;
  customer: { name: string; phone: string; email: string };
  order: OrderInput;
  notes: string;
}

/** Demo data: a catalog and a few sample reservations with invented people. */
export interface SeedFile {
  catalog: Catalog;
  reservations: SeedReservation[];
}
