# Kierunek wizualny v2 (od 2026-11-24)

Decyzja właściciela z 2026-11-24: styl dwóch stron SKY BIKE zastępuje `faza-0/kierunek-wizualny.md`, a ekran startowy sklepu ma układ jak nagłówek komoot.com. Ten plik opisuje, co z tego wynika w kodzie (`src/ui/ui.css`).

## Wzorce

- **Układ ekranu startowego:** komoot.com/pl-pl. Przezroczysty pasek menu leży na zdjęciu, logo z lewej, pozycje menu i przycisk z prawej; zdjęcie zajmuje cały pierwszy ekran; duże wyśrodkowane hasło, dwa przyciski, pod nimi mały napis wersalikami. Na telefonie: logo, przycisk i menu rozwijane.
- **Styl:** skybike-oferta (obecna aplikacja oferty; jej arkusz jest w `referencja/style/offer.css`) i skybike.fun (strona wypożyczalni).

## Zasady

| Element | Ustalenie |
| --- | --- |
| Krój | Jost; tekst 17 px / 1,55 (telefon 16 px), kolor #333 |
| Nagłówki | 600, odstęp liter −0,6 px; H1 34 px, H2 30 px, H3 22 px; hasło na zdjęciu 68 px / 700 (telefon 40 px) |
| Nadtytuł sekcji | 13 px, wersaliki, odstęp liter 1,4 px, #43764e |
| Kolory | zielony #6ac680, ciemnozielony #24613b, pomarańczowy #f7a63d (najechanie #fac16c), linie #e0e7e1, stopka #022f33, pasek pod stopką #222 |
| Przycisk główny | pomarańczowy z ciemnym tekstem #222, 600, promień 7 px; na zdjęciu i w nagłówku ze strzałką |
| Przycisk zwykły | biały z ramką; po najechaniu zielona ramka i tło #f5fbf6 |
| Menu | wersaliki 15 px / 600; bieżąca pozycja ciemnozielona z zielonym podkreśleniem |
| Pasek menu | 76 px (telefon 64 px); na zdjęciu przezroczysty z białym tekstem, po przewinięciu i na pozostałych widokach biały i przyklejony |
| Zdjęcie startowe | cały pierwszy ekran, dolna krawędź wygięta łukiem jak na skybike.fun |
| Karty | ramka 1 px, promień 9 px; po najechaniu ramka #9cccaa |
| Kafelek roweru | zdjęcie na białym tle, nazwa 22 px, typ, linia, cena 26 px w kolorze #b6751d |
| Stany wybrane | zielone tło #6ac680 z ciemnym tekstem: dzień w kalendarzu, rozmiar, zakładka, przełącznik |
| Podsumowanie | zielona górna krawędź 4 px, promień 6 px, suma 34 px ciemnozielona |
| Uwagi | pionowa kreska z lewej: zielona (informacja), bursztynowa (ostrzeżenie), czerwona (błąd) |
| Okna | promień 14 px, cień 0 20px 60px |
| Stopka | ciemny morski kolor z zielonym paskiem u góry |

## Co zostaje z poprzedniego kierunku

To nie wygląd, tylko jakość wykonania, więc obowiązuje dalej:

- kontrast tekstu co najmniej 4,5:1 (duże kwoty co najmniej 3:1); dlatego bieżąca pozycja menu jest ciemnozielona, a nie jasnozielona jak na skybike.fun, a mały tekst w kolorze ceny używa #8a5510;
- pola dotykowe co najmniej 44 px, najpierw telefon (od 390 px), brak poziomego przewijania strony;
- stan nigdy nie jest pokazany samym kolorem (kalendarz, statusy, ceny zmienione ręcznie);
- plakietka „Szkic” i pasek pokazu na każdym widoku;
- wszystkie style pod jedną klasą `.rental-app`.

## Czego nie przeniesiono

- Logo z kółkiem ze skybike.fun: nie mamy pliku. Do czasu jego dostarczenia nagłówek pokazuje nazwę wypożyczalni tekstem.
- Górny pasek z telefonem i e-mailem ze skybike.fun: jego miejsce zajmuje pasek pokazu.
- Wideo w tle (komoot): zostaje zdjęcie z treści edytowanych w panelu.
- Zielony skośny panel z tytułem podstrony (skybike-oferta) i sekcja ikon „Nasza cena zawiera” (skybike.fun): pokaz nie ma podstron ani takiej sekcji.
