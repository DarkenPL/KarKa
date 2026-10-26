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
| `KARTA = 63, 88, zaokrąglenie=3, obwódka=0.7, kolor_obwódki=#222222` | Szerokość i wysokość karty w mm. Opcjonalnie zaokrąglone rogi i obwódka całej karty (rysowana na wierzchu). W sekcji `[REWERS]` ustawia tylko rogi i obwódkę rewersu; rozmiar jest zawsze jak awersu. |
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

Przykład stopki do testów: `TEKST = 6, 82, 51, 3, "[_wersja] · [_numer]/[_liczba]", rozmiar=5, kolor=#999999, wyrównanie=prawo`.

Numery liczą się w kolejności wierszy pliku danych. Data to dzień wygenerowania kart.

## Sekcje

| Sekcja | Opis |
|---|---|
| `[TALIA Nazwa]` | Zaczyna kolejną talię w tym samym pliku. Wszystko przed pierwszą `[TALIA …]` jest **wspólne** dla talii z pliku: `KARTA`, `CZCIONKA` oraz elementy awersu i rewersu, rysowane pod elementami talii. Każda talia potrzebuje własnego `DANE`. Talia może nadpisać wspólne `KARTA` albo `CZCIONKA`. Dwie talie o tej samej nazwie: druga jest pomijana (z uwagą). |
| `[REWERS]` | Poniżej rysuje się rewers talii, wspólny dla wszystkich jej kart. Bez tej sekcji talia nie ma rewersu. Na rewersie pola `[Kolumna]` są puste. |
| `[AWERS]` | Powrót do rysowania awersu. |

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
- `dopasuj=zmieść | wypełnij | rozciągnij`,
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

**Druk w drukarni:** czarny tekst i ikony wpisuj jako `#000` – domyślny kolor tekstu `#1d1b19` i inne ciemne odcienie wychodzą po konwersji do CMYK jako czerń czterokolorowa, a drukarnie chcą czystej czerni K100 (np. `CZCIONKA = …, kolor=#000`). W PDF dla drukarni w CMYK tylko `#000` (w szablonie i w ikonach SVG) daje czystą czerń K100 – [opis](aplikacja.md#okna). Tekst i ważne elementy trzymaj co najmniej 3 mm od krawędzi karty, a tło prowadź do samej krawędzi (spad dorysuje aplikacja). Obrazek `dopasuj=wypełnij` albo `rozciągnij` przy krawędzi zostaje w spadzie w miejscu i skali – żeby spad nie był pusty, obraz musi wystawać poza ramkę o 3 mm (albo daj pod nim tło w kolorze brzegu). Sprawdza to Raport w trybie drukarni – [opis](aplikacja.md#raport).

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

Przykład – złota ramka tylko dla rzadkich kart:

```
PROSTOKĄT = 1.5, 1.5, 60, 85, kolor=brak, obwódka=1.2, kolor_obwódki=#C9A227, jeśli=[Rzadka]=tak
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
