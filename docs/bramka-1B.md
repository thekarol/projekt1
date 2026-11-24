# Bramka 1B: widoki pokazu

Stan na 24.11.2026. Gałąź `faza-1b-widoki`.

## Co działa

- **Strona główna i sklep.** Kafelki budują się z oferty w panelu (widoczne pola kafelka są ustawieniem produktu). Bez wybranego terminu kafelek pokazuje cenę i wolne sztuki najbliższego wolnego dnia z podpisem; po wyborze terminu przelicza się od razu. Nigdzie nie ma „od X zł” ani nazw taryf.
- **Kalendarz.** Stany dnia: wolny, ostatnie sztuki, częściowo wolny, brak, zamknięte, miniony; plakietka różnicy ceny dnia względem ceny standardowej; zdanie o zmianie ceny, gdy termin obejmuje dni w różnych cenach. Plakietka liczy się dla zawartości koszyka albo oglądanego roweru. Najem dniowy na dziś zamyka się o godzinie ustawionej w panelu.
- **Koszyk.** Wiele rowerów i rozmiarów naraz, najem na dni albo godziny, wyposażenie jako osobne pozycje, dowóz, serwis, adres przy usługach, które go wymagają. Podsumowanie pokazuje cenę standardową, różnicę terminu, usługi, rabat grupowy i sumę; „do ustalenia” jest oznaczone i wyłącza płatność.
- **Wysłanie rezerwacji.** Dostępność jest sprawdzana ponownie i zapis następuje w jednym kroku; klient dostaje numer, podgląd maila i (przy cenie pewnej i włączonych płatnościach) szkic płatności.
- **Panel administratora.** Oferta: produkty, rozmiary, egzemplarze z kodami i datami zakupu oraz wycofania, wyłączenia do serwisu, historia zmian. Cennik: siatka stawek na taryfę, cena dla wszystkich rozmiarów naraz z potwierdzeniem przy nadpisywaniu ceny ręcznej, nowa taryfa wypełniana z Bazowej o procent lub kwotę, progi cennika, wyjątki dat (taryfa, własne kwoty, zamknięte). Treści: nagłówek, sekcje, pytania. Ustawienia: rabat grupowy, limit auta, godzina graniczna, najem godzinowy, limity, płatności, godziny działania, statusy z „blokuje sprzęt”, kanały, kategorie usług i usługi, użytkownicy.
- **Ostrzeżenia zamiast automatów.** Zmiana, która zostawia więcej rezerwacji niż sztuk albo zamyka dzień z istniejącymi zgłoszeniami, pokazuje listę dat i numerów i wymaga „Zapisz mimo to”. Nic nie jest anulowane samo. Cennik ostrzega, gdy rozmiar nie ma cen w którejś taryfie; w dniach taryfy sezonowej obowiązuje wtedy cena z Bazowej.
- **Zgłoszenia (wersja prosta).** Lista z rodzajem zgłoszenia, kwotą i zmianą statusu, która od razu zwalnia albo blokuje sprzęt. Lista nieudanych rezerwacji: wpisy automatyczne z odmowy w sklepie i koszyku oraz ręczne.
- **Pokaz.** Pasek pokazu na każdym widoku, przełącznik roli (uprawnienia sprawdzane w kodzie, nie przez ukrycie przycisków), „Przywróć dane startowe”, strona „O pokazie” z listą szkiców i testami silników uruchamianymi w przeglądarce na bieżących danych.

## Jak to sprawdzić

| Co | Jak | Wynik |
| --- | --- | --- |
| Silniki, repozytorium, architektura | `npm test` | 237 z 237 |
| Kryteria bramki w przeglądarce | `npm run build && npm run e2e` | 36 z 36 |
| Typy (silniki, dane, warstwa app, testy) | `npm run typecheck` | bez błędów |
| Testy silników na żywo | strona „O pokazie” w pokazie | 84 z 84 na danych startowych |

Scenariusz przeglądarkowy (`tests-e2e/scenario.mjs`) przechodzi po kolei: dwa rozmiary jednego roweru w jednym koszyku; termin na granicy taryf (suma równa wynikowi silnika, plakietka różnicy, zdanie o zmianie ceny, brak nazw taryf); wyposażenie i dowóz; wysłanie i treść maila; blokadę sprzętu po rezerwacji i zapis odmowy; zwolnienie sprzętu po anulowaniu; brak dostępu zespołu do oferty; zmianę ceny w panelu z potwierdzeniem nadpisania; ostrzeżenie przy zmniejszeniu stanu; nowy produkt założony w panelu i od razu dostępny w sklepie; status bez „blokuje sprzęt”; wyłączenie płatności; grupę 4 rowerów jako „do ustalenia”; przywrócenie danych; całą ścieżkę rezerwacji samą klawiaturą.

Wygląd sprawdzony przy 1280, 900 i 390 px: brak poziomego przewijania strony, elementy dotykowe na telefonie mają co najmniej 44 px (poza paskiem pokazu, który z założenia jest cienki), kontrast tekstów od 5,6:1 wzwyż.

## Czego nie zrobiono

- Dane żyją w pamięci karty przeglądarki: odświeżenie strony przywraca dane startowe. Baza danych i serwer to etap wdrożenia.
- Płatność, e-mail i logowanie są szkicami.
- Zdjęcia: w panelu wpisuje się nazwę pliku; wgrywania plików nie ma.
- Zgłoszenia mają tylko prostą listę. Kalendarz zgłoszeń, filtry, szczegóły, ręczne dodawanie zgłoszenia, korekta kwoty w widoku, dowozy, panel kierowcy i analiza to Faza 2.
- Edycja danych firmy (nazwa, adres, prefiks numerów) i słownika nie ma jeszcze ekranu.
- Widoki nie przechodzą kontroli typów (brak pakietu typów Reacta w środowisku budowania); pilnuje ich scenariusz przeglądarkowy.
- Scenariusz przeglądarkowy używa dat z czerwca 2027 i zakłada dzisiejszą datę sprzed tego terminu.
- Zrzuty kontrolne powstały bez dostępu do Google Fonts, więc pokazują krój zastępczy; opublikowany pokaz ładuje Jost.

## Odpowiedzi właściciela z 24.11.2026 (po raporcie)

1. Rozmiar bez ceny w taryfie sezonowej dostaje cenę z Bazowej (wdrożone w silniku cen, z testami). Brak ceny także w Bazowej nadal oznacza „do ustalenia”.
2. Faza 2: kierowca widzi imię, telefon i adres klienta; bez e-maila i kwot.
3. Faza 2: statusy dowozu to lista edytowalna w panelu, startowo: Zgłoszenie (przed zatwierdzeniem), Zaplanowany, W drodze, Dostarczony, Odebrany od klienta.
4. Faza 2: przy wydaniu zespół może opcjonalnie zaznaczyć kody wydanych egzemplarzy.

## Pytania otwarte

- Zdjęcia w nagłówku i na kafelkach: czy mamy prawa do użycia ich także po wdrożeniu?
