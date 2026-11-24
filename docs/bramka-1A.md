# Bramka 1A: raport testów silników

Wygenerowano poleceniem `npm run raport`. Wynik: **222 z 222 testów przechodzi**, 36 z 36 kwot bazowych zgodnych.

## Testy

| Obszar | Plik | Testów | Zaliczone | Niezaliczone |
| --- | --- | --- | --- | --- |
| Czas i kalendarz cen | `tests/time.test.ts` | 12 | 12 | 0 |
| Silnik cen | `tests/pricing.test.ts` | 101 | 101 | 0 |
| Silnik dostępności | `tests/availability.test.ts` | 52 | 52 | 0 |
| Repozytorium „pamięć” | `tests/repository.test.ts` | 34 | 34 | 0 |
| Dane startowe | `tests/seed.test.ts` | 11 | 11 | 0 |
| Architektura | `tests/architecture.test.ts` | 5 | 5 | 0 |
| Drugi najemca (zmyślona wypożyczalnia kajaków) | `tests/second-tenant.test.ts` | 7 | 7 | 0 |

Uruchomienie: `npm test` (wymaga tylko Node w wersji 22.18 lub nowszej, bez instalowania pakietów).

## Tabela cen: wynik silnika wobec specyfikacji

Każda komórka to kwota policzona przez silnik dla jednego roweru. Pogrubienie oznaczałoby różnicę wobec tabeli „Ceny w obecnej aplikacji” ze specyfikacji; nie ma żadnej.

| Model | Taryfa | Do 4 h | Dzień | 2 dni | 3 dni |
| --- | --- | --- | --- | --- | --- |
| NS Bikes E-Fine 1 | Bazowy | 200 zł | 250 zł | 450 zł | 650 zł |
| NS Bikes E-Fine 1 | Wolne terminy | 200 zł | 230 zł | 440 zł | 630 zł |
| NS Bikes E-Fine 1 | Duży popyt | 220 zł | 270 zł | 490 zł | 710 zł |
| Cannondale Jekyll 2 | Bazowy | 150 zł | 190 zł | 350 zł | 500 zł |
| Cannondale Jekyll 2 | Wolne terminy | 150 zł | 180 zł | 340 zł | 490 zł |
| Cannondale Jekyll 2 | Duży popyt | 160 zł | 200 zł | 380 zł | 550 zł |
| KTM Macina 893 | Bazowy | 160 zł | 200 zł | 370 zł | 540 zł |
| KTM Macina 893 | Wolne terminy | 160 zł | 180 zł | 350 zł | 510 zł |
| KTM Macina 893 | Duży popyt | 170 zł | 210 zł | 390 zł | 570 zł |

## Flota w danych startowych

Liczba sztuk nie jest nigdzie zapisana: wynika z listy egzemplarzy.

| Model | Rozmiar | Sztuk | Kody egzemplarzy |
| --- | --- | --- | --- |
| KTM Macina 893 | L | 4 | KTM-L-01, KTM-L-02, KTM-L-03, KTM-L-04 |
| NS Bikes E-Fine 1 | S | 3 | NS-S-01, NS-S-02, NS-S-03 |
| NS Bikes E-Fine 1 | M | 3 | NS-M-01, NS-M-02, NS-M-03 |
| NS Bikes E-Fine 1 | L | 3 | NS-L-01, NS-L-02, NS-L-03 |
| Cannondale Jekyll 2 | M | 2 | CJ-M-01, CJ-M-02 |
| Cannondale Jekyll 2 | L | 1 | CJ-L-01 |

## Reguły cen sprawdzane przypadkami (35)

- 5 godzin kosztuje tyle, co dzień
- 1 godzina to cena krótkiego najmu
- 9 godzin (cały dzień w trybie godzinowym) to cena dnia
- 4 dni: brak ceny automatycznej, do ustalenia, bez płatności online
- Termin w dwóch cenach: 30-31 sierpnia (Bazowy) i 1 września (Duży popyt)
- Czwartek w Wolnych terminach, piątek i sobota w Bazowej: 643,33 zł zaokrąglone do 643 zł
- Zaokrąglenie dotyczy ceny jednego roweru, potem mnożymy przez ilość
- Czwartek i piątek w maju: 2 dni w dwóch cenach
- Wtorek 4 maja: Wolne terminy
- Poniedziałek 3 maja (święto): wyjątek przywraca cenę Bazową
- Boże Ciało 27 maja (czwartek): wyjątek przywraca cenę Bazową
- Wyjątek z własną kwotą dla jednego rozmiaru; pozostałe biorą cenę z taryfy
- Wyjątek z własną kwotą pakietu 2 dni wchodzi do proporcji
- Połówka złotówki zaokrągla się w górę: 450,50 zł daje 451 zł
- Wyjątek przypisujący taryfę do dat poza jej sezonem
- Rabat grupowy: od 4 rowerów 5% od całego zamówienia, cena do ustalenia
- 3 rowery: bez rabatu, cena ostateczna, płatność online dostępna
- Rabat grupowy obejmuje także dowóz
- Próg i procent rabatu zmienione w ustawieniach (od 2 sztuk, 10%)
- Rabat liczony tylko od rowerów (ustawienie podstawy rabatu)
- Rabat grupowy wyłączony w ustawieniach
- Wyposażenie jako osobne pozycje: 3 kaski na 2 rowery, za sztukę za dzień
- Wyposażenie przy najmie godzinowym liczone jak za jeden dzień
- Dowóz w Szczyrku do limitu auta: cena pewna 100 zł
- Dowóz ponad limit auta: do ustalenia, bez kwoty w sumie
- Limit auta podniesiony w ustawieniach: 5 rowerów z dowozem ma cenę pewną
- Dowóz poza Szczyrk: do ustalenia
- Próg krótkiego najmu zmieniony z 4 na 5 godzin
- Dodany pakiet 4 dni ze stawką: 4 dni mają cenę automatyczną
- Pakiet bez stawki w taryfie sezonowej: do ustalenia zamiast zgadywania
- Długość między pakietami (4 dni przy pakietach 2, 3 i 5): do ustalenia
- Płatności online wyłączone w ustawieniach
- Indywidualne warunki zaznaczone przez klienta
- Oszczędność pakietu 2 dni względem dwóch pojedynczych dni
- Dwa rozmiary tego samego roweru w jednym zamówieniu
