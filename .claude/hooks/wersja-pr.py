#!/usr/bin/env python3
"""Hook PreToolUse (Bash): przy `gh pr create` sprawdza wersję aplikacji (zasada z CLAUDE.md: każdy PR podnosi wersję).
Blokuje PR, gdy: wersja w app/package.json jest taka sama jak na origin/main; package-lock.json ma inną wersję;
tag v<wersja> już istnieje na GitHubie (wersja zajęta – np. przez inny PR)."""
import json, os, re, subprocess, sys

try:
    dane = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if dane.get("tool_name") != "Bash":
    sys.exit(0)
cmd = (dane.get("tool_input") or {}).get("command", "") or ""
bez = re.sub(r'"[^"]*"|\'[^\']*\'', '""', cmd)   # bez treści w cudzysłowach – opis commita nie jest poleceniem
if not re.search(r"\bgh\s+pr\s+create\b", bez):
    sys.exit(0)
proj = os.environ.get("CLAUDE_PROJECT_DIR") or dane.get("cwd") or "."

def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=proj, capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return ""

def blokuj(co, rada):
    print(f"ZABLOKOWANE przez .claude/hooks/wersja-pr.py: {co}. {rada} Nie obchodź tego zamka – powiedz właścicielowi.", file=sys.stderr)
    sys.exit(2)

def wersja_z(tekst):
    try:
        return json.loads(tekst).get("version")
    except Exception:
        return None

try:
    pkg = open(os.path.join(proj, "app", "package.json"), encoding="utf-8").read()
    lock = json.loads(open(os.path.join(proj, "app", "package-lock.json"), encoding="utf-8").read())
except Exception as e:
    blokuj(f"nie mogę odczytać app/package.json albo package-lock.json ({e})", "Sprawdź pliki.")
nowa = wersja_z(pkg)
git("fetch", "-q", "origin", "main")
stara = wersja_z(git("show", "origin/main:app/package.json"))
if not nowa:
    blokuj("brak wersji w app/package.json", "Sprawdź plik.")
if stara and nowa == stara:
    blokuj(f"wersja aplikacji nie została podniesiona (origin/main i gałąź: {stara})",
           "Każdy PR do main podnosi wersję o najmniejszą podwersję w app/package.json i package-lock.json i dopisuje ją w „Zrobione” w CLAUDE.md.")
lock_w = {lock.get("version"), (lock.get("packages") or {}).get("", {}).get("version")}
if lock_w != {nowa}:
    blokuj(f"package-lock.json ma inną wersję ({', '.join(str(x) for x in lock_w if x)}) niż package.json ({nowa})",
           "Podnieś wersję w obu plikach (w package-lock.json w dwóch miejscach: górne „version” i packages[\"\"].version).")
tagi = git("ls-remote", "--tags", "origin", f"refs/tags/v{nowa}")
if tagi.strip():
    blokuj(f"tag v{nowa} już istnieje na GitHubie – wersja zajęta", "Weź kolejną wolną podwersję (sprawdź też otwarte PR-y).")
sys.exit(0)
