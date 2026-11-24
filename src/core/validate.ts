// Checks a catalog for broken references and gaps before the engines use it.

import type { Catalog } from './types.ts';
import { isValidDate } from './time.ts';

export interface CatalogCheck {
  errors: string[];
  warnings: string[];
}

export function validateCatalog(catalog: Catalog): CatalogCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tenantId = catalog.tenant.id;
  const ids = <T extends { id: string }>(list: T[]): Set<string> => new Set(list.map((x) => x.id));

  const collections: Array<[string, Array<{ tenantId: string }>]> = [
    ['bands', catalog.bands],
    ['tariffs', catalog.tariffs],
    ['rates', catalog.rates],
    ['dateExceptions', catalog.dateExceptions],
    ['openingRules', catalog.openingRules],
    ['products', catalog.products],
    ['variants', catalog.variants],
    ['units', catalog.units],
    ['unitOutages', catalog.unitOutages],
    ['serviceCategories', catalog.serviceCategories],
    ['services', catalog.services],
    ['statuses', catalog.statuses],
    ['channels', catalog.channels],
    ['content', catalog.content],
    ['users', catalog.users],
  ];
  for (const [name, list] of collections) {
    if (list.some((record) => record.tenantId !== tenantId)) errors.push(`${name}: record of another tenant`);
  }
  if (catalog.settings.tenantId !== tenantId) errors.push('settings: wrong tenant');

  const bases = catalog.tariffs.filter((t) => t.isBase && t.active);
  if (bases.length !== 1) errors.push(`tariffs: expected exactly one active base tariff, found ${bases.length}`);
  if (catalog.bands.filter((b) => b.kind === 'day').length !== 1) errors.push('bands: expected exactly one day band');
  for (const band of catalog.bands) {
    if (band.kind === 'hours' && !(band.maxHours && band.maxHours > 0)) errors.push(`band ${band.id}: maxHours missing`);
    if (band.kind === 'days' && !(band.days && band.days > 1)) errors.push(`band ${band.id}: days must be above 1`);
  }

  const bandIds = ids(catalog.bands);
  const tariffIds = ids(catalog.tariffs);
  const productIds = ids(catalog.products);
  const variantIds = ids(catalog.variants);
  const unitIds = ids(catalog.units);
  const categoryIds = ids(catalog.serviceCategories);

  for (const rate of catalog.rates) {
    if (!tariffIds.has(rate.tariffId) || !variantIds.has(rate.variantId) || !bandIds.has(rate.bandId)) {
      errors.push(`rate ${rate.tariffId}/${rate.variantId}/${rate.bandId}: broken reference`);
    }
    if (!Number.isInteger(rate.amount) || rate.amount < 0) errors.push('rate: amount must be whole grosze');
  }
  for (const variant of catalog.variants) {
    if (!productIds.has(variant.productId)) errors.push(`variant ${variant.id}: unknown product`);
  }
  const codes = new Set<string>();
  for (const unit of catalog.units) {
    if (!variantIds.has(unit.variantId)) errors.push(`unit ${unit.code}: unknown variant`);
    if (codes.has(unit.code)) errors.push(`unit ${unit.code}: code is not unique`);
    codes.add(unit.code);
    for (const date of [unit.activeFrom, unit.retiredFrom]) {
      if (date !== null && !isValidDate(date)) errors.push(`unit ${unit.code}: invalid date`);
    }
  }
  for (const outage of catalog.unitOutages) {
    if (!unitIds.has(outage.unitId)) errors.push(`outage ${outage.id}: unknown unit`);
    if (!isValidDate(outage.from) || !isValidDate(outage.to) || outage.from > outage.to) {
      errors.push(`outage ${outage.id}: invalid dates`);
    }
  }
  for (const exception of catalog.dateExceptions) {
    if (!isValidDate(exception.from) || !isValidDate(exception.to) || exception.from > exception.to) {
      errors.push(`exception ${exception.id}: invalid dates`);
    }
    if (exception.action.kind === 'tariff' && !tariffIds.has(exception.action.tariffId)) {
      errors.push(`exception ${exception.id}: unknown tariff`);
    }
    if (exception.action.kind === 'customPrices') {
      for (const price of exception.action.prices) {
        if (!variantIds.has(price.variantId) || !bandIds.has(price.bandId)) {
          errors.push(`exception ${exception.id}: broken price reference`);
        }
      }
    }
  }
  for (const service of catalog.services) {
    if (!categoryIds.has(service.categoryId)) errors.push(`service ${service.id}: unknown category`);
    if (service.billing !== 'quote' && service.price === null) {
      warnings.push(`service ${service.id}: no price, will be "to be agreed"`);
    }
  }
  if (!catalog.statuses.some((s) => s.isInitial)) errors.push('statuses: no initial status');

  for (const tariff of catalog.tariffs.filter((t) => t.active)) {
    for (const variant of catalog.variants.filter((v) => v.active)) {
      for (const band of catalog.bands) {
        const found = catalog.rates.some(
          (r) => r.tariffId === tariff.id && r.variantId === variant.id && r.bandId === band.id,
        );
        if (!found) warnings.push(`no rate: ${tariff.name} / ${variant.id} / ${band.label}`);
      }
    }
  }
  return { errors, warnings };
}
