#!/usr/bin/env node
// Testy przykładów w CI (#88): plan uruchomień zależny od trybu, kilka procesów naraz, czasy w podsumowaniu przebiegu.
//   node scripts/testy-ci.js <tryb> --bin "<polecenie aplikacji>" --tmp <katalog> [--razem 3]
// tryb: pr    – 07-gildie w dwóch procesach (lista ciężkich bloków i jej dopełnienie = pełny --test-edytor),
//               08-wieze – blok spadSzablonu, pozostałe przykłady --test-pdf (renderowanie, PDF, eksport);
//       pelny – --test-edytor na każdym przykładzie (jak do 0.6.2).
// --bin: w CI ścieżka do KarKa w .app; lokalnie np. "xvfb-run -a ./node_modules/.bin/electron --no-sandbox ."
// Każde uruchomienie ma własną kopię przykładu i własny --user-data-dir (procesy równoległe się nie blokują).
// Wynik: <tmp>/test/<nazwa>.json, tabela w $GITHUB_STEP_SUMMARY (jeśli jest), ::warning:: przy uruchomieniu > 180 s,
// kod 1, gdy któreś nie ma "ok":true.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const tryb = process.argv[2];
const bin = (arg('--bin') || '').split(' ').filter(Boolean);
const tmp = path.resolve(arg('--tmp', path.join(require('os').tmpdir(), 'karka-ci')));
const razem = Math.max(1, +arg('--razem', 3) || 3);
const PRZYKLADY = path.join(__dirname, '..', '..', 'przyklady');
const PROG_S = 180;
if (!['pr', 'pelny'].includes(tryb) || !bin.length) {
  console.error('Użycie: node scripts/testy-ci.js pr|pelny --bin "<polecenie>" --tmp <katalog> [--razem 3]');
  process.exit(2);
}

// Ciężkie bloki 07-gildie (pomiar 26.10.2026, lokalnie: zakladki 52 s, hist 48, drukarniaPdf 44, spadTest 24 –
// razem ~170 s; reszta z zlecenia 68 s i katalogiem 46 s – ~160 s). Drugi proces dostaje dopełnienie (-nazwy), więc nowy blok zawsze się wykona.
const CIEZKIE_07 = ['zakladki', 'hist', 'drukarniaPdf', 'spadTest'];

function plan() {
  const przyklady = fs.readdirSync(PRZYKLADY).filter((n) => fs.statSync(path.join(PRZYKLADY, n)).isDirectory()).sort();
  if (tryb === 'pelny') return przyklady.map((n) => ({ nazwa: n, przyklad: n, opcje: ['--test-edytor'] }));
  const lista = [];
  for (const n of przyklady) {
    if (n === '07-gildie') {
      lista.push({ nazwa: n + '-a', przyklad: n, opcje: ['--test-edytor', '--test-bloki', CIEZKIE_07.map((b) => '-' + b).join(',')] });
      lista.push({ nazwa: n + '-b', przyklad: n, opcje: ['--test-edytor', '--test-bloki', CIEZKIE_07.join(',')] });
    } else if (n === '08-wieze') lista.push({ nazwa: n, przyklad: n, opcje: ['--test-edytor', '--test-bloki', 'spadSzablonu'] });
    else lista.push({ nazwa: n, przyklad: n, opcje: [] });
  }
  // Najdłuższe najpierw – krótkie wypełniają wolne miejsca.
  return lista.sort((a, b) => b.opcje.length - a.opcje.length);
}

function uruchom(u) {
  return new Promise((koniec) => {
    const kopia = path.join(tmp, u.nazwa), wyniki = path.join(tmp, 'test');
    fs.rmSync(kopia, { recursive: true, force: true });
    fs.cpSync(path.join(PRZYKLADY, u.przyklad), kopia, { recursive: true });   // kopia: test zapisuje też Export/
    const argi = [...bin.slice(1), `--user-data-dir=${path.join(tmp, 'ud-' + u.nazwa)}`, ...u.opcje,
      '--test-pdf', kopia, path.join(wyniki, u.nazwa + '.pdf')];
    const start = Date.now();
    const p = spawn(bin[0], argi, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', () => {});
    p.on('close', (kod) => {
      const s = Math.round((Date.now() - start) / 1000);
      fs.writeFileSync(path.join(wyniki, u.nazwa + '.json'), out);
      let d = null;
      for (const w of out.split('\n').reverse()) if (w.startsWith('{')) { try { d = JSON.parse(w); break; } catch (e) { /* dalej */ } }
      const nieudane = d ? Object.entries(d).filter(([, v]) => v && typeof v === 'object' && v.ok === false).map(([k]) => k) : [];
      koniec({ ...u, s, kod, ok: !!(d && d.ok === true), blad: d ? d.blad : 'brak wyniku JSON', nieudane, czasy: d && d.czasyBlokow });
    });
  });
}

(async () => {
  fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
  const kolejka = plan(), wyniki = [];
  const start = Date.now();
  await Promise.all(Array.from({ length: Math.min(razem, kolejka.length) }, async () => {
    for (let u; (u = kolejka.shift());) {
      const w = await uruchom(u);
      wyniki.push(w);
      console.log(`${w.ok ? 'ok ' : 'BŁĄD'} ${w.nazwa} ${w.s} s${w.nieudane.length ? ' · nieudane: ' + w.nieudane.join(', ') : ''}${!w.ok && w.blad ? ' · ' + String(w.blad).slice(0, 300) : ''}`);
      if (w.s > PROG_S) console.log(`::warning::Test ${w.nazwa} trwał ${w.s} s (> ${PROG_S / 60} min).`);
    }
  }));
  const razemS = Math.round((Date.now() - start) / 1000);
  wyniki.sort((a, b) => a.nazwa.localeCompare(b.nazwa));
  const tab = ['', `Testy przykładów – tryb **${tryb}**, ${razem} naraz, razem ${razemS} s`, '',
    '| Uruchomienie | Opcje | Czas [s] | Wynik | Najdłuższe bloki [s] |', '|---|---|---:|---|---|',
    ...wyniki.map((w) => `| ${w.nazwa} | ${w.opcje.join(' ') || '--test-pdf'} | ${w.s} | ${w.ok ? 'ok' : '**BŁĄD**' + (w.nieudane.length ? ' (' + w.nieudane.join(', ') + ')' : '')} | `
      + (w.czasy ? Object.entries(w.czasy).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ') : '') + ' |')];
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, tab.join('\n') + '\n');
  console.log(tab.join('\n'));
  process.exit(wyniki.every((w) => w.ok) ? 0 : 1);
})();
