'use strict';
// Test modułu drukarnia.js (bez Electrona): node scripts/test-drukarnia.js
// PDF imitujący Chromium (strony 196,08 × 265,92 pt = 69 × 94 mm po zaokrągleniu) → przygotujDruk.
const assert = require('assert');
const { PDFDocument, rgb } = require('pdf-lib');
const D = require('../drukarnia');

// W GitHub Actions błąd także jako adnotacja (widoczna w API bez pobierania logów).
if (process.env.GITHUB_ACTIONS) process.on('unhandledRejection', (e) => {
  const t = String((e && e.stack) || e);
  console.error(t);
  console.log('::error title=test-drukarnia::' + t.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A'));
  process.exit(1);
});

const MM = D.MM;
const bliskie = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.01, `${msg}: ${a} ≠ ${b}`);

async function pdfChromium(strony) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < strony; i++) {
    const s = doc.addPage([196.08, 265.92]);
    s.drawRectangle({ x: 10, y: 10 + i, width: 50, height: 40, color: rgb(1, 0, 0) });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// Plan jak z buildPrint(): 69 × 94 mm, spad 3, karta 63 × 88 mm na środku.
const ciecie = [3, 3, 63, 88];
const plan = (pliki, plikiStron) => ({ uklad: 'drukarnia', szer: 69, wys: 94, spad: 3, pliki, strony: plikiStron.map((plik) => ({ plik, ciecie })) });

(async () => {
  // 1. Jeden plik: MediaBox / TrimBox / BleedBox / CropBox, treść z prefiksem przesunięcia.
  const w1 = await D.przygotujDruk(await pdfChromium(3), plan([''], [0, 0, 0]), '/tmp/Gra – drukarnia.pdf');
  assert.strictEqual(w1.length, 1);
  assert.strictEqual(w1[0].plik, '/tmp/Gra – drukarnia.pdf');
  assert.strictEqual(w1[0].strony, 3);
  const d1 = await PDFDocument.load(w1[0].bufor);
  assert.strictEqual(d1.getPageCount(), 3);
  d1.getPages().forEach((s, i) => {
    const mb = s.getMediaBox(), tb = s.getTrimBox(), bb = s.getBleedBox(), cb = s.getCropBox();
    for (const [n, v] of [['MediaBox', mb], ['BleedBox', bb], ['CropBox', cb]]) {
      bliskie(v.x, 0, `${n} x`); bliskie(v.y, 0, `${n} y`); bliskie(v.width, 69 * MM, `${n} szer`); bliskie(v.height, 94 * MM, `${n} wys`);
    }
    bliskie(tb.x, 3 * MM, 'TrimBox x'); bliskie(tb.y, 3 * MM, 'TrimBox y');
    bliskie(tb.width, 63 * MM, 'TrimBox szer'); bliskie(tb.height, 88 * MM, 'TrimBox wys');
    // Treść: pierwszy strumień w Contents = prefiks z przesunięciem (cm), ostatni = zamknięcie q/Q.
    const tresc = s.node.Contents().asArray ? s.node.Contents() : null;
    assert.ok(tresc && tresc.size() >= 3, `strona ${i}: Contents to tablica z prefiksem`);
    const pierwszy = s.node.context.lookup(tresc.get(0));
    assert.ok(/ cm\b/.test(Buffer.from(pierwszy.getContents()).toString('latin1')), `strona ${i}: prefiks z cm`);
    // różnica wysokości: 94 mm − 265,92 pt
    const dy = 94 * MM - 265.92;
    assert.ok(new RegExp(`1 0 0 1 0\\.0000 ${dy.toFixed(4).replace('.', '\\.')} cm`).test(Buffer.from(pierwszy.getContents()).toString('latin1')), 'przesunięcie o różnicę wysokości');
  });

  // 2. Karta mniejsza od strony: TrimBox według ciecie z planu (środek strony), liczone od dołu.
  const p2 = plan([''], [0]); p2.strony[0].ciecie = [8, 12, 53, 70];
  const w2 = await D.przygotujDruk(await pdfChromium(1), p2, 'a.pdf');
  const tb2 = (await PDFDocument.load(w2[0].bufor)).getPage(0).getTrimBox();
  bliskie(tb2.x, 8 * MM, 'ciecie x'); bliskie(tb2.width, 53 * MM, 'ciecie szer');
  bliskie(tb2.y, (94 - 12 - 70) * MM, 'ciecie y od dołu'); bliskie(tb2.height, 70 * MM, 'ciecie wys');

  // 3. Dwa pliki wg „plik” w planie: awersy (3 strony) i rewersy (3 strony, strona N = rewers awersu N).
  const w3 = await D.przygotujDruk(await pdfChromium(6), plan(['awersy', 'rewersy'], [0, 0, 0, 1, 1, 1]), 'Export/Gra.pdf');
  assert.deepStrictEqual(w3.map((x) => x.plik), ['Export/Gra – awersy.pdf', 'Export/Gra – rewersy.pdf']);
  assert.deepStrictEqual(w3.map((x) => x.strony), [3, 3]);
  for (const c of w3) {
    const d = await PDFDocument.load(c.bufor);
    assert.strictEqual(d.getPageCount(), c.strony);
    bliskie(d.getPage(0).getMediaBox().height, 94 * MM, 'wysokość po podziale');
    bliskie(d.getPage(2).getTrimBox().x, 3 * MM, 'TrimBox po podziale');
  }
  // Nierówny podział (awersy 4, rewers wspólny w tym samym pliku nie dzieli się): 5 stron → 4 + 1.
  const w3b = await D.przygotujDruk(await pdfChromium(5), plan(['awersy', 'rewersy'], [0, 0, 0, 0, 1]), 'G.pdf');
  assert.deepStrictEqual(w3b.map((x) => x.strony), [4, 1]);
  assert.strictEqual((await PDFDocument.load(w3b[1].bufor)).getPageCount(), 1);

  // 4. Nazwy części.
  assert.strictEqual(D.plikCzesci('Gra.pdf', ''), 'Gra.pdf');
  assert.strictEqual(D.plikCzesci('Gra.pdf', 'awersy'), 'Gra – awersy.pdf');
  assert.strictEqual(D.plikCzesci('Gra.PDF', 'rewersy'), 'Gra – rewersy.pdf');
  assert.strictEqual(D.plikCzesci('Gra', 'rewersy'), 'Gra – rewersy.pdf');
  assert.strictEqual(D.plikCzesci('a/b.c/Gra.pdf', 'awersy'), 'a/b.c/Gra – awersy.pdf');

  // 5. Niezgodna liczba stron planu i PDF → błąd (dla jednego i dwóch plików).
  await assert.rejects(D.przygotujDruk(await pdfChromium(2), plan([''], [0, 0, 0]), 'a.pdf'), /2 stron.*3/);
  await assert.rejects(D.przygotujDruk(await pdfChromium(4), plan(['awersy', 'rewersy'], [0, 0, 1]), 'a.pdf'), /4 stron.*3/);

  console.log('test-drukarnia: ok');
})();
