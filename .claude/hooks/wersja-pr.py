#!/usr/bin/env python3
"""Hook PreToolUse (Bash): przy `gh pr create` sprawdza wersję aplikacji (zasada z CLAUDE.md: PR ze zmianą w app/ podnosi wersję).
Bez zmian w app/ (git diff --name-only origin/main...HEAD) milczy – wyjątek z #101. Inaczej blokuje PR, gdy: wersja w app/package.json jest taka sama jak na origin/main; package-lock.json ma inną wersję;
tag v<wersja> już istnieje na GitHubie (wersja zajęta – np. przez inny PR); inny otwarty PR ma w app/package.json
tę samą wersję (gałąź z head.ref; gdy gh nie odpowiada – tylko ostrzeżenie)."""
import base64, json, os, re, subprocess, sys

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

git("fetch", "-q", "origin", "main")
if not any(p.startswith("app/") for p in git("diff", "--name-only", "origin/main...HEAD").splitlines()):
    sys.exit(0)   # PR bez zmian w app/ nie podbija wersji (decyzja właściciela 27.10.2026, #101)

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
stara = wersja_z(git("show", "origin/main:app/package.json"))
if not nowa:
    blokuj("brak wersji w app/package.json", "Sprawdź plik.")
if stara and nowa == stara:
    blokuj(f"wersja aplikacji nie została podniesiona (origin/main i gałąź: {stara})",
           "PR ze zmianą w app/ podnosi wersję o najmniejszą podwersję w app/package.json i package-lock.json i dopisuje ją w docs/historia.md.")
lock_w = {lock.get("version"), (lock.get("packages") or {}).get("", {}).get("version")}
if lock_w != {nowa}:
    blokuj(f"package-lock.json ma inną wersję ({', '.join(str(x) for x in lock_w if x)}) niż package.json ({nowa})",
           "Podnieś wersję w obu plikach (w package-lock.json w dwóch miejscach: górne „version” i packages[\"\"].version).")
tagi = git("ls-remote", "--tags", "origin", f"refs/tags/v{nowa}")
if tagi.strip():
    blokuj(f"tag v{nowa} już istnieje na GitHubie – wersja zajęta", "Weź kolejną wolną podwersję (sprawdź też otwarte PR-y).")

def gh_api(sciezka):
    w = subprocess.run(["gh", "api", sciezka], cwd=proj, capture_output=True, text=True, timeout=30)
    if w.returncode != 0:
        raise RuntimeError((w.stderr or w.stdout).strip()[:200])
    return json.loads(w.stdout)

adres = git("remote", "get-url", "origin").strip()
m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", adres)
galaz = git("rev-parse", "--abbrev-ref", "HEAD").strip()
if m:
    try:
        for pr in gh_api(f"repos/{m.group(1)}/pulls?state=open&per_page=100"):
            glowa = pr.get("head") or {}
            ref, repo = glowa.get("ref"), (glowa.get("repo") or {}).get("full_name") or m.group(1)
            if not ref or (ref == galaz and repo == m.group(1)):
                continue   # własny PR tej gałęzi (np. drugi `gh pr create`) się nie liczy
            plik = gh_api(f"repos/{repo}/contents/app/package.json?ref={ref}")
            if wersja_z(base64.b64decode(plik.get("content", "")).decode("utf-8")) == nowa:
                blokuj(f"wersja {nowa} jest już w otwartym PR #{pr.get('number')} (gałąź {ref})",
                       "Weź kolejną wolną podwersję albo poczekaj na scalenie tamtego PR-a i zrób rebase na main.")
    except SystemExit:
        raise
    except Exception as e:
        print(f"Uwaga (.claude/hooks/wersja-pr.py): nie sprawdzono wersji w otwartych PR-ach ({e}).", file=sys.stderr)
sys.exit(0)
