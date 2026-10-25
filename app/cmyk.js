'use strict';
// PDF dla drukarni w CMYK (issue #66, etap 2): konwersja gotowego PDF-a (RGB z Chromium) Ghostscriptem
// do profilu drukarni, z zachowaniem czystej czerni (K100) dla tekstu i grafiki wektorowej.
// - Ghostscript NIE jest w paczce (AGPL): Homebrew, /opt/homebrew/bin/gs (zapasowo /usr/local/bin/gs), wersja ≥ 10
//   (BlackText od 9.55, BlackVector od 9.56). KARKA_GS = inna ścieżka (testy, Linux).
// - Profile ICC NIE są w repozytorium ani w paczce (licencja ECI / Heidelberg): pobierane przy pierwszym użyciu
//   z eci.org (z ZIP-a tylko jeden plik, kontrola SHA-256) do <dane aplikacji>/profile/. Można wskazać własny plik .icc.
//   KARKA_PROFILE_ADRES = inny adres zamiast https://eci.org/lib/exe/ (testy – udawany serwer).
// Moduł bez Electrona (testy: scripts/test-cmyk.js); fetch podaje main (net.fetch).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ADRES_ECI = 'https://eci.org/lib/exe/';
const PROFILE = {
  fogra39: { nazwa: 'ISO Coated v2 (ECI) – Fogra39', paczka: 'eci_offset_2009.zip', wZip: 'ECI_Offset_2009/ISOcoated_v2_eci.icc',
    plik: 'ISOcoated_v2_eci.icc', sha256: '128dc02f7246cc3807af0323695379f64151a8f27a587736acc59f8b6ce894b8', rozmiar: 1829077, paczkaMB: 17 },
  fogra51: { nazwa: 'PSO Coated v3 – Fogra51', paczka: 'pso-coated_v3.zip', wZip: 'PSOcoated_v3.icc',
    plik: 'PSOcoated_v3.icc', sha256: 'c30ad2c01e8f93135ec7682c535e0a81bc2d177c301e196376c5f5838b5c8e86', rozmiar: 2195228, paczkaMB: 2 },
};
const DOMYSLNY = 'fogra39';
const MIN_WERSJA_GS = 10;
const KANDYDACI_GS = ['/opt/homebrew/bin/gs', '/usr/local/bin/gs'];
const PODPOWIEDZ_GS = 'Zainstaluj Ghostscript z Homebrew: brew install ghostscript';

// ── Ghostscript ─────────────────────────────────────────────────────────────
// → { ok, sciezka, wersja, powod } (powod – czytelny opis, gdy ok = false)
let GS = null;
function znajdzGs({ odswiez = false, kandydaci } = {}) {
  if (GS && !odswiez && !kandydaci) return GS;
  const lista = kandydaci || (process.env.KARKA_GS ? [process.env.KARKA_GS] : KANDYDACI_GS);
  let wynik = { ok: false, sciezka: null, wersja: null, powod: `Nie znaleziono Ghostscripta (${lista.join(', ')}). ${PODPOWIEDZ_GS}` };
  for (const s of lista) {
    if (!fs.existsSync(s)) continue;
    const r = spawnSync(s, ['--version'], { encoding: 'utf8', timeout: 10000 });
    const wersja = String(r.stdout || '').trim();
    const glowna = parseInt(wersja, 10);
    if (r.status !== 0 || !Number.isFinite(glowna)) { wynik = { ok: false, sciezka: s, wersja: null, powod: `Ghostscript ${s} nie odpowiada (${String(r.stderr || r.error || '').trim() || 'kod ' + r.status}). ${PODPOWIEDZ_GS}` }; continue; }
    if (glowna < MIN_WERSJA_GS) { wynik = { ok: false, sciezka: s, wersja, powod: `Ghostscript ${wersja} jest za stary (potrzebny ≥ ${MIN_WERSJA_GS}). Zaktualizuj: brew upgrade ghostscript` }; continue; }
    wynik = { ok: true, sciezka: s, wersja, powod: null };
    break;
  }
  if (!kandydaci) GS = wynik;
  return wynik;
}

// Parametry konwersji – jak w próbie z #66 (pdfwrite, PDF 1.6, CMYK z zachowaniem czerni, przezroczystość zostaje),
// bez -dPDFX i bez Output Intent (drukarnia ich nie wymaga). Dodatkowo: bez obracania stron wg tekstu
// (karta pozioma ma zostać tak, jak w planie druku) i bez stratnego przekodowania i zmniejszania obrazków.
function argumentyGs(wejscie, wyjscie, profil) {
  return ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6',
    '-sColorConversionStrategy=CMYK', `-sOutputICCProfile=${profil}`, '-dOverrideICC=true',
    '-dBlackText=true', '-dBlackVector=true', '-dPreserveSMask=true',
    '-dAutoRotatePages=/None',
    '-dAutoFilterColorImages=false', '-dColorImageFilter=/FlateEncode',
    '-dAutoFilterGrayImages=false', '-dGrayImageFilter=/FlateEncode',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
    `-sOutputFile=${wyjscie}`, wejscie];
}

// Konwersja pliku → plik. Błąd = wyjątek z czytelnym komunikatem, a częściowy plik wyjściowy jest usuwany.
// sygnal: AbortSignal (przerwanie), limit: ms (domyślnie 5 min).
function konwertuj(wejscie, wyjscie, { gs, profil, sygnal, limit = 5 * 60 * 1000 } = {}) {
  gs = gs || znajdzGs();
  if (!gs || !gs.ok) return Promise.reject(new Error((gs && gs.powod) || PODPOWIEDZ_GS));
  const start = Date.now();
  return new Promise((ok, blad) => {
    let wyjscieGs = '', koniec = false;
    const proc = spawn(gs.sciezka, argumentyGs(wejscie, wyjscie, profil), { stdio: ['ignore', 'pipe', 'pipe'] });
    const dopisz = (c) => { wyjscieGs = (wyjscieGs + c).slice(-20000); };
    proc.stdout.on('data', dopisz);
    proc.stderr.on('data', dopisz);
    const zakoncz = (e) => {
      if (koniec) return;
      koniec = true;
      clearTimeout(zegar);
      if (sygnal) sygnal.removeEventListener('abort', przerwij);
      if (e) { fs.rmSync(wyjscie, { force: true }); blad(e); } else ok({ czas: Date.now() - start });
    };
    const przerwij = () => { proc.kill('SIGKILL'); zakoncz(new Error('konwersja do CMYK przerwana')); };
    const zegar = setTimeout(() => { proc.kill('SIGKILL'); zakoncz(new Error(`Ghostscript nie skończył w ${Math.round(limit / 1000)} s`)); }, limit);
    if (sygnal) { if (sygnal.aborted) return przerwij(); sygnal.addEventListener('abort', przerwij); }
    proc.on('error', (e) => zakoncz(new Error('nie udało się uruchomić Ghostscripta: ' + e.message)));
    proc.on('close', (kod) => {
      if (kod === 0 && fs.existsSync(wyjscie) && fs.statSync(wyjscie).size > 0) return zakoncz();
      zakoncz(new Error(`Ghostscript zakończył się błędem (kod ${kod}): ${opisBleduGs(wyjscieGs)}`));
    });
  });
}
// Z wyjścia Ghostscripta: wiersze z błędem (bez śladu stosu PostScriptu), najwyżej 3.
function opisBleduGs(tekst) {
  const wiersze = String(tekst).split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
  const wazne = wiersze.filter((w) => /error|nie|unable|cannot|could not|failed|invalid/i.test(w) && !/^(Operand|Execution|Dictionary|Current allocation|Last OS error)/.test(w));
  return (wazne.length ? wazne : wiersze.slice(-3)).slice(0, 3).join(' · ').slice(0, 400) || 'brak opisu';
}

// ── Profile ICC ─────────────────────────────────────────────────────────────
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const adresPaczki = (klucz) => (process.env.KARKA_PROFILE_ADRES || ADRES_ECI).replace(/\/?$/, '/') + PROFILE[klucz].paczka;
const czyKlucz = (profil) => Object.prototype.hasOwnProperty.call(PROFILE, profil);

// Nagłówek ICC: podpis „acsp” (bajty 36–39), przestrzeń danych (16–19) = „CMYK”.
function sprawdzPlikIcc(plik) {
  let fd;
  try { fd = fs.openSync(plik, 'r'); } catch (e) { throw new Error(`nie ma pliku profilu: ${plik}`); }
  try {
    const n = Buffer.alloc(128);
    if (fs.readSync(fd, n, 0, 128, 0) < 128 || n.toString('latin1', 36, 40) !== 'acsp') throw new Error(`${path.basename(plik)} nie jest profilem ICC`);
    const przestrzen = n.toString('latin1', 16, 20).trim();
    if (przestrzen !== 'CMYK') throw new Error(`${path.basename(plik)} to profil ${przestrzen || '?'}, a do druku potrzebny jest profil CMYK`);
  } finally { fs.closeSync(fd); }
  return plik;
}

// Ścieżka pobranego profilu albo null (brak / uszkodzony – zła suma).
function profilLokalny(klucz, folder) {
  const p = PROFILE[klucz], plik = path.join(folder, p.plik);
  try { return sha256(fs.readFileSync(plik)) === p.sha256 ? plik : null; } catch (e) { return null; }
}

let JSZip = null;
function jszip(zasoby) {
  if (!JSZip) {
    const kandydaci = [zasoby && path.join(zasoby, 'vendor', 'jszip.min.js'), path.join(__dirname, 'node_modules', 'jszip', 'dist', 'jszip.min.js')];
    for (const k of kandydaci.filter(Boolean)) { try { JSZip = require(k); break; } catch (e) { /* następny */ } }
    if (!JSZip) throw new Error('brak biblioteki JSZip');
  }
  return JSZip;
}

// Pobranie paczki z eci.org, z ZIP-a tylko jeden plik, kontrola SHA-256, zapis do folder/<plik>.
// Błąd = wyjątek z komunikatem dla użytkownika (bez cichego użycia innego profilu).
async function pobierzProfil(klucz, folder, { fetch = globalThis.fetch, zasoby, postep = () => {} } = {}) {
  const p = PROFILE[klucz];
  if (!p) throw new Error(`nieznany profil „${klucz}”`);
  const recznie = `Pobierz ręcznie paczkę ${ADRES_ECI}${p.paczka}, rozpakuj i wskaż plik ${p.plik} („inny plik .icc…”).`;
  let zip;
  try {
    const r = await fetch(adresPaczki(klucz), { headers: { 'User-Agent': 'KarKa' } });
    if (!r.ok || !r.body) throw new Error(`serwer odpowiedział ${r.status}`);
    const calosc = +r.headers.get('content-length') || p.paczkaMB * 1048576;
    const czesci = [];
    let ile = 0;
    for await (const c of r.body) { czesci.push(Buffer.from(c)); ile += c.length; postep(Math.min(1, ile / calosc)); }
    zip = Buffer.concat(czesci);
  } catch (e) { throw new Error(`Nie udało się pobrać profilu ${p.nazwa} z eci.org (${e.message}). ${recznie}`); }
  let dane;
  try {
    const z = await jszip(zasoby).loadAsync(zip);
    const wpis = z.file(p.wZip) || z.file(new RegExp('(^|/)' + p.plik.replace(/\./g, '\\.') + '$'))[0];
    if (!wpis) throw new Error(`w paczce nie ma pliku ${p.plik}`);
    dane = await wpis.async('nodebuffer');
  } catch (e) { throw new Error(`Pobrana paczka profilu jest nieczytelna (${e.message}). ${recznie}`); }
  if (sha256(dane) !== p.sha256) throw new Error(`Pobrany profil ${p.plik} ma inną sumę SHA-256 niż oczekiwana – nie został użyty. ${recznie}`);
  fs.mkdirSync(folder, { recursive: true });
  const cel = path.join(folder, p.plik), tmp = cel + '.czesc';
  fs.writeFileSync(tmp, dane);
  fs.renameSync(tmp, cel);
  return cel;
}

// profil: klucz (fogra39 / fogra51) albo ścieżka do pliku .icc → { plik, nazwa, klucz } albo { brak: klucz } (do pobrania).
function rozwiazProfil(profil, folder) {
  profil = profil || DOMYSLNY;
  if (czyKlucz(profil)) {
    const plik = profilLokalny(profil, folder);
    return plik ? { plik, nazwa: PROFILE[profil].nazwa, klucz: profil } : { brak: profil, nazwa: PROFILE[profil].nazwa };
  }
  if (!/\.ic[cm]$/i.test(profil)) throw new Error(`profil: „${profil}” – możliwe: ${Object.keys(PROFILE).join(', ')} albo ścieżka do pliku .icc`);
  sprawdzPlikIcc(profil);
  return { plik: profil, nazwa: path.basename(profil), klucz: null };
}

// ── Kontrola wyniku ─────────────────────────────────────────────────────────
// Strumienie treści (strony i XObject Form): operatory RGB (rg / RG), czysta czerń „0 0 0 1 k”;
// przestrzenie barw RGB w słownikach; obrazki wg przestrzeni barw (maski SMask pomijane); TrimBox na każdej stronie.
function sprawdzPdf(buf, PDFLib) {
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, PDFDict, PDFNumber } = PDFLib;
  return PDFDocument.load(buf, { updateMetadata: false }).then((doc) => {
    const ctx = doc.context;
    const wynik = { strony: doc.getPageCount(), rgb: 0, przestrzenieRgb: 0, czern: 0, obrazki: { cmyk: 0, szare: 0, inne: [] }, trimBox: 0, ok: false };
    const obiekt = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
    const nazwa = (x) => { x = obiekt(x); return x && x.asString ? x.asString() : x instanceof PDFName ? x.toString() : null; };
    const maski = new Set();
    const wszystkie = ctx.enumerateIndirectObjects();
    for (const [, o] of wszystkie) {
      const d = o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : null;
      if (!d) continue;
      const sm = d.get(PDFName.of('SMask'));
      if (sm instanceof PDFRef) maski.add(sm.toString());
      if (/\/(DeviceRGB|CalRGB)\b/.test(d.toString())) wynik.przestrzenieRgb++;
    }
    const rodzajPrzestrzeni = (cs) => {
      cs = obiekt(cs);
      if (cs instanceof PDFName) return { '/DeviceCMYK': 'cmyk', '/DeviceGray': 'szare', '/CalGray': 'szare' }[cs.toString()] || cs.toString();
      if (cs instanceof PDFArray) {
        const t = nazwa(cs.get(0));
        if (t === '/ICCBased') { const n = obiekt(cs.get(1)); const N = n && n.dict && n.dict.get(PDFName.of('N')); const k = N instanceof PDFNumber ? N.asNumber() : 0; return k === 4 ? 'cmyk' : k === 1 ? 'szare' : `ICCBased N=${k}`; }
        if (t === '/Indexed') return rodzajPrzestrzeni(cs.get(1));
        if (t === '/Separation' || t === '/DeviceN') return 'cmyk';
        return t || '?';
      }
      return '?';
    };
    for (const [ref, o] of wszystkie) {
      if (!(o instanceof PDFRawStream)) continue;
      const d = o.dict, typ = nazwa(d.get(PDFName.of('Subtype')));
      if (typ === '/Image') {
        if (maski.has(ref.toString())) continue;
        const im = d.get(PDFName.of('ImageMask'));
        if (im && String(im) === 'true') continue;
        const r = rodzajPrzestrzeni(d.get(PDFName.of('ColorSpace')));
        if (r === 'cmyk' || r === 'szare') wynik.obrazki[r]++; else wynik.obrazki.inne.push(r);
        continue;
      }
      // Treść stron i formularzy: bez Subtype albo /Form; pomijamy czcionki, profile ICC, metadane.
      if ((typ && typ !== '/Form') || d.get(PDFName.of('N')) || d.get(PDFName.of('Length1')) || d.get(PDFName.of('Length2'))) continue;
      const filtr = d.get(PDFName.of('Filter'));
      const filtry = filtr instanceof PDFArray ? filtr.asArray().map(nazwa) : filtr ? [nazwa(filtr)] : [];
      let tekst;
      try {
        if (filtry.length === 0) tekst = Buffer.from(o.contents).toString('latin1');
        else if (filtry.length === 1 && filtry[0] === '/FlateDecode') tekst = zlib.inflateSync(Buffer.from(o.contents)).toString('latin1');
        else continue;
      } catch (e) { continue; }
      wynik.rgb += (tekst.match(/(^|\s)(rg|RG)(?=\s)/g) || []).length;
      wynik.czern += (tekst.match(/(^|\s)0 0 0 1 k(?=\s)/g) || []).length;
    }
    for (const s of doc.getPages()) {
      const t = s.node.get(PDFName.of('TrimBox')), m = s.getMediaBox();
      if (!t) continue;
      const [x1, y1, x2, y2] = obiekt(t).asArray().map((n) => obiekt(n).asNumber());
      if (x1 >= m.x - 0.01 && y1 >= m.y - 0.01 && x2 <= m.x + m.width + 0.01 && y2 <= m.y + m.height + 0.01 && x2 > x1 && y2 > y1) wynik.trimBox++;
    }
    wynik.ok = wynik.rgb === 0 && wynik.przestrzenieRgb === 0 && wynik.obrazki.inne.length === 0 && wynik.trimBox === wynik.strony;
    return wynik;
  });
}

// Konwersja bufora PDF (jedna część z drukarnia.przygotujDruk) → { bufor, kontrola, czas }.
// po(bufor) – poprawka po Ghostscripcie (drukarnia.js: ramki stron z planu druku).
async function konwertujBufor(buf, { gs, profil, sygnal, PDFLib, po } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'karka-cmyk-'));
  try {
    const we = path.join(tmp, 'rgb.pdf'), wy = path.join(tmp, 'cmyk.pdf');
    fs.writeFileSync(we, buf);
    const { czas } = await konwertuj(we, wy, { gs, profil, sygnal });
    let bufor = fs.readFileSync(wy);
    if (po) bufor = await po(bufor);
    const kontrola = await sprawdzPdf(bufor, PDFLib);
    return { bufor, kontrola, czas };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { PROFILE, DOMYSLNY, PODPOWIEDZ_GS, MIN_WERSJA_GS, znajdzGs, argumentyGs, konwertuj, opisBleduGs,
  sprawdzPlikIcc, profilLokalny, pobierzProfil, rozwiazProfil, adresPaczki, czyKlucz, sprawdzPdf, konwertujBufor, sha256 };
