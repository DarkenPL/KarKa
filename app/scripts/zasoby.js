'use strict';
// Przygotowuje app/zasoby/: generator, przykłady, biblioteki i czcionki (do pracy bez internetu).
// Uruchamiane przez `npm run zasoby` (także przed budowaniem aplikacji).
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
const REPO = path.join(APP, '..');
const CEL = path.join(APP, 'zasoby');
const NM = path.join(APP, 'node_modules');

const kopiuj = (z, d) => { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.cpSync(z, d, { recursive: true }); };

fs.rmSync(CEL, { recursive: true, force: true });
kopiuj(path.join(APP, 'generator/karty.html'), path.join(CEL, 'karty.html'));
kopiuj(path.join(REPO, 'przyklady'), path.join(CEL, 'przyklady'));
kopiuj(path.join(APP, 'szablon-startowy'), path.join(CEL, 'szablon-startowy'));

// Biblioteki – te same wersje, które karty.html wczytuje z jsDelivr.
kopiuj(path.join(NM, 'html-to-image/dist/html-to-image.js'), path.join(CEL, 'vendor/html-to-image.js'));
kopiuj(path.join(NM, 'jszip/dist/jszip.min.js'), path.join(CEL, 'vendor/jszip.min.js'));
kopiuj(path.join(NM, 'xlsx/dist/xlsx.full.min.js'), path.join(CEL, 'vendor/xlsx.full.min.js'));
kopiuj(path.join(NM, 'pdf-lib/dist/pdf-lib.min.js'), path.join(CEL, 'vendor/pdf-lib.min.js'));   // PDF dla drukarni (main, drukarnia.js)

// Czcionki wbudowane w generator: EB Garamond (400, 600, 400 kursywa) i Patrick Hand (400).
const czcionki = [
  ['@fontsource/eb-garamond', ['400.css', '600.css', '400-italic.css']],
  ['@fontsource/patrick-hand', ['400.css']],
];
let css = '/* Czcionki wbudowane w aplikację (Fontsource, SIL Open Font License 1.1) */\n';
for (const [pakiet, pliki] of czcionki) {
  const dir = path.join(NM, pakiet);
  for (const f of pliki) {
    // Tylko alfabety łacińskie (latin, latin-ext) – wystarczą dla polskiego.
    const bloki = fs.readFileSync(path.join(dir, f), 'utf8').split(/(?=\/\* [\w-]+ \*\/)/)
      .filter((b) => /^\/\* [\w-]*-(latin|latin-ext)-\d+-(normal|italic) \*\//.test(b));
    for (const b of bloki) {
      css += b.replace(/url\(\.\/files\/([^)]+)\)/g, (m, plik) => {
        if (plik.endsWith('.woff2')) kopiuj(path.join(dir, 'files', plik), path.join(CEL, 'fonts', plik));
        return plik.endsWith('.woff2') ? `url(./${plik})` : m;
      }).replace(/,\s*url\(\.\/files\/[^)]+\) format\('woff'\)/g, '');
    }
  }
}
fs.mkdirSync(path.join(CEL, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(CEL, 'fonts/fonts.css'), css);

const rozmiar = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((s, n) => s + rozmiar(path.join(p, n)), 0) : fs.statSync(p).size;
console.log(`zasoby gotowe: ${CEL} (${(rozmiar(CEL) / 1048576).toFixed(1)} MB)`);
