#!/usr/bin/env node
// Plan testów przykładów (#101, #136 etap A) – jedno źródło dla scripts/testy-ci.js (CI) i scripts/testuj.sh (lokalnie).
//   require('./grupy-testow').GRUPY_07           → [{ nazwa, bloki }]   (bloki = wartość --test-bloki)
//   require('./grupy-testow').planPrzykladu(n)   → [{ nazwa, przyklad, opcje, waga }]   (uruchomienia jednego przykładu)
//   node scripts/grupy-testow.js                 → wiersze „nazwa bloki” grup 07 (dla powłoki)
//   node scripts/grupy-testow.js plan <przykład>[:grupa] [pelny] → wiersze „nazwa opcje…” (dla scripts/testuj.sh)
// Etap A (#136): bloki testują aplikację, nie przykład, więc pełny --test-edytor idzie tylko na 03-ogrod (kilka talii,
// rewersy, jeśli=) i 07-gildie (w grupach niżej). Pozostałe przykłady – tylko --test-pdf (budowa kart, Uwagi, PDF),
// a bloki zależne od ich danych – przez --test-bloki (BLOKI_PRZYKLADOW). Tryb pelny: --test-edytor na każdym przykładzie.
// 07-gildie w trzech procesach (#101, A0). Ostatnia grupa to dopełnienie (-nazwy wszystkich wcześniejszych), więc nowy
// blok zawsze się wykona. Zależności między blokami (pomiar 27.10.2026, każdy blok osobno na kopii 07):
// - zlecenia od 0.7.3 (#102) samo robi zapamietajDruk() na starcie – nie potrzebuje już bloku zmienione,
// - część CMYK w zlecenia (zlecenia z profilem) wykonuje się tylko z cmykTest w tym samym procesie – bez niego blok
//   przechodzi bez tej części (cicha utrata pokrycia).
// Pozostałe bloki przechodzą osobno. Czasy osobno (Linux, 2 rdzenie): ok. 87 / 92 / 85 s; całość w jednym procesie 392 s.
'use strict';
const GRUPY = [
  ['cmykTest', 'zlecenia'],
  ['zakladki', 'zleceniaWTle'],     // oba otwierają i zamykają zakładki (zleceniaWTle – #90)
];
const NAZWY = ['zlecenia', 'zakladki', 'reszta'];

const GRUPY_07 = [
  ...GRUPY.map((b, i) => ({ nazwa: NAZWY[i], bloki: b.join(',') })),
  { nazwa: NAZWY[GRUPY.length], bloki: GRUPY.flat().map((b) => '-' + b).join(',') },
];

// Pełny --test-edytor (wszystkie bloki) – poza 07, które idzie w grupach.
const PELNE = ['03-ogrod'];
// Bloki na danych konkretnego przykładu bez pełnego edytora.
const BLOKI_PRZYKLADOW = {
  '05-zaklecia': ['raportStart'],                     // tekst ok. 2 mm od krawędzi (#111)
  '08-wieze': ['spadSzablonu', 'profileDrukarni'],    // spad w szablonie (#84), profile drukarni (#85)
};

// Uruchomienia jednego przykładu; waga – kolejność w CI (najdłuższe najpierw).
function planPrzykladu(n, pelny = false) {
  if (n === '07-gildie') return GRUPY_07.map((g) =>
    ({ nazwa: n + '-' + g.nazwa, grupa: g.nazwa, przyklad: n, opcje: ['--test-edytor', '--test-bloki', g.bloki], waga: 2 }));
  if (pelny || PELNE.includes(n)) return [{ nazwa: n, przyklad: n, opcje: ['--test-edytor'], waga: 3 }];   // najdłuższe
  if (BLOKI_PRZYKLADOW[n]) return [{ nazwa: n, przyklad: n, opcje: ['--test-edytor', '--test-bloki', BLOKI_PRZYKLADOW[n].join(',')], waga: 1 }];
  return [{ nazwa: n, przyklad: n, opcje: [], waga: 0 }];
}

module.exports = { GRUPY_07, PELNE, BLOKI_PRZYKLADOW, planPrzykladu };

if (require.main === module) {
  if (process.argv[2] === 'plan') {
    const [p, g] = String(process.argv[3] || '').split(':');
    const lista = planPrzykladu(p, process.argv[4] === 'pelny').filter((u) => !g || u.grupa === g);
    if (!p || !lista.length) { console.error(`${p}: nieznana grupa „${g}” (node scripts/grupy-testow.js)`); process.exit(1); }
    for (const u of lista) console.log([u.nazwa, ...u.opcje].join(' '));
  } else for (const g of GRUPY_07) console.log(g.nazwa + ' ' + g.bloki);
}
