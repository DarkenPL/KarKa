#!/usr/bin/env bash
# Testy aplikacji na kopiach przykładów (Linux z Xvfb, np. sesja Claude, albo macOS – okna na ekranie, bash 3.2 wystarczy).
#   scripts/testuj.sh                 – wszystkie przykłady, tryb --test-edytor
#   scripts/testuj.sh 03-ogrod        – wybrane przykłady (nazwy folderów z przyklady/)
#   scripts/testuj.sh /ścieżka/do/gra.txt – dowolny projekt (kopiowany razem z folderem projektu)
#   RAZEM=1 scripts/testuj.sh         – ile testów naraz (domyślnie 5: test głównie czeka, 5 przykładów ≈ 1,5 min zamiast 5)
#   BEZ_EDYTORA=1 scripts/testuj.sh   – szybszy test bez --test-edytor
#   LIMIT=600 scripts/testuj.sh       – limit jednego uruchomienia w sekundach (domyślnie 600)
# 07-gildie z --test-edytor idzie w trzech procesach jak w CI (#101): grupy z scripts/grupy-testow.js (zlecenia z
# cmykTest, zakladki, reszta = dopełnienie) – wynik „07-gildie-<grupa>”. Jedna grupa:
#   scripts/testuj.sh 07-gildie:zakladki   (nazwy grup: node scripts/grupy-testow.js)
# Przed testami przebudowuje app/zasoby (test uruchamia kopię karty.html z zasobów, nie app/generator!).
# Wynik: jeden wiersz na projekt (ok, Uwagi, nieudane części testu, błędy strony) i kod 0 / 1.
set -u
cd "$(dirname "$0")/.."
APP=$(pwd)
TMP=${TMPDIR:-/tmp}; TMP=${TMP%/}/gk-testy
RAZEM=${RAZEM:-5}
LIMIT=${LIMIT:-600}
rm -rf "$TMP"; mkdir -p "$TMP"
# Electron: na Linuksie pod Xvfb i bez piaskownicy, na macOS wprost.
ELECTRON=(./node_modules/.bin/electron)
[ "$(uname)" = Darwin ] || ELECTRON=(xvfb-run -a "${ELECTRON[@]}" --no-sandbox)
# Limit czasu: timeout (Linux), gtimeout (coreutils z Homebrew) albo Perl (macOS bez coreutils) – jak timeout:
# po czasie SIGTERM (node_modules/.bin/electron przekazuje go Electronowi, SIGALRM już nie) i kod 124.
limit() {
  if command -v timeout >/dev/null; then timeout "$@"
  elif command -v gtimeout >/dev/null; then gtimeout "$@"
  else perl -e '$t = shift; $p = fork // die; exec @ARGV or exit 127 unless $p;
      $SIG{ALRM} = sub { kill TERM => $p; $minal = 1 }; alarm $t;
      1 while waitpid($p, 0) == -1 && $!{EINTR}; exit($minal ? 124 : $? >> 8)' "$@"; fi
}
npm run -s zasoby >/dev/null || { echo "zasoby: błąd"; exit 1; }
node --check main.js && node --check preload.js || exit 1
node -e "const h=require('fs').readFileSync('generator/karty.html','utf8');for(const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1])" \
  || { echo "karty.html: błąd składni"; exit 1; }

cele=("$@")
[ ${#cele[@]} -eq 0 ] && cele=($(ls ../przyklady))
EDYTOR=--test-edytor; [ -n "${BEZ_EDYTORA:-}" ] && EDYTOR=

# Zadania: „cel|nazwa|bloki” (bloki = wartość --test-bloki, puste = wszystkie).
zadania=()
for c in "${cele[@]}"; do
  p=${c%%:*}; g=; [ "$p" != "$c" ] && g=${c#*:}
  if [ -n "$EDYTOR" ] && [ "$p" = 07-gildie ]; then
    znaleziona=
    while read -r nazwa bloki; do
      [ -z "$g" ] || [ "$g" = "$nazwa" ] || continue
      zadania+=("$p|$p-$nazwa|$bloki"); znaleziona=1
    done < <(node scripts/grupy-testow.js)
    [ -n "$znaleziona" ] || { echo "07-gildie: nieznana grupa „$g” (node scripts/grupy-testow.js)"; exit 1; }
  else
    zadania+=("$c|$(basename "$c")|")
  fi
done

test1() {
  local cel=$1 n=$2 bloki=$3 kat arg
  if [ -f "$cel" ]; then                         # szablon spoza przykładów: kopiujemy folder projektu
    kat=$(dirname "$cel"); [ "$(basename "$kat")" = Szablony ] && kat=$(dirname "$kat")
    n=$(basename "$kat"); cp -r "$kat" "$TMP/$n"; arg="$TMP/$n/${cel#$kat/}"
  else
    cp -r "../przyklady/$cel" "$TMP/$n"; arg="$TMP/$n"
  fi
  local opcje=($EDYTOR); [ -n "$bloki" ] && opcje+=(--test-bloki "$bloki")
  # ${opcje[@]+…} – pusta tablica przy set -u w bashu 3.2 (macOS) to „unbound variable”.
  limit "$LIMIT" "${ELECTRON[@]}" --user-data-dir="$TMP/ud-$n" \
    --enable-logging=file --log-file="$TMP/$n.log" . ${opcje[@]+"${opcje[@]}"} --test-pdf "$arg" "$TMP/$n.pdf" 2>/dev/null | grep "^{" | tail -1 > "$TMP/$n.json"
  python3 - "$n" "$TMP/$n.json" "$TMP/$n.log" <<'PY'
import json, sys, re
n, plik, log = sys.argv[1:]
try: d = json.load(open(plik))
except Exception: print(f"{n}: BRAK WYNIKU (test przerwany – limit LIMIT – albo zawieszony)"); sys.exit(1)
zle = [k for k, v in d.items() if isinstance(v, dict) and v.get('ok') is False]
bledy = [l.strip()[:160] for l in open(log, errors='ignore') if 'CONSOLE' in l and re.search(r'Uncaught|Error', l)]
print(f"{n}: {'ok' if d.get('ok') else 'BŁĄD'} · {d.get('stan','')[:40]} · Uwagi: {d.get('uwagi') or '–'}"
      + (f" · nieudane: {', '.join(zle)}" if zle else '') + (f" · błędy strony: {len(bledy)}" if bledy else ''))
for b in bledy[:3]: print('   ', b)
sys.exit(0 if d.get('ok') and not bledy else 1)
PY
}

# Bez `wait -n` (nie ma go w bashu 3.2 na macOS): czeka, aż skończy się którykolwiek z procesów `pidy`, i go usuwa.
kod=0; pidy=()
czekaj1() {
  local p reszta
  while :; do
    for p in "${pidy[@]}"; do
      kill -0 "$p" 2>/dev/null && continue
      wait "$p" || kod=1
      reszta=(); for q in "${pidy[@]}"; do [ "$q" = "$p" ] || reszta+=("$q"); done
      pidy=(${reszta[@]+"${reszta[@]}"}); return
    done
    sleep 1
  done
}
for z in "${zadania[@]}"; do
  IFS='|' read -r c n b <<< "$z"
  ( s=$(date +%s); test1 "$c" "$n" "$b"; k=$?; echo "   czas: $(( $(date +%s) - s )) s"; exit $k ) > "$TMP/$n.wynik" 2>&1 &
  pidy+=($!)
  [ ${#pidy[@]} -ge $RAZEM ] && czekaj1
done
while [ ${#pidy[@]} -gt 0 ]; do czekaj1; done
cat "$TMP"/*.wynik
echo "Pliki testów (PDF, zrzuty, JSON, logi): $TMP"
exit $kod
