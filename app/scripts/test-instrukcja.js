#!/usr/bin/env node
// Test modułu instrukcji (#160): parser szablonu stron, style akapitów, Markdown, numeracja – samym Node, bez Electrona.
// Pomocnicy parsera (splitArgs, unq, plain, stripComment, num) są brani z generator/karty.html – ten sam kod co w stronie.
'use strict';
const fs = require('fs');
const path = require('path');
const I = require('../generator/instrukcja.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'generator', 'karty.html'), 'utf8');
const funkcja = (nazwa) => {
  const m = new RegExp(`^function ${nazwa}\\([\\s\\S]*?^}`, 'm').exec(html);
  if (!m) throw new Error('brak funkcji ' + nazwa + ' w karty.html');
  return m[0];
};
const stala = (nazwa) => {
  const m = new RegExp(`^const ${nazwa} = [\\s\\S]*?;$`, 'm').exec(html);
  if (!m) throw new Error('brak stałej ' + nazwa + ' w karty.html');
  return m[0];
};
const h = Function(`${stala('plain')}\n${funkcja('stripComment')}\n${funkcja('splitArgs')}\n${funkcja('unq')}\n${funkcja('num')}
  return { plain, stripComment, splitArgs, unq, num };`)();

let bledow = 0;
const sprawdz = (warunek, opis, dane) => {
  if (warunek) return;
  bledow++;
  console.log('BŁĄD: ' + opis + (dane !== undefined ? ' – ' + JSON.stringify(dane) : ''));
};

// ── Szablon stron ──
const szablon = `; instrukcja
DOKUMENT = 106, 148, spad=3
TREŚĆ    = instrukcja.md
KOLOR    = noc, #1f2a44
STYL = akapit, czcionka="EB Garamond", rozmiar=9, wyrównanie=wyjustuj
STYL = h1, rozmiar=18, wersaliki, kolor=#ffffff
STYL = faza, bazuje=numer1, po=1, czcionka_znaku="Patrick Hand", pogrubienie_znaku
STYL = podpis, rozmiar=7, wyrównanie=środek, kursywa
STYL_ZNAKOWY = pogrubienie, czcionka="EB Garamond", grubość=600
STYL = zła, wyrównanie=krzywo, rozmiar=duży, kolor_tła=#fff

[WZORZEC]
TŁO = #ffffff
[WZORZEC LEWA]
PROSTOKĄT = 0, 0, 5, 148, kolor=noc
[WZORZEC PRAWA]
PROSTOKĄT = 101, 0, 5, 148, kolor=noc
[STRONA 1]
RAMKA = 3, 45, 100, 100, tekst=wstęp, margines=1
TEKST = 3, 3, 100, 10, "Ogród", styl=podpis, rozmiar=20
[STRONA 3, bez_wzorca]
RAMKA = 3, 3, 100, 142, tekst=Zasady, kolor=#eeeeee, zaokrąglenie=2
OBRAZEK = 10, 10, 10, 14, Art/karta.png, obrót=180
[STRONA 2]
[STRONA X]
RAMKA = 1, 1, 1, 1
[ROZDZIAŁ]
`;
const d = I.parseDokument(szablon, 'instrukcja.txt', h);
sprawdz(d.w === 106 && d.h === 148 && d.spad === 3, 'DOKUMENT', [d.w, d.h, d.spad]);
sprawdz(d.tresc.join() === 'instrukcja.md', 'TREŚĆ', d.tresc);
sprawdz(d.strony.length === 3 && d.strony.map((s) => s.nr).join() === '1,2,3', 'strony 1–3 (2 pusta)', d.strony.map((s) => s.nr));
sprawdz(d.strony[2].bezWzorca && !d.strony[0].bezWzorca, 'bez_wzorca');
sprawdz(d.strony[0].ramki.length === 1 && d.strony[0].ramki[0].tekst === 'wstep' && d.strony[0].ramki[0].margines === 1, 'ramka strony 1', d.strony[0].ramki);
sprawdz(d.strony[2].ramki[0].tekst === 'zasady' && d.strony[2].ramki[0].linia === 22, 'ramka strony 3 – nazwa bez wielkości liter, wiersz', d.strony[2].ramki);
sprawdz(d.style.akapit.rozmiar === 9 && d.style.akapit.interlinia === 1.2 && d.style.akapit.wyrownanie === 'wyjustuj', 'akapit – zmiana tylko podanych opcji', d.style.akapit);
sprawdz(d.style.h1.rozmiar === 18 && d.style.h1.wersaliki === true && d.style.h1.czcionka === 'EB Garamond' && d.style.h1.pogrubienie === true, 'h1 bazuje na akapit', d.style.h1);
sprawdz(d.style.faza.numer === '1.' && d.style.faza.wciecie === 5 && d.style.faza.po === 1 && d.style.faza.pogrubienie_znaku === true && d.style.faza.czcionka_znaku === 'Patrick Hand', 'faza bazuje na numer1', d.style.faza);
sprawdz(d.style.lista2.znak === '–' && !d.style.lista2.numer && !d.style.h2.znak, 'znak listy nie przechodzi na nagłówki', [d.style.lista2, d.style.h2]);
sprawdz(d.znakowe.pogrubienie && d.znakowe.pogrubienie.czcionka === 'EB Garamond', 'STYL_ZNAKOWY', d.znakowe);
const b = d.bledy.join('\n');
for (const [re, opis] of [[/wiersz 10: STYL zła: wyrównanie/, 'złe wyrównanie'], [/wiersz 10: STYL zła: rozmiar= to liczba/, 'rozmiar nie-liczba'],
  [/wiersz 10: STYL zła: nieznana opcja kolor_tla/, 'nieznana opcja stylu'], [/wiersz 25: \[STRONA N\]/, 'zły numer strony'], [/wiersz 26: RAMKA stoi poza/, 'ramka poza stroną'],
  [/wiersz 27: nieznana sekcja \[ROZDZIAŁ\]/, 'nieznana sekcja']])
  sprawdz(re.test(b), 'Uwaga: ' + opis, d.bledy);
sprawdz(d.bledy.length === 6, 'liczba Uwag szablonu', d.bledy);

// Tekst strony dla parseTemplate: te same numery wierszy, ramka jako PROSTOKĄT, styl= rozpisany w TEKST.
const linie = szablon.split('\n');
const s1 = I.tekstCzesci(linie, d, d.strony[0], 'strona').split('\n');
sprawdz(s1.length === linie.length, 'tekst strony ma tyle wierszy co plik');
sprawdz(s1[18] === 'PROSTOKĄT = kolor=brak, 3, 45, 100, 100, tekst=wstęp, margines=1', 'RAMKA → PROSTOKĄT', s1[18]);
sprawdz(/^TEKST = czcionka="EB Garamond", rozmiar="7", wyrównanie="srodek", interlinia="1.2", kursywa, 3, 3, 100, 10, "Ogród", styl=podpis, rozmiar=20$/.test(s1[19]), 'styl= w TEKST – opcje stylu przed opcjami wiersza', s1[19]);
sprawdz(s1[3] === linie[3] && s1[5] === '' && s1[21] === '', 'globalne zostają, STYL i cudze strony puste', [s1[3], s1[5], s1[21]]);
const w1 = I.tekstCzesci(linie, d, d.strony[0], 'wzorzec').split('\n'), w2 = I.tekstCzesci(linie, d, d.strony[1], 'wzorzec').split('\n');
sprawdz(w1[12] === linie[12] && w1[16] === linie[16] && w1[14] === '', 'strona 1 – wzorzec wspólny i prawy', w1.slice(11, 17));
sprawdz(w2[14] === linie[14] && w2[16] === '', 'strona 2 – wzorzec lewy', w2.slice(11, 17));
sprawdz(I.tekstCzesci(linie, d, d.strony[2], 'wzorzec').split('\n').every((l, i) => !l || [3].includes(i)), 'bez_wzorca – tylko globalne');

sprawdz(/wiersz 2: nieznana sekcja \[,\]/.test(I.parseDokument('DOKUMENT = 10, 10\n[,]\n', 'z.txt', h).bledy.join()), 'sekcja [,] – Uwaga, nie wyjątek');
const cudz = I.parseDokument('DOKUMENT = 10, 10\n[STRONA 1]\nTEKST = 1, 1, 5, 5, "a, styl=x"\n', 'c.txt', h);
sprawdz(!cudz.bledy.length && !cudz.zamiany.size, 'styl= w cudzysłowie to tekst', cudz.bledy);
sprawdz(I.parsujMarkdown('# Wersja C#\n## Tytuł ##\n', 'h.md', h).teksty[0].bloki.map((b) => b.tekst).join('|') === 'Wersja C#|Tytuł', 'zamykające # nagłówka');
const bez = I.parseDokument('[STRONA 1]\nTEKST = 1, 1, 10, 10, "x", styl=brak\nRAMKA = 1,1,1,1\n', 'i.txt', h);
sprawdz(/brak komendy DOKUMENT/.test(bez.bledy.join()) && /nie ma stylu „brak”/.test(bez.bledy.join()), 'brak DOKUMENT, nieznany styl', bez.bledy);
sprawdz(bez.strony[0].ramki[0].tekst === '', 'ramka bez tekst= – tekst bez nazwy', bez.strony[0].ramki);
const petla = I.parseDokument('DOKUMENT = 10, 10\nSTYL = a, bazuje=b\nSTYL = b, bazuje=a\n[STRONA 1]\n', 'p.txt', h);
sprawdz(/pętlę/.test(petla.bledy.join()), 'pętla bazuje=', petla.bledy);
sprawdz(/RTF/.test(I.parseDokument('{\\rtf1 x', 'r.txt', h).bledy.join()), 'RTF');

// ── Markdown ──
const md = `Wstęp bez nazwy.
<!-- komentarz
na dwa wiersze -->
<tekst=Zasady>
# Przygotowanie

1. Rozłóż planszę {slonce}.
1. Każdy gracz:
   - bierze 3 karty,<br>a potem jeszcze
     jedną (ciąg punktu)
   - <styl=faza>tasuje talię.
     - poziom trzeci
1. Zacznijcie.

Zwykły akapit, który ma dwa wiersze
w pliku i twarde złamanie\\
tutaj.
#### Za głęboko

<następna_ramka>

## Faza ##
- 1.5 punktu to nie lista
2) druga numeracja
- **pogrubiony** punkt
<tekst=podpisy>
Grządka
<tekst=zasady>
Dalszy ciąg zasad.
`;
const m = I.parsujMarkdown(md, 'instrukcja.md', h);
sprawdz(m.teksty.map((t) => t.nazwa).join() === ',zasady,podpisy', 'nazwy tekstów', m.teksty.map((t) => t.nazwa));
const z = m.teksty[1].bloki;
const opis = z.map((x) => x.typ + (x.poziom || '') + (x.numerowana ? 'n' : '') + (x.styl ? '[' + x.styl + ']' : '') + ':' + (x.tekst || '')).join(' | ');
const ocz = 'h1:Przygotowanie | li1n:Rozłóż planszę {slonce}. | li1n:Każdy gracz: | li2:bierze 3 karty,<br>a potem jeszcze jedną (ciąg punktu) | li2[faza]:tasuje talię. | li3:poziom trzeci | li1n:Zacznijcie.'
  + ' | p:Zwykły akapit, który ma dwa wiersze w pliku i twarde złamanie<br>tutaj. | h3:Za głęboko | nastepna: | h2:Faza | li1:1.5 punktu to nie lista | li1n:druga numeracja | li1:**pogrubiony** punkt | p:Dalszy ciąg zasad.';
sprawdz(opis === ocz, 'bloki Markdownu', opis);
sprawdz(z[0].linia === 5 && z[7].linia === 15, 'numery wierszy bloków (komentarz nie przesuwa)', [z[0].linia, z[7].linia]);
sprawdz(/wiersz 18: nagłówek #### – instrukcja ma 3 poziomy/.test(m.bledy.join()) && /wiersz 28: tekst „zasady” był już/.test(m.bledy.join()), 'Uwagi Markdownu', m.bledy);
sprawdz(m.teksty[0].bloki.length === 1 && m.teksty[2].bloki[0].tekst === 'Grządka', 'tekst bez nazwy i podpis', m.teksty.map((t) => t.bloki.length));
sprawdz(I.parsujMarkdown('<tekst=a>\nx\n', 'a.md', h).teksty.map((t) => t.nazwa).join() === 'a', 'pusty tekst bez nazwy pominięty');
sprawdz(I.parsujMarkdown('{Z\u0307o\u0142a\u0328dz\u0301}', 'n.md', h).teksty[0].bloki[0].tekst === '{Żołądź}', 'tekst w NFD → NFC (ikony z polskimi znakami)');

// ── Numeracja ──
const style = I.rozwiazStyle([{ nazwa: 'faza', opt: { bazuje: 'numer1' } }], h, []);
I.numeruj(z, style);
const zn = z.map((x) => x.znacznik || '-').join(' ');
sprawdz(zn === '- 1. 2. – 1. · 3. - - - - • 1. • -', 'znaczniki i numery (punkt poziomu 2 w stylu z numerem liczy się na poziomie 2)', zn);
sprawdz(I.formatNumeru('a)', 28) === 'ab)' && I.formatNumeru('(i)', 14) === '(xiv)' && I.formatNumeru('A.', 3) === 'C.' && I.formatNumeru('•', 2) === '•' && I.formatNumeru('Faza 1:', 3) === 'Faza 3:' && I.formatNumeru('Krok a)', 2) === 'Krok b)', 'formaty numerów');
sprawdz(I.stylBloku({ typ: 'li', poziom: 2, numerowana: true }) === 'numer2' && I.stylBloku({ typ: 'h', poziom: 3 }) === 'h3', 'style wbudowane bloków');

console.log(bledow ? `test-instrukcja: ${bledow} błędów` : 'test-instrukcja: ok');
process.exit(bledow ? 1 : 0);
