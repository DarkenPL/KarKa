# Komendy szablonów

Wygląd kart opisuje plik tekstowy – szablon – w stylu [nanDecka](https://www.nandeck.com/). Każda linia to jedna komenda:

```
KOMENDA = argument, argument, opcja=wartość, flaga
```

## Zasady ogólne

- **Wymiary w milimetrach.** Punkt `(0, 0)` to lewy górny róg karty. Można liczyć: `88 - 1.6 - 10.35`. Ułamki zapisuje się z kropką: `3.5`.
- **Rozmiar czcionki w punktach (pt).**
- `[Kolumna]` wstawia wartość z pliku danych (CSV/XLSX), np. `[Nazwa]`. W `OBRAZEK`, `IKONA`, `TEKST`, `PROSTOKĄT` i `ELIPSA` kolumna może też podawać położenie, rozmiar i obrót – patrz [Układ z danych](#układ-z-danych--pozycja-z-kolumn-kadr-krycie-odbicie).
- `{znacznik}` wstawia ikonę z `ikony.csv` (patrz niżej). Działa też w danych.
- `"tekst"` w cudzysłowie może zawierać przecinki. `\n` oznacza nową linię. Formatowanie tekstu (`**pogrubienie**`, `<i>kursywa</i>` i inne) – patrz [Formatowanie tekstu](#formatowanie-tekstu).
- Komentarz zaczyna się od `;` albo `#` na początku linii. Komentarz na końcu linii zaczyna się od ` ;` (ze spacją przed średnikiem).
- Nazwy komend i opcji można pisać z polskimi znakami lub bez (`TŁO` = `TLO`, `wyrównanie` = `wyrownanie`). Wielkość liter nie ma znaczenia.
- Elementy rysowane są w kolejności: następny przykrywa poprzedni.

### Plik szablonu

- W aplikacji otwierasz jeden plik szablonu (`.txt`). Bez sekcji `[TALIA …]` opisuje on jedną talię, z sekcjami – kilka talii, w kolejności z pliku.
- **Ścieżki** (`DANE`, obrazki, `CZCIONKA_PLIK`, `ikony.csv`) liczą się od **folderu projektu**: folderu, w którym leży szablon, albo folderu nad nim, gdy szablon leży w podfolderze `Szablony`.
- Edytuj jako **zwykły tekst** (TextEdit: Format → Zamień na zwykły tekst) albo w edytorze kodu. Plik zapisany jako RTF generator wykryje i poda, jak to naprawić.

## Talia i projekt

| Komenda | Opis |
|---|---|
| `PROJEKT = Złota Wyprawa` | Nazwa projektu (gry): w nazwach plików JPG i PDF. Bez tej komendy – nazwa pliku szablonu. Zwykle w części wspólnej szablonu. |
| `WERSJA = v0.3` | Wersja projektu, do wstawienia na kartę polem `[_wersja]` (patrz [Pola wbudowane](#pola-wbudowane)). |
| `STAŁA = margines, 4` | Stała: `[=margines]` w dowolnej komendzie zostaje zamienione na `4`. Wygodne dla powtarzanych liczb i kolorów (`STAŁA = złoty, #C9A227` → `kolor=[=złoty]`). Stała działa w całym pliku szablonu, także w taliach i rewersach. |
| `NAZWA = Przedmioty` | Nazwa talii (podgląd, pliki JPG, eksport). Domyślnie nazwa z `[TALIA …]` albo z nazwy pliku. |
| `DANE = przedmioty.csv, przedmioty.xlsx` | Plik(i) z kartami. Pierwszy znaleziony wygrywa. Plik może leżeć w podfolderze projektu: `DANE = dane/przedmioty.csv`. |
| `KARTA = 63, 88, zaokrąglenie=3, obwódka=0.7, kolor_obwódki=#222222` | Szerokość i wysokość karty w mm. Opcjonalnie zaokrąglone rogi i obwódka całej karty (rysowana na wierzchu). **Obwódka `KARTA` leży na linii cięcia** – w druku w drukarni wyjdzie nierówna; zamiast niej użyj `OTOK` albo ramki ≥ 3 mm od cięcia. W sekcji `[REWERS]` ustawia tylko rogi i obwódkę rewersu; rozmiar jest zawsze jak awersu. **`spad=3`** (od 0.6.2, mm od 0 do 10, kropka dziesiętna: `spad=2.5`) deklaruje spad do druku w drukarni – patrz [Spad](#spad-w-szablonie-od-062). Spad w części wspólnej dziedziczą talie bez własnej `KARTA` (własna `KARTA` w talii bez `spad=` oznacza talię bez spadu); w `[REWERS]` `spad=` jest błędem (rewers ma spad awersu). |
| `KOLOR = las, #7BA05B` | Nazwany kolor (paleta wspólna dla wszystkich szablonów). Nazwy można używać w danych i szablonie zamiast kodu, np. `TŁO = [Kolor] \| las`, a także jako ikony-prostokąta `{kolor-las}` (`{kolor-las-mix}` jest w połowie biały). |
| `PCIO`, `STÓŁ` | Nieużywane (dawny eksport do istniejącego pokoju playingcards.io). Teraz eksport tworzy nowy pokój bez dodatkowych komend – patrz [playingcards.md](playingcards.md). |

### Plik danych (CSV / XLSX)

- Pierwszy wiersz zawiera nazwy kolumn.
- Separator to `;` albo `,` (wykrywany sam). Kodowanie UTF-8.
- Gdy pliku nie ma pod ścieżką z `DANE`, KarKa zgłasza Uwagę „Nie znaleziono plików z kartami”. Plik przeniesiony do podfolderu trzeba wskazać pełną ścieżką.
- W pliku XLSX czytany jest pierwszy arkusz. Inny arkusz wskażesz po `#`: `DANE = gra.xlsx#Wydarzenia` (nazwa bez względu na wielkość liter i polskie znaki). Dzięki temu kilka talii może mieć dane w jednym pliku.
- Kolumna **`Ilość`** określa liczbę kopii karty: `0` pomija kartę, a brak kolumny oznacza 1.
- Kolumna **`ID`** służy jako numer karty (podgląd, nazwy plików JPG), a **`Nazwa`** jako podpis karty w podglądzie i uwagach.
- Nazwy tych trzech kolumn można pisać dowolnie: bez polskich znaków i bez względu na wielkość liter (`ilosc`, `Id`, `NAZWA`).
- Nowa linia w komórce to nowa linia na karcie.
- W komórce działa formatowanie: `**pogrubienie**`, `~~przekreślenie~~` i znaczniki `<b>`, `<i>`, `<u>`, `<s>`… – patrz [Formatowanie tekstu](#formatowanie-tekstu).

### Ikony – folder `Ikony` i `ikony.csv`

Najprościej: wrzuć obrazek do folderu **`Ikony`** projektu (albo `Icons`). Plik `Ikony/drewno.svg` od razu działa jako `{drewno}`. Obsługiwane są SVG, PNG, JPG, GIF i WEBP. Nazwę można pisać bez polskich znaków i bez względu na wielkość liter (plik `Złoto.svg` → `{złoto}` albo `{zloto}`).

Plik `ikony.csv` jest potrzebny tylko wtedy, gdy chcesz nadać ikonie inną nazwę, emoji zastępcze albo wyłączyć odstęp. Wpis w `ikony.csv` ma pierwszeństwo przed plikiem z folderu.

```
Znacznik;Znak;Odstęp;Plik;Opis
{drewno};🪵;tak;Ikony/drewno.svg;Surowiec: drewno
```

| Kolumna | Opis |
|---|---|
| Znacznik | Używany w tekście, np. `{drewno}`. |
| Znak | Emoji zastępcze, gdy brakuje pliku. |
| Odstęp | `tak` = mały odstęp, gdy zaraz po ikonie stoi kolejna. |
| Plik | Ścieżka do obrazka (PNG, JPG, SVG). |
| Opis | Dowolny, dla Ciebie. |

### Pola wbudowane

Wstawiasz je jak kolumny, ale z podkreślnikiem. Nie muszą istnieć w pliku danych.

| Pole | Wartość |
|---|---|
| `[_numer]` | Numer kopii w talii: 1, 2, 3… (liczy każdą kopię z kolumny `Ilość`). |
| `[_liczba]` | Liczba wszystkich kart (kopii) w talii. |
| `[_kopia]` | Numer kopii tej samej karty: 1, 2… |
| `[_id]` | Kolumna `ID` (albo numer wiersza). |
| `[_wersja]` | Wartość komendy `WERSJA`. |
| `[_talia]`, `[_projekt]` | Nazwa talii i projektu. |
| `[_data]` | Dzisiejsza data, np. 9.10.2026. |

Przykład stopki do testów: `TEKST = 6, 82, 51, 3, "[_wersja] · [_numer]/[_liczba]", rozmiar=5, kolor=#999999, wyrównanie=prawo`. Taka stopka jest **tylko do playtestów** – tekst 5 pt w kolorze jest za mały do druku w drukarni (próg 6 pt, kolorowy 8 pt); przed drukiem w drukarni ją usuń.

Numery liczą się w kolejności wierszy pliku danych. Data to dzień wygenerowania kart.

## Sekcje

| Sekcja | Opis |
|---|---|
| `[TALIA Nazwa]` | Zaczyna kolejną talię w tym samym pliku. Wszystko przed pierwszą `[TALIA …]` jest **wspólne** dla talii z pliku: `KARTA`, `CZCIONKA` oraz elementy awersu i rewersu, rysowane pod elementami talii. Każda talia potrzebuje własnego `DANE`. Talia może nadpisać wspólne `KARTA` albo `CZCIONKA`. Dwie talie o tej samej nazwie: druga jest pomijana (z uwagą). |
| `[REWERS]` | Poniżej rysuje się rewers talii. Bez tej sekcji talia nie ma rewersu. Rewers bez `[Kolumn]` jest wspólny dla wszystkich kart talii; z `[Kolumnami]` albo warunkami `jeśli=` z kolumn – każda karta ma swój rewers (patrz niżej). Na wydruku A4 karty kilku talii mogą stać na jednym arkuszu – za każdą kartą drukuje się jej rewers (opcja „Talie na wspólnych arkuszach”, [aplikacja](aplikacja.md)). |
| `[AWERS]` | Powrót do rysowania awersu. |

### Rewers zależny od karty (od 0.6.1)

W `[REWERS]` działają te same `[Kolumny]` z wiersza karty co na awersie, pola wbudowane karty (`[_id]`, `[_numer]`, `[_kopia]`), warunki `jeśli=` z kolumnami i `TŁO = [Kolumna]` (kolor albo plik obrazka). Tak zrobisz np. dwa wzory rewersu w jednej talii albo kartę dwustronną:

```
[REWERS]
TŁO   = #45396e
TŁO   = [TłoRewersu]                                  ; karta dwustronna – własne tło (puste = tło wyżej)
IKONA = 0, 22, 63, 22, {ksiega}, jeśli=[Szkoła]=Księgi
IKONA = 0, 22, 63, 22, {runa}, jeśli=[Szkoła]=Runy
TEKST = 0, 50, 63, 12, "Magowie", rozmiar=24, wyrównanie=środek, jeśli=[Rodzaj]!=dwustronna
TEKST = 8, 36, 47, 40, [RewersOpis], wyrównanie=środek, jeśli=[Rodzaj]=dwustronna
```

- Rewers, który nie używa żadnej kolumny (ani `[_id]`, `[_numer]`, `[_kopia]`), jest wspólny dla talii – dokładnie jak wcześniej. Pola wspólne dla całej talii (`[_liczba]`, `[_wersja]`, `[_talia]`, `[_projekt]`, `[_data]`) i stałe `[=nazwa]` nie robią z rewersu zależnego.
- Karty o takim samym rewersie dzielą go: w podglądzie każdy **różny** rewers stoi na początku talii z podpisem „Rewers 2 · ×4” (wzór i liczba kart). Który rewers dostała która karta, pokazuje **Widok → Pokaż rewersy kart** (od 0.6.5).
- Eksport obrazków (od 0.6.5): rewers zależny zapisuje się osobno dla każdej karty, obok jej awersu – `Projekt_Talia_<ID>_rewers.jpg` (przy `[_numer]`/`[_kopia]` w rewersie – `Projekt_Talia_<ID>_<kopia>_rewers.jpg`). Wspólny rewers – jak dotąd jeden plik `Projekt_Talia_rewers.jpg`.
- Katalog talii (od 0.6.5): na początku talii każdy wariant rewersu z podpisem „Rewers 2 · ×4”; przy wyborze kart (`id`) – tylko warianty wybranych kart.
- Brakująca kolumna daje Uwagę tak jak na awersie.
- Gradientu (`#fff > #000`) nie da się wpisać w komórkę danych – z kolumny działa jeden kolor albo plik.
- Druk: na arkuszu A4 i w układzie Drukarnia za każdą kartą idzie jej rewers. playingcards.io – jeden rewers na stos: użyty jest najczęstszy rewers talii, a wynik eksportu zawiera ostrzeżenie.
- Przykład: talia Magowie w `przyklady/07-gildie`.

## Elementy

### `TŁO = [Kolor] | #cccccc`
Tło całej karty.
- `|` oznacza: jeśli pierwszy kolor jest pusty, weź następny.
- Kolor można podać jako `#RRGGBB`, `#RRGGBBAA` (z przezroczystością), nazwę z palety (`KOLOR`) albo `brak`.
- Zamiast koloru można podać obrazek: `TŁO = Art/tlo.png`.
- **Gradient:** kolory rozdzielone `>`, np. `TŁO = #ffffff > [Kolor]` (od góry do dołu). Kierunek w stopniach: `kierunek=90` – od lewej do prawej, `kierunek=135` – po skosie. Kolorów może być więcej niż dwa.

### `PROSTOKĄT = x, y, szer, wys, kolor=#ffffff`
Opcje:
- `kolor` – domyślnie czarny; `brak` = bez wypełnienia,
- `zaokrąglenie` – w mm albo w `%`,
- `obwódka` – grubość w mm,
- `kolor_obwódki`,
- `styl_obwódki` – `przerywana` albo `kropkowana` (domyślnie ciągła),
- `krycie` – od 0 do 1 (albo `50%`), może być z kolumny – [układ z danych](#układ-z-danych--pozycja-z-kolumn-kadr-krycie-odbicie),
- `kolor` może być gradientem: `kolor=#000000 > #00000000, kierunek=90` (zanikający pasek),
- `obrót` – jak niżej,
- `x`, `y`, szerokość i wysokość mogą być `[Kolumną]` albo `[=stałą]` – [układ z danych](#układ-z-danych--pozycja-z-kolumn-kadr-krycie-odbicie).

### `ELIPSA = x, y, szer, wys, kolor=…`
Jak `PROSTOKĄT`, ale okrągła.

### `LINIA = x1, y1, x2, y2, grubość=0.3, kolor=#000000`
Odcinek od punktu (x1, y1) do (x2, y2), w mm od lewego górnego rogu karty. Opcje:
- `grubość` – w mm (domyślnie 0,3),
- `kolor` – także z kolumny, np. `kolor=[Kolor]`,
- `styl` – `ciągła` (domyślnie), `przerywana` albo `kropkowana`,
- `początek`, `koniec` – zakończenia: `brak` (domyślnie), `strzałka` (dwie kreski), `strzałka_pełna` (wypełniony trójkąt), `kropka`, `kreska` (poprzeczna). Wielkość zakończenia rośnie z grubością linii,
- `krycie` – od 0 do 1,
- `jeśli=` – jak przy innych elementach.

```
LINIA = 8, 70, 55, 70, grubość=0.4, styl=przerywana
LINIA = 10, 40, 50, 25, grubość=0.6, kolor=#8b2c2c, koniec=strzałka_pełna
LINIA = 10, 50, 50, 50, początek=kropka, koniec=strzałka
```

### `OTOK = 3, [Kolor]` (od 0.7.12)
**Otok** to kolorowy pas wokół karty, od końca spadu do linii bezpieczeństwa (domyślnie 3 mm od linii cięcia). Słownik: **ramka** – cienka linia (`PROSTOKĄT … obwódka=`, `LINIA`), **otok** – pas od końca spadu do linii bezpieczeństwa, **pole karty** – wnętrze karty wewnątrz otoku.
- pierwsza liczba – szerokość pasa w mm **od linii cięcia** (domyślnie 3); może być `[Kolumną]`,
- drugi argument albo `kolor=` – kolor jak w `TŁO` (`#RRGGBB`, nazwa z `KOLOR`, `[Kolumna]`, `[Kolor] | szary`); pusta kolumna = karta bez otoku,
- `zaokrąglenie` – promień wewnętrznego rogu w mm (domyślnie równy szerokości; `zaokrąglenie=0` – ostry róg),
- `krycie` – od 0 do 1,
- `jeśli=` – jak przy innych elementach; kilka `OTOK` w talii jest dozwolonych (np. zwykły i złoty dla kart rzadkich – rysowane po kolei, ostatni na wierzchu). Działa też w `[REWERS]`.

Otok leży **nad wszystkimi elementami karty**, niezależnie od miejsca w szablonie. Model warstw od góry: otok → teksty → ikony i obrazki → tło. Elementy przy krawędzi (np. pasek przy dolnej krawędzi) mogą sięgać pod otok – bez własnego zaokrąglenia. **Pole nie powinno kończyć się dokładnie na wewnętrznej krawędzi otoku** (np. `PROSTOKĄT = 3, 50, 82, 10` pod `OTOK = 3` na karcie 88 × 63) ani na krawędzi innego pola w innym kolorze: dwie krawędzie na jednej linii są wygładzane osobno, a w druku pasowanie bywa przesunięte, więc na styku widać cienką jasną kreskę. Wsuwaj pole pod otok (najlepiej do krawędzi karty: `PROSTOKĄT = 0, 50, 88, 13`), a sąsiednie pola nakładaj z zakładką ok. 0,5–1 mm. Raport w trybie drukarni pokazuje takie miejsca jako INFO (od 0.7.17). Tekst i ikony pod otokiem są zasłonięte, a Raport w trybie drukarni je zgłasza.

Otok jest rysowany dokładnie, bez zaokrąglania do pikseli. W PDF dla drukarni sięga do końca spadu, a rogi spadu są wypełnione. W podglądzie, w obrazkach i w druku A4 kończy się na krawędzi karty. Zastępuje obejście z obwódką (`PROSTOKĄT = -1, -1, …, obwódka=4, …`), które Raport w trybie drukarni zgłaszał jako błąd przy linii cięcia.

```
OTOK = 3, [Kolor]                                  ; pas 3 mm, róg 3 mm
OTOK = 3, #C9A227, jeśli=[Rzadka]=tak             ; złoty otok kart rzadkich – na wierzchu
OTOK = 4, kolor=#1d1b19, zaokrąglenie=2
```

### `TEKST = x, y, szer, wys, "treść z [Kolumnami]", opcje…`

| Opcja | Znaczenie |
|---|---|
| `czcionka="EB Garamond, Georgia, serif"` | czcionka (zapasowe po przecinku) |
| `rozmiar=10` | wielkość w pt |
| `kolor=#1d1b19` | kolor tekstu |
| `wyrównanie=lewo \| środek \| prawo \| wyjustuj` | w poziomie |
| `pion=góra \| środek \| dół` | w pionie |
| `interlinia=1.15` | odstęp między liniami |
| `ikony=0.9` | wysokość ikon względem tekstu (`1.8` = 2× większe) |
| `min=0.6` | najmniejsza skala, gdy tekst się nie mieści |
| `obrys=0.3`, `kolor_obrysu=#000000` | obrys liter (grubość w mm) – czytelny tekst na obrazku albo gradiencie |
| `cień` albo `cień=#00000099` | cień pod tekstem (domyślnie półprzezroczysty czarny) |
| `lista=tak` | wiersze zaczynające się od `1.`, `12.`, `-` albo `•` (i spacji) to punkty listy z wcięciem wiszącym – patrz „Akapity i listy” niżej |
| `grupa=nazwa` | pola z tą samą grupą zmniejszają się razem (na wszystkich kartach talii o tyle samo) i nie mogą na siebie nachodzić, np. koszt z lewej i punkty z prawej w jednym wierszu |

Flagi: `pogrubienie`, `kursywa`, `podkreślenie`, `wersaliki`, `jedna_linia`, `bez_formatowania` (formatowanie z danych w tym polu zostaje zwykłym tekstem – patrz niżej).

- Za długi tekst zmniejsza się sam. Jeśli nadal się nie mieści, karta dostaje w podglądzie czerwoną ramkę, a w Uwagach pojawia się wpis.
- Jeśli **wszystkie** `[Kolumny]` w treści są puste, element nie jest rysowany. Na przykład `"**Efekt:** [Efekt]"` znika, gdy Efekt jest pusty.

### Formatowanie tekstu

W tekście szablonu i w komórkach danych (CSV/XLSX) działają:

| Zapis | Wynik | Szablon | Dane |
|---|---|---|---|
| `**tekst**` | **pogrubienie** | tak | tak |
| `*tekst*` | *kursywa* | tak | nie – pojedyncza `*` w danych to zwykły znak (`5*`, przypis) |
| `~~tekst~~` | ~~przekreślenie~~ | tak | tak |
| `<b>…</b>`, `<strong>…</strong>` | pogrubienie | tak | tak |
| `<i>…</i>`, `<em>…</em>` | kursywa | tak | tak |
| `<u>…</u>` | podkreślenie | tak | tak |
| `<s>…</s>`, `<del>…</del>`, `<strike>…</strike>` | przekreślenie | tak | tak |
| `<small>…</small>` | mniejszy tekst – 0,6 rozmiaru otoczenia | tak | tak |
| `<big>…</big>` | większy tekst – 1,4 rozmiaru otoczenia | tak | tak |
| `<rozmiar=12>…</rozmiar>` | tekst 12 pt (także `10,5`, `12pt`) | tak | tak |
| `<lewo>`, `<środek>` (`<srodek>`), `<prawo>` na początku wiersza | wyrównanie tego wiersza (akapitu) | tak | tak |

- Znaczniki piszemy **bez atrybutów** (`<b>`, nie `<b class="x">`), wielkość liter nie ma znaczenia (`<B>` = `<b>`). Każdy inny znacznik (`<img>`, `<br>`, `<span>`…) zostaje na karcie zwykłym tekstem.
- W danych `**…**` i `~~…~~` muszą mieć parę w tej samej komórce. Pojedyncze `*` i `~` to zwykłe znaki.
- Niedomknięty znacznik (`<b>` bez `</b>`) jest domykany na końcu pola – formatowanie nie przechodzi na inne elementy karty. W Uwagach pojawia się wpis z kartą i kolumną. Zamknięcie bez otwarcia (`</b>` bez `<b>`) zostaje tekstem (też z Uwagą).
- Ikony działają wewnątrz znaczników: `<b>{moneta} 3</b>`.
- **Rozmiary w jednym polu** (od 0.5.15): `<small>` i `<big>` liczą się od tekstu wokół, więc zagnieżdżone mnożą się (`<big><small>…</small></big>` = 0,84). `<rozmiar=12>` to zawsze 12 pt przy rozmiarze pola z `rozmiar=` – także wewnątrz `<big>`. Cała treść pola to jeden blok: `pion=środek` wyśrodkowuje razem efekt i dopisek, a wiersze z większym tekstem są odpowiednio wyższe. Ikony w mniejszym tekście też są mniejsze.
- Gdy tekst się nie mieści, pole zmniejsza się **całe** (także w `grupa=`) – fragmenty zachowują proporcje: pole 20 pt z dopiskiem `<rozmiar=12>` zmniejszone do 15 pt ma dopisek 9 pt. `<rozmiar=…>` bez liczby (`<rozmiar>`, `<rozmiar=duży>`) zostaje tekstem z Uwagą.
- Raport projektu ma sekcję **„Formatowanie z danych”** – listę kart i kolumn, w których dane zawierają formatowanie. Po aktualizacji z wersji 0.5.4 to właśnie te karty zmieniają wygląd (i pokażą się jako „zmienione od ostatniego PDF”); pozostałe karty wyglądają tak samo.
- Flaga **`bez_formatowania`** w `TEKST` wyłącza formatowanie z danych w tym polu: gwiazdki, tyldy i znaczniki z komórek zostają zwykłym tekstem. Formatowanie zapisane w samym szablonie nadal działa.

Przykład (dane z nazwą zasady pogrubioną w komórce – bez osobnych elementów z `jeśli=`):

```
; karty.csv
ID;Nazwa;Efekt;Cytat
01;Burza;**Grom:** zadaj 2 obrażenia. <u>Raz na turę.</u>;Ocena: **** (cztery gwiazdki)
02;Mgła;<b>Ukrycie:</b> <i>przeciwnik</i> nie widzi twoich kart ~~do końca gry~~ do końca rundy.;

; szablon
TEKST = 4, 50, 55, 22, [Efekt], rozmiar=9
TEKST = 4, 74, 55, 8, [Cytat], rozmiar=7, kursywa, bez_formatowania   ; gwiazdki z danych dosłownie
```

Efekt z dopiskiem w nawiasie, wyśrodkowane razem w jednej ramce:

```
; karty.csv
ID;Efekt
03;Dobierz 2 karty. <small>(Jeśli masz mniej niż 3 – dobierz 3.)</small>

; szablon
TEKST = 4, 50, 55, 22, [Efekt], rozmiar=20, wyrównanie=środek, pion=środek
TEKST = 4, 74, 55, 8, "<big>Uwaga!</big> Reszta <rozmiar=8>drobnym drukiem</rozmiar>", rozmiar=10
```

#### Akapity i listy (od 0.5.17)

Akapit to wiersz treści – kończy go nowa linia w komórce danych albo `\n` w tekście szablonu.

- **Wyrównanie akapitu:** `<lewo>`, `<środek>` (także `<srodek>`) albo `<prawo>` **na początku wiersza** wyrównuje ten jeden wiersz; pozostałe wiersze mają wyrównanie pola (`wyrównanie=`). Przed znacznikiem mogą stać spacje i formatowanie (`**<środek>Tytuł**` działa). Zamknięcie (`</środek>`) na końcu wiersza jest dozwolone, ale niepotrzebne – wyrównanie i tak kończy się z końcem wiersza.
- Znacznik w środku wiersza (`Tekst <środek>dalej`) albo zamknięcie bez otwarcia zostaje tekstem z Uwagą – wyrównać można tylko cały wiersz.
- Formatowanie przechodzi przez granice wierszy jak dotąd: `<b>` otwarte w jednym wierszu i zamknięte w następnym pogrubia oba.
- **Listy – `lista=tak` w `TEKST`:** wiersz zaczynający się od `1.`, `12.` (numer z kropką), `-` albo `•`, a po nim spacji, dostaje **wcięcie wiszące** – kolejne linie tego punktu zaczynają się równo z tekstem za numerem, nie pod numerem. Pogrubiony numer: `**1.** Tekst`. `*` nie jest punktorem (to kursywa). Wiersze bez punktora (`Zwykły tekst`, `-5 obrażeń`, `1.5 punktu`) to zwykłe akapity. Wcięcie ma szerokość numeru danego wiersza (`12.` jest szersze niż `1.`).
- `pion=środek`, zmniejszanie za długiego tekstu i `grupa=` działają z akapitami tak samo jak bez nich.
- `bez_formatowania` wyłącza znaczniki akapitu **z danych** (zostają tekstem); `lista=tak` nadal działa.
- Pole bez tych znaczników i bez `lista=` wygląda dokładnie jak wcześniej (ten sam HTML – karty nie są „zmienione od ostatniego PDF”).

```
; karty.csv (komórka z nowymi liniami, w cudzysłowie)
ID;Nazwa;Opis
11;Rytuał;"**1.** Zapłać {mana}.
**2.** Odrzuć kartę z ręki – najlepiej taką, której i tak nie zagrasz.
**3.** Dobierz 2 karty.
<środek><i>Raz na turę.</i>"

; szablon
TEKST = 3, 37.5, 38, 18, [Opis], rozmiar=8, pion=środek, lista=tak
TEKST = 4, 4, 55, 20, "<środek><big>Tura</big>\nDobierz kartę.\n<prawo><small>– ściąga</small>", rozmiar=9
```

Cały przykład: `przyklady/05-zaklecia` (kolumna `Opis` z każdym znacznikiem – karty 09 i 10 z `<small>`, `<big>` i `<rozmiar=6>`, karta 11 z listą numerowaną i akapitem `<środek>`, karta 12 z nagłówkami `<big>`, listą `•` i podpisem `<prawo>`; kolumna `Cytat` z `bez_formatowania`).

![Formatowanie z danych – przed (0.5.4) i po (0.5.5)](img/formatowanie.jpg)

### Obrót – `obrót=90`
Opcja wszystkich elementów (`TEKST`, `OBRAZEK`, `IKONA`, `PROSTOKĄT`, `ELIPSA`): obrót w stopniach zgodnie z ruchem wskazówek zegara, wokół środka pola. Pole podajesz tak jak bez obrotu, np. pionowy napis wzdłuż prawej krawędzi: `TEKST = 35, 40, 40, 8, "Rzadka", obrót=90`. Ujemne wartości obracają w lewo. Kąt może być z kolumny lub stałej: `obrót=[Kąt]` – [układ z danych](#układ-z-danych--pozycja-z-kolumn-kadr-krycie-odbicie).

### `OBRAZEK = x, y, szer, wys, [Obrazek], pion=dół`
Plik obrazka podany w kolumnie albo wprost, np. `Art/lis.png`. Obsługiwane formaty to PNG, JPG, SVG, GIF i WEBP.

Opcje:
- `dopasuj=zmieść | wypełnij | rozciągnij` – **domyślnie `zmieść`** (cały obraz w ramce, bez przycinania; z `kadr=` domyślnie `wypełnij`),
- `wyrównanie=lewo | środek | prawo`,
- `pion=góra | środek | dół`,
- `kadr=dx dy skala` – ramka z obrazem w środku, jak w InDesignie; `krycie=` i `odbicie=` – patrz [Układ z danych](#układ-z-danych--pozycja-z-kolumn-kadr-krycie-odbicie).

### `IKONA = x, y, szer, wys, {znacznik}`
Ikona (lub kilka) o wysokości pola, wyśrodkowana. Opcje: `wyrównanie`, `pion`, `krycie`, `odbicie` (dwie ostatnie – [układ z danych](#układ-z-danych--pozycja-z-kolumn-kadr-krycie-odbicie)).

### Układ z danych – pozycja z kolumn, kadr, krycie, odbicie
Położenie, rozmiar i wygląd elementu mogą zależeć od karty: zamiast liczby wpisujesz `[Kolumnę]` (z pliku danych) albo `[=stałą]` (z `STAŁA`). Dotyczy `OBRAZEK`, `IKONA`, `TEKST`, `PROSTOKĄT` i `ELIPSA`.

```
STAŁA = żeton, 11                                   ; bok żetonu w mm

; ilustracja w ramce 51×40 mm, kadr z kolumn KadrX, KadrY, Skala
OBRAZEK = 6, 6, 51, 40, [Ilustracja], kadr=[KadrX] [KadrY] [Skala], odbicie=[Odbicie]

; żeton w miejscu z kolumn Z1x i Z1y (każda liczba w osobnej kolumnie)
ELIPSA  = [Z1x], [Z1y], [=żeton], [=żeton], kolor=#fffaf0
OBRAZEK = [Z1x], [Z1y], [=żeton], [=żeton], [Z1]

; krycie i obrót z danych
OBRAZEK = [Z3x], [Z3y], [=żeton], [=żeton], [Z3], krycie=[Z3krycie], obrót=[Z3obrót]

; krycie i odbicie na stałe, także w IKONA
IKONA   = 0, 28, 63, 22, {kowadlo}, odbicie=poziome, krycie=40%
```

| Opcja | Elementy | Wartość |
|---|---|---|
| `x`, `y`, szerokość, wysokość | `OBRAZEK`, `IKONA`, `TEKST`, `PROSTOKĄT`, `ELIPSA` | liczba w mm, `[Kolumna]` albo `[=stała]`; w danych może być przecinek dziesiętny (`17,8`) |
| `obrót=` | jak wyżej | kąt w stopniach, także `[Kolumna]` albo `[=stała]` |
| `kadr=dx dy skala` | `OBRAZEK` | `dx`, `dy` – przesunięcie obrazu od środka ramki w mm (w prawo i w dół dodatnie); `skala` – w % (100 = obraz wypełnia ramkę) |
| `krycie=` | `OBRAZEK`, `IKONA` (oraz `PROSTOKĄT`, `ELIPSA`, `LINIA`) | `0.5` albo `50%`, także z kolumny |
| `odbicie=` | `OBRAZEK`, `IKONA` | `poziome`, `pionowe` albo `oba`; także z kolumny, pusta = bez odbicia |

Zasady:
- **Jedna kolumna na jedną liczbę.** Dwa żetony na karcie to dwa wiersze szablonu, np. `Z1x`/`Z1y` i `Z2x`/`Z2y`.
- **Puste pozycje.** Gdy wszystkie wartości położenia i rozmiaru brane z kolumn są puste, element nie jest rysowany (bez Uwagi) – tak karta może mieć jeden żeton, a inna trzy. Gdy pusta jest tylko część (np. jest `Z1x`, brak `Z1y`), element jest pominięty i w Uwagach pojawia się wpis. Tekst, który nie jest liczbą, też daje Uwagę.
- **Kadr.** Części `kadr=` rozdzielasz **spacjami**, nie przecinkami – przecinek rozdziela argumenty komendy. Każda część może być kolumną: `kadr=[KadrX] [KadrY] [Skala]`. Pusta część to 0, 0 albo 100; gdy puste są wszystkie, obraz po prostu wypełnia ramkę. Z `kadr=` domyślne jest `dopasuj=wypełnij` (można je nadpisać). Ramka przycina obraz, który z niej wystaje.
- **Raport.** Sekcja „obrazki poniżej 300 dpi” uwzględnia powiększenie ze `skala`.
- **Uwagi** o kartach wskazują wiersz szablonu, którego dotyczą – w edytorze od razu go widać.

Cały przykład: `przyklady/06-targ`.

### `CZCIONKA = "EB Garamond, Georgia, serif", 10, kolor=#1d1b19`
Domyślna czcionka, rozmiar i inne opcje (także flagi, np. `kursywa`) dla kolejnych `TEKST`-ów. Działa do następnej `CZCIONKA`.

**Druk w drukarni:** czarny tekst i ikony wpisuj jako `#000` – domyślny kolor tekstu `#1d1b19` i inne ciemne odcienie wychodzą po konwersji do CMYK jako czerń czterokolorowa, a drukarnie chcą czystej czerni K100 (np. `CZCIONKA = …, kolor=#000`). W PDF dla drukarni w CMYK tylko `#000` (w szablonie i w ikonach SVG) daje czystą czerń K100, a tekst w `#000` jest domyślnie nadrukowany na tło (od 0.6.4) – [opis](aplikacja.md#okna). Tekst i ważne elementy trzymaj co najmniej 3 mm od linii cięcia (tolerancja cięcia to ok. ±1 mm). Przy przygotowaniu do druku w drukarni zadeklaruj spad (`KARTA = 63, 88, spad=3`) i przygotuj tło oraz obrazki przy krawędzi ze spadem – [zasady niżej](#spad-w-szablonie-od-062). Bez deklaracji spad jest dorabiany awaryjnie (tło powiększone, obrazki przy krawędzi przedłużone), z ostrzeżeniem. Sprawdza to Raport w trybie drukarni – [opis](aplikacja.md#raport).

### Spad w szablonie (od 0.6.2)

Spad to pas obrazu poza linią cięcia (zwykle 3 mm z każdej strony), który zapewnia, że po cięciu nie zostanie biała krawędź. **W prototypach (gra online, druk domowy A4) spad nie jest potrzebny** – dopisz go dopiero, gdy projekt idzie do drukarni.

- `KARTA = 63, 88, spad=3` – deklaracja. Od tej chwili `TŁO` z pliku to plik **karty ze spadem** (63 × 88 mm + 3 mm z każdej strony = 69 × 94 mm), rysowany od −spad do szerokość + spad.
- Obrazki `OBRAZEK` z `dopasuj=wypełnij` albo `rozciągnij` (bez `kadr=` i `obrót=`), które dotykają krawędzi karty, mają ramkę przedłużoną o spad po stronach, których dotykają – plik też ma zawierać spad.
- **Nakładka ze spadem potrzebuje `dopasuj=wypełnij`** (albo `rozciągnij`). Domyślne `zmieść` nie przedłuża ramki o spad, więc plik ze spadem (np. 69 × 94 mm) zostaje **pomniejszony** do ramki karty (63 × 88 mm) i rozjeżdża się z tłem – w PDF dla drukarni widać to jako przesuniętą kopię krawędzi. Dobrze: `OBRAZEK = 0, 0, 63, 88, Art/ramka.png, dopasuj=wypełnij`. Raport w trybie drukarni i zlecenie `pdf` ostrzegają, gdy obrazek „zmieść” przy krawędzi karty ma plik o proporcjach ramki ze spadem (od 0.6.6).
- Podgląd, druk A4, obrazki JPG/PNG, katalog i playingcards.io przycinają do linii cięcia (karta ma `overflow: hidden`), więc wyglądają jak dotąd. PDF dla drukarni rysuje tło i obrazki w całości, bez skalowania. Kolorowe `TŁO` i `PROSTOKĄT` działają jak dawniej.
- Projektowanie: tło prowadź do krawędzi spadu, ważne elementy (tekst, twarze, ikony) trzymaj min. 3 mm od linii cięcia. Pole przy krawędzi (np. `PROSTOKĄT = 0, 0, 44, 32`) rysuj **bez `zaokrąglenie=`** – kształt zaokrąglony nie jest przedłużany o spad. Cienkie ramki blisko linii cięcia (`PROSTOKĄT … obwódka=`, ramki w plikach SVG) zdradzają krzywe cięcie (±1 mm) – zamiast nich użyj `OTOK` albo zrezygnuj z ramki.
- PDF dla drukarni bierze spad z szablonu (największy zadeklarowany) – ma pierwszeństwo przed oknem i kluczem `spad` zlecenia. Gdy żadna talia nie deklaruje spadu, używa spadu z okna/zlecenia i dorabia go (z ostrzeżeniem); talia ze spadem innym niż w PDF też dostaje ostrzeżenie.
- Przykład: [`08-wieze`](../przyklady/08-wieze).

### `CZCIONKA_PLIK = "Moja Czcionka", Fonts/MojaCzcionka.ttf`
Czcionka z pliku w folderze projektu. Potem używasz jej jako `czcionka="Moja Czcionka"`. Czcionki zainstalowane w systemie działają bez tej komendy.

### `CZCIONKA_GOOGLE = Lobster`
Czcionka z Google Fonts (wymaga internetu). Można podać pełny zapis z wariantami w cudzysłowie, np. `"EB Garamond:ital,wght@0,400;0,600;1,400"`.

Wbudowane są **EB Garamond** i **Patrick Hand**.

## Warunki – `jeśli=`

Każdy element może mieć opcję `jeśli=`:

| Zapis | Element rysowany, gdy… |
|---|---|
| `jeśli=[Kolor2]` | kolumna nie jest pusta |
| `jeśli=[Typ]=burza` | wartość jest równa (bez względu na wielkość liter; `001` = `1`) |
| `jeśli=[Typ]!=burza` | wartość jest inna |

Przykład – złoty otok tylko dla rzadkich kart (drugi `OTOK` jest na wierzchu pierwszego):

```
OTOK = 3, [Grządka]
OTOK = 3, #C9A227, jeśli=[Rzadka]=tak
```

### Pusta kolumna

| Zapis | Element rysowany, gdy… |
|---|---|
| `jeśli=[Dopisek]=` | kolumna jest pusta (same spacje też się liczą jako pusta) |
| `jeśli=[Dopisek]!=` | kolumna nie jest pusta (to samo co `jeśli=[Dopisek]`) |

### Kilka warunków – `&` (i) oraz `|` (lub)

Warunki łączysz znakami `&` i `|`, **bez nawiasów**. `&` wiąże mocniej niż `|`, więc `A | B & C` znaczy „A albo (B i C)”.

| Zapis | Element rysowany, gdy… |
|---|---|
| `jeśli=[Typ]=burza & [Rzadka]=tak` | oba warunki są spełnione |
| `jeśli=[Typ]=burza \| [Typ]=wichura` | spełniony jest którykolwiek |
| `jeśli=[Rzadka]=tak \| [Typ]=burza & [Plon]>=5` | rzadka, albo burza z plonem co najmniej 5 |
| `jeśli=[Dopisek]= & [Układ]!=portret` | dopisek pusty i układ inny niż „portret” |

(W tabeli `\|` to zwykły znak `|` – w szablonie piszesz go bez ukośnika.) Spacje wokół `&` i `|` są dowolne. Znaki `&` i `|` w *danych* nie mają znaczenia – dzielony jest tylko zapis w szablonie.

### Porównania liczb – `>`, `<`, `>=`, `<=`

`jeśli=[Plon]>=5`, `jeśli=[Waga]<[Limit]`, `jeśli=[Koszt]>2.5` – obie strony muszą być liczbami (w danych może być przecinek dziesiętny: `2,5` = `2.5`; w szablonie piszesz kropkę, bo przecinek rozdziela argumenty). `=` i `!=` działają jak dotąd (bez względu na wielkość liter, `001` = `1`).

Gdy któraś strona nie jest liczbą (np. `dużo`), warunek jest fałszywy, a w Uwagach pojawia się komunikat z numerem wiersza szablonu i kartą. Pusta komórka też daje fałsz, ale bez Uwagi (karty bez wartości są zwyczajne).

Przykład z `przyklady/03-ogrod`:

```
TEKST = 6, 60, 51, 9, "Bez wymagań", jeśli=[Lubi]=
TEKST = 6, 70, 26, 12, "Rekord plonu!", jeśli=[Grządka]=grzyby | [Plon]>=7 & [Lubi]=
```
