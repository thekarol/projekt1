// Money is kept in integer grosze. Rounding happens once, where a rule says so.

import type { Grosze } from './types.ts';

/** Rounds to the nearest multiple of `unit`, halves away from zero. */
export function roundHalfUp(value: number, unit: number = 1): number {
  if (unit <= 0) throw new RangeError('Rounding unit must be positive');
  const scaled = value / unit;
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5 + 1e-9) : -Math.floor(-scaled + 0.5 + 1e-9);
  return rounded * unit;
}

export function percentOf(amount: Grosze, percent: number): Grosze {
  return roundHalfUp((amount * percent) / 100, 1);
}

export function formatMoney(amount: Grosze, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
}
