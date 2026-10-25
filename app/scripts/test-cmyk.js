'use strict';
// Test modułu cmyk.js (PDF dla drukarni w CMYK, issue #66 etap 2) – bez Electrona i bez internetu:
//   node scripts/test-cmyk.js
// - znajdzGs (brak / za stary / prawdziwy), sprawdzPlikIcc, rozwiazProfil,
// - pobierzProfil na udawanym serwerze http (127.0.0.1): dobra paczka, zła suma, 404, ZIP bez pliku,
// - konwersja prawdziwym Ghostscriptem ≥ 10: PDF RGB jak z Chromium → przygotujDruk → konwertujBufor → kontrola.
// Profil CMYK do testów: mały profil z instalacji Ghostscripta (KARKA_TEST_ICC ma pierwszeństwo).
// Bez Ghostscripta lokalnie część konwersji jest pomijana; w GitHub Actions brak gs lub profilu = błąd testu.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const assert = require('assert');
const { spawnSync } = require('child_process');
const JSZip = require('jszip');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const cmyk = require('../cmyk');
const drukarnia = require('../drukarnia');

const CI = !!process.env.GITHUB_ACTIONS;
const MM = drukarnia.MM;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'gk-cmyk-'));
const START = Date.now();
const wyniki = [];
let bledy = 0;
const blad = (nazwa, e) => {
  bledy++;
  const t = String((e && e.stack) || e);
  wyniki.push(`BŁĄD ${nazwa} – ${t.split('\n')[0]}`);
  console.error(`BŁĄD ${nazwa}\n${t}`);
  // W GitHub Actions błąd także jako adnotacja (widoczna w API bez pobierania logów).
  if (CI) console.log(`::error title=test-cmyk ${nazwa}::` + t.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A'));
};
async function krok(nazwa, fn) {
  try { const info = await fn(); wyniki.push(`ok   ${nazwa}${info ? ' – ' + info : ''}`); } catch (e) { blad(nazwa, e); }
}
const bliskie = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.01, `${msg}: ${a} ≠ ${b}`);

// ── Szukanie narzędzi testowych ─────────────────────────────────────────────
// Foldery iccprofiles Ghostscripta: Linux (/usr/share/color/icc/ghostscript), Homebrew (share/ghostscript/*/iccprofiles).
function folderyIcc(gsSciezka) {
  const f = ['/usr/share/color/icc/ghostscript'];
  const prefiksy = new Set(['/opt/homebrew', '/usr/local', '/usr']);
  if (gsSciezka) prefiksy.add(path.resolve(path.dirname(fs.realpathSync(gsSciezka)), '..'));
  const brew = spawnSync('brew', ['--prefix'], { encoding: 'utf8' });
  if (brew.status === 0 && brew.stdout.trim()) prefiksy.add(brew.stdout.trim());
  for (const p of prefiksy) {
    const baza = path.join(p, 'share', 'ghostscript');
    let wersje = [];
    try { wersje = fs.readdirSync(baza); } catch (e) { /* brak */ }
    for (const w of wersje) f.push(path.join(baza, w, 'iccprofiles'), path.join(baza, w, 'Resource', 'ColorSpace'));
  }
  return f.filter((x) => fs.existsSync(x));
}
// → ścieżka profilu CMYK albo RGB do testów (null – nie ma).
function znajdzIcc(rodzaj, gsSciezka) {
  const nazwy = rodzaj === 'cmyk' ? ['default_cmyk.icc'] : ['default_rgb.icc', 'srgb.icc'];
  const env = process.env.KARKA_TEST_ICC;
  const foldery = [];
  if (env && rodzaj === 'cmyk') return fs.existsSync(env) ? env : null;
  if (env) foldery.push(path.dirname(env));
  foldery.push(...folderyIcc(gsSciezka));
  // Ghostscript z wkompilowanymi zasobami (%rom%, Homebrew) – profile wypakowane przez cmyk.katalogIccGs.
  if (gsSciezka) { const g = cmyk.znajdzGs({ kandydaci: [gsSciezka] }); const k = g.ok && cmyk.katalogIccGs(g); if (k) foldery.push(k); }
  for (const d of foldery) for (const n of nazwy) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  return null;
}

// ── PNG RGB bez bibliotek (zlib) – obrazek do PDF ───────────────────────────
const TABELA_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngRgb(w, h) {
  const kawalek = (typ, dane) => {
    const t = Buffer.concat([Buffer.from(typ, 'latin1'), dane]);
    const d = Buffer.alloc(4); d.writeUInt32BE(dane.length);
    const s = Buffer.alloc(4); s.writeUInt32BE(crc(t));
    return Buffer.concat([d, t, s]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8 bitów, RGB
  const surowe = Buffer.alloc((w * 3 + 1) * h);
  let ziarno = 12345;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * (w * 3 + 1) + 1 + x * 3;
    // Szum (LCG) zamiast gładkiego gradientu: obrazek musi przekroczyć ok. 4 kB, inaczej gs zapisuje go inline (BI…EI), poza kontrolą sprawdzPdf.
    ziarno = (ziarno * 1103515245 + 12345) >>> 0;
    surowe[i] = (ziarno >>> 8) & 255; surowe[i + 1] = (ziarno >>> 16) & 255; surowe[i + 2] = Math.round(255 * x / (w - 1));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), kawalek('IHDR', ihdr), kawalek('IDAT', zlib.deflateSync(surowe)), kawalek('IEND', Buffer.alloc(0))]);
}

// PDF jak z Chromium: strony 196,08 × 265,92 pt (69 × 94 mm po zaokrągleniu), prostokąt RGB, czarny tekst, obrazek RGB.
async function pdfRgb(stron) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const obraz = await doc.embedPng(pngRgb(64, 64));
  for (let i = 0; i < stron; i++) {
    const s = doc.addPage([196.08, 265.92]);
    s.drawRectangle({ x: 10, y: 10 + i, width: 90, height: 60, color: rgb(0.8, 0.2, 0.1) });
    s.drawText('Próba CMYK ' + (i + 1), { x: 20, y: 150, size: 14, font, color: rgb(0, 0, 0) });
    s.drawImage(obraz, { x: 20, y: 180, width: 60, height: 60 });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
// Liczba operatorów „c m y k k” innych niż „0 0 0 1 k” (kolory, które nie są czernią K100).
async function innyKolorK(buf, PDFLib) {
  const d = await PDFLib.PDFDocument.load(buf, { updateMetadata: false });
  let n = 0;
  for (const [, o] of d.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFLib.PDFRawStream)) continue;
    let t;
    try { t = zlib.inflateSync(Buffer.from(o.contents)).toString('latin1'); } catch (e) { continue; }
    for (const m of t.matchAll(/(?:^|\s)([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k(?=\s)/g)) if (m.slice(1).join(' ') !== '0 0 0 1') n++;
  }
  return n;
}
const plan = (pliki, plikiStron) => ({ uklad: 'drukarnia', szer: 69, wys: 94, spad: 3, pliki,
  strony: plikiStron.map((plik) => ({ plik, ciecie: [3, 3, 63, 88] })) });

(async () => {
  // ── a) znajdzGs ───────────────────────────────────────────────────────────
  let gsPrawdziwy = null;
  await krok('znajdzGs: brak plików', () => {
    const r = cmyk.znajdzGs({ kandydaci: [path.join(T, 'nie-ma', 'gs'), path.join(T, 'nie-ma-2', 'gs')] });
    assert.strictEqual(r.ok, false);
    assert.ok(/brew install ghostscript/.test(r.powod), r.powod);
    assert.ok(r.powod.includes('nie-ma'), 'powód wymienia sprawdzone ścieżki');
  });
  await krok('znajdzGs: za stary (9.54.0)', () => {
    const stary = path.join(T, 'gs-stary');
    fs.writeFileSync(stary, '#!/bin/sh\necho 9.54.0\n', { mode: 0o755 });
    const r = cmyk.znajdzGs({ kandydaci: [stary] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.wersja, '9.54.0');
    assert.ok(/za stary/.test(r.powod), r.powod);
    // Za stary nie przesłania nowszego dalej na liście.
    const dalej = cmyk.znajdzGs({ kandydaci: [stary, path.join(T, 'nie-ma', 'gs')] });
    assert.strictEqual(dalej.ok, false);
  });
  await krok('znajdzGs: gs nie odpowiada', () => {
    const zly = path.join(T, 'gs-zly');
    fs.writeFileSync(zly, '#!/bin/sh\necho kłopot >&2\nexit 3\n', { mode: 0o755 });
    const r = cmyk.znajdzGs({ kandydaci: [zly] });
    assert.strictEqual(r.ok, false);
    assert.ok(/nie odpowiada/.test(r.powod) && /brew install ghostscript/.test(r.powod), r.powod);
  });
  await krok('znajdzGs: prawdziwy gs ≥ 10', () => {
    const lista = [process.env.KARKA_GS, '/usr/bin/gs', '/opt/homebrew/bin/gs', '/usr/local/bin/gs'].filter(Boolean);
    const r = cmyk.znajdzGs({ kandydaci: lista });
    if (!r.ok) {
      if (CI) assert.fail('w GitHub Actions musi być Ghostscript ≥ 10: ' + r.powod);
      return 'pominięto – ' + r.powod;
    }
    assert.ok(parseInt(r.wersja, 10) >= 10, r.wersja);
    assert.ok(fs.existsSync(r.sciezka));
    gsPrawdziwy = r;
    return `gs ${r.wersja} (${r.sciezka})`;
  });
  // ── b) profile ICC ────────────────────────────────────────────────────────
  const iccCmyk = znajdzIcc('cmyk', gsPrawdziwy && gsPrawdziwy.sciezka);
  const iccRgb = znajdzIcc('rgb', gsPrawdziwy && gsPrawdziwy.sciezka);
  let profilGotowy = false;
  await krok('profil CMYK do testów', () => {
    if (!iccCmyk) {
      if (CI) assert.fail('w GitHub Actions musi być profil CMYK z instalacji Ghostscripta (albo KARKA_TEST_ICC)');
      return 'pominięto – brak default_cmyk.icc (ustaw KARKA_TEST_ICC)';
    }
    profilGotowy = true;
    return iccCmyk;
  });
  await krok('katalog profili Ghostscripta (dysk albo wypakowany z %rom%)', () => {
    if (!gsPrawdziwy) return 'pominięto – brak gs';
    const k = cmyk.katalogIccGs({ ...gsPrawdziwy });
    assert.ok(k, 'nie znaleziono ani nie wypakowano iccprofiles');
    for (const f of ['default_cmyk.icc', 'default_gray.icc', 'default_rgb.icc']) assert.ok(fs.existsSync(path.join(k, f)), f);
    // Wypakowanie Ghostscriptem (ta sama droga co %rom%) z katalogu na dysku – ścieżka ze spacją i polskim znakiem.
    const cel = path.join(T, 'wypakowane ą');
    cmyk.wypakujProfileGs(gsPrawdziwy, k.replace(/\/?$/, '/'), cel);
    assert.ok(fs.readFileSync(path.join(cel, 'default_cmyk.icc')).equals(fs.readFileSync(path.join(k, 'default_cmyk.icc'))));
    return k;
  });
  const tekstowy = path.join(T, 'x.txt');
  fs.writeFileSync(tekstowy, 'to nie jest profil\n'.repeat(20));
  await krok('sprawdzPlikIcc: zwykły plik, brak pliku, rozwiazProfil', () => {
    assert.throws(() => cmyk.sprawdzPlikIcc(tekstowy), /nie jest profilem ICC/);
    assert.throws(() => cmyk.sprawdzPlikIcc(path.join(T, 'brak.icc')), /nie ma pliku profilu/);
    const krotki = path.join(T, 'krotki.icc');
    fs.writeFileSync(krotki, 'acsp');
    assert.throws(() => cmyk.sprawdzPlikIcc(krotki), /nie jest profilem ICC/);
    assert.throws(() => cmyk.rozwiazProfil(tekstowy, T), /możliwe: fogra39, fogra51/);   // rozszerzenie .txt
    // plik z rozszerzeniem .icc, ale tekstowy → odrzucony przez nagłówek
    const falszywy = path.join(T, 'falszywy.icc');
    fs.copyFileSync(tekstowy, falszywy);
    assert.throws(() => cmyk.rozwiazProfil(falszywy, T), /nie jest profilem ICC/);
    // klucz bez pobranego pliku → { brak }
    const r = cmyk.rozwiazProfil('fogra39', path.join(T, 'pusty'));
    assert.strictEqual(r.brak, 'fogra39');
    assert.deepStrictEqual(Object.keys(cmyk.PROFILE).sort(), ['fogra39', 'fogra51']);
    assert.strictEqual(cmyk.rozwiazProfil(undefined, path.join(T, 'pusty')).brak, 'fogra39');   // domyślny
  });
  if (profilGotowy) {
    await krok('sprawdzPlikIcc: CMYK ok, RGB odrzucony', () => {
      assert.strictEqual(cmyk.sprawdzPlikIcc(iccCmyk), iccCmyk);
      const r = cmyk.rozwiazProfil(iccCmyk, T);
      assert.deepStrictEqual(r, { plik: iccCmyk, nazwa: path.basename(iccCmyk), klucz: null });
      if (!iccRgb) {
        if (CI) assert.fail('brak profilu RGB (default_rgb.icc / srgb.icc) do testu odrzucenia');
        return 'RGB pominięto – brak profilu RGB';
      }
      assert.throws(() => cmyk.sprawdzPlikIcc(iccRgb), /CMYK/);
      assert.throws(() => cmyk.rozwiazProfil(iccRgb, T), /RGB.*CMYK|CMYK/);
    });
  }

  // ── c) pobierzProfil na udawanym serwerze ─────────────────────────────────
  if (profilGotowy) {
    const dane = fs.readFileSync(iccCmyk);
    const zepsute = Buffer.from(dane); zepsute[zepsute.length - 1] ^= 0xff;
    const zipZ = async (pliki) => { const z = new JSZip(); for (const [n, b] of Object.entries(pliki)) z.file(n, b); return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }); };
    const paczki = {
      dobra: await zipZ({ 'Paczka/test.icc': dane, 'Paczka/czytaj.txt': 'licencja' }),
      zla: await zipZ({ 'Paczka/test.icc': zepsute }),
      bezPliku: await zipZ({ 'Paczka/inny.icc': dane }),
    };
    let tryb = 'dobra';
    const zadania = [];
    const serwer = http.createServer((req, res) => {
      zadania.push(req.url);
      if (req.url !== '/lib/exe/test.zip' || tryb === '404') { res.statusCode = 404; return res.end('nie ma'); }
      const b = paczki[tryb];
      res.setHeader('Content-Length', b.length);
      res.end(b);
    });
    await new Promise((r) => serwer.listen(0, '127.0.0.1', r));
    const adresPrzed = process.env.KARKA_PROFILE_ADRES;
    process.env.KARKA_PROFILE_ADRES = `http://127.0.0.1:${serwer.address().port}/lib/exe/`;
    cmyk.PROFILE.test = { nazwa: 'Profil testowy', paczka: 'test.zip', wZip: 'Paczka/test.icc', plik: 'test.icc', sha256: cmyk.sha256(dane), rozmiar: dane.length, paczkaMB: 1 };
    try {
      const folder = path.join(T, 'profile');
      await krok('pobierzProfil: dobra paczka', async () => {
        assert.strictEqual(cmyk.profilLokalny('test', folder), null);
        assert.strictEqual(cmyk.rozwiazProfil('test', folder).brak, 'test');
        const postep = [];
        const sciezka = await cmyk.pobierzProfil('test', folder, { postep: (u) => postep.push(u) });
        assert.strictEqual(sciezka, path.join(folder, 'test.icc'));
        assert.ok(fs.readFileSync(sciezka).equals(dane), 'plik zgodny z profilem');
        assert.strictEqual(cmyk.profilLokalny('test', folder), sciezka);
        const r = cmyk.rozwiazProfil('test', folder);
        assert.strictEqual(r.plik, sciezka);
        assert.strictEqual(r.klucz, 'test');
        assert.ok(postep.length >= 1 && postep.every((u) => u >= 0 && u <= 1) && postep[postep.length - 1] === 1, 'postęp: ' + postep);
        assert.deepStrictEqual(fs.readdirSync(folder), ['test.icc'], 'w folderze tylko profil (bez .czesc i licencji)');
        assert.strictEqual(cmyk.sprawdzPlikIcc(sciezka), sciezka);
        return `postęp ×${postep.length}`;
      });
      await krok('pobierzProfil: zła suma', async () => {
        const f2 = path.join(T, 'profile-zla-suma');
        tryb = 'zla';
        await assert.rejects(cmyk.pobierzProfil('test', f2), (e) => /SHA-256/.test(e.message) && /Pobierz ręcznie/.test(e.message) && /eci\.org/.test(e.message));
        assert.ok(!fs.existsSync(path.join(f2, 'test.icc')), 'pliku nie ma');
        assert.ok(!fs.existsSync(f2) || fs.readdirSync(f2).length === 0, 'folder pusty');
        assert.strictEqual(cmyk.profilLokalny('test', f2), null);
        // uszkodzony plik leżący w folderze nie jest uznany za pobrany
        fs.mkdirSync(f2, { recursive: true });
        fs.writeFileSync(path.join(f2, 'test.icc'), zepsute);
        assert.strictEqual(cmyk.profilLokalny('test', f2), null);
        assert.strictEqual(cmyk.rozwiazProfil('test', f2).brak, 'test');
      });
      await krok('pobierzProfil: 404', async () => {
        const f3 = path.join(T, 'profile-404');
        tryb = '404';
        await assert.rejects(cmyk.pobierzProfil('test', f3), (e) => /404/.test(e.message) && /Pobierz ręcznie/.test(e.message));
        assert.ok(!fs.existsSync(path.join(f3, 'test.icc')));
      });
      await krok('pobierzProfil: ZIP bez pliku, nie-ZIP, nieznany klucz', async () => {
        const f4 = path.join(T, 'profile-bez-pliku');
        tryb = 'bezPliku';
        await assert.rejects(cmyk.pobierzProfil('test', f4), (e) => /nieczytelna/.test(e.message) && /nie ma pliku test\.icc/.test(e.message) && /Pobierz ręcznie/.test(e.message));
        assert.ok(!fs.existsSync(path.join(f4, 'test.icc')));
        paczki.smieci = Buffer.from('to nie jest zip'.repeat(10));
        tryb = 'smieci';
        await assert.rejects(cmyk.pobierzProfil('test', f4), /nieczytelna/);
        await assert.rejects(cmyk.pobierzProfil('nie-ma', f4), /nieznany profil/);
      });
      await krok('pobierzProfil: tylko 127.0.0.1', () => {
        assert.ok(zadania.length >= 4 && zadania.every((u) => u === '/lib/exe/test.zip'), zadania.join());
        assert.ok(cmyk.adresPaczki('test').startsWith('http://127.0.0.1:'));
        delete process.env.KARKA_PROFILE_ADRES;
        assert.strictEqual(cmyk.adresPaczki('fogra39'), 'https://eci.org/lib/exe/eci_offset_2009.zip');   // domyślny adres (bez żądania)
      });
    } finally {
      delete cmyk.PROFILE.test;
      if (adresPrzed === undefined) delete process.env.KARKA_PROFILE_ADRES; else process.env.KARKA_PROFILE_ADRES = adresPrzed;
      await new Promise((r) => serwer.close(r));
    }
  }

  // ── d) konwersja Ghostscriptem ────────────────────────────────────────────
  if (gsPrawdziwy && profilGotowy) {
    const gs = gsPrawdziwy;
    const PDFLib = drukarnia.pdfLib();
    await krok('sprawdzPdf: PDF RGB przed konwersją', async () => {
      const k = await cmyk.sprawdzPdf(await pdfRgb(2), PDFLib);
      assert.strictEqual(k.strony, 2);
      assert.ok(k.rgb > 0, 'operatory rg: ' + k.rgb);
      assert.ok(k.obrazki.inne.length > 0 || k.przestrzenieRgb > 0, 'obrazek RGB wykryty');
      assert.strictEqual(k.ok, false);
      assert.strictEqual(k.trimBox, 0);
      return `rgb ${k.rgb}, obrazki inne ${k.obrazki.inne.join()}`;
    });
    await krok('konwersja: awersy i rewersy (2 części po 2 strony)', async () => {
      const p = plan(['awersy', 'rewersy'], [0, 0, 1, 1]);
      const czesci = await drukarnia.przygotujDruk(await pdfRgb(4), p, path.join(T, 'Gra.pdf'));
      assert.deepStrictEqual(czesci.map((c) => c.indeksy), [[0, 1], [2, 3]]);
      const opis = [];
      for (const c of czesci) {
        const w = await cmyk.konwertujBufor(c.bufor, { gs, profil: iccCmyk, PDFLib, po: (b) => drukarnia.ustawRamki(b, p, c.indeksy) });
        const k = w.kontrola;
        assert.strictEqual(k.strony, c.strony);
        assert.strictEqual(k.rgb, 0, 'rgb');
        assert.strictEqual(k.przestrzenieRgb, 0, 'przestrzenieRgb');
        // Czysta czerń tekstu: „0 0 0 1 k” (to liczy sprawdzPdf); gs 10.02.1 zapisuje ją jako „0 g” (DeviceGray, też tylko kanał K).
        {   // czarny tekst dokładnie K100, czerwony prostokąt nie zczernił
          assert.ok(k.czern > 0, 'czern > 0 (0 0 0 1 k): ' + k.czern);
          const inne = await innyKolorK(w.bufor, PDFLib);
          assert.ok(inne > 0, 'operatory k inne niż 0 0 0 1 (czerwony prostokąt): ' + inne);
        }
        assert.ok(k.czern > 0, `czerń tekstu #000 jako 0 0 0 1 k: ×${k.czern}`);
        assert.ok(k.obrazki.cmyk >= 1, 'obrazki CMYK: ' + JSON.stringify(k.obrazki));
        assert.deepStrictEqual(k.obrazki.inne, []);
        assert.strictEqual(k.trimBox, k.strony);
        assert.strictEqual(k.ok, true);
        // Ramki z planu: MediaBox 69 × 94 mm, TrimBox [3, 3, 66, 91] mm.
        const doc = await PDFDocument.load(w.bufor);
        doc.getPages().forEach((s, i) => {
          const mb = s.getMediaBox(), tb = s.getTrimBox(), bb = s.getBleedBox(), cb = s.getCropBox();
          for (const [n, v] of [['MediaBox', mb], ['BleedBox', bb], ['CropBox', cb]]) {
            bliskie(v.x, 0, `${n} x`); bliskie(v.y, 0, `${n} y`); bliskie(v.width, 69 * MM, `${n} szer`); bliskie(v.height, 94 * MM, `${n} wys`);
          }
          bliskie(tb.x, 3 * MM, `str. ${i} TrimBox x`); bliskie(tb.y, 3 * MM, `str. ${i} TrimBox y`);
          bliskie(tb.x + tb.width, 66 * MM, `str. ${i} TrimBox x2`); bliskie(tb.y + tb.height, 91 * MM, `str. ${i} TrimBox y2`);
          assert.ok(!s.node.get(PDFLib.PDFName.of('Rotate')), 'bez Rotate');
        });
        opis.push(`${k.strony} str. czerń ${k.czern}, ${w.czas} ms`);
        assert.ok(w.bufor.length > 1000);
      }
      return opis.join(' · ');
    });
    await krok('konwersja: jeden plik (bez podziału, indeksy null)', async () => {
      const p = plan([''], [0, 0]);
      const [c] = await drukarnia.przygotujDruk(await pdfRgb(2), p, path.join(T, 'Jedna.pdf'));
      assert.strictEqual(c.indeksy, null);
      const w = await cmyk.konwertujBufor(c.bufor, { gs, profil: iccCmyk, PDFLib, po: (b) => drukarnia.ustawRamki(b, p, c.indeksy) });
      assert.ok(w.kontrola.ok && w.kontrola.strony === 2);
      // Niezgodna liczba stron w ustawRamki → błąd.
      await assert.rejects(drukarnia.ustawRamki(w.bufor, p, [0]), /2 stron zamiast 1/);
    });

    // Błędy.
    const we = path.join(T, 'we.pdf');
    fs.writeFileSync(we, await pdfRgb(1));
    await krok('konwertuj: błąd gs (kod ≠ 0) → wyjątek, częściowy plik usunięty', async () => {
      // Udawany gs zapisuje połowę wyniku i kończy się błędem – konwertuj ma usunąć plik wyjściowy.
      const zly = path.join(T, 'gs-pada');
      fs.writeFileSync(zly, '#!/bin/sh\nfor a in "$@"; do case "$a" in -sOutputFile=*) echo czesc > "${a#-sOutputFile=}";; esac; done\necho "Error: /undefined in x" >&2\nexit 1\n', { mode: 0o755 });
      const wy = path.join(T, 'pada-cmyk.pdf');
      await assert.rejects(cmyk.konwertuj(we, wy, { gs: { ok: true, sciezka: zly, wersja: '10.0.0', katalogIcc: cmyk.katalogIccGs(gs) }, profil: iccCmyk }), /Ghostscript zakończył się błędem \(kod 1\).*undefined/);
      assert.ok(!fs.existsSync(wy), 'plik wyjściowy nie istnieje');
    });
    await krok('konwertuj: obcięty PDF – gs kończy kodem 0 i daje pusty PDF', async () => {
      // Znane zachowanie gs 10: uszkodzone wejście = kod 0 i pusty PDF. Ochroną jest kontrola liczby stron (pdfDoPliku).
      const obciety = path.join(T, 'obciety.pdf'), wy = path.join(T, 'obciety-cmyk.pdf');
      fs.writeFileSync(obciety, fs.readFileSync(we).subarray(0, 20));
      let blad = null;
      await cmyk.konwertuj(obciety, wy, { gs, profil: iccCmyk }).catch((e) => { blad = e; });
      if (blad) { assert.ok(/Ghostscript zakończył się błędem/.test(blad.message), blad.message); assert.ok(!fs.existsSync(wy)); return 'odrzucony'; }
      const k = await cmyk.sprawdzPdf(fs.readFileSync(wy), PDFLib);
      assert.ok(k.strony <= 1 && k.czern === 0 && k.obrazki.cmyk === 0, 'wynik bez treści: ' + JSON.stringify(k));
      wyniki.push(`UWAGA gs: obcięty PDF → kod 0 i pusty PDF (${k.strony} str.) – konwertuj nie zgłasza błędu`);
    });
    await krok('konwertuj: profil nieistniejący → błąd, brak pliku', async () => {
      const wy = path.join(T, 'bez-profilu-cmyk.pdf');
      await assert.rejects(cmyk.konwertuj(we, wy, { gs, profil: path.join(T, 'nie-ma.icc') }), /Ghostscript zakończył się błędem|profil/i);
      assert.ok(!fs.existsSync(wy), 'plik wyjściowy nie istnieje');
    });
    await krok('konwertuj: brak Ghostscripta w opcjach → czytelny błąd', async () => {
      await assert.rejects(cmyk.konwertuj(we, path.join(T, 'x.pdf'), { gs: { ok: false, powod: 'brew install ghostscript' }, profil: iccCmyk }), /brew install ghostscript/);
    });
    await krok('konwertuj: AbortController przerwany od razu', async () => {
      const wy = path.join(T, 'przerwany-cmyk.pdf');
      const ac = new AbortController(); ac.abort();
      await assert.rejects(cmyk.konwertuj(we, wy, { gs, profil: iccCmyk, sygnal: ac.signal }), /przerwana/);
      assert.ok(!fs.existsSync(wy), 'plik wyjściowy nie istnieje');
      // przerwanie w trakcie
      const ac2 = new AbortController();
      const obietnica = cmyk.konwertuj(we, wy, { gs, profil: iccCmyk, sygnal: ac2.signal });
      ac2.abort();
      await assert.rejects(obietnica, /przerwana/);
      assert.ok(!fs.existsSync(wy), 'plik wyjściowy nie istnieje (przerwanie w trakcie)');
    });
    await krok('konwertuj: limit czasu', async () => {
      const wolny = path.join(T, 'gs-wolny');
      fs.writeFileSync(wolny, '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
      const wy = path.join(T, 'wolny-cmyk.pdf');
      await assert.rejects(cmyk.konwertuj(we, wy, { gs: { ok: true, sciezka: wolny, wersja: '10.0.0', katalogIcc: cmyk.katalogIccGs(gs) }, profil: iccCmyk, limit: 200 }), /nie skończył w/);
      assert.ok(!fs.existsSync(wy));
    });
    await krok('konwertujBufor: sprząta folder tymczasowy', async () => {
      const ile = () => fs.readdirSync(os.tmpdir()).filter((n) => /^karka-(cmyk|icc|profil)-/.test(n)).length;
      const przed = ile();
      await assert.rejects(cmyk.konwertujBufor(Buffer.from('%PDF-1.4 obcięty'), { gs, profil: path.join(T, 'nie-ma.icc'), PDFLib }), /nie ma pliku profilu/);
      await assert.rejects(cmyk.konwertujBufor(Buffer.from('%PDF-1.4 obcięty'), { gs, profil: iccCmyk, PDFLib }));
      const po = ile();
      assert.ok(po <= przed, `foldery karka-cmyk-: ${przed} → ${po}`);
    });
  } else {
    wyniki.push('pominięto – konwersja Ghostscriptem (brak gs ≥ 10 albo profilu CMYK)');
  }

  fs.rmSync(T, { recursive: true, force: true });
  const czas = ((Date.now() - START) / 1000).toFixed(1);
  console.log(wyniki.join('\n'));
  console.log(`test-cmyk: ${bledy ? bledy + ' błędów' : 'ok'} (${czas} s)`);
  process.exit(bledy ? 1 : 0);
})().catch((e) => { blad('nieobsłużony wyjątek', e); process.exit(1); });
