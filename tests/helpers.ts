import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Catalog, Id, OrderInput } from '../src/core/types.ts';
import { subsetDiff } from '../src/app/vectors.ts';
import type { SeedFile } from '../src/data/seed.ts';

export const readJson = <T = any>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

export function loadSeed(): SeedFile {
  return readJson<SeedFile>('../src/data/seed/skybike.json');
}

export function seedCatalog(): Catalog {
  return loadSeed().catalog;
}

export { applyPatch, makeReservation } from '../src/app/vectors.ts';
export type { CatalogPatch } from '../src/app/vectors.ts';

/** Asserts that every field listed in `expected` has that value in `actual`. Arrays must match in length. */
export function assertSubset(actual: any, expected: any): void {
  const diff = subsetDiff(actual, expected);
  assert.equal(diff, null, diff ?? '');
}

export const days = (startDate: string, endDate: string, items: Array<[Id, number]>): OrderInput => ({
  mode: 'days',
  startDate,
  endDate,
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
  services: [],
});

export const hours = (date: string, from: number, to: number, items: Array<[Id, number]>): OrderInput => ({
  mode: 'hours',
  startDate: date,
  endDate: date,
  startMinute: from * 60,
  endMinute: to * 60,
  items: items.map(([variantId, quantity]) => ({ variantId, quantity })),
  services: [],
});
