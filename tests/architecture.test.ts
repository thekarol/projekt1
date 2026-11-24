import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { loadSeed } from './helpers.ts';

const dir = (path: string): string[] =>
  readdirSync(new URL(path, import.meta.url)).filter((f) => f.endsWith('.ts'));
const importsOf = (path: string): string[] => {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  return [...text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
};

describe('architektura', () => {
  it('core importuje wyłącznie pliki z core', () => {
    const files = dir('../src/core/');
    assert.ok(files.length >= 7);
    for (const file of files) {
      for (const spec of importsOf(`../src/core/${file}`)) {
        assert.match(spec, /^\.\/[a-z]+\.ts$/, `${file} importuje ${spec}`);
      }
    }
  });
  it('data importuje tylko z core i z data, bez dostępu do plików i sieci', () => {
    for (const file of dir('../src/data/')) {
      for (const spec of importsOf(`../src/data/${file}`)) {
        assert.match(spec, /^(\.\.\/core\/[a-z]+\.ts|\.\/[a-z]+\.ts)$/, `${file} importuje ${spec}`);
      }
    }
  });
  it('silniki nie czytają zegara ani losowości', () => {
    for (const file of ['pricing.ts', 'availability.ts', 'calendar.ts', 'validate.ts', 'money.ts']) {
      const text = readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8');
      assert.ok(!/Date\.now|new Date\(|Math\.random/.test(text), `${file} używa zegara lub losowości`);
    }
  });
  it('dostępność nie jest nigdzie zapisana jako licznik', () => {
    const seed = loadSeed();
    const forbidden = /^(available|availability|free|booked|reserved|quantity|count|inStock)$/i;
    for (const collection of ['products', 'variants', 'units'] as const) {
      for (const record of seed.catalog[collection]) {
        for (const key of Object.keys(record)) assert.ok(!forbidden.test(key), `${collection}.${key}`);
      }
    }
    const types = readFileSync(new URL('../src/core/types.ts', import.meta.url), 'utf8');
    const variant = /export interface Variant[^}]+}/.exec(types)![0];
    assert.ok(!/quantity|stock|available/i.test(variant), 'Variant ma pole z liczbą sztuk');
  });
  it('silniki nie zawierają nazw modeli, taryf ani kwot SKY BIKE', () => {
    for (const file of dir('../src/core/')) {
      const text = readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8');
      assert.ok(!/skybike|sky bike|cannondale|ktm|e-fine|bazowy|wolne terminy|duży popyt|szczyrk/i.test(text), `${file} zawiera dane najemcy`);
    }
  });
});
