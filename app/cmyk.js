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
// warunek – OutputConditionIdentifier w Output Intent PDF/X (#85: ISO Coated v2 300 % to ten sam warunek druku co Fogra39).
const PROFILE = {
  iso300: { nazwa: 'ISO Coated v2 300 % (ECI)', paczka: 'eci_offset_2009.zip', wZip: 'ECI_Offset_2009/ISOcoated_v2_300_eci.icc',
    plik: 'ISOcoated_v2_300_eci.icc', sha256: 'c6b4b62f0726243742eced8b9669476a6be89e581f50a7600ed8b6fcbb9cdab8', rozmiar: 1829093, paczkaMB: 17, warunek: 'FOGRA39' },
  fogra39: { nazwa: 'ISO Coated v2 (ECI) – Fogra39', paczka: 'eci_offset_2009.zip', wZip: 'ECI_Offset_2009/ISOcoated_v2_eci.icc',
    plik: 'ISOcoated_v2_eci.icc', sha256: '128dc02f7246cc3807af0323695379f64151a8f27a587736acc59f8b6ce894b8', rozmiar: 1829077, paczkaMB: 17, warunek: 'FOGRA39' },
  fogra51: { nazwa: 'PSO Coated v3 – Fogra51', paczka: 'pso-coated_v3.zip', wZip: 'PSOcoated_v3.icc',
    plik: 'PSOcoated_v3.icc', sha256: 'c30ad2c01e8f93135ec7682c535e0a81bc2d177c301e196376c5f5838b5c8e86', rozmiar: 2195228, paczkaMB: 2, warunek: 'FOGRA51' },
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

// Parametry konwersji (sprawdzone w spike'u na gs 10.02 – #66, PR etapu 2): pdfwrite, PDF 1.6, wszystko do CMYK,
// przezroczystość zostaje, bez -dPDFX i bez Output Intent. Różnice względem próby z #66:
// - bez -dBlackText / -dBlackVector – czerniły CAŁY tekst i wszystkie wektory (także kolorowe); K100 daje czernK100() przed gs;
// - bez -dOverrideICC – ignorował profile obrazków (Display P3 liczony jak sRGB, ΔE do ~7,6); bez niej gs czyta profil z PDF;
// - profil docelowy przez -sICCProfilesDir (kopia katalogu profili Ghostscripta z naszym default_cmyk.icc) –
//   -sOutputICCProfile w pdfwrite nie zmienia wyniku, a bez -sProcessColorModel=DeviceCMYK kończy się błędem;
// - -dAutoRotatePages=/None (inaczej strony z kartą poziomą dostają /Rotate 270) i obrazki bez stratnej kompresji i zmniejszania.
function argumentyGs(wejscie, wyjscie, katalogIcc) {
  return ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6',
    '-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK',
    `-sICCProfilesDir=${katalogIcc.replace(/\/?$/, '/')}`, `-sOutputICCProfile=${path.join(katalogIcc, 'default_cmyk.icc')}`,
    '-dPreserveSMask=true', '-dAutoRotatePages=/None',
    '-dAutoFilterColorImages=false', '-dColorImageFilter=/FlateEncode',
    '-dAutoFilterGrayImages=false', '-dGrayImageFilter=/FlateEncode',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
    `-sOutputFile=${wyjscie}`, wejscie];
}

// Katalog profili Ghostscripta (iccprofiles). Na dysku: obok Resource/ z listy „Search path” w gs -h (Debian),
// share/ghostscript/<wersja>/iccprofiles. Ghostscript z wkompilowanymi zasobami (%rom%, np. Homebrew) nie ma ich
// na dysku – wtedy wypakowuje je sam Ghostscript (wypakujProfileGs) do katalogu tymczasowego (raz na uruchomienie).
const PROFILE_GS = ['default_cmyk.icc', 'default_gray.icc', 'default_rgb.icc'];
const maKomplet = (k) => PROFILE_GS.every((f) => fs.existsSync(path.join(k, f)));
function katalogIccGs(gs) {
  if (gs.katalogIcc && maKomplet(gs.katalogIcc)) return gs.katalogIcc;
  const kandydaci = [];
  const r = spawnSync(gs.sciezka, ['-h'], { encoding: 'utf8', timeout: 10000 });
  const pomoc = String(r.stdout || '');
  for (const m of pomoc.matchAll(/(\/[^\s:]*?)\/Resource\/Init\b/g)) kandydaci.push(path.join(m[1], 'iccprofiles'));
  let prefiks = null;
  try { prefiks = path.dirname(path.dirname(fs.realpathSync(gs.sciezka))); } catch (e) { /* brak */ }
  if (prefiks) {
    const share = path.join(prefiks, 'share', 'ghostscript');
    try { for (const n of fs.readdirSync(share)) kandydaci.push(path.join(share, n, 'iccprofiles')); } catch (e) { /* brak */ }
    kandydaci.push(path.join(share, 'iccprofiles'));
  }
  kandydaci.push('/usr/share/color/icc/ghostscript');
  let katalog = kandydaci.find(maKomplet) || null;
  if (!katalog && /%rom%/.test(pomoc)) {
    const cel = path.join(os.tmpdir(), `karka-gs-icc-${String(gs.wersja || '').replace(/[^\w.]/g, '')}-${process.pid}`);
    try { wypakujProfileGs(gs, '%rom%iccprofiles/', cel); if (maKomplet(cel)) katalog = cel; } catch (e) { /* katalog = null → czytelny błąd niżej */ }
  }
  gs.katalogIcc = katalog;
  return katalog;
}
// Kopiuje Ghostscriptem wszystkie pliki <zrodlo>* (np. %rom%iccprofiles/) do katalogu cel (PostScript: filenameforall).
function wypakujProfileGs(gs, zrodlo, cel) {
  fs.mkdirSync(cel, { recursive: true });
  const ps = (t) => '(' + String(t).replace(/[\\()]/g, (z) => '\\' + z) + ')';
  const program = `/dest ${ps(cel.replace(/\/?$/, '/'))} def /n ${zrodlo.length} def /buf 65536 string def
${ps(zrodlo + '*')} {
  dup length string copy /src exch def
  /nazwa src n src length n sub getinterval def
  /d dest length nazwa length add string def d 0 dest putinterval d dest length nazwa putinterval
  /we src (r) file def /wy d (w) file def
  { we buf readstring exch wy exch writestring not { exit } if } loop
  we closefile wy closefile
} 1024 string filenameforall`;
  const plik = path.join(cel, '.wypakuj.ps');
  fs.writeFileSync(plik, program);
  try {
    const r = spawnSync(gs.sciezka, ['-q', '-dNODISPLAY', '-dNOSAFER', '-dBATCH', '-dNOPAUSE', plik], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) throw new Error(`wypakowanie profili Ghostscripta: ${opisBleduGs(String(r.stdout) + r.stderr)}`);
  } finally { fs.rmSync(plik, { force: true }); }
  return cel;
}
// Kopia katalogu profili Ghostscripta z profilem drukarni jako default_cmyk.icc (gs potrzebuje kompletu profili).
function katalogZProfilem(gs, profil, cel) {
  const zrodlo = katalogIccGs(gs);
  if (!zrodlo) throw new Error(`nie znaleziono katalogu profili Ghostscripta (iccprofiles) dla ${gs.sciezka} – zainstaluj ponownie: brew reinstall ghostscript`);
  fs.mkdirSync(cel, { recursive: true });
  for (const f of fs.readdirSync(zrodlo)) if (/\.ic[cm]$/i.test(f)) fs.copyFileSync(path.join(zrodlo, f), path.join(cel, f));
  fs.copyFileSync(profil, path.join(cel, 'default_cmyk.icc'));
  return cel;
}

// Konwersja pliku → plik. Błąd = wyjątek z czytelnym komunikatem, a częściowy plik wyjściowy jest usuwany.
// profil: plik .icc (CMYK). sygnal: AbortSignal (przerwanie), limit: ms (domyślnie 5 min).
// gs przy uszkodzonym wejściu potrafi skończyć kodem 0 z „**** Error” – to też błąd.
function konwertuj(wejscie, wyjscie, { gs, profil, sygnal, limit = 5 * 60 * 1000 } = {}) {
  gs = gs || znajdzGs();
  if (!gs || !gs.ok) return Promise.reject(new Error((gs && gs.powod) || PODPOWIEDZ_GS));
  let katalog;
  try {
    if (!profil) throw new Error('brak profilu CMYK');
    sprawdzPlikIcc(profil);
    katalog = katalogZProfilem(gs, profil, fs.mkdtempSync(path.join(os.tmpdir(), 'karka-icc-')));
  } catch (e) { return Promise.reject(e); }
  const start = Date.now();
  return new Promise((ok, blad) => {
    let wyjscieGs = '', koniec = false;
    const proc = spawn(gs.sciezka, argumentyGs(wejscie, wyjscie, katalog), { stdio: ['ignore', 'pipe', 'pipe'] });
    const dopisz = (c) => { wyjscieGs = (wyjscieGs + c).slice(-20000); };
    proc.stdout.on('data', dopisz);
    proc.stderr.on('data', dopisz);
    const zakoncz = (e) => {
      if (koniec) return;
      koniec = true;
      clearTimeout(zegar);
      if (sygnal) sygnal.removeEventListener('abort', przerwij);
      fs.rmSync(katalog, { recursive: true, force: true });
      if (e) { fs.rmSync(wyjscie, { force: true }); blad(e); } else ok({ czas: Date.now() - start });
    };
    const przerwij = () => { proc.kill('SIGKILL'); zakoncz(new Error('konwersja do CMYK przerwana')); };
    const zegar = setTimeout(() => { proc.kill('SIGKILL'); zakoncz(new Error(`Ghostscript nie skończył w ${Math.round(limit / 1000)} s`)); }, limit);
    if (sygnal) { if (sygnal.aborted) return przerwij(); sygnal.addEventListener('abort', przerwij); }
    proc.on('error', (e) => zakoncz(new Error('nie udało się uruchomić Ghostscripta: ' + e.message)));
    proc.on('close', (kod) => {
      const bladWLogu = /\*\*\*\* Error|^\s*Error:|Unrecoverable error/m.test(wyjscieGs);
      if (kod === 0 && !bladWLogu && fs.existsSync(wyjscie) && fs.statSync(wyjscie).size > 0) return zakoncz();
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

// profil: klucz (iso300 / fogra39 / fogra51) albo ścieżka do pliku .icc → { plik, nazwa, klucz } albo { brak: klucz } (do pobrania).
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
      // Obrazki w treści (BI … ID … EI – Ghostscript tak zapisuje małe obrazki): przestrzeń z /CS albo /ColorSpace.
      for (const m of tekst.matchAll(/(?:^|\s)BI\s([\s\S]*?)\sID\s/g)) {
        const cs = (/\/(?:CS|ColorSpace)\s*\/(\w+)/.exec(m[1]) || [])[1];
        if (/IM\s+true|ImageMask\s+true/.test(m[1])) continue;
        if (cs === 'CMYK' || cs === 'DeviceCMYK') wynik.obrazki.cmyk++;
        else if (cs === 'G' || cs === 'DeviceGray') wynik.obrazki.szare++;
        else wynik.obrazki.inne.push('obrazek w treści ' + (cs || '?'));
      }
      wynik.czern += (tekst.match(/(^|\s)0 0 0 1 k(?=\s)/g) || []).length;
    }
    for (const s of doc.getPages()) {
      const t = s.node.get(PDFName.of('TrimBox')), m = s.getMediaBox();
      if (!t) continue;
      const [x1, y1, x2, y2] = obiekt(t).asArray().map((n) => obiekt(n).asNumber());
      if (x1 >= m.x - 0.01 && y1 >= m.y - 0.01 && x2 <= m.x + m.width + 0.01 && y2 <= m.y + m.height + 0.01 && x2 > x1 && y2 > y1) wynik.trimBox++;
    }
    // ppi obrazków (#112) – ostrzeżenie, nie wpływa na ok; błąd tej kontroli nie blokuje zapisu (bez wyniku ppi).
    let ppi = [];
    try { ppi = ppiObrazkow(doc, PDFLib); } catch (e) { ppi = []; }
    wynik.minPpi = ppi.reduce((a, x) => Math.min(a, x.ppi[0], x.ppi[1]), Infinity);
    if (wynik.minPpi === Infinity) wynik.minPpi = null;
    wynik.obrazkiNiskiePpi = ppi.filter((x) => Math.min(x.ppi[0], x.ppi[1]) < PROG_PPI);
    wynik.ok = wynik.rgb === 0 && wynik.przestrzenieRgb === 0 && wynik.obrazki.inne.length === 0 && wynik.trimBox === wynik.strony;
    return wynik;
  });
}

// ── Rozdzielczość obrazków (#112) ────────────────────────────────────────────
// Ghostscript przy konwersji do CMYK zamienia cieniowania (gradienty CSS/SVG) na obrazki ok. 90 × 45 ppi – preflight
// GWG 2015 zgłasza < 150 ppi jako błąd. Treść stron z bieżącym przekształceniem (q / Q / cm, /Matrix form): obrazek
// (Do z /Subtype /Image albo BI … EI) wypełnia kwadrat 1 × 1, więc jego rozmiar na stronie to długości kolumn macierzy
// (pt), a ppi = piksele · 72 / pt, osobno w poziomie i w pionie. Pomijane maski (ImageMask; SMask nie ma Do) i obrazki
// do 16 × 16 px (jak GWG 2015). Wynik: każde narysowanie obrazka { strona (od 1), px: [w, h], ppi: [x, y] }.
const PROG_PPI = 300;
const razyMacierz = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
function ppiObrazkow(doc, PDFLib) {
  const { PDFName, PDFRawStream, PDFArray, PDFDict, PDFRef, PDFNumber } = PDFLib;
  const ctx = doc.context;
  const obiekt = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
  const liczba = (x) => { x = obiekt(x); return x instanceof PDFNumber ? x.asNumber() : NaN; };
  // Strumień → tekst albo null (bez filtra albo sam FlateDecode – jak nadrukCzerni).
  const czytaj = (o) => {
    if (!(o instanceof PDFRawStream)) return null;
    const d = o.dict, filtr = d.get(PDFName.of('Filter'));
    const filtry = filtr instanceof PDFArray ? filtr.asArray().map(String) : filtr ? [String(filtr)] : [];
    if (filtry.length > 1 || (filtry.length === 1 && filtry[0] !== '/FlateDecode') || d.get(PDFName.of('DecodeParms'))) return null;
    try { return (filtry.length ? zlib.inflateSync(Buffer.from(o.contents)) : Buffer.from(o.contents)).toString('latin1'); } catch (e) { return null; }
  };
  const wynik = [];
  const dodaj = (strona, w, h, m) => {
    const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    if (!(w > 0 && h > 0) || (w <= 16 && h <= 16) || !sx || !sy) return;
    wynik.push({ strona, px: [w, h], ppi: [Math.round(w * 72 / sx), Math.round(h * 72 / sy)] });
  };
  const przejdz = (tekst, zasoby, ctm, strona, glebokosc) => {
    const xo = zasoby instanceof PDFDict ? obiekt(zasoby.get(PDFName.of('XObject'))) : null;
    const stos = [];
    let argumenty = [], nazwa = null;
    for (const tk of tokenyTresci(tekst)) {
      if (tk.t === 'num') { argumenty.push(Number(tk.w)); continue; }
      if (tk.t === 'nazwa') { nazwa = tk.w.slice(1); argumenty.push(null); continue; }
      if (tk.t !== 'op') { argumenty.push(null); continue; }
      if (tk.w === 'q') stos.push(ctm);
      else if (tk.w === 'Q') { if (stos.length) ctm = stos.pop(); }
      else if (tk.w === 'cm') { const a = argumenty.slice(-6); if (a.length === 6 && a.every(Number.isFinite)) ctm = razyMacierz(a, ctm); }
      else if (tk.w === 'BI') {
        const d = (/^BI\s([\s\S]*?)\sID\s/.exec(tekst.slice(tk.p, tk.p + 2000)) || [])[1] || '';
        if (!/\/(?:IM|ImageMask)\s+true/.test(d)) dodaj(strona, Number((/\/(?:W|Width)\s+(\d+)/.exec(d) || [])[1]), Number((/\/(?:H|Height)\s+(\d+)/.exec(d) || [])[1]), ctm);
      } else if (tk.w === 'Do' && nazwa && xo instanceof PDFDict) {
        const o = obiekt(xo.get(PDFName.of(nazwa)));
        const typ = o instanceof PDFRawStream ? String(o.dict.get(PDFName.of('Subtype'))) : null;
        if (typ === '/Image') {
          const im = o.dict.get(PDFName.of('ImageMask'));
          if (!(im && String(im) === 'true')) dodaj(strona, liczba(o.dict.get(PDFName.of('Width'))), liczba(o.dict.get(PDFName.of('Height'))), ctm);
        } else if (typ === '/Form' && glebokosc < 10) {
          const t = czytaj(o);
          const mx = obiekt(o.dict.get(PDFName.of('Matrix')));
          const m = mx instanceof PDFArray && mx.size() === 6 ? mx.asArray().map(liczba) : [1, 0, 0, 1, 0, 0];
          const wlasne = obiekt(o.dict.get(PDFName.of('Resources')));
          if (t !== null) przejdz(t, wlasne instanceof PDFDict ? wlasne : zasoby, razyMacierz(m.every(Number.isFinite) ? m : [1, 0, 0, 1, 0, 0], ctm), strona, glebokosc + 1);
        }
      }
      argumenty = [];
      nazwa = null;
    }
  };
  doc.getPages().forEach((s, i) => {
    const { Resources } = s.node.normalizedEntries();
    const c = obiekt(s.node.get(PDFName.of('Contents')));
    const refy = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
    // Strumienie strony to jedna treść (stan q / cm może przechodzić między nimi).
    const tekst = refy.map((r) => czytaj(obiekt(r))).filter((t) => t !== null).join('\n');
    if (tekst) przejdz(tekst, Resources, [1, 0, 0, 1, 0, 0], i + 1, 0);
  });
  return wynik;
}

// Czysta czerń K100: w strumieniach treści (strony, XObject Form) „0 0 0 rg/RG” i „0 g/G” (czerń #000 z Chromium)
// → „0 0 0 1 k/K”. Ghostscript zostawia DeviceCMYK bez zmian, więc #000 wychodzi jako C0 M0 Y0 K100, a inne kolory
// (także „prawie czerń”) przechodzą przez profil. Zwraca { bufor, zamiany }.
async function czernK100(buf, PDFLib) {
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFNumber } = PDFLib;
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  let zamiany = 0;
  for (const [ref, o] of doc.context.enumerateIndirectObjects()) {
    if (!(o instanceof PDFRawStream)) continue;
    const d = o.dict, typ = d.get(PDFName.of('Subtype'));
    if ((typ && typ.toString() !== '/Form') || d.get(PDFName.of('N')) || d.get(PDFName.of('Length1'))) continue;
    const rodzaj = d.get(PDFName.of('Type'));
    if (rodzaj && rodzaj.toString() !== '/XObject') continue;
    const filtr = d.get(PDFName.of('Filter'));
    const filtry = filtr instanceof PDFArray ? filtr.asArray().map(String) : filtr ? [String(filtr)] : [];
    if (filtry.length > 1 || (filtry.length === 1 && filtry[0] !== '/FlateDecode') || d.get(PDFName.of('DecodeParms'))) continue;
    let tekst;
    try { tekst = (filtry.length ? zlib.inflateSync(Buffer.from(o.contents)) : Buffer.from(o.contents)).toString('latin1'); } catch (e) { continue; }
    let n = 0;
    const nowy = tekst.replace(/(^|\s)(?:0 0 0 (rg|RG)|0 (g|G))(?=\s)/g, (m, przed, rgb, szary) => { n++; return `${przed}0 0 0 1 ${(rgb || szary) === 'rg' || (rgb || szary) === 'g' ? 'k' : 'K'}`; });
    if (!n) continue;
    zamiany += n;
    const dane = filtry.length ? zlib.deflateSync(Buffer.from(nowy, 'latin1')) : Buffer.from(nowy, 'latin1');
    d.set(PDFName.of('Length'), PDFNumber.of(dane.length));
    doc.context.assign(ref, PDFRawStream.of(d, dane));
  }
  return { bufor: zamiany ? Buffer.from(await doc.save({ useObjectStreams: false })) : buf, zamiany };
}

// Grupy przezroczystości (strony i XObject Form): Ghostscript zostawia przestrzeń mieszania /CS /DeviceRGB
// z Chromium – po konwersji ustawiamy /DeviceCMYK (jak w PDF z InDesigna), żeby mieszanie nie szło w RGB.
async function grupyCmyk(buf, PDFLib) {
  const { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, PDFArray } = PDFLib;
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const ctx = doc.context, G = PDFName.of('Group'), CS = PDFName.of('CS');
  const czyRgb = (cs) => {
    cs = cs instanceof PDFRef ? ctx.lookup(cs) : cs;
    if (cs instanceof PDFName) return /^\/(DeviceRGB|CalRGB)$/.test(cs.toString());
    if (cs instanceof PDFArray) { const n = ctx.lookup(cs.get(1)); return String(cs.get(0)) === '/ICCBased' && n && n.dict && String(n.dict.get(PDFName.of('N'))) === '3'; }
    return false;
  };
  let zmiany = 0;
  const popraw = (g) => {
    g = g instanceof PDFRef ? ctx.lookup(g) : g;
    if (!(g instanceof PDFDict) || String(g.get(PDFName.of('S'))) !== '/Transparency' || !czyRgb(g.get(CS))) return;
    g.set(CS, PDFName.of('DeviceCMYK'));
    zmiany++;
  };
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    const d = o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : null;
    if (!d) continue;
    if (String(d.get(PDFName.of('Type'))) === '/Group') popraw(d);
    if (d.get(G)) popraw(d.get(G));
  }
  return zmiany ? Buffer.from(await doc.save({ useObjectStreams: false })) : buf;
}

// ── Nadruk czerni K100 (issue #92) ──────────────────────────────────────────
// Po Ghostscripcie (nie zależy od tego, czy gs przenosi /OP): w strumieniach treści stron i XObject Form
// tekst wypisywany (Tj, TJ, ', ") w czystej czerni „0 0 0 1 k” dostaje nadruk – przed operatorem stan graficzny
// /KarkaNadrukN z /op true (wypełnienie), a przy obrysowaniu liter (Tr 1, 2, 5, 6) w „0 0 0 1 K” – /OP true; /OPM 1, więc
// zerowe kanały C, M, Y nie wycinają tła. Przed każdym innym rysowaniem (f, S, re…f, sh, Do, obrazki) nadruk jest
// wyłączany – prostokąty, linie i obrazki w K100 nadal wybijają (jak dotąd). Kolory inne niż „0 0 0 1 k/K” (także
// cs/scn, g, rg) i tekst niewidoczny (Tr 3, 7) – bez nadruku. Obrys liter z Chromium (-webkit-text-stroke) to osobny
// tekst czcionką Type3 – też tekst, więc też nadrukowany. Zwraca { bufor, obiekty } – obiekty = bloki BT…ET z nadrukiem.
const STANY_NADRUKU = ['KarkaNadruk0', 'KarkaNadruk1', 'KarkaNadruk2', 'KarkaNadruk3'];   // indeks = op + 2·OP
const BIALE = new Set([0, 9, 10, 12, 13, 32]);
const OGRANICZNIKI = new Set('()<>[]{}/%'.split('').map((z) => z.charCodeAt(0)));
// Tokeny strumienia treści: { t: 'op' | 'num' | 'inny', w (tekst), p (początek) }; napisy, słowniki, tablice, nazwy
// i komentarze to „inny”; obrazek w treści (BI … ID dane EI) – jeden token op „BI” (dane pomijane do „EI”).
function* tokenyTresci(s) {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (BIALE.has(c)) { i++; continue; }
    const p = i;
    if (c === 37) { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }          // % komentarz
    if (c === 40) {                                                                              // ( napis )
      let g = 0;
      for (; i < n; i++) {
        const z = s[i];
        if (z === '\\') { i++; continue; }
        if (z === '(') g++;
        else if (z === ')' && --g === 0) { i++; break; }
      }
      yield { t: 'inny', p }; continue;
    }
    if (c === 60 && s[i + 1] === '<') { i += 2; yield { t: 'inny', p }; continue; }            // <<
    if (c === 62 && s[i + 1] === '>') { i += 2; yield { t: 'inny', p }; continue; }            // >>
    if (c === 60) { const k = s.indexOf('>', i); i = k < 0 ? n : k + 1; yield { t: 'inny', p }; continue; }   // <hex>
    if (OGRANICZNIKI.has(c) && c !== 47) { i++; yield { t: 'inny', p }; continue; }            // [ ] { } )
    i++;                                                                                         // /nazwa albo zwykłe znaki
    while (i < n && !BIALE.has(s.charCodeAt(i)) && !OGRANICZNIKI.has(s.charCodeAt(i))) i++;
    const w = s.slice(p, i);
    if (c === 47) { yield { t: 'nazwa', w, p }; continue; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { yield { t: 'num', w, p }; continue; }
    if (w === 'BI') {                       // słownik obrazka do ID, potem dane do białego znaku + EI + białego znaku/końca
      const id = /\sID[\s]/g; id.lastIndex = i;
      const m = id.exec(s);
      let k = m ? m.index + m[0].length : n;
      const ei = /\sEI(?=[\s]|$)/g; ei.lastIndex = k;
      const e = ei.exec(s);
      i = e ? e.index + e[0].length : n;
      yield { t: 'op', w, p }; continue;
    }
    yield { t: 'op', w, p };
  }
}
const RYSOWANIE = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's', 'sh', 'Do', 'BI']);
const TEKST = new Set(['Tj', 'TJ', "'", '"']);
const czyK100 = (a) => a.length === 4 && a.map(Number).join(' ') === '0 0 0 1';

// Jeden strumień (tekst latin1) → { tekst, obiekty, uzyte:Set(indeksów stanów), formy:[nazwy XObject z Do] }.
// zmieniaNadruk(nazwa) – czy ExtGState z zasobów ma /OP albo /op (wtedy stan nadruku nieznany).
function nadrukWStrumieniu(s, zmieniaNadruk) {
  const wstawki = [];                         // [pozycja, tekst]
  const uzyte = new Set(), formy = [];
  let st = { fill: false, stroke: false, tr: 0, stan: 0 };   // stan: indeks stanu nadruku w PDF (null = nieznany)
  const stos = [];
  let argumenty = [], wBT = false, btNadruk = false, obiekty = 0, ostatniaNazwa = null;
  const ustaw = (pozycja, chce) => {
    if (st.stan === chce) return;
    wstawki.push([pozycja, `/${STANY_NADRUKU[chce]} gs `]);
    uzyte.add(chce);
    st.stan = chce;
  };
  let poczatek = null;                        // pozycja pierwszego argumentu operatora – wstawki idą przed argumenty
  for (const tk of tokenyTresci(s)) {
    if (tk.t !== 'op' && poczatek === null) poczatek = tk.p;
    if (tk.t === 'num') { argumenty.push(tk.w); continue; }
    if (tk.t === 'nazwa') { ostatniaNazwa = tk.w.slice(1); argumenty.push(tk.w); continue; }
    if (tk.t !== 'op') { argumenty.push(null); continue; }
    const op = tk.w, przed = poczatek === null ? tk.p : poczatek;
    switch (op) {
      case 'q': stos.push({ ...st }); break;
      case 'Q': if (stos.length) st = stos.pop(); break;
      case 'k': st.fill = czyK100(argumenty); break;
      case 'K': st.stroke = czyK100(argumenty); break;
      case 'g': case 'rg': case 'cs': case 'sc': case 'scn': st.fill = false; break;
      case 'G': case 'RG': case 'CS': case 'SC': case 'SCN': st.stroke = false; break;
      case 'Tr': st.tr = Number(argumenty[argumenty.length - 1]) || 0; break;
      case 'gs': if (ostatniaNazwa && zmieniaNadruk(ostatniaNazwa)) st.stan = null; break;
      case 'BT': wBT = true; btNadruk = false; break;
      case 'ET': if (wBT && btNadruk) obiekty++; wBT = false; break;
      default:
        if (TEKST.has(op)) {
          // Tr: 0, 2, 4, 6 – wypełnienie liter, 1, 2, 5, 6 – obrys liter (3, 7 – niewidoczny).
          const wypelnia = [0, 2, 4, 6].includes(st.tr), obrysowuje = [1, 2, 5, 6].includes(st.tr);
          const chce = (wypelnia && st.fill ? 1 : 0) + (obrysowuje && st.stroke ? 2 : 0);
          ustaw(przed, chce);
          if (chce) btNadruk = true;
        } else if (RYSOWANIE.has(op)) {
          ustaw(przed, 0);
          if (op === 'Do' && ostatniaNazwa) formy.push(ostatniaNazwa);
        }
    }
    argumenty = [];
    ostatniaNazwa = null;
    poczatek = null;
  }
  if (!wstawki.length) return { tekst: s, obiekty: 0, uzyte, formy };
  let wynik = '', od = 0;
  for (const [p, t] of wstawki) { wynik += s.slice(od, p) + t; od = p; }
  return { tekst: wynik + s.slice(od), obiekty, uzyte, formy };
}

async function nadrukCzerni(buf, PDFLib) {
  const { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFDict, PDFRef, PDFNumber } = PDFLib;
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const ctx = doc.context;
  const obiekt = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
  let stany = null;                           // wspólne ExtGState (tworzone przy pierwszym użyciu)
  const stan = (i) => {
    if (!stany) stany = STANY_NADRUKU.map((_, j) => ctx.register(ctx.obj({ Type: 'ExtGState', op: !!(j & 1), OP: !!(j & 2), OPM: 1 })));
    return stany[i];
  };
  const zrobione = new Set();
  let obiekty = 0;
  // Strumień → tekst albo null (tylko bez filtra albo sam FlateDecode, bez DecodeParms – jak czernK100).
  const czytaj = (o) => {
    if (!(o instanceof PDFRawStream)) return null;
    const d = o.dict, filtr = d.get(PDFName.of('Filter'));
    const filtry = filtr instanceof PDFArray ? filtr.asArray().map(String) : filtr ? [String(filtr)] : [];
    if (filtry.length > 1 || (filtry.length === 1 && filtry[0] !== '/FlateDecode') || d.get(PDFName.of('DecodeParms'))) return null;
    try { return { tekst: (filtry.length ? zlib.inflateSync(Buffer.from(o.contents)) : Buffer.from(o.contents)).toString('latin1'), flate: filtry.length > 0 }; } catch (e) { return null; }
  };
  const slownik = (zasoby, klucz) => {
    let d = obiekt(zasoby.get(PDFName.of(klucz)));
    if (!(d instanceof PDFDict)) { d = ctx.obj({}); zasoby.set(PDFName.of(klucz), d); }
    return d;
  };
  // Treść (lista referencji strumieni) z zasobami → dopisuje użyte stany do ExtGState zasobów, potem formy z Do.
  const przetworz = (refy, zasoby) => {
    if (!(zasoby instanceof PDFDict)) return;
    const ext = obiekt(zasoby.get(PDFName.of('ExtGState')));
    const zmieniaNadruk = (n) => {
      const g = ext instanceof PDFDict && obiekt(ext.get(PDFName.of(n)));
      return g instanceof PDFDict && !STANY_NADRUKU.includes(n) && !!(g.get(PDFName.of('OP')) || g.get(PDFName.of('op')));
    };
    const formy = new Set();
    for (const ref of refy) {
      if (!(ref instanceof PDFRef)) continue;
      const klucz = ref.toString();
      if (zrobione.has(klucz)) continue;
      zrobione.add(klucz);
      const o = obiekt(ref), t = czytaj(o);
      if (!t) continue;
      const w = nadrukWStrumieniu(t.tekst, zmieniaNadruk);
      w.formy.forEach((f) => formy.add(f));
      if (!w.uzyte.size) continue;
      obiekty += w.obiekty;
      const e = slownik(zasoby, 'ExtGState');
      for (const i of w.uzyte) e.set(PDFName.of(STANY_NADRUKU[i]), stan(i));
      const dane = t.flate ? zlib.deflateSync(Buffer.from(w.tekst, 'latin1')) : Buffer.from(w.tekst, 'latin1');
      o.dict.set(PDFName.of('Length'), PDFNumber.of(dane.length));
      ctx.assign(ref, PDFRawStream.of(o.dict, dane));
    }
    const xo = obiekt(zasoby.get(PDFName.of('XObject')));
    if (!(xo instanceof PDFDict)) return;
    for (const n of formy) {
      const ref = xo.get(PDFName.of(n)), f = obiekt(ref);
      if (!(f instanceof PDFRawStream) || String(f.dict.get(PDFName.of('Subtype'))) !== '/Form') continue;
      const wlasne = obiekt(f.dict.get(PDFName.of('Resources')));
      przetworz([ref], wlasne instanceof PDFDict ? wlasne : zasoby);   // forma bez Resources korzysta z zasobów rodzica
    }
  };
  for (const s of doc.getPages()) {
    const { Resources } = s.node.normalizedEntries();
    const c = obiekt(s.node.get(PDFName.of('Contents')));
    const refy = c instanceof PDFArray ? c.asArray() : c ? [s.node.get(PDFName.of('Contents'))] : [];
    if (refy.length) przetworz(refy, Resources);
  }
  return { bufor: obiekty ? Buffer.from(await doc.save({ useObjectStreams: false })) : buf, obiekty };
}

// Czy Ghostscript naprawdę użył profilu (spike: -sOutputICCProfile bywał pomijany bez słowa) – czerwony prostokąt
// z profilem drukarni ma wyjść inaczej niż z domyślnym profilem Ghostscripta. Raz na profil (pamięć wg SHA-256).
const PROFIL_SPRAWDZONY = new Map();
async function sprawdzProfilGs(gs, profil, PDFLib) {
  const suma = sha256(fs.readFileSync(profil));
  const zrodlo = katalogIccGs(gs);
  if (!zrodlo || suma === sha256(fs.readFileSync(path.join(zrodlo, 'default_cmyk.icc')))) return true;   // to samo co domyślny
  if (PROFIL_SPRAWDZONY.get(suma + gs.sciezka)) return true;
  const { PDFDocument, rgb } = PDFLib;
  const d = await PDFDocument.create();
  d.addPage([20, 20]).drawRectangle({ x: 0, y: 0, width: 20, height: 20, color: rgb(1, 0, 0) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'karka-profil-'));
  try {
    const we = path.join(tmp, 'we.pdf');
    fs.writeFileSync(we, Buffer.from(await d.save({ useObjectStreams: false })));
    const kolor = async (p, n) => {
      await konwertuj(we, path.join(tmp, n), { gs, profil: p });
      const doc = await PDFDocument.load(fs.readFileSync(path.join(tmp, n)));
      for (const [, o] of doc.context.enumerateIndirectObjects()) {
        if (!(o instanceof PDFLib.PDFRawStream) || o.dict.get(PDFLib.PDFName.of('Subtype'))) continue;
        let t; try { t = zlib.inflateSync(Buffer.from(o.contents)).toString('latin1'); } catch (e) { continue; }
        const m = t.match(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ k/);
        if (m) return m[0];
      }
      return '';
    };
    const nasz = await kolor(profil, 'a.pdf'), domyslny = await kolor(path.join(zrodlo, 'default_cmyk.icc'), 'b.pdf');
    if (!nasz || nasz === domyslny) throw new Error(`Ghostscript ${gs.wersja} nie zastosował profilu ${path.basename(profil)} (wynik jak z domyślnego profilu) – PDF nie powstał`);
    PROFIL_SPRAWDZONY.set(suma + gs.sciezka, true);
    return true;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Konwersja bufora PDF (jedna część z drukarnia.przygotujDruk) → { bufor, kontrola, czas }.
// Kolejno: sprawdzenie profilu, czerń #000 → K100, Ghostscript, po(bufor) – poprawka po Ghostscripcie
// (drukarnia.js: ramki stron z planu druku), kontrola wyniku.
// nadruk (domyślnie true, #92): tekst w czystej czerni K100 z nadrukiem (nadrukCzerni) – wynik ma też { nadruk: liczba obiektów }.
async function konwertujBufor(buf, { gs, profil, sygnal, PDFLib, po, nadruk = true } = {}) {
  gs = gs || znajdzGs();
  if (!gs.ok) throw new Error(gs.powod);
  sprawdzPlikIcc(profil);
  await sprawdzProfilGs(gs, profil, PDFLib);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'karka-cmyk-'));
  try {
    const we = path.join(tmp, 'rgb.pdf'), wy = path.join(tmp, 'cmyk.pdf');
    fs.writeFileSync(we, (await czernK100(buf, PDFLib)).bufor);
    const { czas } = await konwertuj(we, wy, { gs, profil, sygnal });
    let bufor = await grupyCmyk(fs.readFileSync(wy), PDFLib);
    let obiektyNadruku = 0;
    if (nadruk) ({ bufor, obiekty: obiektyNadruku } = await nadrukCzerni(bufor, PDFLib));
    if (po) bufor = await po(bufor);
    const kontrola = await sprawdzPdf(bufor, PDFLib);
    kontrola.nadruk = nadruk ? obiektyNadruku : null;
    return { bufor, kontrola, czas };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ── PDF/X-4 (#85, decyzja 26.10.2026) ───────────────────────────────────────
// Po konwersji (i ramkach z planu): Output Intent z osadzonym profilem użytym do konwersji, Info i XMP zgodne
// (GTS_PDFXVersion, Trapped = False, tytuł, daty, identyfikatory), TrimBox bez ArtBox, nagłówek PDF 1.6, /ID w trailerze.
// Przezroczystość zostaje (PDF/X-4 ją dopuszcza). profil: plik .icc; warunek: OutputConditionIdentifier; nazwa: opis warunku.
const xmlTekst = (t) => String(t).replace(/[<>&"]/g, (z) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[z]));
const uuid = () => 'uuid:' + crypto.randomUUID();
function dataXmp(d) {
  const z = -d.getTimezoneOffset(), dw = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${dw(d.getMonth() + 1)}-${dw(d.getDate())}T${dw(d.getHours())}:${dw(d.getMinutes())}:${dw(d.getSeconds())}` +
    (z >= 0 ? '+' : '-') + dw(z / 60) + ':' + dw(z % 60);
}
async function pdfx4(buf, { PDFLib, profil, warunek = 'Custom', nazwa, tytul = 'Karty', narzedzie = 'KarKa', data = new Date() } = {}) {
  const { PDFDocument, PDFName, PDFString, PDFHexString } = PDFLib;
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const ctx = doc.context;
  nazwa = nazwa || path.basename(profil);
  const icc = ctx.register(ctx.flateStream(fs.readFileSync(profil), { N: 4 }));
  const oi = ctx.register(ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of(warunek),
    OutputCondition: PDFString.of(nazwa), Info: PDFString.of(nazwa), RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: icc }));
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([oi]));
  for (const s of doc.getPages()) s.node.delete(PDFName.of('ArtBox'));
  doc.setTitle(tytul); doc.setCreator(narzedzie); doc.setProducer(narzedzie);
  doc.setCreationDate(data); doc.setModificationDate(data);
  const info = doc.getInfoDict();
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));
  const d = dataXmp(data), idDok = uuid();
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlTekst(tytul)}</rdf:li></rdf:Alt></dc:title>
   <xmp:CreatorTool>${xmlTekst(narzedzie)}</xmp:CreatorTool>
   <xmp:CreateDate>${d}</xmp:CreateDate>
   <xmp:ModifyDate>${d}</xmp:ModifyDate>
   <xmp:MetadataDate>${d}</xmp:MetadataDate>
   <pdf:Producer>${xmlTekst(narzedzie)}</pdf:Producer>
   <pdf:Trapped>False</pdf:Trapped>
   <pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
   <xmpMM:DocumentID>${idDok}</xmpMM:DocumentID>
   <xmpMM:InstanceID>${uuid()}</xmpMM:InstanceID>
   <xmpMM:VersionID>1</xmpMM:VersionID>
   <xmpMM:RenditionClass>default</xmpMM:RenditionClass>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(new Uint8Array(Buffer.from(xmp, 'utf8')), { Type: 'Metadata', Subtype: 'XML' })));
  const id = PDFHexString.of(idDok.slice(5).replace(/-/g, ''));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  // pdf-lib zawsze zapisuje „%PDF-1.7” – nagłówek tej samej długości podmieniany na 1.6 (przesunięcia xref bez zmian).
  const wynik = Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
  if (wynik.toString('latin1', 0, 8) !== '%PDF-1.7') throw new Error('PDF/X-4: nieoczekiwany nagłówek z pdf-lib');
  wynik.write('%PDF-1.6', 0, 'latin1');
  return wynik;
}

// ── TAC – całkowite pokrycie farbą (#85) ────────────────────────────────────
// Render CMYK Ghostscriptem (tiff32nc, nadruk symulowany – jak Podgląd wyjściowy w Acrobacie), suma C+M+Y+K na piksel.
// → { maksTAC (%), strony: [{ maks, ponad (% powierzchni powyżej limitu) }], stronPonadLimit (z limitem), dpi }.
function pikseleTiff(buf) {
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = u32(4), n = u16(ifd), tagi = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), typ = u16(e + 2), ile = u32(e + 4);
    if (![256, 257, 258, 259, 273, 277, 279].includes(tag)) continue;     // tylko potrzebne pola (inne typy, np. ASCII, pomijane)
    const roz = { 1: 1, 2: 1, 3: 2, 4: 4 }[typ] || 8, czytaj = (o) => (typ === 3 ? u16(o) : u32(o));
    const start = ile * roz > 4 ? u32(e + 8) : e + 8;
    tagi[tag] = Array.from({ length: ile }, (_, j) => czytaj(start + j * roz));
  }
  const [w] = tagi[256], [h] = tagi[257], spp = (tagi[277] || [1])[0], kompresja = (tagi[259] || [1])[0];
  if (spp !== 4 || kompresja !== 1 || (tagi[258] || [8])[0] !== 8) throw new Error('nieoczekiwany TIFF z Ghostscripta');
  return { w, h, czesci: tagi[273].map((o, i) => buf.subarray(o, o + tagi[279][i])) };
}
async function zmierzTAC(buf, { gs, dpi = 150, limit = null, limitCzasu = 5 * 60 * 1000 } = {}) {
  gs = gs || znajdzGs();
  if (!gs.ok) throw new Error(gs.powod);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'karka-tac-'));
  try {
    const we = path.join(tmp, 'we.pdf');
    fs.writeFileSync(we, buf);
    await new Promise((ok, blad) => {
      const proc = spawn(gs.sciezka, ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=tiff32nc', `-r${dpi}`, '-dOverprint=/simulate',
        `-sOutputFile=${path.join(tmp, 's%04d.tif')}`, we], { stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      proc.stdout.on('data', (c) => { log = (log + c).slice(-5000); });
      proc.stderr.on('data', (c) => { log = (log + c).slice(-5000); });
      const zegar = setTimeout(() => proc.kill('SIGKILL'), limitCzasu);
      proc.on('error', (e) => { clearTimeout(zegar); blad(e); });
      proc.on('close', (kod) => { clearTimeout(zegar); kod === 0 ? ok() : blad(new Error(`pomiar TAC: Ghostscript (kod ${kod}): ${opisBleduGs(log)}`)); });
    });
    const prog = limit ? limit * 2.55 : Infinity;
    const strony = fs.readdirSync(tmp).filter((f) => f.endsWith('.tif')).sort().map((f) => {
      const { w, h, czesci } = pikseleTiff(fs.readFileSync(path.join(tmp, f)));
      let maks = 0, ponad = 0;
      for (const c of czesci) for (let i = 0; i + 3 < c.length; i += 4) {
        const s = c[i] + c[i + 1] + c[i + 2] + c[i + 3];
        if (s > maks) maks = s;
        if (s > prog) ponad++;
      }
      return { maks: Math.round(maks / 2.55), ponad: Math.round((ponad / (w * h)) * 10000) / 100 };
    });
    const maksTAC = Math.max(0, ...strony.map((s) => s.maks));
    return { maksTAC, dpi, limit, strony, stronPonadLimit: limit ? strony.filter((s) => s.maks > limit).length : null };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { PROFILE, DOMYSLNY, PODPOWIEDZ_GS, MIN_WERSJA_GS, znajdzGs, argumentyGs, konwertuj, opisBleduGs,
  sprawdzPlikIcc, profilLokalny, pobierzProfil, rozwiazProfil, adresPaczki, czyKlucz, sprawdzPdf, konwertujBufor, sha256,
  czernK100, grupyCmyk, nadrukCzerni, nadrukWStrumieniu, katalogIccGs, wypakujProfileGs, sprawdzProfilGs, pdfx4, zmierzTAC, pikseleTiff, PROG_PPI };
