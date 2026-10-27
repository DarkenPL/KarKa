# Aplikacja KarKa (Kawia Karciana)

KarKa to dawny **Generator kart** – od wersji 0.5.0 pod nową nazwą.

## Pobieranie

**[Pobierz najnowszą wersję](https://github.com/DarkenPL/KarKa/releases/latest/download/KarKa.dmg)** (`KarKa.dmg`).

Aplikacja działa na Macach z procesorem Apple (M1–M4). Jaki masz procesor, sprawdzisz w  → **Ten Mac** (pozycja „Układ”).

Plik budowany jest automatycznie po każdej zmianie w gałęzi `main`, a każda wersja dostaje własne wydanie (`v0.4.3`, `v0.4.4`…) w zakładce **Releases** – starsze wersje zostają do pobrania. Wersja robocza z pull requestu jest w zakładce **Actions** → uruchomienie „Aplikacja macOS” → **Artifacts**.

## Instalacja i pierwsze uruchomienie

1. Otwórz pobrany plik `KarKa.dmg` i w okienku przeciągnij **KarKa** na folder **Programy**. Potem możesz go wysunąć (w Finderze ⏏) i skasować.
2. Aplikacja nie jest podpisana certyfikatem Apple (wymaga płatnego konta deweloperskiego), więc przy pierwszym uruchomieniu macOS ją zablokuje. Odblokowujesz ją raz:
   - kliknij aplikację **prawym przyciskiem → Otwórz → Otwórz**,
   - albo, jeśli macOS pokaże tylko „Gotowe/Przenieś do Kosza”: otwórz **Ustawienia systemowe → Prywatność i ochrona**, przewiń w dół i kliknij **Otwórz mimo to** przy „KarKa”.

   Gdyby macOS twierdził, że aplikacja jest „uszkodzona”, wpisz w Terminalu:

   ```
   xattr -dr com.apple.quarantine "/Applications/KarKa.app"
   ```

## Aktualizacje

Od wersji 0.5.0 („Gołąb pocztowy”) aplikacja aktualizuje się sama – bez ponownego pobierania DMG i bez ponownego odblokowywania.

**Przejście z Generatora kart (0.4.x):** zainstaluj KarKę z DMG jak przy pierwszej instalacji. Przy pierwszym uruchomieniu KarKa przejmie ostatnie projekty i ustawienia okien druku i eksportu. Starą aplikację **Generator kart** usuń potem z Programów (przenieś do Kosza); jej folder danych `~/Library/Application Support/Generator kart` też można skasować.

- **Kiedy sprawdza:** przy każdym uruchomieniu (po kilku sekundach; bez komunikatu, gdy nie ma nowej wersji albo internetu), z menu **KarKa → Sprawdź aktualizacje…** i [zleceniem z pliku](#zlecenia-z-pliku) `aktualizacja`.
- Gdy jest nowa wersja, okno pokazuje, co się zmieniło: **Zainstaluj**, **Później** albo **Pomiń tę wersję** (przy starcie aplikacja nie zapyta o nią ponownie; z menu – tak).
- **Mała aktualizacja** (prawie zawsze, ok. 1 MB): pobiera się sam kod Generatora (silnik kart, okna, przykłady) do `~/Library/Application Support/KarKa/kod`, a aplikacja uruchamia się ponownie. Aplikacja w Programach się nie zmienia, więc macOS o nic nie pyta.
- **Pełna aktualizacja** (ok. 120 MB): gdy nowa wersja ma nowszy Electron (silnik okna), pobiera się cała aplikacja. Po pobraniu aplikacja zamyka się, podmienia w Programach i uruchamia od nowa. macOS może wtedy raz zapytać o dostęp do folderów z projektami.
- Przed ponownym uruchomieniem aplikacja pyta o niezapisane zmiany w edytorze szablonu.
- Pobrane pliki są sprawdzane sumą kontrolną SHA-256 z wydania; uszkodzony plik nie zostanie zainstalowany.
- Gdyby nowa wersja kodu nie uruchomiła się poprawnie, przy następnym starcie aplikacja wraca do wersji z Programów.
- Pełna podmiana wymaga prawa zapisu w folderze aplikacji (konto administratora przy `/Applications`). Bez niego okno proponuje pobranie DMG ze strony wydania.

Wersję, nazwę wydania i źródło kodu pokazuje **KarKa → O aplikacji KarKa** („kod z aktualizacji” = mała aktualizacja).

## Praca

1. **Plik → Nowy projekt… (⌘N)** tworzy folder gry o podanej nazwie, z gotowym szablonem (`Szablony/gra.txt`), plikiem kart (`karty.csv`), ikonami, przykładowym obrazkiem i krótką instrukcją (`CZYTAJ.txt`), i od razu go otwiera. Wystarczy zmieniać pliki.

   **Plik → Otwórz szablon… (⌘O)** otwiera istniejący projekt: wskaż plik szablonu (`.txt`) swojej gry.
   - Szablon wskazuje resztę plików: dane kart (`DANE = …`), obrazki, czcionki.
   - Ścieżki liczą się od folderu projektu: tego, w którym leży szablon, albo folderu nad `Szablony`, gdy szablon leży w takim podfolderze.
   - Szablon możesz też otworzyć z Findera: prawy przycisk → **Otwórz za pomocą → KarKa**.
2. Karty odświeżają się same po każdym zapisie szablonu, pliku z kartami albo obrazka.
3. **Edytor szablonu** (przycisk **Edytor** albo ⌥⌘E) otwiera szablon w panelu obok kart:
   - kolorowanie składni: komendy, `[Kolumny]`, `{ikony}`, opcje, liczby, kolory (podkreślone swoim kolorem), komentarze;
   - podgląd na żywo: karty zmieniają się w trakcie pisania, jeszcze przed zapisem;
   - błędy: wiersz z błędem jest podświetlony, a lista pod edytorem i Uwagi nad kartami prowadzą kliknięciem do właściwego wiersza;
   - **⌘S** zapisuje szablon, a ⌘Z cofa zmiany;
   - aplikacja pyta o zapis niezapisanych zmian przy zamykaniu okna, wyjściu i otwieraniu innego projektu. Kropka w czerwonym przycisku okna oznacza niezapisane zmiany;
   - gdy plik zmieni się na dysku, np. w innym edytorze, a w panelu są niezapisane zmiany, aplikacja pyta, którą wersję zostawić;
   - przykłady są w edytorze tylko do odczytu.

   Szablon nadal możesz edytować w dowolnym innym edytorze tekstu.
4. **Pasek** nad kartami: **Edytor**, **Historia**, **Raport**, wybór talii w podglądzie i **Eksport obrazków…**. Pod nim wiersz stanu: liczba kart, karty zmienione od ostatniego PDF i zaznaczone karty. Pozostałe polecenia są w menu **Plik** (druk, PDF, eksport do playingcards.io) i **Widok** (odświeżanie, raport, **Pokaż rewersy kart**).
   - **Widok → Pokaż rewersy kart** (od 0.6.5): zamiast awersów podgląd pokazuje rewers każdej karty, w tej samej kolejności, z podpisem „ID · Rewers N” (numer wariantu, gdy talia ma rewersy zależne od karty). Karta bez rewersu ma szare pole „bez rewersu”. To tylko podgląd – druk, eksport i wybór kart działają jak zwykle. Ustawienie nie jest zapamiętywane: nowa zakładka i ponowne wczytanie projektu pokazują awersy.
5. <a id="okna"></a>**Okna druku i eksportu.** Eksport obrazków (⌘E), druk (⌘P), zapis PDF (⇧⌘S) i pokój playingcards.io otwierają okno z opcjami. Okno **pamięta ostatnie ustawienia osobno dla każdego projektu**. Enter zatwierdza, Esc anuluje.
   - **Obrazki:** rozdzielczość 150 dpi (ekran, playtesty online) albo 300 dpi (druk, drukarnie), format JPG albo PNG (przezroczyste zaokrąglone rogi), które karty, talie, rewersy jako osobne pliki.
   - **Druk i PDF:** układ, linie cięcia, spad, rewersy, **szkic** (bez teł i obrazków, czarny tekst – oszczędza tusz), które karty, talie; przyciski **Drukuj…** i **Zapisz PDF**.
     - Układy: **A4** (karty 1:1 w siatce, po każdym arkuszu arkusz rewersów), **każda karta na osobnej stronie** i **Drukarnia**.
     - **Talie na wspólnych arkuszach** (A4, od 0.6.0, domyślnie włączone): karty wszystkich talii idą ciągiem – następna talia zaczyna się zaraz po poprzedniej, bez pustych miejsc, więc projekt z wieloma małymi taliami drukuje się na dużo mniejszej liczbie kartek. Karty pionowe i poziome tej samej wielkości (63 × 88 i 88 × 63 mm) są na tych samych arkuszach; karty innej wielkości (np. 44 × 68 mm) – na osobnych. Arkusz rewersów jest składany **miejsce po miejscu**: za każdą kartą jej własny rewers. Gdy wszystkie karty arkusza mają ten sam rewers, arkusz rewersów jest wypełniony w całości (jak dotąd); gdy są różne, miejsca bez karty i karty talii bez rewersu zostają puste. Rewersy zależne od karty (kolumny w `[REWERS]`, od 0.6.1 – [komendy](komendy.md)) działają tak samo: za każdą kartą jej rewers. Karty innej wielkości idą na osobną serię arkuszy, więc kolejność kart na arkuszach to kolejność talii w obrębie jednej wielkości (np. talia 44 × 68 mm stojąca między dwiema taliami 63 × 88 mm trafi na osobne arkusze po nich). Po wyłączeniu opcji każda talia ma osobne arkusze (jak do 0.5.x).
     - **Druk dwustronny – odwracanie wzdłuż dłuższej krawędzi:** arkusz rewersów jest lustrem arkusza awersów (w każdym rzędzie kolumny w odwrotnej kolejności), tak jak go odwraca drukarka z ustawieniem „dłuższa krawędź” (long edge). Karty poziome leżą na arkuszu obrócone; ich rewers jest obrócony w drugą stronę niż awers (od 0.6.0), żeby po odwróceniu karty na bok był „do góry” tak jak awers. Przy rewersach z napisem sprawdź to raz wydrukiem próbnym: wydrukuj przykład **07-gildie** (Plik → Przykłady) dwustronnie, odwracanie wzdłuż dłuższej krawędzi, wytnij kilka kart i odwróć każdą na bok – strzałka „↑ góra” na rewersie ma wskazywać tę samą stronę co góra awersu, a rewers ma należeć do tej samej talii co awers (Złodzieje – bez rewersu). Przesunięcie kart względem rewersów koryguje pole niżej.
     - **Przesunięcie rewersów** (A4, od 0.5.1): drukarki przy druku dwustronnym często przesuwają drugą stronę o 1–2 mm. Wydrukuj próbny arkusz, przyłóż kartkę do światła i zmierz, o ile rewersy uciekły; w oknie wpisz korektę w mm (np. rewers 1 mm za bardzo w prawo → „w prawo” −1, 0,5 mm za nisko → „w dół” −0,5). Okno zapamiętuje ją dla projektu.
     - **Linie cięcia** (układ A4): znaczniki na marginesie (gilotyna, nóż), przerywane szare linie wzdłuż krawędzi każdej karty (nożyczki) albo jedno i drugie. Arkusz rewersów nie ma linii.
     - **Drukarnia** (PDF dla drukarni, np. LongPack): jedna strona na kopię karty; strona większa od karty o **spad** z każdej strony. Spad do wyboru **2 albo 3 mm, domyślnie 3 mm** (wymóg drukarni gier): karta 63 × 88 mm daje stronę 69 × 94 mm. Projekt, w którym okno zapamiętało 2 mm, zostaje przy 2 mm; inna zapamiętana wartość pokazuje się jako trzecia pozycja. Strona PDF ma **dokładny** rozmiar, a w pliku są ustawione **TrimBox** (linia cięcia, czyli karta bez spadu) i BleedBox (cała strona) – z nich drukarnie czytają format po cięciu. Przy kartach różnej wielkości strona ma rozmiar największej karty, mniejsza stoi na środku, a jej TrimBox jest wokół niej. Bez znaczników cięcia i bez zaokrąglonych rogów (rogi wycina drukarnia). Tło karty sięga do krawędzi strony; prostokąty i obrazki (`dopasuj=wypełnij` albo `rozciągnij`) dotykające krawędzi karty są przedłużone o spad: **ramka obrazka rośnie o spad, ale sam obraz zostaje w tym samym miejscu i skali** (jak w InDesignie) – wewnątrz linii cięcia karta wygląda dokładnie jak w podglądzie. Spad wypełnia tylko to, co obraz miał poza ramką (przy `wypełnij` – wystający fragment); gdy obraz dokładnie mieści się w ramce, w spadzie widać tło karty pod spodem, a [Raport w trybie drukarni](#raport) to zgłasza. Od 0.6.2 projekt może deklarować spad w szablonie i dostarczać pliki ze spadem – wtedy nic nie jest dorabiane. Teksty, ikony, linie i obwódka karty zostają na miejscu, więc trzymaj je min. 3 mm od krawędzi (sprawdza to [Raport w trybie drukarni](#raport)). Kolor: PDF jest w RGB albo – po włączeniu opcji **Druk w drukarni (CMYK, Fogra39)** – w CMYK (opis niżej). **Spad z szablonu (od 0.6.2):** gdy szablon deklaruje `spad=` w `KARTA` ([komendy](komendy.md#spad-w-szablonie-od-062)), PDF ma ten spad (największy zadeklarowany), a pole Spad w oknie jest nieaktywne i pokazuje „Spad z szablonu: 3 mm”; tło i obrazki przy krawędzi są plikami ze spadem i trafiają do PDF w całości. Bez deklaracji pole Spad działa jak dotąd, a przy nim stoi ostrzeżenie ⚠ (spad jest dorabiany awaryjnie). Po zapisie PDF pasek stanu dopisuje „· Uwaga: …” (projekt bez spadu w szablonie, talia ze spadem innym niż w PDF).
     - **Strony** (układ Drukarnia):
       - **Awersy i rewersy osobno** (domyślnie): plik awersów, karta na stronę, każda kopia osobno. Gdy wszystkie karty mają ten sam rewers, rewers jest **ostatnią stroną** tego pliku. Gdy rewersy są różne (kilka talii z różnymi rewersami), powstają **dwa pliki**: `<nazwa> – awersy.pdf` i `<nazwa> – rewersy.pdf`, w którym strona N to rewers awersu N (karta talii bez rewersu daje pustą stronę). Tak samo przy rewersach zależnych od karty (od 0.6.1) – strona N to rewers tej konkretnej karty.
       - **Na przemian:** awers, rewers, awers, rewers… w jednym pliku (tak było do 0.5.8).
       - Bez rewersów (pole „Rewersy” wyłączone) – tylko awersy.
     - Drukarnie chcą obrazków min. **300 dpi** w rozmiarze na karcie – Raport pokazuje obrazki o mniejszej rozdzielczości.
     - **Druk w drukarni (CMYK, Fogra39)** (od 0.5.11; układ Drukarnia): gotowy PDF przechodzi na końcu przez Ghostscript i jest wyłącznie w **CMYK** (profil drukarni). Czarne (`#000`) teksty, ikony, linie i kształty wychodzą jako czysta czerń **C0 M0 Y0 K100** (czarny tekst domyślnie z nadrukiem – niżej), pozostałe kolory przechodzą przez profil drukarni, przezroczystość zostaje. To PDF 1.6, bez PDF/X i bez Output Intent – drukarnie gier, np. LongPack, ich nie wymagają. TrimBox i BleedBox są ustawiane tak jak w RGB (jeszcze raz po konwersji). Obrazki nie są kompresowane stratnie ani zmniejszane.
       - **Wymaga Ghostscripta 10 lub nowszego** z Homebrew: `brew install ghostscript`. Aplikacja szuka `/opt/homebrew/bin/gs`, potem `/usr/local/bin/gs`. Bez niego opcja jest wyszarzona z podpowiedzią. Ghostscript nie jest dołączony do KarKi (licencja AGPL).
       - Opcja jest domyślnie włączona, gdy Ghostscript jest zainstalowany; wybór jest zapamiętywany dla projektu jak inne opcje okna.
       - **Profil:** ISO Coated v2 (ECI) – Fogra39 (domyślny), PSO Coated v3 – Fogra51 albo **inny plik .icc…** (musi być profilem CMYK, inaczej aplikacja pokaże komunikat). Profile ECI nie są w aplikacji (licencja ECI/Heidelberg nie pozwala ich rozpowszechniać). Przy pierwszym użyciu aplikacja pyta „Pobrać profil … z eci.org?” (paczka ok. 17 MB dla Fogra39, ok. 2 MB dla Fogra51), zapisuje z niej tylko jeden plik w `~/Library/Application Support/KarKa/profile/` i sprawdza sumę SHA-256. Profil jest osadzany w gotowym PDF (to dozwolone).
       - Brak internetu albo zła suma – komunikat „pobierz ręcznie z eci.org i wskaż plik”; aplikacja nie używa po cichu innego profilu. Ręcznie: [eci_offset_2009.zip](https://eci.org/lib/exe/eci_offset_2009.zip) → `ECI_Offset_2009/ISOcoated_v2_eci.icc` (Fogra39), [pso-coated_v3.zip](https://eci.org/lib/exe/pso-coated_v3.zip) → `PSOcoated_v3.icc` (Fogra51); potem wybierz **inny plik .icc…**.
       - **Pliki** mają te same nazwy co w RGB (`… – drukarnia – awersy.pdf` i `– rewersy.pdf` albo jeden plik), tylko zawierają CMYK. Przy dwóch plikach konwertowane są oba. Przy błędzie konwersji nie powstaje żaden plik, tylko komunikat – plik RGB nie udaje CMYK.
       - **Nadruk czarnego tekstu (K100)** (od 0.6.4; domyślnie włączony, jak w InDesignie – „Nadrukowuj próbkę [Czarny] przy 100%”): tekst w kolorze `#000` (czysta czerń K100) jest w PDF **nadrukowywany** na tło (`/op true`, `/OPM 1` w stanie graficznym), a nie wybijany: pod literami zostaje kolor tła, więc na kolorowym tle litery nie są jaśniejsze, a przy niedopasowaniu pasowania wokół cienkich liter nie pokazuje się biały papier. Dotyczy wypełnienia i obrysu liter (`obrys=` w `#000`). Prostokąty, linie, ikony-obrazki i obrazki w K100 oraz tekst w innych kolorach (także biały i „prawie czerń”) – bez zmian (wybicie). Nadruk widać w Acrobacie w „Podglądzie nadruku” (zwykły podgląd PDF go nie pokazuje). Wyłączenie: pole „Nadruk czarnego tekstu” w oknie (zapamiętywane dla projektu) albo `nadrukczerni = nie` w zleceniu.
       - **Sprawdzenie po konwersji:** aplikacja sprawdza każdy plik – zero kolorów RGB, obrazki tylko w CMYK, TrimBox na każdej stronie, liczba stron – i liczy czystą czerń (`0 0 0 1 k`) oraz obiekty tekstu z nadrukiem.
       - **Dla autora kart:** K100 dostaje tylko czerń `#000` w szablonie i w ikonach SVG. Ciemne, ale nie czarne kolory (np. domyślny `#1d1b19`) wychodzą jako czerń złożona z kilku farb (rich black), a drukarnia odrzuca tekst w takiej czerni. Przed PDF dla drukarni sprawdź [Raport w trybie drukarni](#raport) (ostrzeżenie „prawie czerń”).
       - **Obrazki z profilem kolorów** (np. Display P3 z iPhone'a czy Photoshopa) są przeliczane do CMYK z własnego profilu – bez utraty nasycenia względem bezpośredniej konwersji P3 → CMYK (próba opisana w issue #66).
   - **playingcards.io:** rozdzielczość i talie ([opis](playingcards.md)).
   - **Które karty:** wszystkie, tylko zaznaczone albo tylko zmienione od ostatniego PDF.
6. **Zaznaczanie i zmienione karty:**
   - Kliknij kartę w podglądzie, żeby ją zaznaczyć (niebieska ramka), Shift+klik zaznacza zakres. Liczbę zaznaczonych i przycisk **Wyczyść** widać w wierszu stanu. Zaznaczenie zostaje po odświeżeniu kart.
   - Po każdym zapisie PDF aplikacja zapamiętuje wygląd wydrukowanych kart. Karty zmienione od tamtej pory mają **pomarańczową** obwódkę, a nowe **zieloną**. **Porównaj** pokazuje każdą zmienioną kartę „przed” (z ostatniego PDF) i „teraz”.
   - Zmianą jest wszystko, co widać na karcie: tekst z danych, szablon, obrazek. Karty z częściowego wydruku są zapamiętywane pojedynczo, więc „zmienione” znaczy „zmienione od ostatniego wydruku tej karty”. Druk przez systemowe okno drukowania nie zapamiętuje kart, bo nie wiadomo, czy wydruk się udał.
7. **Historia wersji** (przycisk **Historia** albo **Plik → Historia wersji…**): aplikacja sama zapisuje kopię szablonu i plików z kartami (CSV, XLSX) w ukrytym folderze `.historia` projektu – w ważnych chwilach, a nie przy każdym zapisie pliku:
   - przy **otwarciu projektu**, **zapisie PDF** („PDF A4”, „PDF – drukarnia”, „PDF – osobne strony”), **druku**, **eksporcie** obrazków, pokoju playingcards.io i katalogu oraz przy **zamknięciu projektu** (innym szablonie albo wyjściu z aplikacji),
   - jako **Siatka bezpieczeństwa**: co najwyżej raz na godzinę, jeśli coś się zmieniło od ostatniej kopii – żeby długa praca bez eksportu też miała kopie,
   - przed przywróceniem starszej wersji, w punktach nazwanych przez Ciebie (pole „np. przed playtestem 3” → **Zapisz punkt**) i w punktach od innych programów (niżej).
   - Kopia powstaje tylko wtedy, gdy plik naprawdę się zmienił; eksport bez zmian tylko oznacza chwilę opisem. Starsze kopie są przerzedzane: z ostatniej doby zostaje jedna na godzinę, z miesiąca jedna na dzień, starsze jedna na tydzień.
   - **Punkty** (opisy przy kopiach) zostają na zawsze: eksporty, druk, PDF, stan sprzed przywrócenia, punkty nazwane i od innych programów. Z otwarć projektu zostaje 10 ostatnich, z siatki bezpieczeństwa 24 ostatnie.
   - Przy każdej wersji: **Zmiany** (różnice linii względem obecnej wersji), **Pokaż karty** (podgląd kart z tamtej wersji; obrazki są obecne, bo nie są kopiowane) i **Przywróć…** (drugie kliknięcie potwierdza). Przed przywróceniem obecny stan trafia do historii, więc przywrócenie da się cofnąć.
   - Przykłady nie mają historii. Folder `.historia` możesz usunąć – historia zacznie się od nowa.
   - **Z innych programów** (np. gdy Claude zmienia pliki gry): punkt z opisem można dodać z konsoli – `node historia-cli.js punkt <folder projektu> "opis"` (także `lista` i `przywroc <nr>`; plik `app/historia-cli.js` z repozytorium, wymaga Node 18+) – albo przez **skrzynkę**: folder `.historia/przychodzace/<nazwa>/` z kopiami plików (ścieżki jak w projekcie, np. `Szablony/gra.txt`) i plikiem `opis.txt`. Aplikacja w ciągu kilku sekund zamienia go w punkt historii z tym opisem i usuwa folder. Konsola działa też tam, gdzie nie wolno usuwać plików (np. powłoka Claude bez zgody na usuwanie): zostają wtedy najwyżej pliki pomocnicze (`indeks.lock.wolna`, folder `zaimportowane`), które aplikacja sprząta przy następnym zapisie historii. Nazwa folderu w formie `2026-10-09T12-30-00` ustala datę punktu.
8. <a id="raport"></a>**Raport** (przycisk w pasku albo **Widok → Raport projektu**) sprawdza projekt: powtórzone ID, puste pola w kolumnach używanych w szablonie, kolumny, których szablon nie używa, karty pominięte (`Ilość = 0`), obrazki poniżej 300 dpi w rozmiarze na karcie (pliki SVG są pomijane), ikony bez użycia i obrazki w folderach projektu, do których nic się nie odwołuje. Raport odświeża się razem z kartami.
   - **Tryb drukarni** (przełącznik w panelu Raport, zapamiętywany) dodaje na początku raportu cztery sekcje:
     - „Drukarnia: tekst bliżej niż 3 mm od linii cięcia”: liczone z rzeczywistego tekstu po dopasowaniu (obwiednia liter i ikon w tekście, nie ramka pola `TEKST`), także elementy `IKONA`. Karty od najmniejszego odstępu z krawędzią (lewa, górna, prawa, dolna); panel pokazuje 25 pierwszych, pełna lista jest w zleceniu.
     - „Drukarnia: „prawie czerń” zamiast #000”: kolory tekstu, obrysów, obwódek, linii, ikon koloru i plików ikon SVG bardzo ciemne (jasność L* < 20), ale nie `#000`. Po konwersji do CMYK wychodzą czernią czterokolorową, a drukarnie chcą tekstu i małych ikon w czystej czerni K100. Domyślny kolor tekstu KarKi to `#1d1b19` – do druku w drukarni wpisz `kolor=#000` w `CZCIONKA`. W PDF w CMYK ([opis](#okna)) tylko `#000` daje czystą czerń K100.
     - „Drukarnia: kolor przy krawędzi karty (pas 0–3 mm)”: liczone z obrazka każdej karty (awersy i rewersy). Czarna jednolita ramka – drukarnia zaleca „border black” C40 M0 Y0 K100. Fiolet, szarość, brąz bez białej obwódki – słaba powtarzalność koloru między arkuszami, rozważ białą obwódkę. Biała obwódka (zewnętrzny 1 mm biały) – bez uwag. Pierwsze liczenie trwa chwilę, potem tylko zmienione karty.
     - „Drukarnia: nadruk czarnego tekstu (K100)” (od 0.6.4): ustawienie nadruku z okna Druk i PDF; przy wyłączonym – ostrzeżenie, że czarny tekst w PDF CMYK wycina tło. W wyniku zlecenia `raport` z `drukarnia = tak`: `drukarnia.nadrukCzerni` (`true` / `false`).
     - „Drukarnia: spad w szablonie” (od 0.6.2): talie bez deklaracji `spad=` (spad jest wtedy dorabiany awaryjnie) oraz pliki `TŁO` i `OBRAZEK` przy krawędzi, których proporcje nie pasują do ramki ze spadem (np. plik o proporcjach samej karty – „proporcje karty bez spadu”, przygotuj go ze spadem; `wypełnij` przytnie obraz, `rozciągnij` go zniekształci). Od 0.6.6 także obrazki „zmieść” przy krawędzi karty, których plik ma proporcje ramki ze spadem – zostaną pomniejszone i rozjadą się z tłem; dodaj `dopasuj=wypełnij` ([opis](komendy.md#spad-w-szablonie-od-062)). Wynik zlecenia `raport` z `drukarnia = tak`: `drukarnia.spadSzablonu` (`talie`, `bez`, `pliki`, od 0.6.6 `zmiesc` – `karta`, `plik`, `ramka`, `ramkaZeSpadem`, `obraz`, `skala`).
     - „Drukarnia: obrazek przy krawędzi nie sięga do końca spadu” (dotyczy tylko talii bez deklaracji spadu): obrazki `dopasuj=wypełnij` / `rozciągnij` dotykające krawędzi karty, których obraz nie wystaje poza ramkę o pełny spad (3 mm) – w spadzie widać wtedy tło pod obrazkiem. Wystawanie liczone z rozmiaru obrazka (przy `wypełnij` obraz jest skalowany tak, by wypełnić ramkę, i wystaje tylko w jednej osi; `rozciągnij` nie wystaje wcale). Rozwiązanie: powiększ obrazek poza krawędź karty albo daj pod spód tło w kolorze brzegu obrazka. Obrazki z `kadr=` i obrócone nie są sprawdzane.
9. Aplikacja pamięta ostatnie szablony (**Plik → Ostatnie projekty**) i przy starcie otwiera ostatni.

| Skrót | Działanie |
|---|---|
| ⌘N | Nowy projekt |
| ⌘O | Otwórz szablon |
| ⌘S | Zapisz szablon (z edytora) |
| ⌘E | Eksport obrazków (okno opcji) |
| ⌘P | Drukuj (okno opcji, potem systemowe okno drukowania) |
| ⇧⌘S | Zapisz PDF (okno opcji) |
| ⌥⌘E | Pokaż/ukryj edytor szablonu |
| ⌘R | Odśwież karty (automatyczne odświeżanie: **Widok → Odświeżaj automatycznie**) |

- **Eksport obrazków** zapisuje każdą kartę (i rewersy) jako osobny plik JPG albo PNG w folderze `Export` obok szablonu albo folderu `Szablony`.
  - Nazwy: `NazwaProjektu_NazwaTalii_NumerKarty_NumerKopii.jpg` (albo `.png`), np. `ZlotaWyprawa_Przedmioty_7_2.jpg`; rewers: `ZlotaWyprawa_Przedmioty_rewers.jpg`. Rewers zależny od karty (od 0.6.5) – plik na kartę: `ZlotaWyprawa_Przedmioty_7_rewers.jpg` ([opis](komendy.md#rewers-zależny-od-karty-od-061)).
  - Nazwa projektu pochodzi z komendy `PROJEKT = …` w szablonie, a bez niej z nazwy pliku szablonu. Numer karty to kolumna `ID` (gdy jej brak – numer wiersza), a numer kopii liczy się od 1 według kolumny `Ilość`.
  - Polskie znaki i spacje są pomijane (`Karty Wpływu` → `KartyWplywu`).
  - Pliki o tych samych nazwach są nadpisywane, inne pliki w `Export` zostają.
- **Eksport do playingcards.io** zapisuje nowy pokój (`NazwaProjektu – playingcards.pcio`) w folderze projektu – każda talia jako osobny stos ([opis](playingcards.md)). Stos ma jeden rewers: gdy karty talii mają różne rewersy (kolumny w `[REWERS]`, od 0.6.1), w pokoju jest najczęstszy z nich, a pasek stanu i wynik zlecenia (`ostrzezenia`) mówią o tym („talia X ma 3 różne rewersy – w pokoju użyto najczęstszego”).
- **Katalog talii** (**Plik → Eksport → Katalog talii (JPG)…**): dla każdej talii obrazek JPG – najpierw rewers (niebieska ramka; przy rewersach zależnych od karty – każdy wariant z podpisem „Rewers 2 · ×4”, od 0.6.5), potem siatka zmniejszonych awersów z podpisami (ID, nazwa, liczba kopii) – do przeglądu całej talii, instrukcji i dla testerów. Pliki `NazwaProjektu_NazwaTalii.jpg` w `Export/katalog`; obrazek ma najwyżej ok. 2000×2000 px, więc duże talie dzielą się na kilka plików (`_1`, `_2`…). Karty z za długim tekstem mają czerwoną ramkę.
  - Katalog można też zamówić bez klikania – [zlecenie z pliku](#zlecenia-z-pliku) `katalog`.
- **Przykłady** są tylko do odczytu. Eksport obrazków pyta wtedy o folder. Żeby zmieniać przykład, skopiuj jego folder z repozytorium i otwórz szablon kopii.

## Zlecenia z pliku

Otwarta aplikacja wykonuje polecenia zapisane w plikach – bez klikania. Służy to np. Claude, który pracuje na plikach gry i chce dostać PDF, obrazki albo raport z **Twojej** aplikacji (ta sama wersja, te same czcionki, zapamiętany wydruk do „tylko zmienione”).

1. W folderze projektu utwórz plik `.generator/zlecenia/<polecenie>` (bez rozszerzenia), np. `.generator/zlecenia/pdf`.
2. Plik może być pusty albo zawierać wiersze `klucz = wartość` (wiersze zaczynające się od `#` albo `;` są pomijane).
3. W ciągu kilku sekund aplikacja wykonuje zlecenie, **usuwa plik zlecenia** i zapisuje wynik `.generator/zlecenia/wynik-<polecenie>.json`. Kilka zleceń naraz wykonuje po kolei.

| Polecenie | Co robi | Klucze |
|---|---|---|
| `stan` | talie i karty (ID, nazwa, kopie), karty zmienione i nowe od ostatniego PDF, Uwagi – bez plików; od 0.6.5 przy talii `rewersy` (liczba różnych rewersów: wariantów rewersu zależnego, 1 – wspólny, 0 – bez `[REWERS]`), przy karcie `rewersZmieniony` i w wyniku `rewersyZmienione` (karty, którym od ostatniego PDF zmienił się rewers zależny) | – |
| `raport` | Raport projektu (powtórzone ID, puste pola, nieużywane kolumny, obrazki poniżej 300 dpi, nieużywane ikony i obrazki; od 0.6.5 sekcja „Rewersy zależne od karty” – liczba wariantów i kolumny z `[REWERS]`, których brak w danych – tylko w projektach z takim rewersem) – bez plików | `drukarnia` |
| `pdf` | jak **Plik → Zapisz PDF**; zapamiętuje wydruk (potem „tylko zmienione” i Porównaj) | `uklad` (a4 / pojedyncze / drukarnia), `ciecie` (znaczniki / nozyczki / oba), `strony`, `rewersy`, `wspolneArkusze`, `szkic`, `spad`, `profil`, `przesuniecieX`, `przesuniecieY`, `talie`, `id`, `tylkoZmienione`, `plik` |
| `obrazki` | eksport JPG/PNG do `Export/` | `dpi` (150 / 300), `format` (jpg / png), `talie`, `id`, `rewersy` |
| `pcio` | pokój playingcards.io w folderze projektu (`Projekt – playingcards.pcio`) – stos na każdą talię z wybranymi kartami | `dpi` (150 / 300), `talie`, `id` |
| `katalog` | katalog talii (JPG) do `.generator/katalog/`; w wyniku przy talii `rewersy` – liczba kafelków rewersów (od 0.6.5) | `talie`, `id` |
| `aktualizacja` | sprawdza, czy jest nowa wersja aplikacji; z `instaluj = tak` instaluje ją i uruchamia aplikację ponownie | `instaluj` (domyślnie `nie`), `restart` (domyślnie `tak`) |

- `talie` i `id` to listy po przecinku (`talie = Rośliny, Pogoda`, `id = 1, 7`); wielkość liter i polskie znaki nie mają znaczenia. `rewersy`, `wspolneArkusze` (też `wspolne`; talie na wspólnych arkuszach A4), `szkic`, `tylkoZmienione`: `tak` / `nie`. `strony`: `osobno` / `naprzemian` (też `na przemian`), tylko dla `uklad = drukarnia`. `spad` w mm (0–10), domyślnie 3 (z okna); spad zadeklarowany w szablonie (`KARTA = …, spad=N`) ma pierwszeństwo; `przesuniecieX`/`przesuniecieY` – przesunięcie rewersów w mm (−10…10, plus = w prawo / w dół).
- Nieznane ID to ostrzeżenie w wyniku (`ostrzezenia`), reszta kart się eksportuje. Nieznana talia: w `pcio` – ostrzeżenie (eksportują się pozostałe talie), w `pdf`, `obrazki` i `katalog` – błąd (`ok: false`).
- `pcio`: `talie` – tylko te talie (stos na talię), `id` – tylko karty o tych ID (każda w stosie swojej talii, ze wszystkimi kopiami); oba klucze razem – karty o tych ID z tych talii. Bez `talie` – talie zaznaczone ostatnio w oknie playingcards.io (domyślnie wszystkie). W wyniku: `talie` (np. `Rośliny: 12 kart`), `holdery` (liczba stosów), `karty` (liczba kart z kopiami); przy talii z różnymi rewersami – ostrzeżenie w `ostrzezenia`.
- Brak klucza = ostatnie ustawienie z okna (Druk i PDF, Eksport obrazków, playingcards.io) albo domyślne. Zlecenie tych ustawień nie zmienia. Wyjątek: zlecenie zawsze bierze wszystkie karty (nie „zaznaczone”), chyba że `tylkoZmienione = tak`.
- `plik` (PDF): ścieżka w folderze projektu, np. `plik = Druk/playtest 3.pdf`. Bez niej nazwa jak przy ręcznym zapisie (`Projekt – karty A4.pdf`, `Projekt – drukarnia.pdf`…) w folderze projektu.
- `pdf` z `uklad = a4`: w wyniku `strony` (wszystkie arkusze) i `arkusze` (`awersy`, `rewersy` – liczba arkuszy, `wspolne` – czy talie były na wspólnych arkuszach).
- `pdf` z `uklad = drukarnia`: w wyniku dodatkowo `pliki` (1 albo 2 – awersy i rewersy), `stronyPlikow` (liczba stron w każdym pliku), `strona` ([szerokość, wysokość] strony w mm) i `spad`; od 0.6.2 także `spadZSzablonu` (`true`, gdy spad pochodzi z szablonu), `bezSpadu` (lista talii bez deklaracji spadu) i `ostrzezenia` (np. projekt bez spadu w szablonie, talia ze spadem innym niż w PDF; od 0.6.6 – plik ze spadem w ramce „zmieść”). Przykład: `uklad = drukarnia` / `spad = 3` / `plik = Export/Ogród – drukarnia.pdf`.
- `profil` (PDF, od 0.5.11): `fogra39` | `fogra51` | `rgb` | ścieżka do pliku `.icc` (względna, liczona od folderu projektu). Zlecenie z profilem daje PDF w CMYK ([opis](#okna)). **Bez klucza zlecenie daje RGB jak dotąd** – także gdy opcja CMYK jest włączona w oknie. `profil` działa tylko z `uklad = drukarnia`, inaczej jest błąd. Brakujący profil ECI zlecenie pobiera z eci.org bez pytania; bez sieci – `ok: false` z opisem. Bez Ghostscripta – `ok: false` i w `blad` podpowiedź `brew install ghostscript`.
- `nadrukczerni` (alias `nadruk`; PDF CMYK, od 0.6.4): `tak` | `nie` – nadruk czarnego tekstu K100 ([opis](#okna)). Bez klucza – ustawienie z okna Druk i PDF (domyślnie `tak`). Bez `profil` (PDF RGB) klucz nic nie zmienia – ostrzeżenie w `ostrzezenia`.
- Wynik `pdf` z profilem ma pole `cmyk`: `profil` (nazwa), `ghostscript` (wersja), `nadrukCzerni` (`true` / `false`, od 0.6.4), `czas` (ms) i `pliki` – dla każdego pliku: `plik`, `strony`, `rgb` (0), `przestrzenieRgb` (0), `czern` (liczba wystąpień czystej czerni), `nadruk` (liczba obiektów tekstu z nadrukiem; `null`, gdy nadruk wyłączony), `obrazki` (`cmyk`, `szare`, `inne` – lista, pusta), `trimBox` (liczba stron z TrimBox), `ok`, `czas`.
- `raport` z `drukarnia = tak`: w `raport` dochodzą sekcje „Drukarnia: …”, a w wyniku pole `drukarnia` z pełnymi listami: `margines` (3), `odstep` (`karta`, `talia`, `strona`: awers / rewers, `odstep` w mm, `krawedz`, `element`: TEKST / IKONA, `tekst`), `czern` (`kolor`, `rodzaj`, `jasnosc`, `karty`) , `krawedz` (`talia`, `strona`, `rodzaj`: czarny / ryzykowny, `odcien`, `kolor`, `karty`), `spad` (obrazki bez pełnego spadu) i `spadSzablonu` (od 0.6.2: `talie`, `bez`, `pliki`; od 0.6.6 `zmiesc`). Bez klucza raport jest jak dotąd – przełącznik w panelu nie wpływa na zlecenie.
- Gdy w edytorze szablonu są niezapisane zmiany, zlecenie używa szablonu z dysku, a potem wraca podgląd z edytora (w wyniku `niezapisaneZmiany: true`).
- Zlecenia `pdf`, `obrazki` i `pcio` dodają punkt w historii wersji z dopiskiem „(zlecenie)”.
- Działa tylko poza przykładami i tylko w projekcie otwartym w aplikacji.

Przykład – zlecenie `.generator/zlecenia/pdf`:

```
uklad = a4
ciecie = nozyczki
talie = Rośliny
tylkoZmienione = tak
```

Wynik `wynik-pdf.json` (skrót):

```json
{ "zlecenie": "pdf", "ok": true, "pliki": ["Ogród – karty A4 – zmienione.pdf"], "karty": 4, "strony": 2,
  "uwagi": [], "zaDlugie": [], "niezapisaneZmiany": false, "blad": null, "wersjaAplikacji": "0.4.11" }
```

Przykład – PDF dla drukarni w CMYK (Fogra39):

```
uklad = drukarnia
spad = 3
profil = fogra39
plik = Export/Ogród – drukarnia.pdf
```

Fragment wyniku `wynik-pdf.json`:

```json
{ "zlecenie": "pdf", "ok": true, "pliki": ["Export/Ogród – drukarnia.pdf"],
  "cmyk": { "profil": "ISO Coated v2 (ECI) – Fogra39", "ghostscript": "10.x", "nadrukCzerni": true, "czas": 5200,
    "pliki": [{ "plik": "Export/Ogród – drukarnia.pdf", "strony": 24, "rgb": 0, "przestrzenieRgb": 0, "czern": 310, "nadruk": 96,
      "obrazki": { "cmyk": 6, "szare": 0, "inne": [] }, "trimBox": 24, "ok": true, "czas": 2600 }] },
  "blad": null }
```

- Wspólne pola wyniku: `ok`, `pliki` (ścieżki względem folderu projektu; w katalogu – nazwy w `folder`), `uwagi`, `zaDlugie` (karty z za długim tekstem), `niezapisaneZmiany`, `blad`, `wersjaAplikacji`, `opcje` (opcje po uzupełnieniu z okna), `ostrzezenia` (np. nieznany klucz, brak karty o podanym ID).
- Błędna wartość (np. `uklad = plakat`, nieistniejąca talia) – zlecenie nie jest wykonane: `ok: false` i opis w `blad`.
- `katalog` zapisuje wynik także w dawnym `wynik.json` (zgodność ze starszymi wersjami).
- `aktualizacja`: wynik (`wersjaAplikacji`, `najnowsza`, `dostepna`, `rodzaj` – `kod` albo `pelna`, `rozmiar`, `zainstalowano`, `restart`) powstaje przed ponownym uruchomieniem. Gdy edytor ma niezapisane zmiany albo `restart = nie`, nowa wersja uruchomi się przy następnym starcie (pełna – po zamknięciu aplikacji). Zlecenie nie pokazuje okien z pytaniami.

## Dla deweloperów

```
cd app
npm ci
npm start          # zasoby + uruchomienie
npm run dist       # budowanie .app (na macOS)
```

- `app/generator/karty.html`: interfejs i cały silnik generatora (jeden plik HTML).
- `app/main.js`: okno, menu, ostatnie projekty, zapis PDF, eksport do `Export/`, podmiana adresów CDN na zasoby lokalne.
- `app/serwer.js`: lokalny serwer HTTP, który podaje pliki projektu.
- `app/scripts/zasoby.js`: kopiuje generator, przykłady, biblioteki i czcionki do `app/zasoby/`.
- Tryb testowy: `KarKa [--test-nowy <nowy folder>] [--test-edytor] --test-pdf <szablon.txt|folder|-> <wynik.pdf>` otwiera projekt, sprawdza eksport JPG (poza przykładami także do `Export/`), zapisuje PDF i zrzut ekranu, a potem kończy z kodem 0 albo 1. `-` oznacza ekran powitalny. `--test-edytor` uruchamia wszystkie bloki sprawdzeń; `--test-bloki a,b` (od 0.6.3) – tylko wymienione (nazwy jak klucze w wyniku JSON, np. `spadSzablonu`, `arkusze`, `rewersy`; nieznana nazwa = błąd testu), `--test-bloki -a,-b` – wszystkie poza wymienionymi. Wynik ma pola `bloki` i `czasyBlokow` (sekundy na blok).
- Aktualizacje: `app/start.js` (rozrusznik – wybiera kod z paczki albo nakładkę), `app/nakladka.js`, `app/aktualizacje.js`; pliki do wydania robi `app/scripts/paczka-kodu.js` (`kod.zip`, `aktualizacja.json`), a workflow dokłada `KarKa.zip` (`ditto` z `.app`). Test: `node app/scripts/test-aktualizacje.js [--electron]`. `--bez-nakladki` uruchamia kod z paczki.
- `app/scripts/testuj.sh [przykład… | szablon.txt]`: na Linuksie z Xvfb przebudowuje zasoby i uruchamia tryb testowy na kopiach przykładów (domyślnie wszystkich, równolegle); wypisuje wiersz na projekt i kończy z kodem 0 albo 1.
- `.github/workflows/aplikacja-mac.yml`: budowanie i testy na macOS. Po każdej zmianie w `main` tworzy wydanie `v<wersja>` z DMG (wersja z `app/package.json`). Testy przykładów (od 0.6.3) zależą od zdarzenia:
  - **pull request** – pełny `--test-edytor` na `07-gildie` (w dwóch równoległych procesach), na `08-wieze` blok `spadSzablonu`, pozostałe przykłady `--test-pdf` (renderowanie, PDF, eksport); uruchomienia przez `app/scripts/testy-ci.js pr|pelny --bin <aplikacja> --tmp <katalog>` (do 3 naraz; lokalnie np. `--bin "xvfb-run -a ./node_modules/.bin/electron --no-sandbox ."`);
  - **push do `main`** (po scaleniu przetestowanego PR-a) – bez testów przykładów: start, nowy projekt, nakładka, DMG i wydanie;
  - **pełny zestaw** (`--test-edytor` na wszystkich przykładach) – ręcznie (Actions → „Aplikacja macOS” → Run workflow), przy tagu `v*` i wydaniu opublikowanym na GitHubie.

  Czasy przykładów są w podsumowaniu przebiegu (Summary); ostrzeżenie, gdy przykład trwa ponad 3 min albo przebieg PR ponad 10 min.

### Wydania

Każda zmiana w `main` podnosi wersję w `app/package.json` (0.4.3 → 0.4.4 …). Po scaleniu workflow sam tworzy wydanie `v<wersja>` z plikiem DMG, opisem (lista scalonych PR-ów) i oznaczeniem „najnowsze”, więc link do pobrania w README wskazuje ostatnią wersję. Gdy wersja nie została podniesiona, wydanie nie powstaje (ostrzeżenie w Actions).

Ręcznie opublikowane wydanie albo wypchnięty tag `v*` też dostaną DMG – workflow dołączy plik po kilku minutach.
