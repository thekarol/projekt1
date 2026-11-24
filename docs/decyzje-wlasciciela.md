# Faza 1: decyzje właściciela po akceptacji Fazy 0

Stan na 2026-11-24. Faza 0 jest zaakceptowana. Ten plik zbiera odpowiedzi właściciela z rozmowy i ma pierwszeństwo nad `faza-0/faza-0-decyzje-i-plan.md` tam, gdzie się różnią. Wygląd reguluje `faza-0/kierunek-wizualny.md`.

**Stan prac:** bramka 1A zaakceptowana („dalej”). **Bramka 1B gotowa do oceny właściciela:** działa pokaz (sklep, kalendarz, koszyk, potwierdzenie, panel administratora, prosta lista zgłoszeń, „O pokazie”). Testy: 237 z 237 (silniki, repozytorium, architektura), 36 z 36 sprawdzeń w przeglądarce, 84 z 84 testów silników na żywo w pokazie. Raport: `docs/bramka-1B.md` w repozytorium.

**Kod:** repozytorium `thekarol/projekt1`. Gałąź `faza-1a-silniki` (bramka 1A) i `faza-1b-widoki` (bramka 1B) są na GitHubie.

**Pokaz:** prywatny artefakt https://claude.ai/artifact/FNZYDq4vKCwD7Exf94rfTa (widoczny tylko dla właściciela, dopóki go nie udostępni).

## Dane oferty

- Trzy modele, ceny z `dane/dane-startowe.json` (nie z obecnej strony).
- Rozmiary: NS Bikes E-Fine 1: S 3, M 3, L 3. Cannondale Jekyll 2: M 2, L 1. KTM Macina 893: L 4.
- Dowóz z odbiorem w Szczyrku: 100 zł. Ustawienie „liczba rowerów mieszczących się w aucie przy dowozie”, wartość startowa 4. Do limitu cena pewna, powyżej „do ustalenia”. Cena i limit edytowalne w panelu.
- Trasy Komoot zostają jako pole z nazwą i linkiem (zakaz map dotyczy tylko dojazdów).

## Flota: egzemplarze, plan, historia

- **Każdy fizyczny egzemplarz ma własny kod** (nadawany automatycznie, edytowalny; w danych startowych np. `NS-M-02`, `CJ-L-01`, `KTM-L-04`). Klient nadal rezerwuje ilość w rozmiarze, nie konkretny rower.
- **Liczba sztuk rozmiaru nie jest zapisana:** to liczba jego egzemplarzy w ofercie danego dnia.
- **Plan floty:** egzemplarz może wejść do oferty od daty (zakup) i wyjść od daty (sprzedaż).
- **Wyłączenia na okres:** konkretny egzemplarz jest wyłączany do serwisu od–do i zmniejsza dostępność tylko wtedy.
- Wszystko to jest na ekranie produktów w panelu administratora, razem z **historią tych działań** (kto, kiedy, co).
- Zmiana, która daje więcej rezerwacji niż sztuk, pokazuje ostrzeżenie z datami i niczego nie anuluje.

## Reguły cen

1. **Sezony działają automatycznie po datach**, cena jest ostateczna: Wolne terminy (maj–czerwiec, pon–czw), Duży popyt (wrzesień–październik), w pozostałych dniach Bazowy.
2. **Wyjątki dat mają pierwszeństwo nad sezonami.** Wyjątek to data lub zakres oraz jedno działanie: przypisana taryfa, własne kwoty dla progów albo „zamknięte”.
3. **Progi cennika są ustawieniem w panelu:** najem godzinowy do N godzin (start: 4, powyżej cena dnia), pakiety dni (start: 2 i 3), powyżej najdłuższego pakietu „do ustalenia”.
4. **Taryfy są definiowalne w panelu:** nazwa wewnętrzna, tabela cen dla progów i wariantów, sezon (miesiące, dni tygodnia).
5. **Rozmiar bez ceny w taryfie sezonowej dostaje cenę z Bazowej** (decyzja po bramce 1B); cennik pokazuje ostrzeżenie o brakujących cenach. Brak ceny także w Bazowej oznacza „do ustalenia”.
6. **Nowa taryfa: „Wypełnij z Bazowej” o procent lub kwotę, potem ręczne poprawki pojedynczych komórek.** Wynik korekty zaokrąglany do pełnych złotych. Komórka zmieniona ręcznie jest oznaczona; nadpisanie jej ceną „dla wszystkich rozmiarów” albo ponownym wypełnieniem wymaga potwierdzenia.
7. **Najem obejmujący dni w różnych cenach liczymy proporcjonalnie:** każdy dzień wnosi 1/N ceny pakietu N-dniowego ze swojej taryfy; wynik zaokrąglamy do pełnych złotych. Przykład: NS, 30–31 sierpnia i 1 września: 2/3 × 650 + 1/3 × 710 = 670 zł.
8. **Klient nie widzi nazw taryf.** Widzi cenę standardową (Bazowy), różnicę terminu jako osobny wiersz („+20 zł”, „−20 zł”) i sumę. Kafelek kalendarza ma plakietkę z różnicą, a zakres na granicy cen zdanie o zmianie ceny.
9. **Plakietka w kalendarzu liczy się dla zawartości koszyka; gdy koszyk jest pusty, dla oglądanego roweru.** Bez koszyka i bez wybranego roweru kalendarz nie pokazuje plakietek.
10. **Rabat grupowy:** od 4 rowerów 5% od całego zamówienia (rowery, wyposażenie, dowóz), w każdym terminie. Zamówienie dostaje status ceny „do ustalenia” i nie oferuje płatności online. Próg, procent i podstawa edytowalne. Zastępuje dawną regułę „niższa kwota bez sumowania”. Tekst na stronie: „Od 4 rowerów naliczamy 5% rabatu na całe zamówienie. Cenę i szczegóły potwierdzimy po otrzymaniu rezerwacji.”
11. **Wyposażenie to osobne pozycje z ilością** (np. 3 kaski na 5 rowerów), cena za sztukę za dzień.
12. **Ceny na kafelkach bez „od”.** Przed wyborem daty: cena najbliższego wolnego terminu z podpisem terminu. Po wyborze daty: natychmiastowa aktualizacja.

## Dostępność, kalendarz, statusy

- Dzień zamknięty blokuje nowe rezerwacje obejmujące ten dzień. Gdy są już na nim zgłoszenia: ostrzeżenie, nic nie jest anulowane automatycznie.
- Godziny działania edytowalne osobno dla dni tygodnia i dla okresów (np. sezon). Start: 9:00–18:00 codziennie.
- **Najem dniowy na dziś jest przyjmowany do godziny ustawionej w panelu** (start: 12:00; puste pole oznacza „najwcześniej od jutra”). Najem godzinowy na dziś pozostaje możliwy w godzinach działania.
- Nowy status „Komunikacja z klientem” między „Nowe” a „Potwierdzone”; blokuje sprzęt.
- Dane startowe pokazu zawierają wyjątki: 3 maja 2027 i 27 maja 2027 w cenie Bazowej, 24 grudnia 2026 zamknięte.

## Zgłoszenia, usługi, analiza

- Rodzaj zgłoszenia obejmuje także dowóz i serwis; rodzaje tworzą się automatycznie z usług zdefiniowanych w panelu.
- Kanały pozyskania: dochodzi „E-mail”.
- Filtr kanału pozyskania znika z ekranu zgłoszeń i trafia na ekran analizy w panelu administratora.
- Kalendarz zgłoszeń pokazuje także inne zarezerwowane usługi, nie tylko rowery.
- **Nieudane rezerwacje (utracony popyt):** system zapisuje anonimowy wpis (termin, model, rozmiar, ilość, szacowana wartość), gdy klient dostaje odmowę w koszyku albo przy wysłaniu; jedno zdarzenie na termin i rozmiar w jednej wizycie. Zespół może dodać taki wpis ręcznie na widoku rezerwacji.
- **Analiza rentowności modeli:** ekran w Fazie 2, razem z panelem zgłoszeń: przychód i wykorzystanie każdego modelu, podział na weekendy i pozostałe dni, utracone rezerwacje (automatyczne i ręczne), kanały pozyskania. Koszty i zysk dochodzą w Fazie 4 razem z symulacją.

## Pokaz i wygląd

- **Pokaz używa prawdziwej dzisiejszej daty.** Przykładowe zgłoszenia są w czerwcu 2027.
- Zdjęcia z `referencja/zdjecia` w prywatnym pokazie. Klientowi pokazujemy po Fazie 2. Publikacja: najpierw prywatny artefakt, później darmowy hosting statyczny.
- `theme.css` tylko jako źródło kolorów i czcionki. Bez przeglądania makiet z Fazy 0 i bez nowych makiet. Jeden punkt kontrolny wyglądu przy bramce 1B (1280, 900, 390 px).
- Szkic płatności nie przyjmuje żadnych danych płatniczych: pole kodu jest nieaktywne.

## Zasada nadrzędna

Wszystko, co dotyczy oferty, cen, taryf, progów, wyjątków dat, usług, statusów, godzin, floty i rodzajów zgłoszeń, jest danymi edytowanymi w panelu administratora. Pytania do właściciela zadajemy od razu, interaktywnie, z opcjami i rekomendacją.

## Założenia wykonawcze (do potwierdzenia przez właściciela)

Z bramki 1A:

- Zaokrąglenie do pełnych złotych dotyczy ceny jednego roweru w pozycji i tylko najmu, którego dni mają różne ceny; potem mnożymy przez ilość.
- We „własnych kwotach” wyjątku puste komórki biorą cenę z taryfy, która obowiązywałaby bez wyjątku.
- Dowóz ponad limit auta nie ma kwoty w sumie zamówienia.
- Usługa dodatkowa może mieć opcjonalny stan sztuk; puste pole znaczy bez limitu.
- Długość najmu, dla której nie ma pakietu (np. 4 dni przy pakietach 2, 3 i 5), jest „do ustalenia”.
- Dzień zamknięty wyjątkiem blokuje każdy najem, który go obejmuje. Dzień, w którym punkt jest regularnie nieczynny (godziny działania), blokuje tylko odbiór i zwrot.
- Gdy dwa wyjątki obejmują tę samą datę, wygrywa krótszy zakres.
- Sklep nie przyjmuje rezerwacji wstecz; zgłoszenie ręczne zespołu może zaczynać się wcześniej tego samego dnia.
- Przywrócenie anulowanego zgłoszenia sprawdza ponownie, czy sprzęt jest wolny.
- Numer zgłoszenia: prefiks najemcy, rok, kolejny numer w roku (np. `SB-2027-0007`).
- Kody egzemplarzy w danych startowych: prefiks modelu (`NS`, `CJ`, `KTM`), rozmiar, numer. Prefiks `CJ` dla Cannondale Jekyll jest propozycją.
- Testy bazowe: 36 kwot z tabeli cen bez zmian. Zamówienia od 4 rowerów celowo różnią się od obecnej aplikacji (rabat od całości).

Z bramki 1B:

- Godzina graniczna najmu dniowego na dziś w danych startowych: 12:00.
- Usunięcie progu cennika, taryfy albo rozmiaru usuwa także ich ceny (rozmiaru: także egzemplarze i wyłączenia). Rekord użyty w zgłoszeniu nie da się usunąć; można go wyłączyć.
- Drugie kliknięcie w kalendarzu wydłuża termin; kliknięcie dalej niż najdłuższy dozwolony najem zaczyna nowy termin.

## Decyzje do Fazy 2 (odpowiedzi z 2026-11-24)

- **Panel kierowcy:** kierowca widzi imię, telefon i adres klienta; nie widzi e-maila ani kwot.
- **Statusy dowozu:** lista edytowalna w panelu, jak statusy zgłoszeń. Startowo: Zgłoszenie (przed zatwierdzeniem), Zaplanowany, W drodze, Dostarczony, Odebrany od klienta.
- **Kody egzemplarzy przy wydaniu:** zespół może je zaznaczyć przy statusie „Wydane”, ale nie musi; brak kodów nie blokuje wydania.

## Pytania otwarte po bramce 1B

- Akceptacja bramki 1B przez właściciela (wygląd i zasady w pokazie).
- Prawa do zdjęć (nagłówek i kafelki) po wdrożeniu.
