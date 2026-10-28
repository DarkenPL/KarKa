---
name: zadanie
description: Pełna pętla zadania z GitHub Issues w repozytorium KarKi – gałąź, plan z wariantami do zgody właściciela, zmiana, testy, wersja, historia, PR. Wywołuje tylko właściciel: /zadanie <numer issue>.
disable-model-invocation: true
---

Zadanie: issue **#$ARGUMENTS** w repozytorium DarkenPL/KarKa. Przejdź kroki po kolei; zasady repo są w `CLAUDE.md` (przeczytaj „Sposób pracy sesji”, jeśli jeszcze nie).

1. **Świeży start.** `git switch main && git pull`. Sprawdź otwarte PR-y i gałęzie (`gh api "repos/DarkenPL/KarKa/pulls?state=open"`, `git branch -r`) – gdy ktoś już pracuje nad tym issue, zatrzymaj się i zapytaj właściciela.
2. **Issue.** Odczytaj treść i komentarze (`gh api repos/DarkenPL/KarKa/issues/$ARGUMENTS` i `…/issues/$ARGUMENTS/comments`). Decyzje właściciela z datami w treści issue są wiążące; „do ustalenia” – do zapytania w planie.
3. **Gałąź.** `git switch -c claude/$ARGUMENTS-<krótka-nazwa> origin/main` (nazwa po polsku bez znaków diakrytycznych, np. `claude/90-stan-json`).
4. **Plan – i STOP.** Przeczytaj tylko potrzebne fragmenty kodu (mapa `karty.html`: `grep -n "^async function\|^function\|^const [A-Z_]* =" app/generator/karty.html`; opis sekcji w `docs/architektura.md`). Napisz właścicielowi plan: co zmienisz, w których plikach, **2–3 warianty z plusami i minusami** tam, gdzie jest wybór, jaki test to sprawdzi, proponowany numer wersji. **Czekaj na zgodę** („ok”, „wariant B”) – bez niej nie zmieniaj plików. Okienko z pytaniem tylko do wyboru między wariantami, nigdy z jedną opcją „zrób”.
5. **Zmiana.** Po zgodzie wprowadź zmianę. Po edycji `app/generator/karty.html` albo `app/*.js` hook uruchamia szybki test; przy zmianie silnika uruchom też pełny: `cd app && scripts/testuj.sh 03-ogrod` (kilka minut) i obejrzyj wynik (zrzut, PDF, katalog) – nie tylko kod wyjścia. Nowa funkcja = nowy blok w `trybTestowy` (`main.js`). Zero Uwag i zero błędów strony na wszystkich przykładach przed PR-em (`scripts/testuj.sh`).
6. **Dokumentacja.** Zmiana widoczna dla użytkownika → `docs/komendy.md` albo `docs/aplikacja.md`; architektura → `docs/architektura.md` / `docs/kod-aplikacji.md`. Tylko nazwy z `przyklady/`, bez nazw gier właściciela.
7. **Wersja i historia.** Kolejna wolna podwersja (sprawdź `origin/main`, otwarte PR-y i tagi) w `app/package.json` i `package-lock.json` (dwa miejsca); wpis w `docs/historia.md` z notatkami technicznymi. Większy skok wersji – tylko na prośbę właściciela.
8. **Commit, push, PR.** Przejrzyj `git diff --cached` (ścieżki z dysku, dane gier – hooki to blokują, ale spójrz sam). Commit z opisem po polsku i `Closes #$ARGUMENTS` w treści PR-a. `git push -u origin <gałąź>`, `gh pr create --base main`. CI (macOS, 8–10 min) sprawdź raz na końcu, nie w pętli.
9. **Raport dla właściciela:** co zmienione, wynik testów, adres PR-a, co zostało do jego decyzji. Przegląd drugą sesją proponuj tylko przy zmianie silnika (`karty.html`).
