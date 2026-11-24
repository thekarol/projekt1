// Browser walk-through of the gate 1B acceptance criteria. Run: node tests-e2e/scenario.mjs
// Needs the built bundle (node scripts/build.ts), Playwright and Chrome.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { quote } from '../src/core/pricing.ts';

const seed = JSON.parse(readFileSync(new URL('../src/data/seed/skybike.json', import.meta.url), 'utf8'));
const base = new URL('../dist/index.html', import.meta.url).href;
const zl = (grosze) => (grosze / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' zł';
const norm = (text) => text.replace(/ | /g, ' ').replace(/\s+/g, ' ').trim();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok || !detail ? '' : ' :: ' + detail}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/fonts.g*/**', (r) => r.abort());

const role = (name) => page.selectOption('[data-testid=role]', name);
const go = async (view) => {
  await page.evaluate((v) => { location.hash = v; }, view);
  await page.waitForTimeout(150);
};
const card = (name) => page.locator('[data-product]').filter({ hasText: name });
const size = (name, label) => card(name).locator('.ra-size').filter({ has: page.locator('strong', { hasText: new RegExp(`^${label}$`) }) });
const toMonth = async (label) => {
  for (let i = 0; i < 14; i++) {
    if (norm(await page.locator('.ra-cal-head strong').first().innerText()) === label) return;
    await page.locator('.ra-cal-head button[aria-label="Następny miesiąc"]').first().click();
  }
  throw new Error('month not found: ' + label);
};
const pickTerm = async (from, to) => {
  await toMonth('czerwiec 2027');
  await page.locator(`.ra-day[data-date="${from}"]`).first().click();
  if (to !== from) await page.locator(`.ra-day[data-date="${to}"]`).first().click();
};

await page.goto(base);
await page.waitForSelector('[data-product]');

// 1. Two sizes of one bike with different quantities in one cart
await size('NS Bikes', 'S').click();
await card('NS Bikes').getByRole('button', { name: 'Dodaj do koszyka' }).click();
await size('NS Bikes', 'M').click();
await card('NS Bikes').getByRole('button', { name: 'Więcej' }).click();
await card('NS Bikes').getByRole('button', { name: 'Dodaj do koszyka' }).click();
check('koszyk: S × 1 i M × 2 tego samego roweru', norm(await page.locator('[data-testid=cartlink] .ra-count').innerText()) === '3');

// 2. Term across a tariff boundary, calendar states, summary equals engine
await go('koszyk');
await toMonth('grudzień 2026');
const closedDay = page.locator('.ra-day[data-date="2026-12-24"]').first();
const closedOk = (await closedDay.getAttribute('data-state')) === 'closed' && (await closedDay.isDisabled());
await pickTerm('2027-06-10', '2027-06-12');
const items = [{ variantId: 'ns-s', quantity: 1 }, { variantId: 'ns-m', quantity: 2 }];
let expected = quote(seed.catalog, { mode: 'days', startDate: '2027-06-10', endDate: '2027-06-12', items, services: [] });
check('podsumowanie = silnik cen (3 dni, dwie taryfy)', norm(await page.locator('[data-testid=total]').first().innerText()) === zl(expected.total), `${await page.locator('[data-testid=total]').first().innerText()} vs ${zl(expected.total)}`);
const deltaText = norm(await page.locator('.ra-day[data-date="2027-06-10"] .ra-delta').first().innerText().catch(() => ''));
check('kalendarz: plakietka różnicy ceny w dniu tańszej taryfy', /^[−-]\d+ zł$/.test(deltaText), deltaText);
check('kalendarz: dzień zamknięty wyjątkiem jest niedostępny', closedOk);
const main = norm(await page.locator('main').innerText());
check('klient nie widzi nazw taryf', !/Bazowy|Wolne terminy|Duży popyt/i.test(main));
check('koszyk: zdanie o zmianie ceny na granicy taryf', /cena|taniej|drożej/i.test(norm(await page.locator('.ra-cal').first().locator('xpath=..').innerText())));
check('podsumowanie: wiersz „Różnica terminu”', /Różnica terminu/.test(main));

// 3. Equipment and delivery
const stepper = (text) => page.locator('.ra-line').filter({ hasText: text }).getByRole('button', { name: 'Więcej' });
await stepper('Kask MTB').click();
await stepper('Kask MTB').click();
await page.getByLabel('Dowóz z odbiorem w Szczyrku').check();
await page.getByLabel(/Adres/).fill('ul. Przykładowa 1, Szczyrk');
expected = quote(seed.catalog, { mode: 'days', startDate: '2027-06-10', endDate: '2027-06-12', items, services: [{ serviceId: 'mtb', quantity: 2 }, { serviceId: 'delivery-city', quantity: 1 }] });
check('podsumowanie = silnik cen (z wyposażeniem i dowozem)', norm(await page.locator('[data-testid=total]').first().innerText()) === zl(expected.total), `${await page.locator('[data-testid=total]').first().innerText()} vs ${zl(expected.total)}`);
check('cena pewna: przycisk z płatnością', /Zarezerwuj i zapłać/.test(await page.locator('[data-testid=send]').first().innerText()));

// 4. Send: number, mail preview
await page.getByLabel(/Zgadzam się/).check();
await page.locator('[data-testid=send]').first().click();
await page.waitForSelector('[data-testid=number]');
const number = norm(await page.locator('[data-testid=number]').innerText());
check('potwierdzenie: numer zgłoszenia', /^SB-\d{4}-\d{4}$/.test(number), number);
const mail = norm(await page.locator('[data-testid=mail]').innerText());
check('potwierdzenie: mail zawiera termin, pozycje, kwotę i status', mail.includes(zl(expected.total)) && /10\.06/.test(mail) && /NS Bikes/.test(mail) && /Nowe/.test(mail), mail.slice(0, 200));
check('szkice są oznaczone', (await page.locator('.ra-sketch').count()) >= 2);

// 5. The new reservation blocks stock; refusal over stock is recorded
await go('start');
await page.getByRole('button', { name: 'Wybierz termin' }).click();
await pickTerm('2027-06-10', '2027-06-12');
await page.getByRole('button', { name: 'Gotowe' }).click();
check('sklep: po rezerwacji M × 2 wolna została 1 sztuka', /wolne 1/.test(await size('NS Bikes', 'M').innerText()), await size('NS Bikes', 'M').innerText());
await size('NS Bikes', 'M').click();
await card('NS Bikes').getByRole('button', { name: 'Więcej' }).click();
check('sklep: komunikat przy próbie ponad stan', /wolne: 1/i.test(await card('NS Bikes').innerText()));
await role('team');
await go('zgloszenia');
check('zespół: nieudana rezerwacja zapisana automatycznie', /NS Bikes E-Fine 1 · rozmiar M/.test(await page.locator('[data-testid=lost]').innerText()));

// 6. Status change frees stock
await page.locator(`tr[data-number="${number}"] select`).selectOption({ label: 'Anulowane' });
await page.waitForTimeout(200);
await go('start');
check('status „Anulowane” zwalnia sprzęt', /wolne 3/.test(await size('NS Bikes', 'M').innerText()), await size('NS Bikes', 'M').innerText());
await go('oferta');
check('zespół nie ma dostępu do oferty', /nie ma dostępu/.test(await page.locator('main').innerText()));

// 7. Admin: price change shows up in the shop; overwrite of a hand-edited price needs confirmation
await role('admin');
await go('cennik');
const cell = page.getByLabel('NS Bikes E-Fine 1 S, Dzień', { exact: false }).first();
await cell.fill('260');
await cell.blur();
await page.waitForTimeout(200);
await page.getByLabel('NS Bikes E-Fine 1, wszystkie rozmiary, Dzień').fill('270');
await page.locator('tr', { hasText: 'wszystkie rozmiary naraz' }).filter({ hasText: 'NS Bikes' }).getByRole('button', { name: 'Wpisz wszystkim' }).click();
check('cennik: nadpisanie ręcznej ceny wymaga potwierdzenia', /nadpisze 1 cenę zmienioną ręcznie/.test(await page.locator('main').innerText()));
await page.getByRole('button', { name: 'Nadpisz' }).click();
await page.waitForTimeout(200);
await page.locator('.ra-tabs button', { hasText: 'Wyjątki dat' }).click();
check('cennik: wyjątki dat widoczne', /zamknięte/.test(await page.locator('main').innerText()));

// 8. Admin: stock below future reservations warns
await go('oferta');
await page.locator('.ra-list button', { hasText: 'NS Bikes' }).click();
await page.locator('[data-crud=units] tr', { hasText: 'NS-M-01' }).getByRole('button', { name: 'Edytuj' }).click();
await page.getByLabel(/Wycofany od/).fill('2027-06-01');
await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
await page.waitForTimeout(200);
check('oferta: zmniejszenie stanu poniżej rezerwacji ostrzega', /Więcej rezerwacji niż sztuk/.test(await page.locator('dialog[open]').innerText()));
await page.getByRole('button', { name: 'Anuluj' }).click();

// 9. Admin: product text and tile fields show up in the shop
await page.locator('[data-crud=products] tr', { hasText: 'KTM' }).getByRole('button', { name: 'Edytuj' }).click();
await page.getByLabel('Nazwa', { exact: true }).fill('KTM Macina 893 Test');
await page.locator('dialog[open] .ra-chip', { hasText: 'typ' }).click();
await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
await page.waitForTimeout(200);
check('oferta: historia zmian floty', /KTM Macina 893 Test/.test(await page.locator('main section:last-of-type').innerText()));

// 9b. Admin: a brand new product with one size, one unit and prices is bookable in the shop
const dialog = page.locator('dialog[open]');
const save = async () => {
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await page.waitForTimeout(200);
};
await page.getByRole('button', { name: 'Dodaj produkt' }).click();
await dialog.getByLabel('Nazwa', { exact: true }).fill('Rower Testowy');
await dialog.getByLabel('Typ (plakietka)').fill('Gravel');
await dialog.getByLabel(/Prefiks kodów/).fill('RT');
await dialog.locator('.ra-chip', { hasText: 'zdjęcie' }).click();
await save();
await page.locator('.ra-list button', { hasText: 'Rower Testowy' }).click();
await page.getByRole('button', { name: 'Dodaj rozmiar' }).click();
await dialog.getByLabel('Rozmiar (etykieta)').fill('M');
await save();
await page.getByRole('button', { name: 'Dodaj egzemplarz' }).click();
const suggested = await dialog.getByLabel(/Kod egzemplarza/).inputValue();
await save();
await go('cennik');
check('cennik: ostrzeżenie o brakujących cenach nowego rozmiaru', /Brakuje cen/.test(await page.locator('[data-testid=missing-rates]').innerText().catch(() => '')));
// Prices go into the base tariff only; seasonal tariffs then charge the base price.
const newRow = page.locator('tr', { hasText: 'wszystkie rozmiary naraz' }).filter({ hasText: 'Rower Testowy' });
for (const input of await newRow.locator('input').all()) await input.fill('120');
await newRow.getByRole('button', { name: 'Wpisz wszystkim' }).click();
await page.waitForTimeout(200);
const missingText = await page.locator('[data-testid=missing-rates]').innerText();
check('cennik: po cenach w Bazowej ostrzeżenie zostaje tylko dla taryf sezonowych', !/Bazowy:/.test(missingText) && /Rower Testowy/.test(missingText), missingText);
await go('start');
const fresh = card('Rower Testowy');
check('nowy produkt z panelu: w sklepie z ceną z Bazowej także w dniu taryfy sezonowej, jedną sztuką i bez zdjęcia', (await fresh.count()) === 1 && /120 zł/.test(norm(await fresh.innerText())) && /wolne 1/.test(await fresh.innerText()) && (await fresh.locator('.ra-photo').count()) === 0 && suggested === 'RT-M-01', `${suggested} :: ${(await fresh.count()) ? norm(await fresh.innerText()) : 'brak kafelka'}`);

// 10. Admin: status without "blokuje sprzęt" stops blocking; payments off
await go('ustawienia');
await page.locator('[data-crud=statuses] tr', { hasText: 'Nowe' }).getByRole('button', { name: 'Edytuj' }).click();
await page.locator('dialog[open]').getByLabel(/Blokuje sprzęt/).uncheck();
await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
await page.waitForTimeout(200);
await page.locator('[data-testid=settings]').getByLabel(/Płatności online włączone/).uncheck();
await page.getByRole('button', { name: 'Zapisz reguły' }).click();
await page.waitForTimeout(200);

await role('client');
await go('start');
check('sklep: nowa cena z panelu (270 zł po pakiecie 3 dni)', await (async () => {
  const want = quote({ ...seed.catalog, rates: seed.catalog.rates.map((r) => (r.tariffId === 'standard' && r.variantId === 'ns-s' && r.bandId === 'day' ? { ...r, amount: 27000 } : r)) }, { mode: 'days', startDate: '2027-06-10', endDate: '2027-06-12', items: [{ variantId: 'ns-s', quantity: 1 }], services: [] }).lines[0].unitPrice;
  const shown = norm(await card('NS Bikes').locator('.ra-price').innerText());
  return shown === zl(want).replace(',00', '') || (console.log('   shown', shown, 'want', zl(want)), false);
})());
check('sklep: zmieniona nazwa i ukryty typ na kafelku', (await card('KTM Macina 893 Test').count()) === 1 && (await card('KTM Macina 893 Test').locator('.ra-badge').filter({ hasText: 'E-MTB' }).count()) === 0);
await page.getByRole('button', { name: 'Zmień termin' }).first().click();
await pickTerm('2027-06-13', '2027-06-13');
await page.getByRole('button', { name: 'Gotowe' }).click();
check('status bez „blokuje sprzęt” przestaje blokować (13.06, M wolne 3)', /wolne 3/.test(await size('NS Bikes', 'M').innerText()), await size('NS Bikes', 'M').innerText());
await size('NS Bikes', 'M').click();
await card('NS Bikes').getByRole('button', { name: 'Dodaj do koszyka' }).click();
await go('koszyk');
const cartText = await page.locator('main').innerText();
check('płatności wyłączone: brak płatności w koszyku', /Wyślij rezerwację/.test(cartText) && !/BLIK|zapłać/i.test(cartText));

// 11. "Do ustalenia": group of 4 bikes has no payment even with payments on
await role('admin');
await go('ustawienia');
await page.locator('[data-testid=settings]').getByLabel(/Płatności online włączone/).check();
await page.getByRole('button', { name: 'Zapisz reguły' }).click();
await page.waitForTimeout(200);
await role('client');
await go('koszyk');
check('płatności włączone: przycisk z płatnością wraca', /Zarezerwuj i zapłać/.test(await page.locator('[data-testid=send]').first().innerText()));
for (let i = 0; i < 2; i++) await page.locator('.ra-line[data-variant="ns-m"]').getByRole('button', { name: 'Więcej' }).click();
await go('start');
await size('NS Bikes', 'S').click();
await card('NS Bikes').getByRole('button', { name: 'Dodaj do koszyka' }).click();
await go('koszyk');
const group = await page.locator('main').innerText();
check('grupa 4 rowerów: rabat, „do ustalenia” i brak płatności', /Rabat grupowy/i.test(group) && /do ustalenia/i.test(group) && /Wyślij rezerwację/.test(group) && !/Zarezerwuj i zapłać/.test(group));

// 12. Live engine checks and reset
await go('o-pokazie');
check('o pokazie: testy na żywo pokazują różnicę po zmianie cennika', /Przeszło \d+ z \d+/.test(await page.locator('[data-testid=selfcheck-summary]').innerText()));
await page.locator('[data-testid=reset]').click();
await page.waitForTimeout(300);
const summary = norm(await page.locator('[data-testid=selfcheck-summary]').innerText());
check('przywrócenie danych: wszystkie testy na żywo przechodzą', /^Wszystkie testy przeszły: (\d+) z \1\.$/.test(summary), summary);
await go('start');
check('przywrócenie danych: cena i nazwa wracają', norm(await card('NS Bikes').locator('.ra-price').innerText()) === '250 zł' && (await card('KTM Macina 893 Test').count()) === 0 && (await card('Rower Testowy').count()) === 0);
check('pasek pokazu na każdym widoku', (await page.locator('.ra-demo').count()) === 1);

// 13. Keyboard only: choose a size, add to cart, pick a day, send
await page.reload();
await page.waitForSelector('[data-product]');
const tabTo = async (test, limit = 80) => {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(test)) return true;
  }
  return false;
};
let keyboard = await tabTo(() => document.activeElement?.classList.contains('ra-size'));
await page.keyboard.press('Space');
keyboard &&= await tabTo(() => document.activeElement?.textContent === 'Dodaj do koszyka');
await page.keyboard.press('Enter');
keyboard &&= norm(await page.locator('[data-testid=cartlink] .ra-count').innerText()) === '1';
await page.locator('[data-testid=cartlink]').focus();
await page.keyboard.press('Enter');
await page.waitForSelector('.ra-cal');
keyboard &&= await tabTo(() => document.activeElement?.classList.contains('ra-day') && !document.activeElement.disabled && document.activeElement.getAttribute('aria-pressed') === 'false');
await page.keyboard.press('Enter');
keyboard &&= await tabTo(() => document.activeElement?.type === 'checkbox' && /Zgadzam/.test(document.activeElement.closest('label')?.textContent ?? ''), 120);
await page.keyboard.press('Space');
keyboard &&= await tabTo(() => document.activeElement?.getAttribute('data-testid') === 'send');
await page.keyboard.press('Enter');
keyboard &&= await page.waitForSelector('[data-testid=number]', { timeout: 3000 }).then(() => true, () => false);
check('cała ścieżka rezerwacji samą klawiaturą', keyboard);

check('brak błędów JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} z ${results.length} sprawdzeń przeszło.`);
process.exit(failed ? 1 : 0);
