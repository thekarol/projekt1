# System obsługi wypożyczalni

Pierwszy najemca: wypożyczalnia rowerów SKY BIKE w Szczyrku. Docelowo narzędzie dla dowolnej wypożyczalni: oferta, ceny, taryfy, progi, wyjątki dat, usługi, statusy i godziny są danymi edytowanymi w panelu administratora, a nie kodem.

## Stan

Faza 1, bramka 1A: gotowe są model danych, silnik cen, silnik dostępności i repozytorium danych w pamięci, wszystko z testami. Widoków (sklep, koszyk, panele) jeszcze nie ma; powstają po akceptacji bramki 1A. Raport bramki: [docs/bramka-1A.md](docs/bramka-1A.md).

## Uruchomienie

Potrzebny jest tylko Node w wersji 22.18 lub nowszej. Nie trzeba instalować żadnych pakietów.

```
npm test          # wszystkie testy
npm run raport    # testy + tabela 36 kwot, zapis do docs/bramka-1A.md
npm run seed      # odbudowa danych startowych z plików w dane/
```

Kontrola typów (`npm run typecheck`) wymaga TypeScript 6 i `@types/node`.

## Układ

| Katalog | Co zawiera |
| --- | --- |
| `src/core` | Silniki bez żadnych zależności: ceny (`pricing.ts`), dostępność (`availability.ts`), kalendarz cen i godzin (`calendar.ts`), czas, kwoty, typy modelu, walidator danych |
| `src/data` | Jeden interfejs dostępu do danych (`repository.ts`) i jego wersja w pamięci (`memory.ts`); dane startowe pokazu w `seed/skybike.json` |
| `dane` | Źródła danych startowych: `dane-startowe.json` (z obecnej aplikacji) i `decyzje-wlasciciela.json` (rozmiary, progi, wyjątki, statusy, kanały) |
| `tests` | Testy; przypadki cenowe są danymi w `tests/vectors/*.json`, żeby ten sam zestaw sprawdzał późniejszą wersję po stronie serwera |
| `scripts` | Budowa danych startowych i raport bramki |

## Zasady, których pilnują testy

- Dostępność nie jest nigdzie zapisana jako licznik. Liczba sztuk rozmiaru to liczba jego egzemplarzy (każdy z własnym kodem), pomniejszona o wyłączenia do serwisu w danym dniu; zajętość wynika z rezerwacji o statusie blokującym.
- Zapis rezerwacji sprawdza dostępność i zapisuje w jednej operacji.
- Kwoty są w groszach. Zaokrąglenie do pełnych złotych dotyczy tylko najmu, którego dni mają różne ceny.
- `src/core` nie importuje niczego spoza siebie i nie zawiera nazw modeli, taryf ani kwot żadnego najemcy.
- Klient nie dostaje nazw taryf; widzi cenę standardową i różnicę terminu.
