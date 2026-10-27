'use strict';
// Profile drukarni (issue #85, etap 2, od 0.7.0). Format: docs/profile-drukarni.md.
// Wbudowane: pliki JSON w drukarnie/ obok kodu (longpack.json, printnet.json – trafiają też do nakładki kodu),
// „Własne ustawienia”: <dane aplikacji>/drukarnie/wlasne.json (ten sam format, id = wlasne).
// Moduł bez Electrona – czyta go też test (scripts/test-drukarnie.js) i może czytać osobne narzędzie do sprawdzania PDF.
const fs = require('fs');
const path = require('path');

const FORMAT = 1;
const STRONY = ['osobno', 'dwapliki', 'naprzemian'];
const PROFILE_ICC = ['iso300', 'fogra39', 'fogra51', 'rgb'];
const WLASNE = 'wlasne';
// Domyślne „Własne ustawienia” – jak okno PDF dla drukarni do 0.6.8 (nazwy plików „Gra – drukarnia – awersy.pdf”), z PDF/X-4.
const DOMYSLNE = {
  format: FORMAT, id: WLASNE, nazwa: 'Własne ustawienia', opis: 'Wszystko do ustawienia ręcznie',
  spad: 3, strefa: 3, icc: 'fogra39', tac: 300, pdfx: 'PDF/X-4', nadrukCzerni: true, rewersy: true, strony: 'osobno',
  wzorNazwy: '{projekt} – drukarnia{dopiski} – {strona}', strona: { awersy: 'awersy', rewersy: 'rewersy', razem: '' },
  komponent: '', jezyk: '', minTekstPt: null, uwagi: [],
};

const tekst = (x, d = '') => (typeof x === 'string' ? x : d);
// Sprawdza i uzupełnia profil → { profil, bledy }. Nieznane pola zostają (zgodność w przód), złe wartości → błąd.
function sprawdz(obj, zrodlo = 'profil') {
  const bledy = [], p = { ...DOMYSLNE, ...(obj && typeof obj === 'object' ? obj : {}) };
  const zle = (pole, opis) => bledy.push(`${zrodlo}: ${pole} – ${opis}`);
  if (p.format !== FORMAT) zle('format', `nieznany format ${JSON.stringify(p.format)} (KarKa zna ${FORMAT})`);
  if (!/^[a-z0-9-]+$/.test(String(p.id))) zle('id', 'małe litery, cyfry i „-”');
  p.nazwa = tekst(p.nazwa, p.id); p.opis = tekst(p.opis);
  if (typeof p.spad !== 'number' || !(p.spad >= 0 && p.spad <= 10)) zle('spad', 'liczba mm od 0 do 10');
  if (p.strefa != null && (typeof p.strefa !== 'number' || p.strefa < 0)) zle('strefa', 'liczba mm albo null');
  // icc: klucz profilu z eci.org, „rgb” (bez konwersji) albo ścieżka do pliku .icc (tylko Własne ustawienia).
  if (typeof p.icc !== 'string' || !(PROFILE_ICC.includes(p.icc) || /\.ic[cm]$/i.test(p.icc))) zle('icc', `${PROFILE_ICC.join(', ')} albo ścieżka do pliku .icc`);
  if (p.tac != null && (typeof p.tac !== 'number' || p.tac < 100 || p.tac > 400)) zle('tac', 'limit w % od 100 do 400 albo null');
  if (p.pdfx != null && p.pdfx !== 'PDF/X-4') zle('pdfx', '"PDF/X-4" albo null');
  if (!STRONY.includes(p.strony)) zle('strony', STRONY.join(', '));
  for (const k of ['nadrukCzerni', 'rewersy']) if (typeof p[k] !== 'boolean') zle(k, 'true albo false');
  p.wzorNazwy = tekst(p.wzorNazwy, DOMYSLNE.wzorNazwy);
  if (!p.wzorNazwy.includes('{projekt}')) zle('wzorNazwy', 'musi zawierać {projekt}');
  p.strona = { ...DOMYSLNE.strona, ...(p.strona && typeof p.strona === 'object' ? p.strona : {}) };
  p.komponent = tekst(p.komponent); p.jezyk = tekst(p.jezyk);
  p.uwagi = Array.isArray(p.uwagi) ? p.uwagi.filter((x) => typeof x === 'string') : [];
  return { profil: p, bledy };
}

// Wbudowane profile (kolejność: LongPack, Printnet, potem inne pliki alfabetycznie). Zły plik → wyjątek (błąd paczki).
function wbudowane(katalog = path.join(__dirname, 'drukarnie')) {
  const pliki = fs.readdirSync(katalog).filter((f) => f.endsWith('.json')).sort();
  const kolejnosc = ['longpack.json', 'printnet.json'];
  pliki.sort((a, b) => ((kolejnosc.indexOf(a) + 1 || 99) - (kolejnosc.indexOf(b) + 1 || 99)) || a.localeCompare(b));
  return pliki.map((f) => {
    const { profil, bledy } = sprawdz(JSON.parse(fs.readFileSync(path.join(katalog, f), 'utf8')), f);
    if (bledy.length) throw new Error('profil drukarni ' + bledy.join('; '));
    if (profil.id === WLASNE || profil.id + '.json' !== f) throw new Error(`profil drukarni ${f}: id „${profil.id}” musi się zgadzać z nazwą pliku`);
    return profil;
  });
}

const plikWlasnych = (dane) => path.join(dane, 'drukarnie', 'wlasne.json');
// Własne ustawienia z danych aplikacji; brak pliku → null (strona bierze ustawienia okna z 0.6.x); zły plik → domyślne z błędem.
function wlasne(dane) {
  let obj;
  try { obj = JSON.parse(fs.readFileSync(plikWlasnych(dane), 'utf8')); } catch (e) { return e.code === 'ENOENT' ? null : { ...DOMYSLNE, blad: 'wlasne.json: ' + e.message }; }
  const { profil, bledy } = sprawdz({ ...obj, id: WLASNE, format: FORMAT }, 'wlasne.json');
  return bledy.length ? { ...DOMYSLNE, blad: bledy.join('; ') } : profil;
}
function zapiszWlasne(dane, obj) {
  const { profil, bledy } = sprawdz({ ...obj, id: WLASNE, format: FORMAT, nazwa: DOMYSLNE.nazwa, opis: DOMYSLNE.opis }, 'Własne ustawienia');
  if (bledy.length) throw new Error(bledy.join('; '));
  const plik = plikWlasnych(dane);
  fs.mkdirSync(path.dirname(plik), { recursive: true });
  fs.writeFileSync(plik + '.czesc', JSON.stringify(profil, null, 2) + '\n');
  fs.renameSync(plik + '.czesc', plik);
  return profil;
}

module.exports = { FORMAT, STRONY, PROFILE_ICC, WLASNE, DOMYSLNE, sprawdz, wbudowane, wlasne, zapiszWlasne, plikWlasnych };
