#!/usr/bin/env python3
"""Hook PreToolUse (Bash): zamki na gicie w repozytorium KarKi – zasady z CLAUDE.md zamienione na blokady.
Czyta JSON wywołania ze stdin. Wyjście 2 = zablokuj (tekst ze stderr wraca do modelu); ostrzeżenie = JSON z systemMessage.
Blokuje:
- `git commit` na gałęzi main (zadanie = własna gałąź z origin/main);
- `git commit` z danymi gier właściciela w indeksie (pliki kart, szablony, kociol/, .generator/, .historia/, Export/, PDF/pcio
  spoza przyklady/ i app/szablon-startowy/) oraz bezwzględnymi ścieżkami z jego dysku (/Users/…, ~/…) w dodanych wierszach;
- `git push --force` (także --force-with-lease), `git tag <nazwa>` (tagi i wydania robi workflow), `gh release …`;
- `gh pr create --base <inna niż main>`.
Ostrzega (nie blokuje): przy `gh pr create`, gdy gałąź nie zawiera aktualnego origin/main (PR z PR-a albo stary main)."""
import json, os, re, subprocess, sys

try:
    dane = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if dane.get("tool_name") != "Bash":
    sys.exit(0)
cmd = (dane.get("tool_input") or {}).get("command", "") or ""
proj = os.environ.get("CLAUDE_PROJECT_DIR") or dane.get("cwd") or "."
# do rozpoznawania poleceń: tekst bez cudzysłowów (opis commita „użyj git tag” nie uruchamia zamka)
bez = re.sub(r'"[^"]*"|\'[^\']*\'', '""', cmd)

def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=proj, capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return ""

def blokuj(co, rada):
    print(f"ZABLOKOWANE przez .claude/hooks/zamki-git.py: {co}. {rada} Nie obchodź tego zamka – powiedz właścicielowi.", file=sys.stderr)
    sys.exit(2)

def ostrzez(tekst):
    tekst = "Hook zamki-git: " + tekst
    print(json.dumps({"systemMessage": tekst,
                      "hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": tekst}}, ensure_ascii=False))

# --- dane gier: wzorce ścieżek w indeksie (względem repo) ---
DOZWOLONE_FOLDERY = re.compile(r"^(przyklady|app/szablon-startowy|app/zasoby)/")
DANE_GIER = re.compile(r"(^|/)(kociol|\.generator|\.historia|Export|Szablony|dane)/|\.(csv|tsv|xlsx|xlsm|pcio|pdf|indd|idml)$", re.I)
SCIEZKI_DYSKU = re.compile(r"/Users/[A-Za-z]|(^|[\s'\"(=])~/[A-Za-z]")

def sprawdz_commit():
    galaz = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    if galaz in ("main", "master"):
        blokuj(f"commit na gałęzi „{galaz}”", "Zadanie robi się na własnej gałęzi z aktualnego origin/main (`git switch -c claude/<nazwa> origin/main`), potem PR do main.")
    pliki = [p for p in git("diff", "--cached", "--name-only", "--diff-filter=AM").splitlines() if p.strip()]
    zle = [p for p in pliki if DANE_GIER.search(p) and not DOZWOLONE_FOLDERY.match(p)]
    if zle:
        blokuj("w indeksie są pliki wyglądające na dane gier właściciela: " + ", ".join(zle[:8]) + (" …" if len(zle) > 8 else ""),
               "Do repozytorium trafiają tylko generator, dokumentacja i zmyślone przykłady z przyklady/. Zdejmij te pliki z indeksu (`git restore --staged <plik>`).")
    roznice = git("diff", "--cached", "--unified=0")
    trafienia = []
    plik = "?"
    for linia in roznice.splitlines():
        if linia.startswith("+++ "):
            plik = linia[4:].replace("b/", "", 1)
        elif linia.startswith("+") and not linia.startswith("+++") and SCIEZKI_DYSKU.search(linia):
            trafienia.append(f"{plik}: {linia[1:].strip()[:80]}")
    if trafienia:
        blokuj("dodane wiersze zawierają ścieżki z dysku właściciela (/Users/…, ~/…): " + " | ".join(trafienia[:5]),
               "Ścieżki do jego folderów z grami nie trafiają do repozytorium – zastąp je ogólnym opisem (np. „<folder projektu>”).")

def sprawdz_pr():
    m = re.search(r"--base[= ]+(\S+)", cmd)
    if m and m.group(1).strip("'\"") != "main":
        blokuj(f"PR z bazą „{m.group(1)}”", "PR zawsze do main – nigdy łańcuchem do innej gałęzi.")
    git("fetch", "-q", "origin", "main")
    jest = subprocess.run(["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"], cwd=proj, capture_output=True).returncode
    if jest != 0:
        ostrzez("gałąź nie zawiera aktualnego origin/main (PR z PR-a albo nieświeży main?). Zasada: jedno zadanie = jedna gałąź z aktualnego origin/main = jeden PR. "
                "Jeśli ta gałąź zawiera inny niescalony PR – poczekaj na jego scalenie albo zapytaj właściciela; jeśli main odjechał – `git rebase origin/main`.")

if re.search(r"\bgit\b[^|;&]*?\bcommit\b", bez):
    sprawdz_commit()
if re.search(r"\bgit\b[^|;&]*?\bpush\b[^|;&]*(--force|\s-f\b|\s\+refs)", bez):
    blokuj("git push z wymuszeniem", "Historia na GitHubie zostaje – zamiast tego nowy commit.")
if re.search(r"\bgit\b[^|;&]*?\btag\s+(?!-l\b|--list\b|-n\b)\S", bez):
    blokuj("git tag", "Tagi i wydania tworzy workflow po scaleniu PR-a (wersja z app/package.json).")
if re.search(r"\bgh\s+release\s+(create|upload|delete|edit)\b", bez):
    blokuj("gh release", "Wydania tworzy workflow po scaleniu PR-a; sesja ich nie robi.")
if re.search(r"\bgh\s+pr\s+create\b", bez):
    sprawdz_pr()
sys.exit(0)
