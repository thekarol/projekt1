import { useMemo } from 'react';
import { runSelfCheck } from '../app/vectors.ts';
import { CALC_VERSION } from '../core/pricing.ts';
import { useApp } from './store.tsx';
import { Icon, Notice, Sketch } from './widgets.tsx';

const WORKS = [
  'Sklep: ceny i wolne sztuki liczone na żywo z cennika, floty i zgłoszeń.',
  'Kalendarz: stany dni i różnica ceny względem ceny standardowej.',
  'Koszyk: kilka rowerów i rozmiarów naraz, wyposażenie, dowóz, podsumowanie zgodne z silnikiem cen.',
  'Wysłanie rezerwacji: ponowne sprawdzenie dostępności i zapis w jednym kroku, numer zgłoszenia.',
  'Panel administratora: oferta, egzemplarze, cennik, taryfy, wyjątki dat, godziny, usługi, statusy, treści.',
  'Zgłoszenia: zmiana statusu od razu blokuje albo zwalnia sprzęt.',
  'Nieudane rezerwacje: zapisywane automatycznie przy odmowie i ręcznie przez zespół.',
];

const SKETCHES = [
  ['Płatność online', 'Ekran płatności niczego nie pobiera. Prawdziwy operator płatności dojdzie w Fazie 3.'],
  ['E-mail z potwierdzeniem', 'Widzisz treść wiadomości, ale nic nie jest wysyłane.'],
  ['Logowanie zespołu', 'Role przełącza się w pasku u góry. Konta i hasła powstaną przy wdrożeniu.'],
  ['Trwałość danych', 'Dane żyją w pamięci tej karty przeglądarki. Odświeżenie strony przywraca dane startowe.'],
  ['Zdjęcia', 'W panelu wpisuje się nazwę pliku. Wgrywanie zdjęć dojdzie z bazą danych.'],
];

const LATER = [
  'Faza 2: pełny panel zgłoszeń z kalendarzem i filtrami, ręczne zgłoszenia, dowozy i panel kierowcy, analiza modeli i kanałów.',
  'Faza 3: prawdziwe płatności i artykuły.',
  'Faza 4: koszty, symulacje i zysk.',
];

export function AboutPage() {
  const app = useApp();
  const results = useMemo(() => runSelfCheck(app.catalog, app.vectors), [app.catalog, app.vectors]);
  const groups = [...new Set(results.map((r) => r.group))];
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="ra-wrap ra-panel">
      <div className="ra-stack" style={{ gap: 8 }}>
        <h1>O pokazie</h1>
        <p className="ra-muted">To wersja pokazowa na przykładowych danych. Służy do sprawdzenia zasad i wyglądu przed wdrożeniem. Osoby w zgłoszeniach są fikcyjne.</p>
      </div>

      <section className="ra-two">
        <div className="ra-card ra-stack">
          <h2>Co działa naprawdę</h2>
          <ul className="ra-ticks">
            {WORKS.map((text) => (
              <li key={text}><Icon name="check" /><span>{text}</span></li>
            ))}
          </ul>
        </div>
        <div className="ra-card ra-stack">
          <h2>Co jest szkicem</h2>
          <ul className="ra-ticks">
            {SKETCHES.map(([name, text]) => (
              <li key={name}><Sketch /><span><strong>{name}.</strong> {text}</span></li>
            ))}
          </ul>
          <h3>Czego jeszcze nie ma</h3>
          <ul className="ra-small ra-muted" style={{ margin: 0, paddingLeft: 18 }}>
            {LATER.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
      </section>

      <section className="ra-stack" data-testid="selfcheck">
        <div className="ra-stack" style={{ gap: 4 }}>
          <h2>Testy silników na żywo</h2>
          <p className="ra-muted ra-small">Te same przypadki, które sprawdzają kod przy każdej zmianie, uruchomione teraz w Twojej przeglądarce na bieżącym cenniku i flocie. Wersja obliczeń: {CALC_VERSION}.</p>
        </div>
        {failed.length === 0 ? (
          <Notice kind="note"><strong data-testid="selfcheck-summary">Wszystkie testy przeszły: {results.length} z {results.length}.</strong></Notice>
        ) : (
          <Notice kind="warn">
            <strong data-testid="selfcheck-summary">Przeszło {results.length - failed.length} z {results.length}.</strong> Testy tabeli bazowej porównują wynik z cenami startowymi SKY BIKE, więc po zmianie cennika w panelu część z nich pokaże różnicę. To oczekiwane; „Przywróć dane startowe” w pasku u góry cofa zmiany.
          </Notice>
        )}
        {groups.map((group) => {
          const list = results.filter((r) => r.group === group);
          const bad = list.filter((r) => !r.ok);
          return (
            <details key={group} className="ra-card" open={bad.length > 0}>
              <summary><strong>{group}</strong> · {list.length - bad.length} z {list.length}</summary>
              <ul className="ra-ticks ra-small" style={{ marginTop: 12 }}>
                {list.map((r) => (
                  <li key={r.name}>
                    {r.ok ? <Icon name="check" size={16} /> : <Icon name="warn" size={16} />}
                    <span>{r.ok ? 'zgodny' : 'różnica'}: {r.name}{r.detail ? <span className="ra-muted"> ({r.detail})</span> : null}</span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </section>
    </div>
  );
}
