# Ramki i linie przy linii cięcia (Raport w trybie drukarni)

Sekcja „Drukarnia: obwódki i ramki przy linii cięcia” w [Raporcie w trybie drukarni](aplikacja.md#raport) sprawdza, czy ramki, linie i boki pól nie leżą za blisko linii cięcia. Ten plik opisuje progi i pomiar (od 0.7.16, issue #138).

## Skąd progi

Wytyczne drukarni:

- **LongPack 2025** (s. 8, 21, 25): tolerancja cięcia **±1 mm**, strefa bezpieczna **3 mm** od linii cięcia, linie i tekst na żetonach „3 mm, min. 2,5”.
- **Fabryka Kart 2019** (s. 7): tolerancja cięcia ±1 mm, strefa bezpieczna 3 mm.

Do 0.7.15 raport dawał UWAGĘ dla ramek bliżej niż 5 mm. Tego progu nie ma w wytycznych, a dawał fałszywe UWAGI (np. ramka opisu w `04-karawana` na 3,5 mm). Od 0.7.16 (decyzja właściciela 29.10.2026):

| Odstęp od linii cięcia | Poziom | Znaczenie |
|---|---|---|
| mniej niż **2,5 mm** | **BŁĄD** | po cięciu ±1 mm linia może zostać ucięta albo wyraźnie krzywa |
| **2,5–3 mm** | **UWAGA** | poniżej strefy bezpiecznej – odstęp po cięciu będzie widocznie nierówny |
| **3–4 mm** (tylko linie i boki równoległe do krawędzi) | INFO | w strefie bezpiecznej, ale ciągła linia blisko krawędzi zdradza krzywe cięcie; **nie liczy się do wyniku** (sekcja zostaje z ✓, pozycje INFO są pod nią) |
| 4 mm i dalej | – | OK |

Odstęp liczy się od zewnętrznej krawędzi linii (z połową grubości obwódki), czyli tej bliżej cięcia.

Dodatkowo:

- **Obwódka karty** (`KARTA … obwódka=`) leży na samej linii cięcia – zawsze BŁĄD.
- **Krawędź urwana w spadzie** – BŁĄD. Linia albo bok przechodzi przez linię cięcia, ale kończy się między nią a końcem spadu. Przy przesunięciu cięcia koniec może wejść na kartę albo zostać na krawędzi. Linię trzeba doprowadzić do końca spadu. Spad bierze się z szablonu (`KARTA = 63, 88, spad=3`), a bez deklaracji przyjmuje się 3 mm (spad dorabiany w PDF dla drukarni). Nie dotyczy prostokątów dotykających krawędzi karty, bo PDF dla drukarni i tak przedłuża je do końca spadu.
- **Linia nierównoległa do krawędzi** (np. pionowy separator), która kończy się bliżej niż 3 mm przed linią cięcia – UWAGA (od 0.7.7).
- **Linia w spadzie** równoległa do cięcia, nie dalej niż 1 mm za nim – BŁĄD, bo przy cięciu ±1 mm wejdzie na kartę.

## Co jest ramką, otokiem i polem karty

- **Ramka / obwódka** – obwódka `PROSTOKĄT` / `ELIPSA` (`obwódka=`), linia `LINIA` albo linia narysowana w grafice (SVG, obrazek) wewnątrz karty.
- **Bok pola** – brzeg wypełnionego kształtu albo obszaru o innym kolorze (np. pole opisu bez obwódki). Z szablonu nie jest oceniany, z obrazu karty – tak jak ramka.
- **`OTOK`** ([komendy](komendy.md)) sięga końca spadu, więc nie jest ramką przy cięciu i nie podlega tym progom. Raport sprawdza tylko jego szerokość: otok węższy niż 3 mm daje UWAGĘ. Wewnętrzna krawędź otoku jest pomijana w pomiarze z obrazu.
- **Elementy sięgające końca spadu** (linia, która przechodzi przez cięcie aż do końca spadu, tło, obrazki ze spadem) są celowe i nie są zgłaszane.

## Dwa pomiary

1. **Z szablonu** – geometria elementów w mm (obwódki `PROSTOKĄT`, `ELIPSA`, `KARTA`, linie `LINIA`), dokładna.
2. **Z obrazu karty** (od 0.7.16) – zrzut karty ze spadem (tak jak w PDF dla drukarni) w **300 dpi** (1 piksel = **0,085 mm**). Przy każdej krawędzi pas od 3 mm w spadzie do 4,5 mm w głąb karty, bez 3 mm przy narożnikach (zaokrąglone rogi) i bez obszarów tekstu i ikon (odstęp tekstu sprawdza osobna sekcja). Widzi to, czego szablon nie opisuje: ramki w plikach SVG i obrazkach, boki pól bez obwódki.
   - Linia to co najmniej **10 mm** krawędzi równoległej do cięcia, na której jasność zmienia się wyraźnie (L* o więcej niż 15). Przerwy krótsze niż 2 mm są łączone, więc linia przerywana też się liczy.
   - **Tolerancja ±0,15 mm**: progi są obniżone o 0,15 mm, bo pomiar rastrowy ma błąd ok. 1 piksela. Linia na 3,0 mm zmierzona jako 2,9 mm nie daje UWAGI.
   - Krawędzie, które ocenia już pomiar z szablonu (±0,3 mm), nie są powtarzane.
   - Wynik jest zapamiętany według odcisku karty, więc kolejny raport bez zmian w kartach liczy się od razu. Pierwszy raport robi zrzut każdej niepowtórzonej karty (przykłady: ok. 0,5–3 s, panel Raport pokazuje postęp „karta i z n”). Gdy zrzut się nie uda, sekcja pokazuje błąd „Nie zmierzono linii z obrazu…” zamiast ✓.

## Znane ograniczenia pomiaru z obrazu

- **Słaby kontrast** – jasnoszara linia na białym tle albo ciemna linia na ciemnym otoku (zmiana jasności do 15) nie jest wykrywana. **„0 uwag” nie znaczy „na pewno nie ma ramki”** – taką linię trzeba sprawdzić samemu.
- Linie krótsze niż 10 mm wzdłuż krawędzi, skośne i łuki nie są liczone jako ramki.
- Linia urwana w spadzie jest wykrywana, gdy ma najwyżej 3 mm szerokości. Szersze obszary (obrazek, który nie sięga końca spadu) zgłasza sekcja „obrazek przy krawędzi nie sięga do końca spadu”.

## Zlecenie `raport`

Z `drukarnia = tak` wynik ma `drukarnia.obwodki` (BŁĘDY i UWAGI; z obrazu – `element: "OBRAZ"`, `odstep` ujemny = w spadzie, `urwana: true` z `spad` i `u` – miejsce wzdłuż krawędzi w mm), `drukarnia.obwodkiInfo` (INFO 3–4 mm) i `drukarnia.liniiNiezmierzone` (karty bez pomiaru z obrazu). Zlecenie czeka na koniec pomiaru. W `raport[]` sekcja ma pole `info` z pozycjami INFO.
