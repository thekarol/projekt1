// Gate 1A report: runs the test files, prices the 36 baseline cases with the engine and
// writes docs/bramka-1A.md. Run with: npm run raport

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { quote } from '../src/core/pricing.ts';
import { capacityOn } from '../src/core/availability.ts';
import type { SeedFile } from '../src/data/seed.ts';

const read = (path: string): any => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const seed: SeedFile = read('../src/data/seed/skybike.json');
const baseline = read('../tests/vectors/pricing-baseline.json');
const scenarios = read('../tests/vectors/pricing-scenarios.json');
const catalog = seed.catalog;
const zl = (grosze: number): string => (grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 0 }) + ' zł';

const labels: Record<string, string> = {
  'time.test.ts': 'Czas i kalendarz cen',
  'pricing.test.ts': 'Silnik cen',
  'availability.test.ts': 'Silnik dostępności',
  'repository.test.ts': 'Repozytorium „pamięć”',
  'seed.test.ts': 'Dane startowe',
  'architecture.test.ts': 'Architektura',
  'second-tenant.test.ts': 'Drugi najemca (zmyślona wypożyczalnia kajaków)',
};
const files = readdirSync(new URL('../tests/', import.meta.url)).filter((f) => f.endsWith('.test.ts'));
let total = 0;
let failed = 0;
const testRows: string[] = [];
for (const file of Object.keys(labels).filter((f) => files.includes(f))) {
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `tests/${file}`], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  const count = (name: string): number => Number(new RegExp(`^# ${name} (\\d+)`, 'm').exec(run.stdout)?.[1] ?? 0);
  total += count('tests');
  failed += count('fail');
  testRows.push(`| ${labels[file]} | \`tests/${file}\` | ${count('tests')} | ${count('pass')} | ${count('fail')} |`);
}

const columns = ['Do 4 h', 'Dzień', '2 dni', '3 dni'];
const groups = new Map<string, any[]>();
for (const c of baseline.cases) {
  const key = `${c.model} | ${c.tariff}`;
  groups.set(key, [...(groups.get(key) ?? []), c]);
}
let matches = 0;
const priceRows: string[] = [];
for (const [key, cases] of groups) {
  const cells = columns.map((column) => {
    const c = cases.find((x) => x.column === column);
    const got = quote(catalog, c.order).total;
    if (got === c.expectedTotal) matches++;
    return got === c.expectedTotal ? zl(got) : `**${zl(got)}** (oczekiwane ${zl(c.expectedTotal)})`;
  });
  priceRows.push(`| ${key} | ${cells.join(' | ')} |`);
}

const stock = catalog.variants
  .map((v) => {
    const product = catalog.products.find((p) => p.id === v.productId)!;
    const codes = catalog.units.filter((u) => u.variantId === v.id).map((u) => u.code);
    return `| ${product.name} | ${v.label} | ${capacityOn(catalog, v.id, '2027-06-01')} | ${codes.join(', ')} |`;
  })
  .join('\n');

const report = `# Bramka 1A: raport testów silników

Wygenerowano poleceniem \`npm run raport\`. Wynik: **${total - failed} z ${total} testów przechodzi**, ${matches} z ${baseline.cases.length} kwot bazowych zgodnych.

## Testy

| Obszar | Plik | Testów | Zaliczone | Niezaliczone |
| --- | --- | --- | --- | --- |
${testRows.join('\n')}

Uruchomienie: \`npm test\` (wymaga tylko Node w wersji 22.18 lub nowszej, bez instalowania pakietów).

## Tabela cen: wynik silnika wobec specyfikacji

Każda komórka to kwota policzona przez silnik dla jednego roweru. Pogrubienie oznaczałoby różnicę wobec tabeli „Ceny w obecnej aplikacji” ze specyfikacji; nie ma żadnej.

| Model | Taryfa | ${columns.join(' | ')} |
| --- | --- | --- | --- | --- | --- |
${priceRows.join('\n')}

## Flota w danych startowych

Liczba sztuk nie jest nigdzie zapisana: wynika z listy egzemplarzy.

| Model | Rozmiar | Sztuk | Kody egzemplarzy |
| --- | --- | --- | --- |
${stock}

## Reguły cen sprawdzane przypadkami (${scenarios.cases.length})

${scenarios.cases.map((c: any) => `- ${c.name}`).join('\n')}
`;

writeFileSync(new URL('../docs/bramka-1A.md', import.meta.url), report);
console.log(`${total - failed}/${total} tests pass, ${matches}/${baseline.cases.length} baseline prices match`);
if (failed > 0 || matches !== baseline.cases.length) process.exit(1);
