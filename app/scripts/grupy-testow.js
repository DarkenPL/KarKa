#!/usr/bin/env node
// Plan testów przykładów (#101, #136) – jedno źródło dla scripts/testy-ci.js (CI) i scripts/testuj.sh (lokalnie).
//   require('./grupy-testow').planPrzykladu(n)   → [{ nazwa, grupa, przyklad, opcje, waga }]   (uruchomienia jednego przykładu)
//   require('./grupy-testow').sprawdzPlan()      → [] albo lista błędów przypisania bloków
//   node scripts/grupy-testow.js                 → wiersze „uruchomienie bloki” całego planu (dla ludzi)
//   node scripts/grupy-testow.js plan <przykład>[:grupa] [pelny] → wiersze „nazwa opcje…” (dla scripts/testuj.sh)
// Etap B (#136): każdy blok --test-edytor ma jeden przykład macierzysty (BLOKI) i w pełnym zestawie idzie dokładnie raz.
// Blok w main.js bez przypisania, przypisany dwa razy albo nazwa spoza main.js = błąd planu (testuj.sh i CI kończą się
// błędem) – nowy blok musi trafić do BLOKI. Bez przypisania zostają tylko bloki z BLOKI_KAZDEGO (na każdym przykładzie).
// Klucz „przykład:grupa” = osobny proces (07-gildie w trzech, #101); przykład bez wpisu – --test-edytor z samymi
// BLOKI_KAZDEGO (budowa kart, Uwagi, PDF). Tryb pelny: --test-edytor (wszystkie bloki) na każdym przykładzie.
// Podział (pomiar 29.10.2026, macOS, 5 procesów naraz): bloki z danymi przykładu tam, gdzie te dane są; pozostałe
// rozłożone tak, żeby 03 i grupy 07 trwały podobnie (ok. 1 min). Ten sam blok na 03 (26 kart z obrazkami) trwa kilka
// razy dłużej niż na 07 (okna 28 / 1 s, katalog 28 / 3 s) – ciężkie bloki ogólne idą na 07.
// Zależności między blokami (każdy blok osobno na kopii 07, 27.10.2026):
// - część CMYK w zlecenia (zlecenia z profilem) wykonuje się tylko z cmykTest w tym samym procesie – bez niego blok
//   przechodzi bez tej części (cicha utrata pokrycia),
// - zakladki i zleceniaWTle otwierają i zamykają zakładki (zleceniaWTle – #90) – razem.
'use strict';
const fs = require('fs');
const path = require('path');

const BLOKI = {
  '03-ogrod': ['edytor', 'wybor', 'drukarnia', 'drukarniaPdf', 'obrotKarty', 'oknaDruku'],   // kilka talii, rewersy, jeśli=
  '05-zaklecia': ['raportStart'],                                       // tekst ok. 2 mm od krawędzi (#111)
  '07-gildie:zlecenia': ['cmykTest', 'zlecenia', 'hist', 'zmienione', 'katalog'],
  '07-gildie:zakladki': ['zakladki', 'zleceniaWTle'],
  '07-gildie:reszta': ['arkusze', 'rewersy', 'rewersyDodatki',          // talia Magowie – rewersy zależne od karty (#47)
    'spadTest', 'okna', 'podfolder', 'filtrWTrakcie',
    'formatowanie', 'uklad', 'jesli', 'rozmiary', 'akapity',            // karty testowe poza projektem
    'raportProgi', 'naroznik', 'otok', 'ramkiObraz', 'styk'],
  '08-wieze': ['spadSzablonu', 'profileDrukarni'],                      // spad w szablonie (#84), profile drukarni (#85)
};
// Bloki na danych każdego przykładu: raport drukarni bez UWAG z pomiaru obrazu (#138). Na przykładzie w kilku
// procesach (07) – w ostatnim.
const BLOKI_KAZDEGO = ['ramkiPrzyklad'];

// Lista bloków z main.js – to samo wyrażenie co BLOKI_TESTU() w main.js.
const blokiMain = () => [...new Set([...fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
  .matchAll(/\(testBloku\('(\w+)'\)/g)].map((m) => m[1]))];

function sprawdzPlan(znane = blokiMain()) {
  const bledy = [], gdzie = {};
  for (const [k, lista] of Object.entries(BLOKI)) for (const b of lista) (gdzie[b] = gdzie[b] || []).push(k);
  for (const b of BLOKI_KAZDEGO) (gdzie[b] = gdzie[b] || []).push('BLOKI_KAZDEGO');
  for (const [b, k] of Object.entries(gdzie)) {
    if (!znane.includes(b)) bledy.push(`blok „${b}” (${k.join(', ')}) – nie ma go w main.js`);
    if (k.length > 1) bledy.push(`blok „${b}” przypisany kilka razy: ${k.join(', ')}`);
  }
  for (const b of znane) if (!gdzie[b]) bledy.push(`blok „${b}” bez przykładu macierzystego – dopisz go w BLOKI (scripts/grupy-testow.js)`);
  return bledy;
}

// Uruchomienia jednego przykładu; waga – kolejność w CI (najdłuższe najpierw).
function planPrzykladu(n, pelny = false) {
  if (pelny) return [{ nazwa: n, przyklad: n, opcje: ['--test-edytor'], waga: 1 }];
  const bledy = sprawdzPlan();
  if (bledy.length) throw new Error('Plan testów (scripts/grupy-testow.js):\n  ' + bledy.join('\n  '));
  const klucze = Object.keys(BLOKI).filter((k) => k.split(':')[0] === n);
  const procesy = klucze.length ? klucze : [n];
  return procesy.map((k, i) => {
    const grupa = k.includes(':') ? k.split(':')[1] : undefined;
    const bloki = [...(BLOKI[k] || []), ...(i === procesy.length - 1 ? BLOKI_KAZDEGO : [])];
    return { nazwa: grupa ? n + '-' + grupa : n, grupa, przyklad: n, opcje: ['--test-edytor', '--test-bloki', bloki.join(',')],
      waga: (BLOKI[k] || []).length > 1 ? 2 : 1 };
  });
}

module.exports = { BLOKI, BLOKI_KAZDEGO, sprawdzPlan, planPrzykladu };

if (require.main === module) {
  try {
    if (process.argv[2] === 'plan') {
      const [p, g] = String(process.argv[3] || '').split(':');
      const lista = planPrzykladu(p, process.argv[4] === 'pelny').filter((u) => !g || u.grupa === g);
      if (!p || !lista.length) { console.error(`${p}: nieznana grupa „${g}” (node scripts/grupy-testow.js)`); process.exit(1); }
      for (const u of lista) console.log([u.nazwa, ...u.opcje].join(' '));
    } else {
      const przyklady = fs.readdirSync(path.join(__dirname, '..', '..', 'przyklady')).sort();
      for (const u of przyklady.flatMap((n) => planPrzykladu(n))) console.log(u.nazwa + ' ' + u.opcje[2]);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
