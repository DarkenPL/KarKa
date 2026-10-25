'use strict';
// PDF dla drukarni (issue #66, etap 1): dokładny rozmiar stron, TrimBox/BleedBox i podział na pliki.
// Wejście: bufor z webContents.printToPDF i plan z buildPrint() (karty.html):
//   { szer, wys, spad, pliki: ['', …] | ['awersy', 'rewersy'], strony: [{ plik: 0|1, ciecie: [x, y, w, h] }] }
// wymiary w mm, ciecie = prostokąt karty bez spadu liczony od lewego górnego rogu strony.
// pdf-lib (MIT) jest w zasoby/vendor – trafia też do małej aktualizacji (nakładka nie ma node_modules).
const path = require('path');

const MM = 72 / 25.4;
let PDFLib = null;
function pdfLib(zasoby) {
  if (!PDFLib) {
    const kandydaci = [zasoby && path.join(zasoby, 'vendor', 'pdf-lib.min.js'), path.join(__dirname, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js')];
    let blad;
    for (const k of kandydaci.filter(Boolean)) { try { PDFLib = require(k); break; } catch (e) { blad = e; } }
    if (!PDFLib) throw new Error('brak biblioteki pdf-lib: ' + (blad && blad.message));
  }
  return PDFLib;
}

// Chromium zaokrągla rozmiar strony (np. 69 × 94 mm → 196,08 × 265,92 pt) i rysuje treść od lewego
// górnego rogu (odwrócona oś Y z wysokością starej strony). Nowy MediaBox = dokładny rozmiar z planu,
// treść przesunięta w pionie o różnicę wysokości (bez skalowania – górny i lewy brzeg zostają na miejscu).
// TrimBox = karta bez spadu (z planu – przy kartach różnej wielkości karta stoi na środku strony),
// BleedBox = CropBox = MediaBox.
async function ustawStrony(buf, plan, zasoby) {
  const { PDFDocument, PDFName, PDFArray } = pdfLib(zasoby);
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const ctx = doc.context;
  const W = plan.szer * MM, H = plan.wys * MM;
  const box = (a, b, c, d) => ctx.obj([a, b, c, d].map((x) => Math.round(x * 1000) / 1000));
  const strony = doc.getPages();
  if (plan.strony && plan.strony.length !== strony.length)
    throw new Error(`PDF ma ${strony.length} stron, a plan druku ${plan.strony.length}`);
  strony.forEach((strona, i) => {
    const mb = strona.getMediaBox();
    const dy = H - (mb.y + mb.height);
    const przed = ctx.register(ctx.stream(`q 1 0 0 1 ${(-mb.x).toFixed(4)} ${(dy - mb.y).toFixed(4)} cm\n`));
    const po = ctx.register(ctx.stream('Q\n'));
    const tresc = strona.node.get(PDFName.of('Contents'));
    const tablica = ctx.obj([przed]);
    if (tresc) (tresc instanceof PDFArray ? tresc.asArray() : [tresc]).forEach((x) => tablica.push(x));
    tablica.push(po);
    strona.node.set(PDFName.of('Contents'), tablica);
    const [x, y, w, h] = (plan.strony && plan.strony[i] && plan.strony[i].ciecie) || [plan.spad || 0, plan.spad || 0, plan.szer - 2 * (plan.spad || 0), plan.wys - 2 * (plan.spad || 0)];
    strona.node.set(PDFName.of('MediaBox'), box(0, 0, W, H));
    strona.node.set(PDFName.of('CropBox'), box(0, 0, W, H));
    strona.node.set(PDFName.of('BleedBox'), box(0, 0, W, H));
    strona.node.set(PDFName.of('TrimBox'), box(x * MM, H - (y + h) * MM, (x + w) * MM, H - y * MM));
  });
  return { doc, bufor: Buffer.from(await doc.save({ useObjectStreams: false })) };
}

async function wybierzStrony(doc, indeksy, zasoby) {
  const { PDFDocument } = pdfLib(zasoby);
  const out = await PDFDocument.create();
  (await out.copyPages(doc, indeksy)).forEach((p) => out.addPage(p));
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

// Nazwa pliku części: „Gra – drukarnia.pdf” + „awersy” → „Gra – drukarnia – awersy.pdf”.
const plikCzesci = (plik, przyrostek) => !przyrostek ? plik
  : plik.replace(/(\.pdf)?$/i, '') + ' – ' + przyrostek + '.pdf';

// Zwraca [{ plik, bufor, strony }] – jeden plik albo awersy i rewersy (strona N rewersów = rewers awersu N).
async function przygotujDruk(buf, plan, plik, zasoby) {
  const { doc, bufor } = await ustawStrony(buf, plan, zasoby);
  const pliki = plan.pliki && plan.pliki.length ? plan.pliki : [''];
  if (pliki.length === 1) return [{ plik: plikCzesci(plik, pliki[0]), bufor, strony: doc.getPageCount() }];
  const wynik = [];
  for (let n = 0; n < pliki.length; n++) {
    const indeksy = plan.strony.map((s, i) => (s.plik === n ? i : -1)).filter((i) => i >= 0);
    if (!indeksy.length) continue;
    wynik.push({ plik: plikCzesci(plik, pliki[n]), bufor: await wybierzStrony(doc, indeksy, zasoby), strony: indeksy.length });
  }
  return wynik;
}

module.exports = { ustawStrony, przygotujDruk, plikCzesci, MM };
