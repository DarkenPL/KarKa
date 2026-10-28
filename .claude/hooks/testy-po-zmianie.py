#!/usr/bin/env python3
"""Hook PostToolUse (Edit/Write/MultiEdit): po zmianie silnika albo kodu aplikacji uruchamia szybki test na kopii przykładu 03-ogrod
(BEZ_EDYTORA=1 scripts/testuj.sh 03-ogrod, ok. 10 s; na Macu okno KarKi mignie). Pełny test --test-edytor (kilka minut) – tylko na prośbę.
Wynik idzie do właściciela (systemMessage) i do modelu (additionalContext). Czerwone = napraw albo cofnij, zanim powiesz „gotowe”."""
import json, os, re, subprocess, sys

try:
    dane = json.load(sys.stdin)
except Exception:
    sys.exit(0)
plik = (dane.get("tool_input") or {}).get("file_path", "") or ""
proj = os.environ.get("CLAUDE_PROJECT_DIR") or dane.get("cwd") or "."
rel = os.path.relpath(plik, proj) if plik.startswith("/") else plik
if not re.match(r"app/(generator/karty\.html|[^/]+\.js)$", rel):
    sys.exit(0)
srodowisko = dict(os.environ, BEZ_EDYTORA="1", RAZEM="1", LIMIT="150")
try:
    w = subprocess.run(["bash", "scripts/testuj.sh", "03-ogrod"], cwd=os.path.join(proj, "app"), capture_output=True, text=True, timeout=190, env=srodowisko)
    wynik = (w.stdout + w.stderr).strip().splitlines()
    ostatnie = " | ".join(l.strip() for l in wynik[-4:])
    stan = "zielony" if w.returncode == 0 else f"CZERWONY (kod {w.returncode})"
except subprocess.TimeoutExpired:
    stan, ostatnie = "CZERWONY (przekroczony czas)", ""
tekst = f"Hook testy-po-zmianie: szybki test 03-ogrod po zmianie {rel} – {stan}. {ostatnie}"
if "CZERWONY" in stan:
    tekst += " Napraw albo cofnij zmianę, zanim zgłosisz zadanie jako gotowe; pełny test: scripts/testuj.sh 03-ogrod."
print(json.dumps({"systemMessage": tekst, "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": tekst}}, ensure_ascii=False))
sys.exit(0)
