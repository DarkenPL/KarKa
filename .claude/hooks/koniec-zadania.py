#!/usr/bin/env python3
"""Hook PostToolUse (mcp__ccd_turn__wrap_up) + Stop: przypomnienie o domknięciu zadania w repozytorium KarKi.
Patrzy w gita, nie w zapis sesji: gdy gałąź ma zmiany względem origin/main (zacommitowane albo w drzewie roboczym),
a brakuje wpisu w docs/historia.md albo (przy zmianie w plikach aplikacji – pliki_aplikacji.py) wersja w app/package.json jest taka sama jak na origin/main – dokleja
przypomnienie modelowi (additionalContext) i właścicielowi (systemMessage). Nie blokuje.
Przy wrap_up przypomina za każdym razem, przy Stop – raz na sesję (znacznik w folderze tymczasowym)."""
import json, os, subprocess, sys, tempfile

try:
    dane = json.load(sys.stdin)
except Exception:
    sys.exit(0)
zdarzenie = dane.get("hook_event_name", "")
proj = os.environ.get("CLAUDE_PROJECT_DIR") or dane.get("cwd") or "."
sesja = dane.get("session_id", "bez-id")

def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=proj, capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return ""

if zdarzenie == "Stop":
    if dane.get("stop_hook_active"):
        sys.exit(0)
    znacznik = os.path.join(tempfile.gettempdir(), f"karka-koniec-zadania-{sesja}")
    if os.path.exists(znacznik):
        sys.exit(0)

galaz = git("rev-parse", "--abbrev-ref", "HEAD").strip()
if galaz in ("", "main", "master", "HEAD"):
    sys.exit(0)
zmienione = set(p for p in git("diff", "--name-only", "origin/main...HEAD").splitlines() if p)
zmienione |= set(l[3:].strip() for l in git("status", "--porcelain").splitlines() if l)
if not zmienione:
    sys.exit(0)

def wersja(tekst):
    try:
        return json.loads(tekst).get("version")
    except Exception:
        return None

braki = []
if "docs/historia.md" not in zmienione:
    braki.append("brak wpisu w docs/historia.md")
try:
    nowa = wersja(open(os.path.join(proj, "app", "package.json"), encoding="utf-8").read())
except Exception:
    nowa = None
stara = wersja(git("show", "origin/main:app/package.json"))
try:
    from pliki_aplikacji import OPIS, wymaga_wersji
except Exception:   # bez modułu – ostrożnie: każda zmiana w app/ i przyklady/
    OPIS = "app/, przyklady/"
    wymaga_wersji = lambda sciezki: any(p.startswith(("app/", "przyklady/")) for p in sciezki)
kod_app = wymaga_wersji(zmienione)   # wersję podnosi tylko PR ze zmianą w plikach aplikacji (#101, #141)
if kod_app and nowa and stara and nowa == stara:
    braki.append(f"wersja aplikacji nie podniesiona (wciąż {stara})")
if not braki:
    sys.exit(0)

if zdarzenie == "Stop":
    open(znacznik, "w").close()
tekst = (f"Hook koniec-zadania: gałąź {galaz} ma zmiany ({len(zmienione)} plików), a " + " i ".join(braki) +
         f". Zasada z CLAUDE.md: PR ze zmianą w plikach aplikacji ({OPIS}) podnosi wersję (app/package.json + package-lock.json), a wpis w docs/historia.md ma każdy PR – "
         "uzupełnij to przed PR-em (albo powiedz właścicielowi, czemu nie).")
wynik = {"systemMessage": tekst}
if zdarzenie != "Stop":
    wynik["hookSpecificOutput"] = {"hookEventName": "PostToolUse", "additionalContext": tekst}
print(json.dumps(wynik, ensure_ascii=False))
sys.exit(0)
