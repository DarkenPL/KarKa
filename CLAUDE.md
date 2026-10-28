# Notatki projektu – KarKa (Kawia Karciana, dawniej Generator kart)

Plik dla Claude (i ludzi): stan projektu, decyzje i lista pomysłów. Aktualizuj przy każdej większej zmianie.

## Sposób pracy sesji (przeczytaj najpierw)

Wnioski z porównania sesji z 9–11.10.2026 (łączone PR-y, kolizja wersji, nazwy talii właściciela w dokumentacji). Nad projektem pracuje równolegle kilka sesji Claude.

- **Przed startem:** sprawdź otwarte issues, PR-y i gałęzie (`gh api "repos/DarkenPL/KarKa/issues?state=open&per_page=100"` – lista zawiera też PR-y, `git branch -r`). Gdy inna sesja pracuje nad tym samym zadaniem – zapytaj właściciela, nie rób tego drugi raz.
- **Sesje z projektów gier** (prototypy u właściciela) **nie zmieniają repozytorium** – błędy i pomysły zgłaszają jako issues z etykietami (patrz „Zadania”) i uzupełniają issues, które same założyły (decyzja właściciela 11.10.2026; od 12.10.2026 issues zamiast kolejki w tym pliku).
- **Start zadania tylko na wyraźny sygnał** („zrób”, „startuj”). „Dopisz do kolejki” = tylko nowe issue (bez kodu i bez PR-a). Prośba o plik lokalny ≠ zmiana w repozytorium (PR #18).
- **Jedno zadanie = jedna gałąź z aktualnego `origin/main` = jeden PR.** Nigdy PR zawierający inny niescalony PR (#20 ⊃ #19, #23 ⊃ #22 – właściciel zamykał duplikaty). Gdy nowe zadanie wymaga niescalonego PR-a – poczekaj na scalenie albo zapytaj.
- **Wersja:** dopiero po sprawdzeniu `main` i otwartych PR-ów – kolejna wolna podwersja (0.4.8 była w dwóch PR-ach naraz).
- **Przed każdym commitem:** przejrzyj `git diff --cached` pod kątem nazw z gier właściciela (talie, karty, postacie, nazwy projektów i folderów). W dokumentacji i testach tylko nazwy z `przyklady/`.
- **Testy sprawdzają wygląd, nie tylko istnienie pliku:** obejrzyj wynik (zrzut, katalog, strona PDF), zanim powiesz „działa”. Błąd czcionek w JPG przetrwał od v0.4.2 do v0.4.9, bo test sprawdzał tylko, czy JPG powstał.
- **Wszystko po polsku** – także krótkie zdania robocze między narzędziami.
- **Krótkie sesje:** jedno zadanie na sesję, start od tego pliku. Bardzo długie sesje gubią zasady po streszczeniu kontekstu. Nowe wnioski dopisuj tutaj albo w „Jak pracować szybko”.
- `pkill -f` / `pgrep -f` z wzorcem, który występuje w tym samym poleceniu, zabija własną powłokę – zabijaj procesy osobnym poleceniem albo po PID.
- **Przegląd PR-a przez drugą sesję:** przed scaleniem diff czyta inna sesja (inny model) – sprawdza nazwy z gier właściciela, zgodność wersji, czy testy oglądają wynik, i ryzyka w silniku. Wynik przeglądu jako komentarz w PR (decyzja właściciela 26.10.2026).
- **Paczka drobnych** (decyzja właściciela 27.10.2026, #101): 2–4 issues bez zmian silnika i HTML kart (dokumentacja, komunikaty, drobne poprawki) w jednym PR-ze. Skład wskazuje właściciel („paczka: #a #b”), sesja nie łączy sama. Osobny commit na issue, jedna wersja (jedno podbicie), jeden przegląd drugą sesją, `Closes #N` dla każdego issue.
- **Sesje po kolei, nie równolegle:** kolejny PR z podbiciem wersji zaczyna się od świeżego `origin/main`; przy dwóch otwartych PR-ach drugi przed otwarciem robi rebase na `main` (decyzja właściciela 26.10.2026).
- **Zamki (`.claude/`, od v0.7.4):** hooki Claude Code pilnują części zasad z tej sekcji – `zamki-git.py` blokuje commit na `main`, dane gier i ścieżki z dysku w indeksie, push z wymuszeniem, tagi, wydania i PR z bazą inną niż `main`; `wersja-pr.py` blokuje PR ze zmianą w `app/` bez podbitej wersji (albo z wersją zajętą tagiem lub innym otwartym PR-em), PR bez zmian w `app/` przepuszcza; `testy-po-zmianie.py` po zmianie `karty.html` / `app/*.js` uruchamia szybki test 03-ogrod; `koniec-zadania.py` (od v0.7.9) po zgłoszeniu gotowości (`wrap_up`) i przy końcu sesji przypomina o wpisie w `docs/historia.md` i (przy zmianie w `app/`) o podbiciu wersji, gdy gałąź ma zmiany, a ich brakuje (nie blokuje). Skill `/zadanie <numer issue>` (`.claude/skills/zadanie/`) prowadzi pełną pętlę zadania – od świeżego `main` i planu z wariantami do zgody właściciela po wersję, historię i PR; wywołuje go tylko właściciel. Polecenia rozpoznawane są bez treści w cudzysłowach, ale tekst z heredoca (opis commita przez `-F -`) jest sprawdzany – nie wpisuj w nim nazw poleceń. Hook zatrzymuje całe polecenie (także `git add` przed `&&`). Blokady nie obchodzić – zgłosić właścicielowi.

## Zasady

- **Bez danych gier użytkownika w repozytorium.** Właściciel trzyma swoje projekty gier lokalnie i nie chce ich udostępniać. W repozytorium są tylko generator, dokumentacja i zmyślone przykłady.
- Język: polski (interfejs, komunikaty, komentarze w kodzie, dokumentacja).
- **Tylko aplikacja na Maca (Apple Silicon).** Wersja przeglądarkowa i `Uruchom generator.command` zostały usunięte (decyzja właściciela). Silnik i interfejs to jeden plik `app/generator/karty.html` bez kroku budowania.
- Nowe ikony do przykładów: tylko na wolnej licencji, z wpisem w `CREDITS.md` (game-icons.net = CC BY 3.0, podać autora i link do ikony).
- **Wersje:** każda aktualizacja (PR do `main`) podnosi wersję o najmniejszą podwersję w `app/package.json` i `package-lock.json` (0.4.1 → 0.4.2 …) i dopisuje ją w `docs/historia.md`. Po scaleniu workflow sam publikuje wydanie `v<wersja>` – bez podniesienia wersji wydania nie będzie. **Wyjątek** (decyzja właściciela 27.10.2026, #101): PR bez zmian w plikach aplikacji (`build.files`, `generator/`, `przyklady/`, `szablon-startowy/` – czyli tylko CI, skrypty testów w `app/scripts/`, dokumentacja) **nie podbija wersji** – wydanie i aktualizacja bez zmian dla użytkownika nie mają sensu; ostrzeżenie „Wydanie … już istnieje” na `main` jest wtedy oczekiwane. Workflow ma filtr ścieżek (`app/**`, `przyklady/**`, sam workflow) – **PR z samą dokumentacją nie uruchamia CI ani w PR, ani po scaleniu** (bez przebiegu i bez ostrzeżenia; sprawdzone na PR #119). Zmiana kodu testów w `main.js` (`trybTestowy`) to zmiana pliku aplikacji – wersja jak zwykle. Większy skok tylko na prośbę właściciela. Seria wydań ma nazwę: `nazwaWydania` w `app/package.json` (0.5.x – „Gołąb pocztowy”, 0.6.x – „Lustro weneckie”, 0.7.x – „Pieczęć lakowa”); trafia do tytułu wydania i okna „O aplikacji”. Nową nazwę wymyśla się (z właścicielem) tylko przy większym skoku wersji.
- **Gałęzie:** PR zawsze do `main` (nie łańcuchem do innej gałęzi – po scaleniu bazowej gałęzi GitHub nie przestawił bazy i PR #11 trafił do `claude/noc`). Po scaleniu gałąź można usunąć.
- Zmiany wyglądu kart istniejących projektów muszą być zgodne wstecz. Przed zmianą silnika porównaj zrzuty kart przed/po (różnice tylko w wygładzaniu krawędzi).

## Struktura

```
docs/                      dokumentacja użytkownika; docs/kod-aplikacji.md, architektura.md, testowanie.md, historia.md = notatki techniczne
przyklady/NN-nazwa/        przykładowe projekty (Szablony/, CSV, ikony.csv, Ikony/)
CREDITS.md                 autorzy ikon, licencje
app/                       aplikacja na Maca (Electron); app/generator/karty.html = silnik i interfejs; app/drukarnia.js = PDF dla drukarni (TrimBox, podział); app/cmyk.js = CMYK przez Ghostscript, profile ICC, PDF/X-4, TAC; app/drukarnie.js + app/drukarnie/*.json = profile drukarni (0.7.0)
.github/workflows/         budowanie aplikacji na macOS (GitHub Actions)
```

## Dokumentacja techniczna

- **Kod aplikacji** (`main.js`, zakładki, zlecenia w tle, edytor, aktualizacje, budowanie i CI, tryb testowy): `docs/kod-aplikacji.md`.
- **Architektura `karty.html`** (sekcje silnika: wczytywanie, szablony, dopasowanie tekstu, druk, CMYK, eksporty, raporty, zlecenia): `docs/architektura.md`.
- **Testowanie i praca na Macu właściciela**: `docs/testowanie.md`.
- **Historia wersji** (notatki techniczne do każdego wydania): `docs/historia.md`. **Nowe wpisy wersji idą tylko do `docs/historia.md`** (na górę listy wersji 0.5+, nad poprzednią wersją) – w tym pliku nie ma już listy „Zrobione”.
- Przy zmianie kodu aktualizuj odpowiedni plik z `docs/` (opis jak dotąd w tym pliku).

## Testowanie (środowisko Claude)

**Przeczytaj `docs/testowanie.md` przed testami i przed PR-em** – testy lokalne przed PR-em (07-gildie w trzech grupach, pełny zestaw przy zmianach silnika), `scripts/testuj.sh`, CMYK, odciski kart, zrzuty, błędy JS strony.

## Jak pracować szybko (wnioski z poprzednich sesji)

Właściciel zwraca uwagę na czas pracy – mniej czekania, mniej czytania na ślepo.

**Start sesji**
- `git clone --depth 1` → `cd app && npm ci && npm run zasoby` (≈ 1 min). Mapa `karty.html` (≈ 2900 wierszy): `grep -n "^async function\|^function\|^const [A-Z_]* =" app/generator/karty.html`; opis sekcji – `docs/architektura.md`. Czytaj tylko potrzebne fragmenty.
- Płytki klon ma w `remote.origin.fetch` tylko `main` – po wypchnięciu własnej gałęzi `git status` nie widzi jej na serwerze i hook zgłasza „unpushed commit”. Od razu po `git push -u`: `git config --add remote.origin.fetch '+refs/heads/<gałąź>:refs/remotes/origin/<gałąź>' && git fetch -q origin`.
- `gh pr list` nie działa (GraphQL zablokowany) – tylko REST: `gh api repos/DarkenPL/KarKa/pulls …`.

**Pętla pracy**
- Test uruchamia kopię `app/zasoby/karty.html`, nie `app/generator/karty.html` – po każdej zmianie `npm run zasoby` (robi to `scripts/testuj.sh`). Zapomniane = test starego kodu.
- Nowa funkcja = nowy blok w `trybTestowy` (`main.js`) przed `await wc.executeJavaScript('buildPrint()')`, z warunkiem `testBloku('nazwa')` (nie `process.argv.includes('--test-edytor')` – od v0.6.3), dopisany do `ok` i do JSON-a na końcu. Blok zależny od treści konkretnego przykładu, innego niż `07-gildie` → dopisz ten przykład z `--test-bloki` w `plan()` w `scripts/testy-ci.js` (inaczej w PR się nie wykona). Blok 07 zależny od stanu po innym bloku (jak `zlecenia` od `zmienione` i `cmykTest`) → oba w jednej grupie w `scripts/grupy-testow.js`; nowy niezależny blok trafia sam do grupy `reszta`. Blok zostawia okno jak zastał (np. zamyka edytor) – przy `--test-bloki` kolejność bloków jest inna. Wzór: bloki `katalog`, `zlecenia`.
- Tekst dopisany w teście na koniec szablonu trafia do ostatniej sekcji (w 02-kuznia to `[REWERS]`) – zmieniając karty w teście, celuj w konkretną sekcję albo w wiersz `PROJEKT =` (komentarz `;` za wartością!).
- **Nie zmieniaj atrybutów ani struktury HTML kart** (`renderCard`, `data-*`, `title`) bez potrzeby: odcisk karty (`htmlKarty`) to jej HTML, więc po aktualizacji aplikacji wszystkie karty u właściciela byłyby „zmienione od ostatniego PDF”. Brakujące dane bierz z istniejących atrybutów (np. nazwa z `title`).
- Błędy, które już raz kosztowały czas: `window.x = () => x()` (rekurencja, test wisi); zmienna lokalna o nazwie globalnej `szablon` w `main.js` (v0.4.0 – ReferenceError, domyślne menu); eksport bez `naWylacznosc()` (losowo padał co kilka przebiegów); `naWylacznosc` zamykająca bramę przed czekaniem na kolejkę przebudów (zawieszenie przy przebudowie czekającej w kolejce, v0.7.1); odcisk plików z nieposortowanej listy (pętla odświeżania, v0.4.4); `html-to-image` bez `fontEmbedCSS` (czcionka zastępcza, v0.4.9).

**CI i PR**
- Workflow macOS (od v0.6.3, #88; #101): PR ≈ CZAS_PR (przed #101: 4:46, krok przykładów 177 s), push do `main` ≈ 3–4 min (z DMG i wydaniem), pełny zestaw (ręcznie) ≈ 15 min – czasy w Summary przebiegu. Runner macOS bywa w kolejce 5–10 min – to nie czas testów. Nie czekaj na niego bezczynnie w pętli: otwórz PR, napisz właścicielowi wynik testów lokalnych, a CI sprawdź raz na końcu (`gh api "repos/DarkenPL/KarKa/actions/runs?branch=<gałąź>&per_page=1" --jq '.workflow_runs[0]|.status+" "+(.conclusion//"")'`). Gdy padnie: `…/actions/runs/<id>/jobs` → `…/actions/jobs/<id>/logs`.
- Drobna poprawka do otwartego, niescalonego PR-a = commit na tę samą gałąź (bez nowego podbicia wersji).

**Praca na Macu właściciela (podłączone foldery)** – `docs/testowanie.md` (powłoka na Macu, `historia-cli.js`, kopia projektu do testu, zlecenia z pliku, `stan.json`).

## Zadania (GitHub Issues)

Od 12.10.2026 kolejka zadań to **issues**: https://github.com/DarkenPL/KarKa/issues. Ten plik ich nie powtarza – lista: `gh api "repos/DarkenPL/KarKa/issues?state=open&per_page=100" --jq '.[] | select(.pull_request|not) | "#\(.number) \(.title) [\([.labels[].name]|join(", "))]"'`.

- **Tytuł:** dawne punkty kolejki mają numer w tytule (`[pkt 37] …`) – właściciel tak się do nich odwołuje. Nowe zadania nie dostają już numeru punktu, tylko numer issue (`#51`).
- **Etykiety:** rodzaj – `funkcja`, `błąd`, `dokumentacja`; obszar – `obszar: druk`, `eksport`, `edytor`, `szablony`, `aplikacja`, `aktualizacje`, `zlecenia`; `priorytet: wysoki`; stan – `stan: pomysł`, `stan: czeka na decyzję` (decyzja albo test właściciela), `stan: odłożone` (świadomie odłożone – nie proponować bez pytania). Etykiety `dependencies` i `github_actions` zostają dla Dependabota.
- **Treść:** plan, decyzje właściciela z datą, „do ustalenia”, test. Nowe decyzje – komentarz w issue (albo poprawka treści). Repozytorium i issues są **publiczne**: bez nazw talii, kart i projektów z gier właściciela.
- **Realizacja:** start tylko na sygnał właściciela. PR z `Closes #N` (zamyka issue po scaleniu) + wpis wersji w `docs/historia.md`.
- **Przeniesienie (12.10.2026):** pkt 37 → #34, pkt 1 → #35 (Windows), #36 (podpis Apple), #37 (skojarzenie folderów), pkt 2 → #38, 3 → #39, 4 → #40, 12 → #41, 19 → #42, 20 → #43, 21 → #44, 22 → #45, 25 → #46, 29 → #47, 34 → #48, roadmapa (stół playingcards.io) → #49, ikona z kawią → #50 (pkt 38).

Kolejność i start każdego zadania ustala właściciel – nie zaczynać bez jego sygnału.
