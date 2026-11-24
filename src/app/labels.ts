// Polish wording for dates, money, pricing methods and refusal reasons.
// Tariff names never appear here: the customer sees prices and differences only.

import type { Problem } from '../core/availability.ts';
import type { PricingMethod, ToBeAgreedCode } from '../core/pricing.ts';
import { daysBetweenInclusive, formatTime, weekday } from '../core/time.ts';
import type { Catalog, Grosze, Id, ISODate, Minutes, RentalMode } from '../core/types.ts';

export const WEEKDAYS_SHORT = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz'];
export const WEEKDAYS_LONG = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
export const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
export const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

const dm = (date: ISODate): string => `${Number(date.slice(8))}.${date.slice(5, 7)}`;

/** "pt 11.06.2027" */
export function formatDate(date: ISODate): string {
  return `${WEEKDAYS_SHORT[weekday(date) - 1]} ${dm(date)}.${date.slice(0, 4)}`;
}

/** "pt 11.06" */
export function formatDay(date: ISODate): string {
  return `${WEEKDAYS_SHORT[weekday(date) - 1]} ${dm(date)}`;
}

/** "11 czerwca 2027" */
export function formatDateLong(date: ISODate): string {
  return `${Number(date.slice(8))} ${MONTHS_GENITIVE[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

export function daysWord(n: number): string {
  return n === 1 ? '1 dzień' : `${n} dni`;
}

export function formatTerm(term: {
  mode: RentalMode;
  startDate: ISODate;
  endDate: ISODate;
  startMinute?: Minutes | null;
  endMinute?: Minutes | null;
}): string {
  if (term.mode === 'hours') {
    return `${formatDate(term.startDate)} · ${formatTime(term.startMinute ?? 0)}–${formatTime(term.endMinute ?? 0)}`;
  }
  const n = daysBetweenInclusive(term.startDate, term.endDate);
  return n === 1
    ? `${formatDate(term.startDate)} · 1 dzień`
    : `${formatDay(term.startDate)} – ${formatDate(term.endDate)} · ${daysWord(n)}`;
}

const nbsp = ' ';

/** "1 940,00 zł" */
export function money(amount: Grosze): string {
  const sign = amount < 0 ? '−' : '';
  const abs = Math.abs(amount);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')}${nbsp}zł`;
}

/** "450 zł", grosze only when present */
export function moneyShort(amount: Grosze): string {
  return amount % 100 === 0 ? money(amount).replace(',00', '') : money(amount);
}

/** "+20 zł" / "−20 zł" */
export function moneyDelta(amount: Grosze): string {
  return (amount > 0 ? '+' : '') + moneyShort(amount);
}

export function methodLabel(method: PricingMethod): string {
  switch (method.code) {
    case 'short':
      return `Do ${method.maxHours} h`;
    case 'dayByHours':
      return 'Cena dnia';
    case 'day':
      return '1 dzień';
    case 'package':
      return `Pakiet ${method.days} dni`;
    default:
      return 'Do ustalenia';
  }
}

export function variantName(catalog: Catalog, variantId: Id): string {
  const variant = catalog.variants.find((v) => v.id === variantId);
  const product = variant && catalog.products.find((p) => p.id === variant.productId);
  if (!variant || !product) return variantId;
  return `${product.name} · rozmiar ${variant.label}`;
}

export function serviceName(catalog: Catalog, serviceId: Id): string {
  return catalog.services.find((s) => s.id === serviceId)?.name ?? serviceId;
}

export function statusName(catalog: Catalog, statusId: Id): string {
  return catalog.statuses.find((s) => s.id === statusId)?.name ?? statusId;
}

export function toBeAgreedText(catalog: Catalog, code: ToBeAgreedCode | string, refId: Id | null): string {
  switch (code) {
    case 'longerThanPackages':
      return `${variantName(catalog, refId ?? '')}: cena dłuższego pobytu`;
    case 'noPackageForLength':
      return `${variantName(catalog, refId ?? '')}: cena dla tej liczby dni`;
    case 'missingRate':
      return `${variantName(catalog, refId ?? '')}: cena w tym terminie`;
    case 'serviceQuote':
      return `${serviceName(catalog, refId ?? '')}: wycena indywidualna`;
    case 'deliveryOverVehicleLimit':
      return `${serviceName(catalog, refId ?? '')}: liczba kursów przy tylu rowerach`;
    case 'groupDiscount':
      return 'Rabat grupowy: potwierdzimy ostateczną kwotę';
    case 'individualTerms':
      return 'Indywidualne warunki';
    default:
      return String(code);
  }
}

export function problemText(catalog: Catalog, problem: Problem): string {
  switch (problem.code) {
    case 'invalidDates':
      return 'Wybierz poprawny termin.';
    case 'tooLong':
      return `Najem może trwać najwyżej ${problem.maxDays} dni.`;
    case 'hoursSingleDate':
      return 'Najem godzinowy obejmuje jeden dzień.';
    case 'hoursRange':
      return `Wybierz od ${problem.minHours} do ${problem.maxHours} godzin.`;
    case 'hoursStep':
      return `Godziny wybiera się co ${problem.stepMinutes} minut.`;
    case 'outsideHours':
      return `Punkt jest czynny ${formatTime(problem.open)}–${formatTime(problem.close)}. Najem musi się zmieścić w tych godzinach.`;
    case 'closed':
      return `W tym terminie punkt jest nieczynny: ${problem.dates.map(formatDay).join(', ')}.`;
    case 'past':
      return 'Ten termin już minął.';
    case 'sameDayClosed':
      return problem.until === null
        ? 'Najem na cały dzień zaczyna się najwcześniej jutro. Na dziś wybierz godziny.'
        : `Najem na cały dzień na dziś przyjmujemy do ${formatTime(problem.until)}. Wybierz godziny albo inny dzień.`;
    case 'empty':
      return 'Koszyk jest pusty.';
    case 'invalidQuantity':
      return 'Podaj liczbę sztuk.';
    case 'unknownVariant':
      return 'Ten rower nie jest już w ofercie.';
    case 'unknownService':
      return 'Ta usługa nie jest już w ofercie.';
    case 'overOrderLimit':
      return `Powyżej ${problem.limit} sztuk skontaktuj się z nami bezpośrednio.`;
    case 'overProductLimit':
      return `Jednego modelu można zamówić najwyżej ${problem.limit} sztuk.`;
    case 'shortage':
      return `${variantName(catalog, problem.variantId)}: w tym terminie wolne: ${problem.free}.`;
    case 'serviceShortage':
      return `${serviceName(catalog, problem.serviceId)}: w tym terminie wolne: ${problem.free}.`;
  }
}
