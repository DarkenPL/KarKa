'use strict';
// Porównanie odcisków kart między starą a nową wersją karty.html (zgodność wstecz silnika).
// Dla każdego przykładu z przyklady/ liczy skrot(htmlKarty(k)) wszystkich kart na obu wersjach
// i zgłasza różnice. Kod wyjścia 1 przy jakiejkolwiek różnicy.
//
// Użycie (po `npm run zasoby`, z folderu app/):
//   node scripts/odciski.js <stary-karty.html> [przykład ...]
//   np. git show origin/main:app/generator/karty.html > /tmp/baza/karty-main.html
//       node scripts/odciski.js /tmp/baza/karty-main.html           # wszystkie przykłady
//       node scripts/odciski.js /tmp/baza/karty-main.html 03-ogrod  # wybrane
// Nowa wersja = app/zasoby/karty.html. Przykłady, których nie ma w starej wersji (nowe foldery),
// podaj jawnie albo pomiń: domyślnie lista z ODCISKI_POMIN (po przecinku, np. 06-targ).
// Wymaga: playwright (Chromium w /opt/pw-browsers), bibliotek w app/node_modules. Bez sieci.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { utworzSerwer } = require('../serwer');

const APP = path.join(__dirname, '..');
const ZASOBY = path.join(APP, 'zasoby');
const PRZYKLADY = path.join(APP, '..', 'przyklady');
const NM = path.join(APP, 'node_modules');
const BIBLIOTEKI = [
  [/html-to-image/, 'html-to-image/dist/html-to-image.js'],
  [/jszip/, 'jszip/dist/jszip.min.js'],
  [/xlsx/, 'xlsx/dist/xlsx.full.min.js'],
];

const stary = process.argv[2];
if (!stary || !fs.existsSync(stary)) { console.error('Podaj plik starej wersji karty.html (np. z origin/main).'); process.exit(2); }
const pomin = (process.env.ODCISKI_POMIN || '06-targ').split(',');
const wybrane = process.argv.slice(3);
const przyklady = (wybrane.length ? wybrane : fs.readdirSync(PRZYKLADY).filter((n) => !pomin.includes(n)))
  .filter((n) => fs.existsSync(path.join(PRZYKLADY, n)));

// Folder zasobów starej wersji: kopia zasobów z podmienionym karty.html.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odciski-'));
const zasobyStare = path.join(tmp, 'zasoby');
fs.cpSync(ZASOBY, zasobyStare, { recursive: true });
fs.copyFileSync(stary, path.join(zasobyStare, 'karty.html'));

const pierwszySzablon = (folder) => {
  const d = path.join(folder, 'Szablony');
  const f = fs.readdirSync(d).filter((n) => n.endsWith('.txt')).sort()[0];
  return 'Szablony/' + f;
};

async function odciski(browser, zasoby, folder) {
  const srv = utworzSerwer({ zasoby, projekt: () => folder });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const szablon = pierwszySzablon(folder);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const bledy = [];
  page.on('pageerror', (e) => bledy.push(String(e)));
  await page.addInitScript((szab) => {
    const nic = async () => null;
    window.generatorApp = new Proxy({
      info: async () => ({ szablon: szab, nazwa: 'odciski', przyklad: true, auto: false }),
      odciski: async () => null, eksportUstawienia: async () => ({}), cmykStan: async () => ({ gs: { ok: false } }),
      historiaZapisz: nic, naZmianeHistorii: () => {}, przyklady: async () => [],
    }, { get: (t, k) => (k in t ? t[k] : nic) });
  }, szablon);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (/fonts\.googleapis\.com/.test(url)) {
      const css = fs.readFileSync(path.join(zasoby, 'fonts/fonts.css'), 'utf8').replace(/url\(\.\//g, `url(http://127.0.0.1:${port}/.app/fonts/`);
      return route.fulfill({ contentType: 'text/css', body: css });
    }
    for (const [re, plik] of BIBLIOTEKI)
      if (re.test(url)) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(NM, plik)) });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/karty.html?szablon=${encodeURIComponent(szablon)}`);
  await page.waitForFunction(() => window.zbudowano === true, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const wynik = await page.evaluate(() => {
    const o = {};
    [...document.querySelectorAll('.karta')].forEach((k, i) => { o[i + '|' + kluczDruku(k)] = skrot(htmlKarty(k)); });
    return { odciski: o, uwagi: (document.getElementById('uwagi') || {}).textContent || '' };
  });
  await ctx.close();
  await new Promise((r) => srv.close(r));
  return { ...wynik, bledy };
}

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  let rozne = 0;
  for (const n of przyklady) {
    const folder = path.join(PRZYKLADY, n);
    const a = await odciski(browser, zasobyStare, folder);
    const b = await odciski(browser, ZASOBY, folder);
    const klucze = new Set([...Object.keys(a.odciski), ...Object.keys(b.odciski)]);
    const lista = [...klucze].filter((k) => a.odciski[k] !== b.odciski[k]);
    rozne += lista.length;
    console.log(`${lista.length ? 'RÓŻNICE' : 'ok     '}  ${n}: kart ${Object.keys(a.odciski).length}/${Object.keys(b.odciski).length}, różnic ${lista.length}`
      + (a.bledy.length || b.bledy.length ? `, błędy strony: ${a.bledy.concat(b.bledy).join(' | ')}` : ''));
    for (const k of lista.slice(0, 10)) console.log('    ' + k);
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(rozne ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
