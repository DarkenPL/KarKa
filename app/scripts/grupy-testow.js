#!/usr/bin/env node
// Podział pełnego --test-edytor na 07-gildie na osobne procesy (#101, A0) – jedno źródło dla scripts/testy-ci.js (CI)
// i scripts/testuj.sh (lokalnie).
//   require('./grupy-testow').GRUPY_07  → [{ nazwa, bloki }]   (bloki = wartość --test-bloki)
//   node scripts/grupy-testow.js        → wiersze „nazwa bloki” (dla powłoki)
// Ostatnia grupa to dopełnienie (-nazwy wszystkich wcześniejszych), więc nowy blok zawsze się wykona.
// Zależności między blokami (pomiar 27.10.2026, każdy blok osobno na kopii 07):
// - zlecenia potrzebuje zmienione (zapamietajDruk() – bez tego „tylko zmienione” po PDF jednej talii nie jest puste),
// - część CMYK w zlecenia (zlecenia z profilem) wykonuje się tylko z cmykTest w tym samym procesie – bez niego blok
//   przechodzi bez tej części (cicha utrata pokrycia).
// Pozostałe bloki przechodzą osobno. Czasy osobno (Linux, 2 rdzenie): ok. 87 / 92 / 85 s; całość w jednym procesie 392 s.
'use strict';
const GRUPY = [
  ['zmienione', 'cmykTest', 'zlecenia'],
  ['zakladki'],
];
const NAZWY = ['zlecenia', 'zakladki', 'reszta'];

const GRUPY_07 = [
  ...GRUPY.map((b, i) => ({ nazwa: NAZWY[i], bloki: b.join(',') })),
  { nazwa: NAZWY[GRUPY.length], bloki: GRUPY.flat().map((b) => '-' + b).join(',') },
];

module.exports = { GRUPY_07 };

if (require.main === module) for (const g of GRUPY_07) console.log(g.nazwa + ' ' + g.bloki);
