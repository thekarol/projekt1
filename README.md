# System obsługi wypożyczalni

Pierwszy najemca: wypożyczalnia rowerów SKY BIKE w Szczyrku. Docelowo narzędzie dla dowolnej wypożyczalni: oferta, ceny, taryfy, progi, wyjątki dat, usługi, statusy i godziny są danymi edytowanymi w panelu administratora, a nie kodem.

## Stan

Faza 1, bramka 1B: działa pokaz na przykładowych danych. Sklep, kalendarz, koszyk i potwierdzenie liczą ceny i dostępność silnikami z bramki 1A; panel administratora edytuje ofertę, egzemplarze, cennik, taryfy, wyjątki dat, godziny, usługi, statusy, treści i reguły. Płatność, e-mail i logowanie są szkicami i są tak oznaczone. Raporty bramek: [docs/bramka-1A.md](docs/bramka-1A.md), [docs/bramka-1B.md](docs/bramka-1B.md).

## Uruchomienie

Testy silników potrzebują tylko Node w wersji 22.18 lub nowszej, bez instalowania pakietów.

```
npm test          # testy silników, repozytorium i architektury
npm run seed      # odbudowa danych startowych z plików w dane/
npm run build     # paczka aplikacji: dist/index.html, rental-app.js, rental-app.css, assets/
npm run e2e       # przejście kryteriów bramki 1B w przeglądarce (wymaga wcześniejszego build)
```

`build` wymaga pakietów `esbuild`, `react` i `react-dom`, `e2e` dodatkowo `playwright` i przeglądarki Chrome (ścieżkę można podać w zmiennej `CHROME`), a `typecheck` TypeScript 6 i `@types/node`. Po `build` wystarczy otworzyć `dist/index.html`; serwer nie jest potrzebny.

Aplikacja montuje się na elemencie `<div data-rental-app data-assets="assets/">` i wszystkie style trzyma pod klasą `.rental-app`, więc można ją osadzić na istniejącej stronie.

## Układ

| Katalog | Co zawiera |
| --- | --- |
| `src/core` | Silniki bez żadnych zależności: ceny (`pricing.ts`), dostępność (`availability.ts`), kalendarz cen i godzin (`calendar.ts`), czas, kwoty, typy modelu, walidator danych |
| `src/data` | Jeden interfejs dostępu do danych (`repository.ts`) i jego wersja w pamięci (`memory.ts`); dane startowe pokazu w `seed/skybike.json` |
| `dane` | Źródła danych startowych: `dane-startowe.json` (z obecnej aplikacji) i `decyzje-wlasciciela.json` (rozmiary, progi, wyjątki, statusy, kanały) |
| `src/app` | Warstwa pośrednia bez przeglądarki: polskie etykiety, uprawnienia ról, treść maila, testy silników uruchamiane też na stronie „O pokazie” |
| `src/ui` | Widoki (React): sklep, kalendarz, koszyk, potwierdzenie, panel, „O pokazie”; jeden arkusz `ui.css` |
| `assets` | Zdjęcia używane w pokazie |
| `tests-e2e` | Scenariusz przeglądarkowy kryteriów bramki 1B |
| `tests` | Testy; przypadki cenowe są danymi w `tests/vectors/*.json`, żeby ten sam zestaw sprawdzał późniejszą wersję po stronie serwera |
| `scripts` | Budowa danych startowych, paczki aplikacji i raportu bramki 1A |

## Zasady, których pilnują testy

- Dostępność nie jest nigdzie zapisana jako licznik. Liczba sztuk rozmiaru to liczba jego egzemplarzy (każdy z własnym kodem), pomniejszona o wyłączenia do serwisu w danym dniu; zajętość wynika z rezerwacji o statusie blokującym.
- Zapis rezerwacji sprawdza dostępność i zapisuje w jednej operacji.
- Kwoty są w groszach. Zaokrąglenie do pełnych złotych dotyczy tylko najmu, którego dni mają różne ceny.
- `src/core` nie importuje niczego spoza siebie i nie zawiera nazw modeli, taryf ani kwot żadnego najemcy.
- Klient nie dostaje nazw taryf; widzi cenę standardową i różnicę terminu.
