# Profile drukarni (od 0.7.0)

Okno **Plik → PDF dla drukarni…** i zlecenie `pdf` z kluczem `drukarnia` biorą ustawienia z **profilu drukarni**. Profil ustala spad, profil kolorów (ICC), PDF/X-4, limit farby (TAC), nadruk czerni, rewersy, układ stron i nazwy plików. Ręcznie wybiera się tylko karty i talie.

| Profil | Skąd | Do zmiany |
|---|---|---|
| **LongPack** | `app/drukarnie/longpack.json` (w aplikacji) | nie |
| **Printnet** | `app/drukarnie/printnet.json` (w aplikacji) | nie |
| **Własne ustawienia** | `~/Library/Application Support/KarKa/drukarnie/wlasne.json` | tak – w oknie (zapis przy **Zapisz PDF**) |

„Własne ustawienia” są wspólne dla wszystkich projektów. Bez zapisanego pliku biorą ustawienia okna PDF dla drukarni z wersji 0.6.x (spad, strony, CMYK, profil, nadruk, rewersy), więc PDF wychodzi jak dotąd – tylko domyślnie jako PDF/X-4.

Format jest wspólny dla KarKi i przyszłego osobnego narzędzia do sprawdzania gotowego PDF (wariant B z issue #85): oba czytają te same pliki.

## Format (wersja 1)

Plik JSON w UTF-8. Przykład – `longpack.json`:

```json
{
  "format": 1,
  "id": "longpack",
  "nazwa": "LongPack",
  "opis": "Offset – karty do gier",
  "spad": 3,
  "strefa": 3,
  "promienRogu": 5,
  "promienRoguPotwierdzony": false,
  "icc": "iso300",
  "tac": 300,
  "pdfx": "PDF/X-4",
  "nadrukCzerni": true,
  "rewersy": true,
  "strony": "dwapliki",
  "wzorNazwy": "{projekt}_{komponent}_{strona}_{jezyk}_{wersja}",
  "strona": { "awersy": "Front", "rewersy": "Back", "razem": "" },
  "komponent": "Playingcards",
  "jezyk": "PL",
  "minTekstPt": null,
  "uwagi": ["Strefa bezpieczna 3 mm od linii cięcia (cięcie ±1 mm)"]
}
```

| Pole | Typ | Co | Używa KarKa (0.7.0) |
|---|---|---|---|
| `format` | liczba | wersja formatu – `1` | tak (inny = błąd) |
| `id` | tekst | `a-z`, `0-9`, `-`; równe nazwie pliku; `wlasne` zarezerwowane | tak – klucz zlecenia `drukarnia` |
| `nazwa`, `opis` | tekst | nazwa w oknie i w komunikatach, opis w podsumowaniu | tak |
| `spad` | mm, 0–10 | spad w PDF (strona = karta + 2 × spad) | tak |
| `strefa` | mm albo `null` | strefa bezpieczna od linii cięcia | nie (opis; dla narzędzia sprawdzającego) |
| `promienRogu` | mm, 0–20, albo `null` | promień narożnika wykrojnika – LongPack i Printnet: 5 mm z rysunku formatów Fabryki Kart (2019, s. 7), drukarnie go nie podają | Raport drukarni (od 0.7.18): odstęp od łuku w rogach ([drukarnia.md](drukarnia.md#zaokrąglone-rogi-od-0718-issue-146)); `null` – tylko `KARTA … zaokrąglenie=` z szablonu; w oknie: „Narożniki: promień …” |
| `promienRoguPotwierdzony` | `true`/`false` | `false` – w oknie i w raporcie dopisek „nie potwierdzony przez drukarnię” | tak (domyślnie `true`) |
| `icc` | tekst | `iso300` (ISO Coated v2 300 % ECI), `fogra39`, `fogra51`, `rgb` (bez konwersji) albo ścieżka do pliku `.icc` (tylko Własne) | tak |
| `tac` | % albo `null` | limit całkowitego pokrycia farbą – pomiar po konwersji, przekroczenie = ostrzeżenie | tak |
| `pdfx` | `"PDF/X-4"` albo `null` | metadane PDF/X-4 po konwersji CMYK | tak |
| `nadrukCzerni` | `true`/`false` | nadruk czarnego tekstu K100 | tak |
| `rewersy` | `true`/`false` | strony rewersów | tak |
| `strony` | tekst | `osobno` – awersy, wspólny rewers na ostatniej stronie, różne rewersy w drugim pliku; `dwapliki` – awersy i rewersy zawsze w dwóch plikach (wspólny rewers = plik z jedną stroną); `naprzemian` – jeden plik: awers 1, rewers 1, awers 2… | tak |
| `wzorNazwy` | tekst | wzór nazwy pliku bez `.pdf`, musi mieć `{projekt}` | tak |
| `strona` | obiekt | wartości `{strona}`: `awersy`, `rewersy`, `razem` (jeden plik) | tak |
| `komponent`, `jezyk` | tekst | wartości `{komponent}` i `{jezyk}` | tak |
| `minTekstPt` | obiekt albo `null` | minimalny rozmiar tekstu, np. `{ "czarny": 6, "kontra": 8 }` (`czarny` – tekst `#000`, `kontra` – każdy inny kolor) | Raport drukarni (od 0.7.6; `null` – 6 i 8 pt) |
| `uwagi` | lista tekstów | wymagania drukarni pokazywane w oknie | tak (tylko pokazuje) |

Nieznane pola są pomijane (zgodność w przód). Zła wartość znanego pola: w `wlasne.json` – KarKa bierze domyślne Własne ustawienia; w profilu wbudowanym (błąd paczki) – profile wbudowane nie pokazują się w oknie, a zlecenie z nimi kończy się `ok: false`.

### Nazwy plików

Człony wzoru: `{projekt}` (`PROJEKT =` z szablonu, bez niego nazwa folderu), `{komponent}`, `{strona}`, `{jezyk}`, `{wersja}` (`WERSJA =` z szablonu), `{dopiski}` (` – wybrane`, ` – zmienione`). **Pusty człon znika razem ze znakami rozdzielającymi przed nim** (spacja, `_`, `–`, `-`). Bez `{dopiski}` we wzorze dopiski idą na koniec nazwy. Znaki `/` i `:` zamieniają się na `-`.

| Wzór | Wynik |
|---|---|
| `{projekt}_{komponent}_{strona}_{jezyk}_{wersja}` (LongPack, `WERSJA = 1.2`) | `Wieże_Playingcards_Front_PL_1.2.pdf`, `Wieże_Playingcards_Back_PL_1.2.pdf` |
| to samo bez `WERSJA` | `Wieże_Playingcards_Front_PL.pdf` |
| `{projekt} – printnet{dopiski}` (Printnet, tylko zaznaczone) | `Wieże – printnet – wybrane.pdf` |
| `{projekt} – drukarnia{dopiski} – {strona}` (Własne – domyślnie, jak do 0.6.8) | `Wieże – drukarnia.pdf` albo `… – awersy.pdf` / `… – rewersy.pdf` |

Przy `strony = dwapliki` bez rewersów (żadna talia nie ma `[REWERS]` albo rewersy wyłączone) powstaje jeden plik z członem `{strona}` = `awersy` (LongPack: `…_Front_PL.pdf`).

W oknie zapisu pierwszy plik ma nazwę z profilu – można ją zmienić; drugi plik (rewersy) powstaje obok, z nazwą z profilu. Zlecenie z kluczem `plik` używa podanej nazwy (drugi plik: `<plik> – rewersy.pdf`).

### Spad z profilu a spad w szablonie

- Szablon deklaruje **ten sam** spad – pliki ze spadem idą do PDF w całości.
- Szablon deklaruje **większy** spad – PDF jest przycinany do spadu profilu; w wyniku zlecenia pole `informacje`, w oknie i pasku stanu opis.
- Szablon deklaruje **mniejszy** spad – **błąd**: PDF nie powstaje (`ok: false`), bo spadu nie da się dorobić z pliku.
- Szablon **nie deklaruje** spadu – spad jest dorabiany (tło powiększone, obrazki przy krawędzi przedłużone) z ostrzeżeniem, jak do 0.6.x.

## Wbudowane profile

**LongPack** (offset, wytyczne „Games artwork guidelines” 2025-04-16): spad 3 mm, strefa 3 mm, ISO Coated v2 300 % (decyzja właściciela 26.10.2026 – wytyczne podają Fogra39, bez limitu TAC), TAC 300 %, PDF/X-4, nadruk czerni, rewersy **zawsze w osobnym pliku** (decyzja 27.10.2026), nazwy `Projekt_Komponent_Strona_Język_Wersja`.

**Printnet** (druk cyfrowy, Ricoh Pro C9210; wymagania z printnet.pl, 26.10.2026): spad 2 mm, strefa 3 mm, ISO Coated v2 300 %, TAC 300 % (250 % laminowane, 200 % niepowlekana strona kartonu – zmień w Własnych ustawieniach), PDF/X-4, jeden plik z awersem i rewersem na zmianę. Przezroczystość **nie jest spłaszczana** – Printnet przyjmuje takie pliki (decyzja 27.10.2026).

## PDF/X-4 i TAC

Po konwersji do CMYK (Ghostscript) KarKa dopisuje do każdego pliku: Output Intent z osadzonym profilem użytym do konwersji (`/S /GTS_PDFX`, warunek `FOGRA39` / `FOGRA51` albo `Custom` dla własnego `.icc`), `GTS_PDFXVersion = PDF/X-4` i `Trapped = False` w Info i XMP (zgodne), tytuł, daty i identyfikatory (`xmpMM:DocumentID`, `InstanceID`, `/ID`), usuwa ArtBox (TrimBox zostaje) i zapisuje nagłówek PDF 1.6. Przezroczystość zostaje (PDF/X-4 ją dopuszcza).

TAC: każda strona renderowana Ghostscriptem (`tiff32nc`, 150 dpi, `-dOverprint=/simulate`), suma C+M+Y+K na piksel – ta sama metoda co Podgląd wyjściowy w Acrobat Pro. Wynik w `wynik-pdf.json`: `cmyk.maksTAC`, `cmyk.limitTAC`, `cmyk.stronPonadLimit`, a dla każdego pliku `maksTAC`, `stronPonadLimit` i `tacStron` (maksimum każdej strony).
