// Instrukcja gry (#160, etap 1) – czysta logika bez DOM: szablon stron, style akapitów, tekst w Markdownie, numeracja.
// Działa w stronie (karty.html wczytuje /.app/instrukcja.js → window.Instrukcja) i w Node (scripts/test-instrukcja.js).
// Pomocnicy parsera szablonu kart (splitArgs, unq, plain, stripComment, num) przychodzą z karty.html w argumencie h –
// ten sam kod co dla kart, bez kopii. Rysowanie stron (renderCard), pomiar i Uwagi o miejscu – w karty.html.
(function (root, fabryka) {
  const m = fabryka();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.Instrukcja = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Style akapitów ─────────────────────────────────────────────────────────
  // Wbudowane style (nazwy, których używa Markdown bez znacznika <styl=…>). STYL = nazwa, … w szablonie zmienia
  // tylko podane opcje; style poza akapit bazują domyślnie na akapit (zmiana czcionki akapitu zmienia wszystkie).
  const WBUDOWANE = {
    akapit: { rozmiar: 10, interlinia: 1.2, po: 1.5, wyrownanie: 'lewo' },
    h1: { rozmiar: 16, pogrubienie: true, przed: 3, po: 2 },
    h2: { rozmiar: 13, pogrubienie: true, przed: 2.5, po: 1.5 },
    h3: { rozmiar: 11, pogrubienie: true, przed: 2, po: 1 },
    lista1: { wciecie: 4, wciecie_znaku: 0, znak: '•', po: 0.8 },
    lista2: { wciecie: 8, wciecie_znaku: 4, znak: '–', po: 0.8 },
    lista3: { wciecie: 12, wciecie_znaku: 8, znak: '·', po: 0.8 },
    numer1: { wciecie: 5, wciecie_znaku: 0, numer: '1.', po: 0.8 },
    numer2: { wciecie: 10, wciecie_znaku: 5, numer: 'a)', po: 0.8 },
    numer3: { wciecie: 15, wciecie_znaku: 10, numer: 'i.', po: 0.8 },
  };
  const OPCJE_STYLU = ['czcionka', 'rozmiar', 'kolor', 'wyrownanie', 'interlinia', 'przed', 'po', 'wciecie', 'wciecie_pierwszego',
    'wciecie_prawe', 'wciecie_znaku', 'znak', 'numer', 'czcionka_znaku', 'rozmiar_znaku', 'kolor_znaku', 'ikony', 'bazuje'];
  const LICZBOWE = ['rozmiar', 'interlinia', 'przed', 'po', 'wciecie', 'wciecie_pierwszego', 'wciecie_prawe', 'wciecie_znaku', 'rozmiar_znaku', 'ikony'];
  const FLAGI_STYLU = ['pogrubienie', 'kursywa', 'wersaliki', 'pogrubienie_znaku'];
  const WYROWNANIA = ['lewo', 'srodek', 'prawo', 'wyjustuj'];
  const NIE = /^(nie|brak|0|false)$/i;

  // Opcje i flagi z argumentów komendy (jak parseTemplate: opcja=wartość, flaga, reszta – argumenty).
  function rozbierz(reszta, h) {
    const args = [], opt = {};
    for (const a of h.splitArgs(reszta)) {
      const u = h.unq(a);
      const o = !u.q && /^([\p{L}_][\p{L}\p{N}_ ]*?)\s*=\s*([\s\S]*)$/u.exec(a);
      if (o) opt[h.plain(o[1])] = h.unq(o[2]).v;
      else if (!u.q && FLAGI_STYLU.includes(h.plain(a))) opt[h.plain(a)] = true;
      else args.push(u.v);
    }
    return { args, opt };
  }

  // Style z wpisów STYL (w kolejności pliku) → nazwa → opcje po dziedziczeniu (bazuje=), liczby jako liczby.
  function rozwiazStyle(wpisy, h, bledy) {
    const wlasne = new Map();
    for (const w of wpisy) wlasne.set(w.nazwa, { ...(wlasne.get(w.nazwa) || {}), ...w.opt });
    const nazwy = new Set([...Object.keys(WBUDOWANE), ...wlasne.keys()]);
    const gotowe = {};
    const licz = (n, stos) => {
      if (gotowe[n]) return gotowe[n];
      if (stos.includes(n)) { bledy.push(`STYL ${n}: bazuje= tworzy pętlę (${[...stos, n].join(' → ')})`); return {}; }
      const own = { ...(WBUDOWANE[n] || {}), ...(wlasne.get(n) || {}) };
      let baza = own.bazuje !== undefined ? h.plain(own.bazuje) : (n === 'akapit' ? '' : 'akapit');
      if (baza && !nazwy.has(baza)) { bledy.push(`STYL ${n}: nie ma stylu „${own.bazuje}” (bazuje=)`); baza = 'akapit'; }
      const wynik = { ...(baza ? licz(baza, [...stos, n]) : {}), ...own };
      delete wynik.bazuje;
      // znak i numer nie przechodzą z akapitu na nagłówki (styl listy dziedziczy po liście, nie po akapicie)
      if (own.znak !== undefined && own.numer === undefined) delete wynik.numer;
      if (own.numer !== undefined && own.znak === undefined) delete wynik.znak;
      gotowe[n] = wynik;
      return wynik;
    };
    for (const n of nazwy) licz(n, []);
    return gotowe;
  }

  // Opcje stylu zapisane jako opcje TEKST (styl= w TEKST na stronie): czcionka, rozmiar, kolor, wyrównanie, interlinia,
  // ikony i flagi. Wstawiane przed opcjami z wiersza – opcje z wiersza wygrywają, a styl wygrywa z CZCIONKA.
  function opcjeTekstu(s) {
    const q = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const out = [];
    for (const [k, n] of [['czcionka', 'czcionka'], ['rozmiar', 'rozmiar'], ['kolor', 'kolor'], ['wyrownanie', 'wyrównanie'], ['interlinia', 'interlinia'], ['ikony', 'ikony']])
      if (s[k] !== undefined && s[k] !== '') out.push(`${n}=${q(s[k])}`);
    for (const f of ['pogrubienie', 'kursywa', 'wersaliki']) if (s[f] === true) out.push(f);
    return out.join(', ');
  }

  // ── Szablon instrukcji ─────────────────────────────────────────────────────
  // DOKUMENT = szer, wys, spad=3, strony=N; TREŚĆ = plik.md, …; STYL = nazwa, …; STYL_ZNAKOWY = pogrubienie|kursywa, …;
  // sekcje [WZORZEC], [WZORZEC LEWA], [WZORZEC PRAWA], [STRONA N] / [STRONA N, bez_wzorca]; RAMKA = x, y, szer, wys, tekst=…
  // Pozostałe wiersze to komendy szablonu kart – karty.html składa z nich tekst strony (tekstCzesci) z tymi samymi
  // numerami wierszy (puste w miejscu cudzych wierszy), więc Uwagi parseTemplate wskazują właściwy wiersz pliku.
  const ZAWSZE = ['stala', 'kolor', 'czcionka_plik', 'czcionka_google'];   // działają w całym pliku, gdziekolwiek stoją
  function parseDokument(text, plik, h) {
    const d = { plik, w: 0, h: 0, spad: 0, stron: 0, tresc: [], style: {}, znakowe: {}, strony: [], wzorzec: { wspolny: [], lewa: [], prawa: [] },
      globalne: [], zamiany: new Map(), ramki: new Map(), bledy: [] };
    if (/^\s*\{\\rtf/.test(text)) { d.bledy.push(`${plik}: plik jest zapisany jako RTF. W TextEdit wybierz Format → Zamień na zwykły tekst i zapisz ponownie.`); return d; }
    const linie = text.replace(/^﻿/, '').split(/\r?\n/);
    const wpisyStylu = [], strony = new Map();
    let cel = null, dokument = false;              // cel: tablica numerów wierszy bieżącej sekcji (null = przed sekcjami)
    let strona = null;
    linie.forEach((raw, i) => {
      const where = `${plik}, wiersz ${i + 1}`;
      let line = raw.trim();
      if (!line || /^(;|#|\/\/)/.test(line)) return;
      line = h.stripComment(line).trim();
      if (!line) return;
      const sec = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
      if (sec) {
        const [glowa, ...opcje] = h.splitArgs(sec[1]);
        const m = /^(\S+)(?:\s+(.+))?$/.exec(glowa.trim()), co = h.plain(m[1]), arg = (m[2] || '').trim();
        if (co === 'wzorzec') {
          const s = h.plain(arg);
          if (!arg) cel = d.wzorzec.wspolny; else if (s === 'lewa' || s === 'prawa') cel = d.wzorzec[s];
          else { d.bledy.push(`${where}: [WZORZEC], [WZORZEC LEWA] albo [WZORZEC PRAWA]`); cel = []; }
          strona = null; return;
        }
        if (co === 'strona') {
          const n = h.num(arg);
          if (!Number.isInteger(n) || n < 1) { d.bledy.push(`${where}: [STRONA N] – numer strony od 1, np. [STRONA 3]`); cel = []; strona = null; return; }
          if (strony.has(n)) d.bledy.push(`${where}: strona ${n} występuje drugi raz – elementy dopisano do niej`);
          strona = strony.get(n) || { nr: n, bezWzorca: false, linie: [], ramki: [], wiersz: i + 1 };
          strony.set(n, strona);
          for (const o of opcje) {
            if (h.plain(o) === 'bez_wzorca') strona.bezWzorca = true;
            else d.bledy.push(`${where}: nieznana opcja strony „${o}” (jest bez_wzorca)`);
          }
          cel = strona.linie; return;
        }
        d.bledy.push(`${where}: nieznana sekcja ${line} – w instrukcji są [WZORZEC], [WZORZEC LEWA], [WZORZEC PRAWA] i [STRONA N]`);
        cel = []; strona = null; return;
      }
      const m = /^([^=]+?)\s*=\s*([\s\S]*)$/.exec(line);
      const kom = m ? h.plain(m[1]) : '';
      if (kom === 'dokument') {
        const { args, opt } = rozbierz(m[2], h);
        const w = h.num(args[0]), hh = h.num(args[1]);
        if (!(w > 0 && hh > 0)) d.bledy.push(`${where}: DOKUMENT = szerokość, wysokość strony w mm, np. DOKUMENT = 148, 210, spad=3`);
        else { d.w = w; d.h = hh; dokument = true; }
        if (opt.spad !== undefined) {
          const s = h.num(String(opt.spad).replace(',', '.'));
          if (s >= 0 && s <= 10) d.spad = s; else d.bledy.push(`${where}: spad= to liczba mm od 0 do 10`);
        }
        if (opt.strony !== undefined) {
          const s = h.num(opt.strony);
          if (Number.isInteger(s) && s >= 1 && s <= 500) d.stron = s; else d.bledy.push(`${where}: strony= to liczba stron od 1 do 500`);
        }
        return;
      }
      if (kom === 'tresc') { d.tresc.push(...h.splitArgs(m[2]).map((x) => h.unq(x).v.trim()).filter(Boolean)); return; }
      if (kom === 'styl') {
        const { args, opt } = rozbierz(m[2], h);
        const nazwa = h.plain(args[0] || '');
        if (!nazwa) { d.bledy.push(`${where}: STYL = nazwa, opcje… (np. STYL = akapit, rozmiar=10)`); return; }
        if (args.length > 1) d.bledy.push(`${where}: STYL ${args[0]}: niezrozumiałe „${args.slice(1).join(', ')}” – opcje piszemy jako nazwa=wartość`);
        for (const [k, v] of Object.entries(opt)) {
          if (!OPCJE_STYLU.includes(k) && !FLAGI_STYLU.includes(k)) { d.bledy.push(`${where}: STYL ${args[0]}: nieznana opcja ${k}`); delete opt[k]; continue; }
          if (FLAGI_STYLU.includes(k) && v !== true) opt[k] = !NIE.test(String(v).trim());
          else if (LICZBOWE.includes(k)) {
            const n = h.num(String(v).replace(',', '.'));
            if (Number.isNaN(n)) { d.bledy.push(`${where}: STYL ${args[0]}: ${k}= to liczba (${k === 'rozmiar' || k === 'rozmiar_znaku' ? 'pt' : k === 'interlinia' || k === 'ikony' ? 'krotność' : 'mm'})`); delete opt[k]; }
            else opt[k] = n;
          } else if (k === 'wyrownanie' && !WYROWNANIA.includes(h.plain(v))) { d.bledy.push(`${where}: STYL ${args[0]}: wyrównanie= lewo, środek, prawo albo wyjustuj`); delete opt[k]; }
          else if (k === 'wyrownanie') opt[k] = h.plain(v);
        }
        wpisyStylu.push({ nazwa, opt, where });
        return;
      }
      if (kom === 'styl_znakowy') {
        const [pierwszy, ...reszta] = h.splitArgs(m[2]);
        const { opt } = rozbierz(reszta.join(', '), h);
        const nazwa = h.plain(h.unq(pierwszy || '').v);
        if (nazwa !== 'pogrubienie' && nazwa !== 'kursywa') { d.bledy.push(`${where}: STYL_ZNAKOWY = pogrubienie albo kursywa, opcje… (to, co dają **…** i *…*)`); return; }
        d.znakowe[nazwa] = { ...(d.znakowe[nazwa] || {}), ...opt };
        return;
      }
      if (kom === 'instrukcja') { d.bledy.push(`${where}: INSTRUKCJA wpisz w szablonie kart (wskazuje ten plik)`); return; }
      if (kom === 'karta') { d.bledy.push(`${where}: w instrukcji rozmiar strony podaje DOKUMENT, nie KARTA`); return; }
      if (kom === 'dane') { d.bledy.push(`${where}: instrukcja nie ma pliku danych (DANE) – tekst podaje TREŚĆ`); return; }
      if (ZAWSZE.includes(kom)) { d.globalne.push(i); return; }
      if (kom === 'ramka') {
        if (!strona) { d.bledy.push(`${where}: RAMKA stoi poza [STRONA N] – ramka tekstu należy do strony`); return; }
        const { opt } = rozbierz(m[2], h);
        const r = { linia: i + 1, strona: strona.nr, tekst: opt.tekst !== undefined ? h.plain(opt.tekst) : '', nazwa: opt.tekst || '',
          margines: opt.margines !== undefined ? h.num(String(opt.margines).replace(',', '.')) : 0, pion: h.plain(opt.pion || '') };
        if (Number.isNaN(r.margines)) { d.bledy.push(`${where}: margines= to liczba mm`); r.margines = 0; }
        d.ramki.set(i + 1, r); strona.ramki.push(r);
        // Ramka rysuje się jak PROSTOKĄT (wypełnienie, obwódka, zaokrąglenie, obrót) – domyślnie bez wypełnienia.
        d.zamiany.set(i, 'PROSTOKĄT = kolor=brak, ' + m[2]);
        strona.linie.push(i); return;
      }
      if (m && kom === 'tekst' && /(?:^|,)\s*styl\s*=/.test(m[2])) d.styleTekstu = (d.styleTekstu || []).concat([{ i, reszta: m[2], where }]);
      if (cel === null) {
        // przed sekcjami: CZCIONKA działa dalej w całym pliku, elementy są wspólne dla stron (jak [WZORZEC])
        if (kom === 'czcionka' || kom === 'projekt' || kom === 'wersja') d.globalne.push(i); else d.wzorzec.wspolny.push(i);
        return;
      }
      cel.push(i);
    });
    if (!dokument) d.bledy.push(`${plik}: brak komendy DOKUMENT = szerokość, wysokość (mm) – np. DOKUMENT = 148, 210`);
    d.style = rozwiazStyle(wpisyStylu, h, d.bledy);
    // styl= w TEKST na stronie → opcje stylu przed opcjami wiersza
    for (const { i, reszta, where } of d.styleTekstu || []) {
      const { opt } = rozbierz(reszta, h);
      const s = d.style[h.plain(opt.styl)];
      if (!s) { d.bledy.push(`${where}: nie ma stylu „${opt.styl}” (STYL = ${opt.styl}, …)`); continue; }
      const o = opcjeTekstu(s);
      d.zamiany.set(i, 'TEKST = ' + (o ? o + ', ' : '') + reszta);
    }
    delete d.styleTekstu;
    const ile = Math.max(d.stron, ...strony.keys(), 0);
    for (let n = 1; n <= ile; n++) d.strony.push(strony.get(n) || { nr: n, bezWzorca: false, linie: [], ramki: [], wiersz: 0 });
    if (!ile && dokument) d.bledy.push(`${plik}: instrukcja nie ma stron – dodaj [STRONA 1] albo strony= w DOKUMENT`);
    return d;
  }

  // Tekst do parseTemplate: wiersze globalne + wzorzec strony (czesc = 'wzorzec') albo jej własne (czesc = 'strona'),
  // reszta pusta – numery wierszy się zgadzają. Strona 1 jest prawa (nieparzyste – prawe, parzyste – lewe).
  function tekstCzesci(linie, d, strona, czesc) {
    const bierz = new Set(d.globalne);
    if (czesc === 'wzorzec') {
      if (!strona.bezWzorca) [...d.wzorzec.wspolny, ...d.wzorzec[strona.nr % 2 ? 'prawa' : 'lewa']].forEach((i) => bierz.add(i));
    } else strona.linie.forEach((i) => bierz.add(i));
    return linie.map((l, i) => (bierz.has(i) ? (d.zamiany.has(i) ? d.zamiany.get(i) : l) : '')).join('\n');
  }

  // ── Tekst w Markdownie ─────────────────────────────────────────────────────
  // Nagłówki #, ##, ###; akapity (pusta linia kończy akapit); listy -, *, +, • i 1. / 1) – poziom z wcięcia (do 3);
  // twarde złamanie: <br>, \ albo dwie spacje na końcu wiersza; <styl=nazwa> na początku akapitu albo punktu;
  // <tekst=nazwa> w osobnym wierszu zaczyna nazwany tekst; <następna_ramka> w osobnym wierszu – przejście do następnej
  // ramki; komentarze <!-- … --> pomijane. Formatowanie w wierszu (**, *, {ikona}, znaczniki) zostaje w polu tekst –
  // zamienia je karty.html (to samo co na kartach).
  const PUNKT_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
  function parsujMarkdown(text, plik, h) {
    const bledy = [], teksty = [];
    // NFC: tekst z eksportów (np. IDML) bywa w NFD – „ó” jako „o” + znak łączący; {Żołądź} nie trafiałby w ikonę
    const czysty = String(text).normalize('NFC').replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, (k) => k.replace(/[^\n]/g, ''));
    let biezacy = { nazwa: '', etykieta: '', bloki: [], linia: 1 };
    teksty.push(biezacy);
    let blok = null, wciecia = [];
    const zamknij = () => { blok = null; };
    const nowy = (b) => { biezacy.bloki.push(b); blok = b; };
    const dopisz = (t) => {
      const twarde = /(\\|\s{2,})$/.test(t);
      t = t.replace(/(\\|\s{2,})$/, '').trim();
      blok.tekst += (blok.tekst && !/<br>$/i.test(blok.tekst) ? ' ' : '') + t + (twarde ? '<br>' : '');
    };
    czysty.split(/\r?\n/).forEach((raw, i) => {
      const linia = i + 1, where = `${plik}, wiersz ${linia}`;
      const t = raw.replace(/\t/g, '    ');
      if (!t.trim()) { zamknij(); wciecia = []; return; }
      const zn = /^\s*<\s*tekst\s*=\s*([^>]*?)\s*>\s*$/i.exec(t);
      if (zn) {
        zamknij(); wciecia = [];
        const nazwa = h.plain(zn[1]);
        biezacy = teksty.find((x) => x.nazwa === nazwa) || null;
        if (biezacy) bledy.push(`${where}: tekst „${zn[1]}” był już wcześniej – dalszy ciąg dopisano do niego`);
        else { biezacy = { nazwa, etykieta: zn[1], bloki: [], linia }; teksty.push(biezacy); }
        return;
      }
      if (/^\s*<\s*nast[eę]pna_ramka\s*>\s*$/i.test(t)) {
        zamknij(); wciecia = [];
        biezacy.bloki.push({ typ: 'nastepna', linia });
        return;
      }
      const hd = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(t);
      if (hd) {
        zamknij(); wciecia = [];
        let poziom = hd[1].length;
        if (poziom > 3) { bledy.push(`${where}: nagłówek ${hd[1]} – instrukcja ma 3 poziomy nagłówków (#, ##, ###), użyto ###`); poziom = 3; }
        nowy({ typ: 'h', poziom, tekst: hd[2], linia });
        zamknij();
        return;
      }
      const p = PUNKT_RE.exec(t);
      if (p) {
        const w = p[1].length;
        // stos wcięć listy: głębiej o ponad 1 spację = poziom niżej, płycej = powrót do poziomu o pasującym wcięciu
        if (!wciecia.length || w > wciecia[wciecia.length - 1] + 1) wciecia.push(w);
        else while (wciecia.length > 1 && w <= wciecia[wciecia.length - 2] + 1) wciecia.pop();
        let poziom = wciecia.length;
        if (poziom > 3) { bledy.push(`${where}: lista ma więcej niż 3 poziomy – punkt na poziomie 3`); poziom = 3; wciecia.length = 3; }
        nowy({ typ: 'li', poziom, numerowana: /\d/.test(p[2]), tekst: '', linia });
        dopisz(p[3]);
        return;
      }
      if (blok && blok.typ !== 'h') { dopisz(t); return; }
      wciecia = [];
      nowy({ typ: 'p', tekst: '', linia });
      dopisz(t);
    });
    for (const t of teksty) for (const b of t.bloki) {
      if (b.tekst === undefined) continue;
      const s = /^\s*<\s*styl\s*=\s*([^>]*?)\s*>\s*/i.exec(b.tekst);
      if (s) { b.styl = h.plain(s[1]); b.tekst = b.tekst.slice(s[0].length); }
      b.tekst = b.tekst.replace(/(?:\s*<br>)+$/i, '');
    }
    return { teksty: teksty.filter((t, i) => i > 0 || t.bloki.length), bledy };
  }

  // Nazwa stylu bloku: <styl=…> albo wbudowany wg rodzaju (h1–h3, akapit, lista1–3, numer1–3).
  function stylBloku(b) {
    if (b.styl) return b.styl;
    if (b.typ === 'h') return 'h' + b.poziom;
    if (b.typ === 'li') return (b.numerowana ? 'numer' : 'lista') + b.poziom;
    return 'akapit';
  }

  // Numer w formacie stylu: cyfra 1 wzoru (albo, bez niej, osobna litera a / A / i / I) zastępuje numer: 1., a), (i),
  // „Faza 1:” – litery w słowach („Faza”) zostają.
  function rzymska(n) {
    let s = '';
    for (const [v, z] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']])
      while (n >= v) { s += z; n -= v; }
    return s;
  }
  function litera(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }
  function formatNumeru(wzor, n) {
    const m = /1/.exec(String(wzor)) || /(?<!\p{L})[aAiI](?!\p{L})/u.exec(String(wzor));
    if (!m) return String(wzor);
    const z = m[0], v = z === '1' ? String(n) : z === 'a' ? litera(n) : z === 'A' ? litera(n).toUpperCase() : z === 'i' ? rzymska(n) : rzymska(n).toUpperCase();
    return wzor.slice(0, m.index) + v + wzor.slice(m.index + 1);
  }

  // Znaki list i numery: punkt na poziomie L zeruje liczniki głębszych poziomów, akapit bez znaku i nagłówek – wszystkie.
  // Akapit (nie punkt) w stylu z numerem liczy się na poziomie 1. Wynik: b.znacznik (tekst znaku albo numeru) i b.numer.
  function numeruj(bloki, style) {
    const licz = [0, 0, 0, 0];
    for (const b of bloki) {
      if (b.typ === 'nastepna') continue;
      const s = style[stylBloku(b)] || {};
      const poziom = b.typ === 'li' ? b.poziom : 1;
      if (s.numer) {
        for (let k = poziom + 1; k < licz.length; k++) licz[k] = 0;
        b.numer = ++licz[poziom];
        b.znacznik = formatNumeru(s.numer, b.numer);
      } else if (s.znak) {
        for (let k = poziom + 1; k < licz.length; k++) licz[k] = 0;
        b.znacznik = s.znak;
      } else licz.fill(0);
    }
    return bloki;
  }

  return { WBUDOWANE, parseDokument, tekstCzesci, parsujMarkdown, stylBloku, formatNumeru, numeruj, rozwiazStyle, opcjeTekstu };
});
