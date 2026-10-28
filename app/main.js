'use strict';
// KarKa (Kawia Karciana, dawniej Generator kart) – aplikacja na macOS (Electron).
// Okno pokazuje generator (generator/karty.html). Pliki projektu podaje lokalny serwer (serwer.js),
// a biblioteki i czcionki są w aplikacji. Projekt otwiera się przez wskazanie pliku szablonu.
// Każdy otwarty projekt to obiekt Projekt: własny widok strony (WebContentsView) w oknie, własny serwer
// na osobnym porcie, zlecenia z pliku, historia i stan edytora. Projekty są zakładkami jednego okna
// (issue #59, etap 2): pasek zakładek to osobny widok (zakladki.html) nad widokiem aktywnego projektu.
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, shell, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { utworzSerwer } = require('./serwer');
const historia = require('./historia');
const drukarnia = require('./drukarnia');
const cmyk = require('./cmyk');
const drukarnie = require('./drukarnie');
const aktualizacje = require('./aktualizacje');

// Kod aplikacji: z paczki albo z nakładki po aktualizacji (start.js, nakladka.js). Zasoby leżą obok kodu
// (nakładka, npm start) albo – w paczce – w Contents/Resources/zasoby.
const KOD = global.GENERATOR_KOD || { zrodlo: 'paczka', dir: __dirname, wersja: app.getVersion(), wbudowana: app.getVersion() };
const WERSJA = KOD.wersja;
const ZASOBY = fs.existsSync(path.join(__dirname, 'zasoby', 'karty.html')) ? path.join(__dirname, 'zasoby') : path.join(process.resourcesPath, 'zasoby');
const PRZYKLADY = path.join(ZASOBY, 'przyklady');
const DOKUMENTACJA = 'https://github.com/DarkenPL/KarKa#readme';

let okno = null;             // okno aplikacji (BaseWindow); projekty i pasek zakładek są w nim widokami (WebContentsView)
let pasek = null;            // widok paska zakładek (zakladki.html); widoczny od 2 zakładek
let testowy = false;         // tryb testowy (CI) – bez otwierania okien Findera
const projekty = [];         // otwarte projekty = zakładki, w kolejności paska (nowe na końcu)
let aktywny = null;          // projekt widoczny w oknie – na niego działają menu i skróty
let przywracanie = false;    // trwa przywracanie zakładek po starcie – bez zapisu listy do ustawień
const LIMIT_ZAKLADEK = 8;    // decyzja właściciela 16.10.2026 (pamięć: ok. 100 MB na zakładkę)
const PASEK_WYSOKOSC = 34;   // px
// Zaczepy trybu testowego: pytania, które w teście nie są pokazywane, i odpowiedź na pytanie o limit zakładek.
// bezczynnosc – krótszy czas samozamykania zakładek ze zleceń (ms, blok zleceniaWTle).
const TEST = { pytania: 0, limit: null, odpowiedzLimit: false, bezczynnosc: null };
// Zlecenia z „Folderu z projektami” (#90): zaległe zlecenie (mtime) nie jest wykonywane – decyzja właściciela 27.10.2026;
// zakładka otwarta przez zlecenie zamyka się sama po 15 min bez zleceń – decyzja 16.10.2026 w #59.
const ZALEGLE_MS = 10 * 60 * 1000;
const BEZCZYNNOSC_MS = 15 * 60 * 1000;

// ── Ustawienia: ostatnie projekty ──────────────────────────────────────────
// Pierwszy start po zmianie nazwy (Generator kart → KarKa): ustawienia ze starego folderu danych.
aktualizacje.przeniesDane(path.join(app.getPath('appData'), 'Generator kart'), app.getPath('userData'));
const plikUstawien = () => path.join(app.getPath('userData'), 'ustawienia.json');
function ustawienia() {
  try { return JSON.parse(fs.readFileSync(plikUstawien(), 'utf8')); } catch (e) { return { ostatnie: [] }; }
}
function zapiszUstawienia(u) {
  try { fs.mkdirSync(path.dirname(plikUstawien()), { recursive: true }); fs.writeFileSync(plikUstawien(), JSON.stringify(u, null, 2)); }
  catch (e) { /* bez zapisu ustawień aplikacja nadal działa */ }
}
// Przykłady są tylko do odczytu – także te z paczki, gdy działa nakładka (ostatnie projekty mogą wskazywać oba miejsca).
const FOLDERY_PRZYKLADOW = [...new Set([PRZYKLADY, path.join(process.resourcesPath || '', 'zasoby', 'przyklady')].map((p) => path.resolve(p)))];
const jestPrzykladem = (p) => !!p && FOLDERY_PRZYKLADOW.some((f) => path.resolve(p).startsWith(f + path.sep));
const jestPlikiem = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
const jestFolderem = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

// Folder podany zamiast szablonu (np. z poprzedniej wersji) → pierwszy szablon w nim albo w jego „Szablony”.
function szablonZFolderu(dir) {
  for (const d of [path.join(dir, 'Szablony'), dir]) {
    try {
      const t = fs.readdirSync(d).filter((n) => /\.txt$/i.test(n) && !n.startsWith('_') && !n.startsWith('.'))
        .sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }));
      if (t.length) return path.join(d, t[0]);
    } catch (e) { /* brak folderu */ }
  }
  return null;
}
const naSzablon = (p) => (!p ? null : jestPlikiem(p) ? p : jestFolderem(p) ? szablonZFolderu(p) : null);
const ostatnie = () => [...new Set((ustawienia().ostatnie || []).map(naSzablon).filter(Boolean))];
const folderProjektu = (plik) => {
  const dir = path.dirname(plik);
  return path.basename(dir).toLowerCase() === 'szablony' ? path.dirname(dir) : dir;
};

// ── Projekt ─────────────────────────────────────────────────────────────────
// Otwarty projekt: widok strony, serwer plików na własnym porcie, szablon, stan edytora, zlecenia, eksport.
// Serwer i widok zostają przy zmianie szablonu (Plik → Otwórz szablon… w tym samym projekcie).
class Projekt {
  constructor() {
    this.szablon = null;          // otwarty plik szablonu (.txt)
    this.folder = null;           // folder projektu: folder szablonu, a gdy szablon leży w „Szablony” – folder nad nim
    this.zmiany = false;          // niezapisane zmiany w edytorze szablonu
    this.zlecenieTrwa = false;    // trwa zlecenie z pliku w tym projekcie (PDF bez okna dozwolony tylko wtedy)
    this.folderEksportu = null;   // folder trwającego eksportu obrazków
    this.serwer = null;
    this.port = 0;
    this.widok = null;
    this.tytul = '';              // PROJEKT = z szablonu (nazwa zakładki); pusty → nazwa folderu
    this.uzyty = Date.now();      // ostatnie pokazanie zakładki – do wyboru najdawniej używanej (limit, etap 3)
    this.pokazRewersy = false;    // Widok → Pokaż rewersy kart (#47) – strona po wczytaniu zaczyna od awersów
    this.zeZlecenia = false;      // zakładka otwarta w tle przez zlecenie (#90); kliknięcie właściciela ją „przejmuje”
    this.ostatnieZlecenie = Date.now();   // koniec ostatniego zlecenia – samozamykanie zakładek ze zleceń
  }
  get wc() { const w = this.widok && this.widok.webContents; return w && !w.isDestroyed() ? w : null; }
  get nazwa() { return this.folder ? path.basename(this.folder) : ''; }
  // Nazwa w pasku zakładek i w menu Okno: PROJEKT = z szablonu albo nazwa folderu; przykład z dopiskiem.
  get nazwaZakladki() {
    if (!this.szablon) return 'Nowa zakładka';
    return (this.tytul || this.nazwa) + (jestPrzykladem(this.szablon) ? ' (przykład)' : '');
  }
  // Historia, zlecenia i zapis do Export/ – tylko w projektach użytkownika (przykłady są tylko do odczytu).
  get zapisywalny() { return !!this.folder && !jestPrzykladem(this.folder); }
  // PROJEKT = Nazwa gry z pliku szablonu (bez wczytywania strony) – przy otwarciu i po zapisie z edytora.
  odczytajTytul() {
    this.tytul = '';
    if (!this.szablon) return;
    try {
      const m = /^[ \t]*PROJEKT[ \t]*=[ \t]*([^;#\r\n]*)/mi.exec(fs.readFileSync(this.szablon, 'utf8'));
      if (m) this.tytul = m[1].trim().replace(/^"(.*)"$/, '$1').trim();
    } catch (e) { /* bez tytułu – nazwa folderu */ }
  }

  async uruchom() {
    this.serwer = utworzSerwer({ zasoby: ZASOBY, projekt: () => this.folder });
    await new Promise((ok, zle) => { this.serwer.once('error', zle); this.serwer.listen(0, '127.0.0.1', ok); });
    this.port = this.serwer.address().port;
    this.widok = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Dławienie timerów Chromium (backgroundThrottling) tylko w zakładkach w tle: strona widzi document.hidden i odświeża
    // pliki co ~9 s zamiast 1,5 s (0.5.2). Aktywna zakładka ma dławienie wyłączone (pokazProjekt) – zasłonięte okno
    // odświeża jak dotąd. Z wyłączonym dławieniem Chromium zawsze zgłasza stronie „widoczna”, także po odpięciu widoku.
    this.widok.setBackgroundColor('#ece9e4');
    const wc = this.widok.webContents, nasz = `http://127.0.0.1:${this.port}/`;
    wc.on('will-navigate', (e, url) => {
      if (!url.startsWith(nasz)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
    });
    wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    wc.once('did-finish-load', potwierdzStart);            // nowy kod z nakładki uruchomił się poprawnie
    wc.on('did-finish-load', () => {                        // nowa strona = awersy; menu Widok bez zaznaczenia
      ustawTlo(this);                                       // zakładka ze zlecenia w tle – bez sprawdzania plików co 1,5 s
      if (!this.pokazRewersy) return;
      this.pokazRewersy = false;
      if (this === aktywny) zbudujMenu();
    });
    projekty.push(this);
    return this;
  }

  // Zamknięcie projektu – tylko sprzątanie: kopia zmienionych plików w historii, serwer i widok.
  // Wybór i pokazanie sąsiedniej zakładki robi zamknijZakladke().
  zamknij() {
    const i = projekty.indexOf(this);
    if (i < 0) return;
    projekty.splice(i, 1);
    historiaZamkniecie(this);
    try { this.serwer.close(); } catch (e) { /* trudno */ }
    try { if (okno && !okno.isDestroyed()) okno.contentView.removeChildView(this.widok); } catch (e) { /* już odpięty */ }
    try { if (this.wc) this.wc.close(); } catch (e) { /* już zamknięty */ }
    if (aktywny === this) aktywny = null;
  }
}
// Projekt, z którego przyszło IPC (event.sender) – zamiast globalnego „otwartego projektu”.
const projektWc = (wc) => (wc && projekty.find((p) => p.wc && p.wc.id === wc.id)) || null;
function projektZ(e) {
  const p = projektWc(e.sender);
  if (!p) throw new Error('Nieznany projekt – strona spoza aplikacji.');
  return p;
}

// ── Zakładki ────────────────────────────────────────────────────────────────
// Pasek zakładek (zakladki.html) nad widokiem aktywnego projektu; przy jednej zakładce ma 0 px – aplikacja
// wygląda jak w 0.5.7. Układ: pasek {0,0,w,34}, widok {0,34,w,h−34}.
const pasekWidoczny = () => projekty.length > 1;
function ulozWidok() {
  if (!okno || okno.isDestroyed()) return;
  const [width, height] = okno.getContentSize();
  const gora = pasekWidoczny() ? PASEK_WYSOKOSC : 0;
  if (pasek) pasek.setBounds({ x: 0, y: 0, width, height: gora });
  if (aktywny && aktywny.widok) aktywny.widok.setBounds({ x: 0, y: gora, width, height: Math.max(0, height - gora) });
}
// Tytuł okna, plik w pasku tytułu i kropka niezapisanych zmian – z aktywnego projektu.
function odswiezOkno() {
  if (!okno) return;
  const p = aktywny;
  okno.setDocumentEdited(!!(p && p.zmiany));
  okno.setTitle(p && p.szablon ? `${p.nazwa} – ${path.basename(p.szablon)} – KarKa` : 'KarKa');
  okno.setRepresentedFilename(p && p.szablon ? p.szablon : '');   // ekran startowy – bez ikony poprzedniego pliku
}
// Stan paska: lista zakładek (nazwa, ścieżka szablonu w dymku, kropka zmian, trwające zlecenie) i aktywna.
const stanPaska = () => ({
  zakladki: projekty.map((p) => ({ nazwa: p.nazwaZakladki, sciezka: p.szablon || '', zmiany: !!p.zmiany, zlecenie: !!p.zlecenieTrwa,
    pusta: !p.szablon, przyklad: !!p.szablon && jestPrzykladem(p.szablon) })),
  aktywna: projekty.indexOf(aktywny), limit: projekty.length >= LIMIT_ZAKLADEK,
});
function odswiezPasek() {
  if (!okno || okno.isDestroyed()) return;
  ulozWidok();
  const wc = pasek && pasek.webContents;
  if (wc && !wc.isDestroyed()) wc.send('zakladki:stan', stanPaska());
  zapiszStan();
}
// Przełączenie na zakładkę: odpięcie starego widoku (strona widzi document.hidden → odświeża rzadziej),
// przypięcie nowego, fokus, tytuł, pasek, menu, zapis listy zakładek.
function pokazProjekt(p) {
  if (!okno || okno.isDestroyed() || !p || !p.widok) return;
  const stary = aktywny;
  if (aktywny && aktywny !== p && aktywny.widok) {
    try { aktywny.widok.setVisible(false); okno.contentView.removeChildView(aktywny.widok); } catch (e) { /* już odpięty */ }
    if (aktywny.wc && !aktywny.zlecenieTrwa) aktywny.wc.setBackgroundThrottling(true);   // w tle: document.hidden → rzadsze odświeżanie
  }
  aktywny = p;
  if (stary && stary !== p) ustawTlo(stary);
  przejmij(p);                                              // pokazana zakładka ze zlecenia = zakładka właściciela
  ustawTlo(p);
  p.uzyty = Date.now();
  okno.contentView.addChildView(p.widok);
  p.widok.setVisible(true);
  if (p.wc) p.wc.setBackgroundThrottling(false);
  ulozWidok();
  if (okno.isFocused() && p.wc) p.wc.focus();
  odswiezOkno();
  odswiezPasek();
  zbudujMenu();
  zapiszZakladki();
}
const przesunZakladke = (o) => { const n = projekty.length; if (n > 1) pokazProjekt(projekty[((projekty.indexOf(aktywny) + o) % n + n) % n]); };
const wybierzZakladke = (i) => { if (projekty[i]) pokazProjekt(projekty[i]); };
// Zakładka ze zlecenia w tle (#90): strona nie sprawdza plików co 1,5 s (zlecenie i tak wczytuje je z dysku).
// Widoczna (aktywna) albo przejęta – sprawdza jak każda inna.
function ustawTlo(p) {
  if (p && p.wc) p.wc.executeJavaScript(`window.ustawWTle && ustawWTle(${!!(p.zeZlecenia && p !== aktywny)})`).catch(() => {});
}
// Pokazana zakładka otwarta przez zlecenie (kliknięcie, ⌘1–9, ⌃Tab, otwarcie folderu, sąsiad po zamknięciu): od teraz zwykła zakładka – nie zamyka się sama, wraca po starcie,
// trafia do „Ostatnich projektów”.
function przejmij(p) {
  if (!p || !p.zeZlecenia) return;
  p.zeZlecenia = false;
  ustawTlo(p);
  if (p.szablon && !jestPrzykladem(p.szablon)) dodajDoOstatnich(p.szablon);
  zbudujMenu();
  zapiszZakladki();
  zapiszStan();
}
const rodzajZakladki = (p) => (p === aktywny ? 'aktywna' : p.zeZlecenia ? 'otwarta przez zlecenie' : 'w tle');

// Lista otwartych zakładek w ustawieniach (bez przykładów i pustych), zapisywana przy każdej zmianie –
// po starcie wracają te same zakładki. Brak klucza w ustawieniach → ostatni projekt (jak do 0.5.7).
function zapiszZakladki() {
  if (przywracanie || !okno) return;
  // Zakładki otwarte przez zlecenie i nieprzejęte nie wracają po starcie (#90, pkt 6 – zgoda właściciela 27.10.2026).
  const lista = projekty.filter((p) => p.szablon && !jestPrzykladem(p.szablon) && !p.zeZlecenia);
  const u = ustawienia();
  u.otwarteZakladki = lista.map((p) => p.szablon);
  u.aktywnaZakladka = Math.max(0, lista.indexOf(aktywny));
  zapiszUstawienia(u);
}
const tenSamFolder = (a, b) => !!a && !!b && (path.resolve(a) === path.resolve(b) || realna(a) === realna(b));

// Nowa pusta zakładka (⌘T, +): ekran startowy, z którego wybór projektu wczytuje go w tej zakładce.
// Przy limicie pyta o zamknięcie najdawniej używanej zakładki; null = nie otwarto.
async function nowaZakladka() {
  if (!okno) return null;
  if (projekty.length >= LIMIT_ZAKLADEK && !(await zwolnijZakladke())) return null;
  const p = await new Projekt().uruchom();
  pokazProjekt(p);
  await otworzSzablon(null, p);
  return p;
}
// Limit zakładek: propozycja zamknięcia najdawniej używanej bez niezapisanych zmian i bez trwającego zlecenia;
// gdy takiej nie ma – sama odmowa (nic nie znika bez wiedzy użytkownika).
async function zwolnijZakladke() {
  const kandydat = projekty.filter((p) => !p.zmiany && !p.zlecenieTrwa).sort((a, b) => a.uzyty - b.uzyty)[0] || null;
  let zgoda = false;
  if (testowy) { TEST.limit = { liczba: projekty.length, kandydat: kandydat ? kandydat.nazwaZakladki : null, odmowa: !kandydat }; zgoda = !!kandydat && TEST.odpowiedzLimit; }
  else if (!kandydat) {
    await dialog.showMessageBox(okno, { type: 'info', message: `Otwartych jest już ${projekty.length} zakładek.`,
      detail: 'Każda ma niezapisane zmiany albo trwające zlecenie. Zamknij którąś, żeby otworzyć następną.' });
  } else {
    const r = await dialog.showMessageBox(okno, { type: 'question', buttons: ['Zamknij i otwórz nową', 'Anuluj'], defaultId: 0, cancelId: 1,
      message: `Otwartych jest ${projekty.length} zakładek. Zamknąć „${kandydat.nazwaZakladki}”?`,
      detail: 'To najdawniej używana zakładka bez niezapisanych zmian. Pozostałe zakładki zostaną.' });
    zgoda = r.response === 0;
  }
  if (!zgoda || !kandydat) return false;
  return zamknijZakladke(kandydat);
}
// Otwarcie szablonu „w zakładce” – jedna zasada dla menu, Findera, przykładów i ekranu startowego:
// folder już otwarty → przełączenie (inny szablon tego folderu → podmiana w tej zakładce, z pytaniem o edytor);
// pusta zakładka (nadawca albo aktywna) → wczytanie w niej; inaczej nowa zakładka na końcu paska.
async function otworzWZakladce(plik, w = null) {
  const szablon = naSzablon(plik);
  if (!szablon) return null;
  const folder = folderProjektu(szablon);
  let p = projekty.find((x) => tenSamFolder(x.folder, folder));
  if (p) {
    pokazProjekt(p);
    if (p.szablon !== szablon && !(await otworzSzablon(szablon, p))) return null;
    return p;
  }
  p = [w, aktywny].find((x) => x && projekty.includes(x) && !x.szablon) || null;
  if (p) { pokazProjekt(p); return (await otworzSzablon(szablon, p)) ? p : null; }
  p = await nowaZakladka();
  return p && (await otworzSzablon(szablon, p)) ? p : null;
}
// Zamknięcie zakładki (⌘W, ×): pytanie o niezapisany edytor (po przełączeniu na nią), sprzątanie,
// aktywna staje się sąsiednia po prawej (bez niej – po lewej). Ostatnia zakładka → zostaje pusta z ekranem startowym.
async function zamknijZakladke(p = aktywny) {
  if (!p || !projekty.includes(p)) return false;
  if (projekty.length === 1 && !p.szablon) return false;        // jedyna, pusta – nie ma czego zamykać
  if (!(await czyMoznaPorzucic(p))) return false;
  const i = projekty.indexOf(p), byla = aktywny === p;
  // Sąsiad: najpierw zakładki właściciela (zakładki ze zleceń są dopisywane z prawej – nie wyciągamy ich na wierzch).
  const wlasne = projekty.filter((x) => x === p || !x.zeZlecenia), j = wlasne.indexOf(p);
  const sasiad = (wlasne.length > 1 ? wlasne[j + 1] || wlasne[j - 1] : projekty[i + 1] || projekty[i - 1]) || null;
  p.zamknij();
  if (!projekty.length) { const n = await new Projekt().uruchom(); pokazProjekt(n); await otworzSzablon(null, n); }
  else if (byla) pokazProjekt(sasiad);
  else { odswiezPasek(); zbudujMenu(); zapiszZakladki(); }
  return true;
}
// Kliknięcia w pasku; po każdym fokus klawiatury wraca do widoku aktywnego projektu (pasek go zabiera).
const oddajFokus = () => { if (okno && !okno.isDestroyed() && okno.isFocused() && aktywny && aktywny.wc) aktywny.wc.focus(); };
ipcMain.on('zakladki:wybierz', (e, i) => { wybierzZakladke(Number(i)); oddajFokus(); });
ipcMain.on('zakladki:zamknij', async (e, i) => { await zamknijZakladke(projekty[Number(i)]); oddajFokus(); });
ipcMain.on('zakladki:nowa', async () => { await nowaZakladka(); oddajFokus(); });

// Niezapisane zmiany w edytorze: Zapisz / Nie zapisuj / Anuluj. Zwraca true, gdy można iść dalej.
// Pytanie dotyczy zakładki p – najpierw ją pokazuje, żeby użytkownik widział, o który szablon chodzi.
async function czyMoznaPorzucic(p) {
  if (!p || !p.zmiany) return true;
  TEST.pytania++;
  if (testowy || !okno) return true;
  pokazProjekt(p);
  const r = await dialog.showMessageBox(okno, {
    type: 'warning', buttons: ['Zapisz', 'Nie zapisuj', 'Anuluj'], defaultId: 0, cancelId: 2,
    message: `Zapisać zmiany w szablonie „${path.basename(p.szablon || '')}”?`,
    detail: 'Jeśli nie zapiszesz, zmiany przepadną.',
  });
  if (r.response === 2) return false;
  if (r.response === 0) {
    try { zapiszSzablonNaDysk(p, await p.wc.executeJavaScript('window.edytorTekst()')); }
    catch (e) { dialog.showErrorBox('Nie można zapisać szablonu', e.message); return false; }
  }
  p.zmiany = false;
  return true;
}
// Zamknięcie okna, ⌘Q, restart po aktualizacji: pytanie o każdy projekt z niezapisanym edytorem.
async function czyMoznaPorzucicWszystkie() {
  for (const p of [...projekty]) if (!(await czyMoznaPorzucic(p))) return false;
  return true;
}
function zapiszSzablonNaDysk(p, tekst) {
  if (!p.szablon || jestPrzykladem(p.szablon)) throw new Error('Ten szablon jest tylko do odczytu.');
  fs.writeFileSync(p.szablon, String(tekst));
}

// Po nieudanym kroku (np. zapis się nie powiódł) stan „zmiany” wraca ze strony – zamknięcie okna znów zapyta.
async function przywrocZmiany(p) {
  if (p && p.wc) p.zmiany = !!(await p.wc.executeJavaScript('!!(window.ED && ED.zmiany)').catch(() => p.zmiany));
}
// Wczytanie szablonu (albo ekranu startowego – plik null) w zakładce p. Zwraca false, gdy użytkownik anulował
// przy pytaniu o niezapisany edytor. Otwieranie z menu i Findera idzie przez otworzWZakladce().
async function otworzSzablon(plik, p = aktywny) {
  if (!p || !(await czyMoznaPorzucic(p))) return false;
  try {
    historiaZamkniecie(p);
    p.zmiany = false;
    p.szablon = naSzablon(plik);
    p.folder = p.szablon ? folderProjektu(p.szablon) : null;
    p.odczytajTytul();
    if (p.szablon && !jestPrzykladem(p.szablon) && !przywracanie && !p.zeZlecenia) dodajDoOstatnich(p.szablon);
    if (p === aktywny) odswiezOkno();
    if (p.wc) {
      const rel = p.szablon ? path.relative(p.folder, p.szablon).split(path.sep).join('/') : '';
      p.wc.loadURL(`http://127.0.0.1:${p.port}/karty.html` + (rel ? '?szablon=' + encodeURIComponent(rel) : ''));
    }
  } catch (e) { await przywrocZmiany(p); throw e; }
  odswiezPasek();
  zbudujMenu();
  zapiszZakladki();
  return true;
}

// Ostatnie projekty (menu, ekran startowy) – bez zakładek otwartych w tle przez zlecenia (#90).
function dodajDoOstatnich(szablon) {
  const u = ustawienia();
  u.ostatnie = [szablon, ...(u.ostatnie || []).map(naSzablon).filter((x) => x && x !== szablon)].slice(0, 10);
  zapiszUstawienia(u);
  app.addRecentDocument(szablon);
}

// Plik → Otwórz szablon… (⌘O) i przycisk na ekranie startowym: wybrany plik otwiera się w zakładce
// (pusta zakładka nadawcy – w niej, folder już otwarty – przełączenie, inaczej nowa).
async function wybierzSzablon(w = aktywny) {
  const r = await dialog.showOpenDialog(okno, {
    title: 'Otwórz szablon kart', buttonLabel: 'Otwórz',
    message: 'Wybierz plik szablonu (.txt) – wskazuje on pliki z kartami i obrazki.',
    properties: ['openFile'],
    filters: [{ name: 'Szablon kart', extensions: ['txt'] }],
    defaultPath: w && w.szablon && !jestPrzykladem(w.szablon) ? path.dirname(w.szablon) : app.getPath('documents'),
  });
  if (!r.canceled && r.filePaths[0]) otworzWZakladce(r.filePaths[0], w);
  return !r.canceled;
}

// ── Nowy projekt ────────────────────────────────────────────────────────────
// Folder gry z szablonem startowym (zasoby/szablon-startowy): szablon, karty.csv, ikony, obrazek.
const STARTOWY = path.join(ZASOBY, 'szablon-startowy');
function utworzProjekt(folder) {
  if (fs.existsSync(folder) && fs.readdirSync(folder).some((n) => !n.startsWith('.')))
    throw new Error(`Folder „${path.basename(folder)}” już istnieje i nie jest pusty – wybierz inną nazwę.`);
  const nazwa = path.basename(folder);
  const wCudzyslowie = nazwa.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const wstaw = (t) => t.replace(/\{\{NAZWA_W_CUDZYSLOWIE\}\}/g, () => wCudzyslowie).replace(/\{\{NAZWA\}\}/g, () => nazwa);
  fs.cpSync(STARTOWY, folder, { recursive: true });
  for (const plik of ['Szablony/gra.txt', 'CZYTAJ.txt']) {
    const p = path.join(folder, plik);
    fs.writeFileSync(p, wstaw(fs.readFileSync(p, 'utf8')));
  }
  return path.join(folder, 'Szablony', 'gra.txt');
}

// Nowy projekt otwiera się w zakładce (pusta zakładka nadawcy, inaczej nowa) – folder sprawdzany i tworzony
// przed jakimkolwiek pytaniem o niezapisany edytor, więc nieudane utworzenie nic nie zmienia w otwartych zakładkach.
async function nowyProjekt(w = aktywny) {
  const r = await dialog.showSaveDialog(okno, {
    title: 'Nowy projekt', buttonLabel: 'Utwórz', nameFieldLabel: 'Nazwa gry:',
    message: 'Powstanie folder gry z przykładowym szablonem, plikiem kart i ikonami.',
    defaultPath: path.join(app.getPath('documents'), 'Nowa gra'),
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (r.canceled || !r.filePath) return false;
  let szablon;
  try { szablon = utworzProjekt(r.filePath); }
  catch (e) { dialog.showErrorBox('Nie można utworzyć projektu', e.message); return false; }
  return !!(await otworzWZakladce(szablon, w));
}

const listaPrzykladow = () => {
  try { return fs.readdirSync(PRZYKLADY).filter((n) => !n.startsWith('.') && jestFolderem(path.join(PRZYKLADY, n))).sort(); }
  catch (e) { return []; }
};

// ── PDF ─────────────────────────────────────────────────────────────────────
// Zapis wprost do pliku – w rozmiarze stron z @page (A4 albo rozmiar karty), bez okna drukowania.
// druk (układ Drukarnia, plan z buildPrint): dokładny rozmiar stron, TrimBox i ewentualny podział
// na awersy i rewersy (drukarnia.js) – wtedy wynik to lista plików, inaczej jedna ścieżka.
// druk.cmyk = { plik, nazwa } (profil już rozwiązany – profilDoDruku): każda część przez Ghostscripta (cmyk.js),
// ramki stron jeszcze raz z planu, kontrola wyniku. Pliki zapisywane dopiero, gdy wszystkie części się udały –
// przy błędzie nie powstaje żaden plik (RGB nie udaje CMYK). Wynik wtedy: { pliki, cmyk: { profil, ghostscript, nadrukCzerni, pliki[] } }.
// druk.cmyk.nadruk (#92, domyślnie true): czarny tekst K100 nadrukowany (cmyk.nadrukCzerni) – pliki[].nadruk = liczba obiektów tekstu.
async function pdfDoPliku(webContents, plik, druk) {
  const dane = await webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  if (!druk) { fs.writeFileSync(plik, dane); return plik; }
  const czesci = await drukarnia.przygotujDruk(dane, druk, plik, ZASOBY);
  let raport = null;
  if (druk.cmyk) {
    const gs = cmyk.znajdzGs({ odswiez: true });
    if (!gs.ok) throw new Error(gs.powod);
    if (!druk.cmyk.plik) throw new Error('brak profilu CMYK');
    raport = { profil: druk.cmyk.nazwa, ghostscript: gs.wersja, nadrukCzerni: druk.cmyk.nadruk !== false,
      pdfx: druk.cmyk.pdfx === 'PDF/X-4' ? 'PDF/X-4' : null, limitTAC: druk.cmyk.tac || null, czas: 0, pliki: [] };
    const PDFLib = drukarnia.pdfLib(ZASOBY);
    for (const c of czesci) {
      // PDF/X-4 (#85): po ramkach z planu – Output Intent z profilem konwersji, Info + XMP, PDF 1.6.
      const pdfx = druk.cmyk.pdfx === 'PDF/X-4';
      const w = await cmyk.konwertujBufor(c.bufor, { gs, profil: druk.cmyk.plik, PDFLib, nadruk: druk.cmyk.nadruk !== false,
        po: async (b) => {
          b = await drukarnia.ustawRamki(b, druk, c.indeksy, ZASOBY);
          return pdfx ? cmyk.pdfx4(b, { PDFLib, profil: druk.cmyk.plik, warunek: druk.cmyk.warunek, nazwa: druk.cmyk.nazwa,
            tytul: path.basename(c.plik, '.pdf'), narzedzie: `KarKa ${WERSJA}` }) : b;
        } });
      const k = w.kontrola, nazwa = path.basename(c.plik);
      if (k.strony !== c.strony) throw new Error(`${nazwa}: po konwersji ${k.strony} stron zamiast ${c.strony}`);
      const zle = [k.rgb && `${k.rgb}× kolor RGB w treści`, k.przestrzenieRgb && `${k.przestrzenieRgb}× przestrzeń barw RGB`,
        k.obrazki.inne.length && `obrazki nie w CMYK: ${[...new Set(k.obrazki.inne)].join(', ')}`, k.trimBox !== k.strony && 'brak TrimBox'].filter(Boolean);
      if (zle.length) throw new Error(`kontrola CMYK: ${nazwa} – ${zle.join('; ')}`);
      c.bufor = w.bufor;
      // TAC po konwersji (#85): przekroczenie limitu profilu drukarni = ostrzeżenie, nie blokada.
      const t = await cmyk.zmierzTAC(w.bufor, { gs, limit: raport.limitTAC });
      raport.czas += w.czas;
      raport.pliki.push({ plik: c.plik, ...k, maksTAC: t.maksTAC, stronPonadLimit: t.stronPonadLimit, tacStron: t.strony.map((x) => x.maks), czas: w.czas });
    }
  }
  for (const c of czesci) fs.writeFileSync(c.plik, c.bufor);
  const pliki = czesci.map((c) => c.plik);
  if (raport) {
    raport.maksTAC = Math.max(0, ...raport.pliki.map((x) => x.maksTAC));
    if (raport.limitTAC) raport.stronPonadLimit = raport.pliki.reduce((a, x) => a + x.stronPonadLimit, 0);
  }
  return raport ? { pliki, cmyk: raport } : pliki;
}

// ── CMYK (issue #66, etap 2) ─────────────────────────────────────────────────
// Profil drukarni: klucz (fogra39 / fogra51 – pobierany raz z eci.org do <dane>/profile) albo plik .icc.
// pytaj: okno PDF pyta przed pobraniem; zlecenie pobiera samo. null = użytkownik zrezygnował.
const folderProfili = () => path.join(app.getPath('userData'), 'profile');
async function profilDoDruku(profil, { pytaj, folder }) {
  // Tylko tryb testowy (bez eci.org): KARKA_TEST_PROFIL_KLUCZA = plik .icc w miejsce każdego klucza (iso300, fogra39…) – profile drukarni w teście.
  if (testowy && process.env.KARKA_TEST_PROFIL_KLUCZA && cmyk.czyKlucz(profil || cmyk.DOMYSLNY))
    return { plik: process.env.KARKA_TEST_PROFIL_KLUCZA, nazwa: cmyk.PROFILE[profil || cmyk.DOMYSLNY].nazwa, klucz: profil || cmyk.DOMYSLNY };
  if (profil && !cmyk.czyKlucz(profil) && folder && !path.isAbsolute(profil)) profil = path.resolve(folder, profil);
  const r = cmyk.rozwiazProfil(profil, folderProfili());
  if (r.plik) return r;
  const opis = cmyk.PROFILE[r.brak];
  if (pytaj) {
    const o = await dialog.showMessageBox(okno, { type: 'question', buttons: ['Pobierz', 'Anuluj'], defaultId: 0, cancelId: 1,
      message: `Pobrać profil kolorów ${opis.nazwa} z eci.org?`,
      detail: `Do PDF w CMYK potrzebny jest profil drukarni (paczka ok. ${opis.paczkaMB} MB). Pobierany jest raz i zostaje w danych aplikacji. Możesz też wskazać własny plik .icc w oknie PDF dla drukarni.` });
    if (o.response !== 0) return null;
  }
  try {
    const plik = await cmyk.pobierzProfil(r.brak, folderProfili(), { fetch: pobieraj, zasoby: ZASOBY,
      postep: (u) => { if (okno && !okno.isDestroyed()) okno.setProgressBar(u); } });
    return { plik, nazwa: opis.nazwa, klucz: r.brak };
  } finally { if (okno && !okno.isDestroyed()) okno.setProgressBar(-1); }
}
// Output Intent PDF/X: warunek druku znanego profilu (FOGRA39 / FOGRA51), własny plik .icc – „Custom”.
const warunekProfilu = (prof) => (prof.klucz && cmyk.PROFILE[prof.klucz] && cmyk.PROFILE[prof.klucz].warunek) || 'Custom';
// Profile drukarni (#85, etap 2): wbudowane z drukarnie/*.json obok kodu, „Własne ustawienia” w danych aplikacji.
ipcMain.handle('drukarnie:lista', () => ({ wbudowane: drukarnie.wbudowane(), wlasne: drukarnie.wlasne(app.getPath('userData')) }));
ipcMain.handle('drukarnie:zapiszWlasne', (e, p) => drukarnie.zapiszWlasne(app.getPath('userData'), p));
// Stan do okna PDF dla drukarni: Ghostscript (opcja wyszarzona bez niego) i które profile są już pobrane.
ipcMain.handle('cmyk:stan', () => ({ gs: cmyk.znajdzGs({ odswiez: true }),
  profile: Object.fromEntries(Object.entries(cmyk.PROFILE).map(([k, p]) => [k, { nazwa: p.nazwa, pobrany: !!cmyk.profilLokalny(k, folderProfili()), paczkaMB: p.paczkaMB }])) }));
ipcMain.handle('cmyk:wybierzProfil', async () => {
  const r = await dialog.showOpenDialog(okno, { title: 'Profil kolorów drukarni (CMYK)', properties: ['openFile'], filters: [{ name: 'Profil ICC', extensions: ['icc', 'icm'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { return cmyk.sprawdzPlikIcc(r.filePaths[0]); }
  catch (e) { await dialog.showMessageBox(okno, { type: 'warning', message: 'Tego pliku nie da się użyć', detail: e.message }); return null; }
});

ipcMain.handle('projekt:info', (e) => {
  const p = projektZ(e);
  return { auto: ustawienia().auto !== false, szablon: p.szablon, sciezka: p.folder, nazwa: p.nazwa, przyklad: jestPrzykladem(p.szablon) };
});
ipcMain.handle('projekt:otworz', (e) => wybierzSzablon(projektZ(e)));
ipcMain.handle('edytor:zapisz', (e, tekst) => {
  const p = projektZ(e);
  zapiszSzablonNaDysk(p, tekst); p.zmiany = false;
  p.odczytajTytul();                                        // PROJEKT = mógł się zmienić – nazwa zakładki
  if (p === aktywny) odswiezOkno();
  odswiezPasek(); zbudujMenu();
  return true;
});
ipcMain.handle('edytor:zmiany', (e, czy) => {
  const p = projektZ(e);
  p.zmiany = !!czy;
  if (p === aktywny && okno) okno.setDocumentEdited(p.zmiany);
  odswiezPasek();
});
ipcMain.handle('projekt:nowy', (e) => nowyProjekt(projektZ(e)));
ipcMain.handle('projekt:przyklady', () => listaPrzykladow());
ipcMain.handle('projekt:przyklad', (e, nazwa) => {
  const p = projektZ(e), dir = path.join(PRZYKLADY, path.basename(String(nazwa)));
  if (jestFolderem(dir)) otworzWZakladce(dir, p);
});
ipcMain.handle('projekt:pokaz', (e) => { const p = projektZ(e); if (p.folder) shell.openPath(p.folder); });

// ── Eksport JPG do folderu Export ───────────────────────────────────────────
// Przykłady są tylko do odczytu – wtedy pytamy, gdzie zapisać.
// cel: undefined = Export, 'katalog' = Export/katalog, 'zlecenie' = .generator/katalog (czyszczony).
ipcMain.handle('eksport:start', async (e, cel) => {
  const p = projektZ(e);
  const pod = cel === 'katalog' ? ['katalog'] : [];
  if (cel === 'zlecenie') {
    if (!p.zapisywalny) return null;
    p.folderEksportu = path.join(p.folder, '.generator', 'katalog');   // nie w zlecenia/ – tam plik zlecenia „katalog”
    fs.rmSync(p.folderEksportu, { recursive: true, force: true });
  } else if (p.zapisywalny) p.folderEksportu = path.join(p.folder, 'Export', ...pod);
  else {
    const r = await dialog.showOpenDialog(okno, {
      title: 'Gdzie zapisać obrazki?', buttonLabel: 'Wybierz', properties: ['openDirectory', 'createDirectory'],
      defaultPath: app.getPath('documents'),
    });
    if (r.canceled || !r.filePaths[0]) return null;
    p.folderEksportu = path.join(r.filePaths[0], 'Export', ...pod);
  }
  fs.mkdirSync(p.folderEksportu, { recursive: true });
  return p.folderEksportu;
});
ipcMain.handle('eksport:plik', (e, nazwa, dane) => {
  const p = projektZ(e);
  if (!p.folderEksportu) throw new Error('Eksport nie został rozpoczęty');
  fs.writeFileSync(path.join(p.folderEksportu, path.basename(String(nazwa))), Buffer.from(dane));
});
ipcMain.handle('eksport:koniec', (e) => { const p = projektZ(e); if (p.folderEksportu && !testowy) shell.openPath(p.folderEksportu); });
// Eksport playingcards.io: plik .pcio w folderze projektu (przykłady – okno zapisu).
ipcMain.handle('pcio:zapisz', async (e, nazwa, dane) => {
  const p = projektZ(e);
  let plik;
  const czysta = path.basename(String(nazwa || 'karty.pcio')).replace(/[\\/:*?"<>|]+/g, '_');
  if (p.zapisywalny) plik = path.join(p.folder, czysta);
  else {
    const r = await dialog.showSaveDialog(okno, { title: 'Zapisz pokój playingcards.io',
      defaultPath: path.join(app.getPath('documents'), czysta), filters: [{ name: 'playingcards.io', extensions: ['pcio'] }] });
    if (r.canceled || !r.filePath) return null;
    plik = r.filePath;
  }
  fs.writeFileSync(plik, Buffer.from(dane));
  return plik;
});
ipcMain.handle('pdf:zapisz', async (e, nazwa, druk) => {
  const p = projektZ(e);
  // CMYK: Ghostscript i profil przed oknem zapisu (bez nich nie pytamy o nazwę pliku).
  if (druk && druk.cmyk) {
    try {
      const gs = cmyk.znajdzGs({ odswiez: true });
      if (!gs.ok) throw new Error(gs.powod);
      const prof = await profilDoDruku(druk.cmyk.profil, { pytaj: !testowy, folder: p.folder });
      if (!prof) return null;
      druk = { ...druk, cmyk: { ...druk.cmyk, plik: prof.plik, nazwa: prof.nazwa, warunek: warunekProfilu(prof) } };
    } catch (er) {
      if (!testowy) await dialog.showMessageBox(okno, { type: 'warning', message: 'PDF w CMYK nie powstał', detail: er.message });
      throw er;
    }
  }
  const katalog = p.zapisywalny ? p.folder : app.getPath('documents');
  const r = await dialog.showSaveDialog(okno, {
    title: 'Zapisz PDF', defaultPath: path.join(katalog, `${nazwa || 'karty'}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return pdfDoPliku(e.sender, r.filePath, druk);
});

// ── Odciski kart z ostatniego PDF (druk tylko zmienionych, porównanie) ──────
// Jeden plik JSON na szablon w danych aplikacji – folder projektu zostaje czysty, działa też dla przykładów.
const plikWDanych = (folder, p) => p.szablon && path.join(app.getPath('userData'), folder,
  require('crypto').createHash('sha1').update(p.szablon).digest('hex').slice(0, 16) + '.json');
const plikOdciskow = (p) => plikWDanych('odciski', p);
// Ostatnie ustawienia okien druku i eksportu – osobno dla każdego szablonu.
const plikUstawienEksportu = (p) => plikWDanych('eksport', p);
ipcMain.handle('eksport:ustawienia', (e) => {
  try { return JSON.parse(fs.readFileSync(plikUstawienEksportu(projektZ(e)), 'utf8')); } catch (er) { return {}; }
});
ipcMain.handle('eksport:zapiszUstawienia', (e, dane) => {
  const p = plikUstawienEksportu(projektZ(e)); if (!p) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(dane || {}, null, 1));
  return true;
});
ipcMain.handle('druk:odciski', (e) => {
  try { return JSON.parse(fs.readFileSync(plikOdciskow(projektZ(e)), 'utf8')); } catch (er) { return null; }
});
ipcMain.handle('druk:zapiszOdciski', (e, dane) => {
  const p = plikOdciskow(projektZ(e)); if (!p) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(dane));
  return true;
});

// ── Historia wersji (folder .historia w projekcie; przykłady – bez historii) ─
ipcMain.handle('historia:zapisz', (e, pliki, punkt) => {
  const p = projektZ(e);
  return p.zapisywalny ? historia.zapisz(p.folder, (pliki || []).map(String), punkt || null) : 0;
});
ipcMain.handle('historia:lista', (e) => { const p = projektZ(e); return p.zapisywalny ? historia.wczytajIndeks(p.folder) : null; });
ipcMain.handle('historia:stan', (e, czas) => {
  const p = projektZ(e);
  return p.zapisywalny ? historia.stan(p.folder, Number(czas)).map((s) => ({ plik: s.plik, dane: new Uint8Array(s.dane) })) : [];
});
// Zamknięcie projektu (inny szablon, koniec aplikacji): kopia plików, które zmieniły się od ostatniej kopii.
// Pliki = te, które historia już śledzi (przy otwarciu projektu kopiowane są wszystkie).
function historiaZamkniecie(p) {
  if (!p || !p.zapisywalny) return;
  try {
    const pliki = [...new Set(historia.wczytajIndeks(p.folder).wersje.map((v) => v.plik))];
    if (pliki.length) historia.zapisz(p.folder, pliki, { powod: 'zamknięcie', etykieta: 'zamknięcie projektu', jesliZmiany: true });
  } catch (e) { /* bez kopii – nie blokujemy zamykania */ }
}
// Skrzynka (.historia/przychodzace) – punkty od innych narzędzi, np. Claude; sprawdzana co 3 s w każdym projekcie.
setInterval(() => {
  for (const p of projekty) {
    if (!p.zapisywalny || !p.wc) continue;
    try { if (historia.sprawdzSkrzynke(p.folder)) p.wc.send('historia:zmiana'); } catch (e) { /* spróbujemy za chwilę */ }
  }
}, 3000);
// Zlecenia z pliku (np. od Claude): .generator/zlecenia/<polecenie> w folderze otwartego projektu.
// Polecenia: katalog, stan, raport, pdf, obrazki, pcio. Treść (opcjonalnie): wiersze „klucz = wartość”
// (puste wiersze i komentarze # / ; pomijane). Otwarta aplikacja wykonuje zlecenia po kolei (jedno naraz,
// wspólna kolejka dla wszystkich projektów), usuwa plik zlecenia i zapisuje wynik-<polecenie>.json
// (katalog także dawny wynik.json).
const FOLDER_ZLECEN = ['.generator', 'zlecenia'];
const POLECENIA = ['katalog', 'stan', 'raport', 'pdf', 'obrazki', 'pcio'];
let kolejkaZlecen = false;           // trwa przegląd zleceń (wszystkie projekty po kolei)
function czytajZlecenie(tekst) {
  const o = {};
  for (const w of String(tekst).replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*([#;]|$)/.test(w)) continue;
    const m = /^\s*([^=:]+?)\s*[=:]\s*(.*?)\s*$/.exec(w);
    if (m) o[m[1]] = m[2];
  }
  return o;
}
const plain = (k) => String(k).trim().toLowerCase();
const realna = (d) => { try { return fs.realpathSync(d); } catch (e) { return path.resolve(d); } };
const STAN = { kolejka: 0, ostatnie: null };       // do pliku stanu (stan.json): zlecenia czekające i ostatnie wykonane
// Wynik zlecenia (wynik-<polecenie>.json; katalog też dawny wynik.json – zgodność z v0.4.6–0.4.10).
function plikiWyniku(folderZl, polecenie) {
  const w = [path.join(folderZl, `wynik-${polecenie}.json`)];
  if (polecenie === 'katalog') w.push(path.join(folderZl, 'wynik.json'));
  return w;
}
// Zlecenie zakończone bez wykonania (zaległe, limit zakładek, brak szablonu…): plik zlecenia znika (albo został
// odłożony), wynik ok: false z opisem – zlecenie nigdy nie zostaje bez wyniku (#90).
function wynikBezWykonania(folder, polecenie, blad, dodatki = {}, p = null) {
  const folderZl = path.join(folder, ...FOLDER_ZLECEN);
  const wynik = { zlecenie: polecenie, czas: new Date().toISOString(), szablon: p && p.szablon ? path.relative(p.folder, p.szablon) : null,
    wersjaAplikacji: WERSJA, zakladka: p ? rodzajZakladki(p) : null, ok: false, pliki: [], blad, ...dodatki };
  try {
    fs.rmSync(path.join(folderZl, polecenie), { force: true });
    for (const w of plikiWyniku(folderZl, polecenie)) fs.writeFileSync(w, JSON.stringify(wynik, null, 1));
  } catch (e) { /* trudno – folder zniknął */ }
  STAN.ostatnie = { polecenie, folder, czas: wynik.czas, ok: false, blad };
  zapiszStan();
  return wynik;
}
// Zaległe zlecenie (#90, pkt 4): plik starszy niż 10 min (mtime) nie jest wykonywany, tylko przenoszony do
// .generator/zlecenia/przeterminowane/<RRRR-MM-DD-GG-MM>-<polecenie> (czas zlecenia; KarKa tego folderu nie czyta).
// Działa w zakładce aktywnej, w tle, w folderze bez zakładki i przy starcie. Zwraca true, gdy zlecenia nie wykonujemy.
const dwa = (n) => String(n).padStart(2, '0');
function odlozZalegle(folder, polecenie, p = null) {
  const folderZl = path.join(folder, ...FOLDER_ZLECEN), plik = path.join(folderZl, polecenie);
  let st;
  try { st = fs.statSync(plik); } catch (e) { return false; }
  if (!st.isFile() || Date.now() - st.mtimeMs <= ZALEGLE_MS) return false;
  const d = new Date(st.mtimeMs), baza = `${d.getFullYear()}-${dwa(d.getMonth() + 1)}-${dwa(d.getDate())}-${dwa(d.getHours())}-${dwa(d.getMinutes())}-${polecenie}`;
  const kat = path.join(folderZl, 'przeterminowane');
  let cel = path.join(kat, baza);
  try {
    fs.mkdirSync(kat, { recursive: true });
    for (let i = 2; fs.existsSync(cel); i++) cel = path.join(kat, `${baza}-${i}`);
    fs.renameSync(plik, cel);
  } catch (e) { return true; }                            // nie da się przenieść – i tak nie wykonujemy, spróbujemy później
  const rel = path.relative(folder, cel).split(path.sep).join('/');
  const kiedy = `${d.getFullYear()}-${dwa(d.getMonth() + 1)}-${dwa(d.getDate())} ${dwa(d.getHours())}:${dwa(d.getMinutes())}`;
  wynikBezWykonania(folder, polecenie, `zaległe zlecenie z ${kiedy} (starsze niż ${ZALEGLE_MS / 60000} min) – nie wykonane, odłożone do ${rel}`,
    { przeterminowane: rel }, p);
  if (p && p.wc) p.wc.executeJavaScript(`status(${JSON.stringify(`Zaległe zlecenie „${polecenie}” z ${kiedy} – nie wykonane, odłożone do ${rel}`)})`).catch(() => {});
  return true;
}
// Klucz „szablon = …” w zleceniu (#90, pkt 2; ta sama reguła co w #54): ścieżka względem Szablony/ projektu.
function szablonZKlucza(folder, wartosc) {
  const v = String(wartosc || '').trim().replace(/^"(.*)"$/, '$1').trim();
  const kat = path.join(folder, 'Szablony');
  let plik = path.resolve(kat, v);
  if (!/\.txt$/i.test(plik) && !jestPlikiem(plik)) plik += '.txt';
  const rel = path.relative(kat, plik);
  if (!v || rel.startsWith('..') || path.isAbsolute(rel) || !jestPlikiem(plik)) throw new Error(`szablon: nie ma pliku „${v}” w folderze Szablony/ projektu`);
  return plik;
}
// Szablon dla projektu bez zakładki: klucz szablon =, ostatni szablon tego folderu z „Ostatnich projektów”,
// jedyny albo pierwszy alfabetycznie .txt w Szablony/ (bez plików od „_”). Brak – błąd (wynik ok: false).
function szablonDlaZlecenia(folder, klucz) {
  if (klucz) return szablonZKlucza(folder, klucz);
  const real = realna(folder);
  const z = ostatnie().find((s) => realna(folderProjektu(s)) === real);
  if (z) return z;
  const kat = path.join(folder, 'Szablony');
  let t = [];
  try { t = fs.readdirSync(kat).filter((n) => /\.txt$/i.test(n) && !n.startsWith('_') && !n.startsWith('.') && jestPlikiem(path.join(kat, n))); } catch (e) { /* brak folderu */ }
  t.sort((a, b) => a.localeCompare(b, 'pl'));
  if (t.length) return path.join(kat, t[0]);
  throw new Error('brak szablonu: w folderze Szablony/ projektu nie ma pliku .txt');
}
// Strona przyjmuje zlecenia: wczytana, zbudowana i z bieżącym szablonem projektu (po podmianie szablonu loadURL
// nie czeka na nawigację – stara strona ma jeszcze zbudowano = true; przegląd PR #117).
function stronaGotowa(p) {
  if (!p.wc) return Promise.resolve(false);
  const rel = p.szablon ? path.relative(p.folder, p.szablon).split(path.sep).join('/') : '';
  return p.wc.executeJavaScript(`!!(window.wykonajZlecenie && window.zbudowano) && (new URLSearchParams(location.search).get('szablon') || '') === ${JSON.stringify(rel)}`).catch(() => false);
}
// Czekanie na stronę po otwarciu zakładki w tle albo podmianie szablonu.
async function czekajNaStrone(p, ms = 60000) {
  for (let t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 100))) {
    if (!p.wc || !projekty.includes(p)) return false;
    if (await stronaGotowa(p)) return true;
  }
  return false;
}
async function wykonajPlikZlecenia(p, polecenie) {
  const folder = path.join(p.folder, ...FOLDER_ZLECEN), plik = path.join(folder, polecenie);
  if (odlozZalegle(p.folder, polecenie, p)) return false;
  let tekst;
  try { if (!fs.statSync(plik).isFile()) return false; tekst = fs.readFileSync(plik, 'utf8'); } catch (e) { return false; }
  const surowe = czytajZlecenie(tekst);
  // Klucz szablon = (zdejmowany przed stroną – to nie opcja polecenia). Zakładka ze zlecenia bez zmian – podmiana
  // szablonu; zakładka właściciela z innym szablonem – błąd, bez podmiany (niczego nie przełączamy pod ręką).
  const klucz = Object.keys(surowe).find((k) => plain(k) === 'szablon');
  if (klucz !== undefined) {
    const v = surowe[klucz];
    delete surowe[klucz];
    let sz;
    try { sz = szablonZKlucza(p.folder, v); } catch (e) { wynikBezWykonania(p.folder, polecenie, e.message, {}, p); return true; }
    if (realna(sz) !== realna(p.szablon || '')) {
      if (!(p.zeZlecenia && p !== aktywny && !p.zmiany)) {
        wynikBezWykonania(p.folder, polecenie, `projekt jest otwarty z innym szablonem (${path.relative(p.folder, p.szablon)}) – zlecenie z kluczem szablon = ${v} nie podmienia szablonu w zakładce`, {}, p);
        return true;
      }
      await otworzSzablon(sz, p);
      await czekajNaStrone(p);
      if (!p.wc || !projekty.includes(p)) return false;     // zakładkę zamknięto w trakcie – zlecenie zostaje na następny przegląd
    }
  }
  // Strona jeszcze się wczytuje – spróbujemy przy następnym sprawdzeniu.
  if (!(await stronaGotowa(p))) return false;
  const wyniki = plikiWyniku(folder, polecenie);
  const naglowek = { zlecenie: polecenie, czas: new Date().toISOString(), szablon: p.szablon && path.relative(p.folder, p.szablon), wersjaAplikacji: WERSJA, zakladka: rodzajZakladki(p) };
  let wynik;
  // Zakładka w tle: na czas zlecenia bez dławienia – strona „widoczna”, klatki (requestAnimationFrame) idą jak w aktywnej.
  const wTle = p !== aktywny;
  if (wTle && p.wc) p.wc.setBackgroundThrottling(false);
  zlecenieTrwa(p, true);
  try {
    wyniki.forEach((w) => fs.rmSync(w, { force: true }));
    const w = await p.wc.executeJavaScript(`wykonajZlecenie(${JSON.stringify(polecenie)}, ${JSON.stringify(surowe)})`);
    wynik = { ...naglowek, ok: false, pliki: [], blad: null, ...w };
    const wzgledna = (x) => (typeof x === 'string' && path.isAbsolute(x) ? path.relative(p.folder, x) : x);
    wynik.pliki = (wynik.pliki || []).map(wzgledna);
    if (wynik.folder) wynik.folder = wzgledna(wynik.folder);
  } catch (e) {
    wynik = { ...naglowek, ok: false, pliki: [], blad: String((e && e.message) || e) };
  } finally {
    zlecenieTrwa(p, false);
    p.ostatnieZlecenie = Date.now();
    if (p !== aktywny && p.wc) p.wc.setBackgroundThrottling(true);   // także zakładka schowana w trakcie zlecenia (pokazProjekt jej nie dławi)
  }
  try {
    fs.rmSync(plik, { force: true });                     // najpierw zlecenie – plik wyniku = koniec pracy
    for (const w of wyniki) fs.writeFileSync(w, JSON.stringify(wynik, null, 1));
  } catch (e) { /* trudno – folder zniknął */ }
  STAN.ostatnie = { polecenie, folder: p.folder, czas: wynik.czas, ok: !!wynik.ok, blad: wynik.blad || null };
  zapiszStan();
  return true;
}
// Znak „trwa zlecenie” tylko przy prawdziwym zleceniu (nie przez cały przegląd folderu) – kropka w pasku nie miga.
function zlecenieTrwa(p, czy) {
  if (p.zlecenieTrwa === czy) return;
  p.zlecenieTrwa = czy;
  odswiezPasek();
}
// Zlecenia czekające w folderze projektu (pliki poleceń z POLECENIA).
const oczekujace = (folder) => POLECENIA.filter((pol) => jestPlikiem(path.join(folder, ...FOLDER_ZLECEN, pol)));

// ── Folder z projektami (#90, pkt 1) ────────────────────────────────────────
// Ustawienie folderProjektow (domyślnie brak = wyłączone). Przegląd <folder>/*/ i jeden poziom niżej – tylko foldery,
// które po realpath leżą wewnątrz folderu (dowiązanie na zewnątrz jest pomijane); przykłady i projekty otwarte w zakładkach
// pomijane (ich zlecenia wykonuje przegląd zakładek).
const POMIJANE_FOLDERY = new Set(['szablony', 'export', 'ikony', 'icons', 'node_modules']);
function folderyZeZleceniami() {
  const korzen = ustawienia().folderProjektow;
  if (!korzen) return [];
  let kr;
  try { kr = fs.realpathSync(korzen); } catch (e) { return []; }
  const otwarte = new Set(projekty.filter((p) => p.folder).map((p) => realna(p.folder)));
  const wynik = [], byly = new Set();
  const podfoldery = (d) => { try { return fs.readdirSync(d).filter((n) => !n.startsWith('.') && !n.startsWith('_') && !POMIJANE_FOLDERY.has(n.toLowerCase())); } catch (e) { return []; } };
  const sprawdz = (d, poziom) => {
    let real;
    try { real = fs.realpathSync(d); } catch (e) { return; }
    if (!real.startsWith(kr + path.sep) || byly.has(real) || !jestFolderem(real)) return;
    byly.add(real);
    if (!jestPrzykladem(real) && !otwarte.has(real)) { const l = oczekujace(real); if (l.length) wynik.push({ folder: real, lista: l }); }
    if (poziom < 2) for (const n of podfoldery(real)) sprawdz(path.join(real, n), poziom + 1);
  };
  for (const n of podfoldery(kr)) sprawdz(path.join(kr, n), 1);
  return wynik;
}
// Projekt bez zakładki: zakładka w tle (dopisana z prawej, aktywna bez zmian). Przy limicie zamykana jest najdawniej
// używana nieprzejęta zakładka ze zlecenia bez zmian; gdy takiej nie ma – błąd „limit zakładek” bez okna (pkt 3).
async function otworzWTle(folder, klucz) {
  const szablon = szablonDlaZlecenia(folder, klucz);
  if (projekty.length >= LIMIT_ZAKLADEK) {
    const k = projekty.filter((x) => x.zeZlecenia && x !== aktywny && !x.zmiany && !x.zlecenieTrwa).sort((a, b) => a.ostatnieZlecenie - b.ostatnieZlecenie)[0];
    if (!k || !(await zamknijZakladke(k))) throw new Error('limit zakładek');
  }
  const p = await new Projekt().uruchom();
  p.zeZlecenia = true;
  if (aktywny && aktywny.widok) p.widok.setBounds(aktywny.widok.getBounds());   // rozmiar strony jak w oknie, choć widok nie jest przypięty
  p.wc.setBackgroundThrottling(false);                     // wczytanie i pierwsza budowa kart bez ściśniętych timerów
  try {
    await otworzSzablon(szablon, p);
    if (!(await czekajNaStrone(p))) throw new Error('strona projektu nie wczytała się w 60 s');
  } catch (e) {
    if (projekty.includes(p)) await zamknijZakladke(p);    // bez pustej zakładki zajmującej miejsce w limicie
    throw e;
  } finally { if (p.wc && p !== aktywny) p.wc.setBackgroundThrottling(true); }
  return p;
}
async function zleceniaZFolderuProjektow(foldery) {
  for (const { folder } of foldery) {
    const swieze = oczekujace(folder).filter((pol) => !odlozZalegle(folder, pol));
    if (!swieze.length || projekty.some((p) => p.folder && realna(p.folder) === folder)) continue;
    let klucz = null;
    for (const pol of swieze) {
      try {
        const o = czytajZlecenie(fs.readFileSync(path.join(folder, ...FOLDER_ZLECEN, pol), 'utf8'));
        const k = Object.keys(o).find((x) => plain(x) === 'szablon');
        if (k !== undefined) { klucz = o[k]; break; }
      } catch (e) { /* zlecenie zniknęło */ }
    }
    let p;
    try { p = await otworzWTle(folder, klucz); }
    catch (e) { for (const pol of swieze) wynikBezWykonania(folder, pol, String((e && e.message) || e)); continue; }
    for (const pol of POLECENIA) if (p.wc && projekty.includes(p)) await wykonajPlikZlecenia(p, pol);
  }
}
// Samozamykanie: nieprzejęta zakładka ze zlecenia, nieaktywna, bez zmian i bez zlecenia, 15 min po ostatnim zleceniu.
async function zamknijBezczynne() {
  const limit = TEST.bezczynnosc != null ? TEST.bezczynnosc : BEZCZYNNOSC_MS;
  for (const p of [...projekty]) {
    if (p.zeZlecenia && p !== aktywny && !p.zmiany && !p.zlecenieTrwa && Date.now() - p.ostatnieZlecenie > limit) await zamknijZakladke(p);
  }
}
// Przegląd: zakładki po kolei, potem „Folder z projektami”, potem samozamykanie. Wywołanie w trakcie przeglądu
// (np. test zaraz po zapisie pliku zlecenia – #102) nie przepada: przegląd powtarza się od razu po końcu.
let ponownie = false;
async function sprawdzZlecenia() {
  if (!okno) return;
  if (kolejkaZlecen) { ponownie = true; return; }
  kolejkaZlecen = true;
  try {
    do {
      ponownie = false;
      const otwarte = projekty.filter((p) => p.zapisywalny && p.wc);
      const zFolderu = przywracanie || !aktywny ? [] : folderyZeZleceniami();   // przy starcie – po przywróceniu zakładek
      STAN.kolejka = otwarte.reduce((n, p) => n + oczekujace(p.folder).length, 0) + zFolderu.reduce((n, f) => n + f.lista.length, 0);
      zapiszStan();
      // Błąd w jednym projekcie (np. zakładka zamknięta w trakcie) nie zatrzymuje przeglądu pozostałych.
      for (const p of otwarte) {
        if (!projekty.includes(p) || !p.zapisywalny || !p.wc) continue;
        try {
          await zlecenieAktualizacji(p);
          for (const pol of POLECENIA) if (projekty.includes(p) && p.zapisywalny && p.wc) await wykonajPlikZlecenia(p, pol);
        } catch (e) { /* spróbujemy przy następnym przeglądzie */ }
      }
      try { await zleceniaZFolderuProjektow(zFolderu); } catch (e) { /* jw. */ }
      try { await zamknijBezczynne(); } catch (e) { /* jw. */ }
    } while (ponownie);
  } finally { kolejkaZlecen = false; STAN.kolejka = 0; zapiszStan(); }
}
setInterval(sprawdzZlecenia, 3000);

// ── Plik stanu dla programów z zewnątrz (#90, pkt 7 – decyzja 27.10.2026) ────────────────────────────────────
// <dane aplikacji>/stan.json (na Macu ~/Library/Application Support/KarKa/stan.json): wersja, pid, zakładki z rodzajem,
// zlecenia czekające w ostatnim przeglądzie i ostatnie zlecenie. Zapis przy zmianie, nie częściej niż co 2 s
// (przez plik tymczasowy – czytający nie trafi na połowę pliku); przy wyjściu dziala: false.
const plikStanu = () => path.join(app.getPath('userData'), 'stan.json');
const ZAPIS_STANU = { czas: 0, timer: null };
function trescStanu(dziala = true) {
  return { dziala, wersja: WERSJA, pid: process.pid, czas: new Date().toISOString(), folderProjektow: ustawienia().folderProjektow || null,
    zakladki: projekty.filter((p) => p.szablon).map((p) => ({ nazwa: p.nazwaZakladki, folder: p.folder, szablon: p.szablon, rodzaj: rodzajZakladki(p),
      zmiany: !!p.zmiany, zlecenie: !!p.zlecenieTrwa })),
    kolejka: STAN.kolejka, ostatnieZlecenie: STAN.ostatnie };
}
function zapiszStanTeraz(dziala = true) {
  if (!app.hasSingleInstanceLock()) return;                // drugi proces (zaraz się zamknie) nie nadpisuje stanu działającej KarKi
  ZAPIS_STANU.czas = Date.now();
  try {
    const plik = plikStanu();
    fs.mkdirSync(path.dirname(plik), { recursive: true });
    fs.writeFileSync(plik + '.tmp', JSON.stringify(trescStanu(dziala), null, 1));
    fs.renameSync(plik + '.tmp', plik);
  } catch (e) { /* bez pliku stanu aplikacja nadal działa */ }
}
function zapiszStan() {
  if (ZAPIS_STANU.timer) return;
  ZAPIS_STANU.timer = setTimeout(() => { ZAPIS_STANU.timer = null; zapiszStanTeraz(); }, Math.max(0, 2000 - (Date.now() - ZAPIS_STANU.czas)));
}
app.on('will-quit', () => { clearTimeout(ZAPIS_STANU.timer); ZAPIS_STANU.timer = null; zapiszStanTeraz(false); });

// KarKa → Folder z projektami → Wybierz… / Wyłącz.
async function wybierzFolderProjektow() {
  const u = ustawienia();
  const r = await dialog.showOpenDialog(okno, { title: 'Folder z projektami', buttonLabel: 'Wybierz',
    message: 'Zlecenia z plików w projektach z tego folderu (i jeden poziom niżej) wykonują się w zakładkach w tle.',
    defaultPath: u.folderProjektow || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  ustawFolderProjektow(r.filePaths[0]);
}
function ustawFolderProjektow(folder) {
  const u = ustawienia();
  if (folder) u.folderProjektow = folder; else delete u.folderProjektow;
  zapiszUstawienia(u);
  zbudujMenu();
  zapiszStan();
}
// PDF ze zlecenia: zapis bez okna, tylko w folderze projektu (domyślna nazwa jak przy ręcznym zapisie).
ipcMain.handle('zlecenie:pdf', async (e, nazwa, druk) => {
  const p = projektZ(e);
  if (!p.zlecenieTrwa || !p.zapisywalny) throw new Error('zapis PDF bez okna działa tylko w zleceniu z pliku');
  let cel = path.resolve(p.folder, String(nazwa || 'karty.pdf'));
  if (!/\.pdf$/i.test(cel)) cel += '.pdf';
  const rel = path.relative(p.folder, cel);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('plik PDF musi być w folderze projektu');
  fs.mkdirSync(path.dirname(cel), { recursive: true });
  if (druk && druk.cmyk) {
    const gs = cmyk.znajdzGs({ odswiez: true });
    if (!gs.ok) throw new Error(gs.powod);
    const prof = await profilDoDruku(druk.cmyk.profil, { pytaj: false, folder: p.folder });
    druk = { ...druk, cmyk: { ...druk.cmyk, plik: prof.plik, nazwa: prof.nazwa, warunek: warunekProfilu(prof) } };
  }
  return pdfDoPliku(e.sender, cel, druk);
});
ipcMain.handle('historia:przywroc', (e, czas) => {
  const p = projektZ(e);
  if (!p.zapisywalny) return { blad: 'Przykłady nie mają historii.' };
  if (p.zmiany) return { blad: 'Najpierw zapisz albo cofnij zmiany w edytorze szablonu.' };
  return { zmienione: historia.przywroc(p.folder, Number(czas)) };
});

// ── Aktualizacje ─────────────────────────────────────────────────────────────
// Sprawdzanie: przy starcie (bez komunikatu, gdy brak nowej wersji albo internetu), z menu
// (KarKa → Sprawdź aktualizacje…) i zleceniem z pliku .generator/zlecenia/aktualizacja.
// Mała aktualizacja = nakładka kodu (restart), pełna = podmiana aplikacji po zamknięciu (aktualizacje.js).
const AKT = { trwa: false, podmiana: null };     // podmiana: { nowa, stara, wersja } – czeka na zamknięcie aplikacji
const MB = (b) => (b / 1048576).toLocaleString('pl-PL', { maximumFractionDigits: b < 10485760 ? 1 : 0 }) + ' MB';
const pobieraj = (u, o) => net.fetch(u, o);
const okienko = (o) => (okno ? dialog.showMessageBox(okno, o) : dialog.showMessageBox(o));
const postepAktualizacji = (f) => { if (okno) okno.setProgressBar(f == null ? -1 : f); };
const niezapisane = () => projekty.some((p) => p.zmiany);

function sprawdzWydanie() {
  return aktualizacje.sprawdz({ wersja: WERSJA, electron: process.versions.electron, fetch: pobieraj });
}
// Pobranie i instalacja według wyniku sprawdzWydanie(). Mała – od razu do <dane>/kod; pełna – nowa .app
// czeka na zamknięcie (AKT.podmiana).
async function zainstalujAktualizacje(info) {
  AKT.trwa = true; zbudujMenu();
  try {
    const dane = app.getPath('userData'), opcje = { fetch: pobieraj, postep: postepAktualizacji };
    if (info.rodzaj === 'kod') { await aktualizacje.zainstalujKod(info, dane, opcje); return; }
    const stara = aktualizacje.folderAplikacji();
    if (!aktualizacje.moznaPodmienic(stara)) throw new Error(stara ? `Brak prawa zapisu w folderze ${path.dirname(stara)}.` : 'Aplikacja nie działa z paczki .app.');
    AKT.podmiana = { nowa: await aktualizacje.przygotujPelna(info, dane, opcje), stara, wersja: info.najnowsza };
  } finally { AKT.trwa = false; postepAktualizacji(null); zbudujMenu(); }
}
function uruchomPodmiane(uruchom) {
  const p = AKT.podmiana;
  if (!p) return;
  AKT.podmiana = null;
  aktualizacje.uruchomPodmiane(aktualizacje.zaplanujPodmiane({ nowa: p.nowa, stara: p.stara, uruchom, dane: app.getPath('userData') }));
}
// Zamknięcie i start nowej wersji (bez pytania – niezapisany szablon sprawdza wcześniej wywołujący).
function zrestartuj() {
  projekty.forEach((p) => { p.zmiany = false; });
  if (AKT.podmiana) uruchomPodmiane(true); else app.relaunch();
  app.quit();
}
app.on('will-quit', () => uruchomPodmiane(false));         // pełna aktualizacja bez restartu – podmiana przy wyjściu

async function sprawdzAktualizacje({ cicho }) {
  if (AKT.trwa || testowy) return;
  let info;
  AKT.trwa = true;
  try { info = await sprawdzWydanie(); }
  catch (e) {
    if (!cicho) okienko({ type: 'warning', message: 'Nie udało się sprawdzić aktualizacji.', detail: String((e && e.message) || e) });
    return;
  } finally { AKT.trwa = false; }
  const u = ustawienia();
  if (!info.dostepna) { if (!cicho) okienko({ type: 'info', message: `Masz najnowszą wersję (${WERSJA}).` }); return; }
  if (cicho && u.pominWersje === info.najnowsza) return;
  if (AKT.podmiana && AKT.podmiana.wersja === info.najnowsza) {
    const r = await okienko({ type: 'info', buttons: ['Uruchom ponownie', 'Później'], defaultId: 0, cancelId: 1,
      message: `Wersja ${info.najnowsza} jest pobrana.`, detail: 'Aplikacja podmieni się po zamknięciu.' });
    if (r.response === 0 && await czyMoznaPorzucicWszystkie()) zrestartuj();
    return;
  }
  const opis = info.opis.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s*by @\S+ in https?:\S+/, '').trim())
    .filter((l) => l && !/^#+\s*(What's Changed|Full Changelog)|^\*\*Full Changelog/.test(l)).slice(0, 10).join('\n');
  const jak = info.rodzaj === 'kod'
    ? `Mała aktualizacja: ${MB(info.rozmiar)}. Aplikacja uruchomi się ponownie.`
    : `Pełna aktualizacja (nowa wersja silnika Electron): ${MB(info.rozmiar)}. Po pobraniu aplikacja zamknie się, podmieni i uruchomi ponownie.`;
  const r = await okienko({ type: 'info', buttons: ['Zainstaluj', 'Później', 'Pomiń tę wersję'], defaultId: 0, cancelId: 1,
    message: `Dostępna jest wersja ${info.najnowsza} (masz ${WERSJA}).`, detail: jak + (opis ? '\n\nCo nowego:\n' + opis : '') });
  if (r.response === 2) { u.pominWersje = info.najnowsza; zapiszUstawienia(u); return; }
  if (r.response !== 0) return;
  try { await zainstalujAktualizacje(info); }
  catch (e) {
    const r2 = await okienko({ type: 'error', buttons: ['Otwórz stronę wydania', 'Zamknij'], defaultId: 1, cancelId: 1,
      message: 'Aktualizacja nie powiodła się.', detail: String((e && e.message) || e) + '\n\nMożesz pobrać plik DMG ze strony wydania.' });
    if (r2.response === 0 && info.strona) shell.openExternal(info.strona);
    return;
  }
  if (await czyMoznaPorzucicWszystkie()) return zrestartuj();
  okienko({ type: 'info', message: `Wersja ${info.najnowsza} uruchomi się przy następnym starcie aplikacji.` });
}

// Zlecenie z pliku .generator/zlecenia/aktualizacja (w folderze dowolnego otwartego projektu):
// „instaluj = tak” (domyślnie tylko sprawdza), „restart = nie” (domyślnie po instalacji restart – chyba że
// edytor któregoś projektu ma niezapisane zmiany). Wynik: wynik-aktualizacja.json; powstaje przed restartem.
const TAK = (v) => /^(tak|t|true|1|yes)$/i.test(String(v).trim());
async function zlecenieAktualizacji(p) {
  if (odlozZalegle(p.folder, 'aktualizacja', p)) return;     // zaległa instalacja kilka dni później – nie (#90)
  const folder = path.join(p.folder, ...FOLDER_ZLECEN), plik = path.join(folder, 'aktualizacja');
  let tekst;
  try { if (!fs.statSync(plik).isFile()) return; tekst = fs.readFileSync(plik, 'utf8'); } catch (e) { return; }
  const wynikPlik = path.join(folder, 'wynik-aktualizacja.json');
  fs.rmSync(wynikPlik, { force: true });
  const opcje = { instaluj: false, restart: true }, ostrzezenia = [];
  for (const [k, v] of Object.entries(czytajZlecenie(tekst))) {
    const kk = k.trim().toLowerCase();
    if (kk === 'instaluj' || kk === 'restart') opcje[kk] = TAK(v); else ostrzezenia.push(`nieznany klucz „${k}” – pominięty`);
  }
  const wynik = { zlecenie: 'aktualizacja', czas: new Date().toISOString(), wersjaAplikacji: WERSJA, kod: KOD.zrodlo,
    electron: process.versions.electron, opcje, ok: false, blad: null };
  if (ostrzezenia.length) wynik.ostrzezenia = ostrzezenia;
  let restart = false;
  zlecenieTrwa(p, true);
  try {
    if (AKT.trwa) throw new Error('aktualizacja już trwa');
    const info = await sprawdzWydanie();
    Object.assign(wynik, { ok: true, najnowsza: info.najnowsza, dostepna: info.dostepna, rodzaj: info.dostepna ? info.rodzaj : null,
      rozmiar: info.dostepna ? info.rozmiar : 0, zainstalowano: false, restart: false });
    if (opcje.instaluj && info.dostepna) {
      await zainstalujAktualizacje(info);
      wynik.zainstalowano = true;
      wynik.niezapisaneZmiany = niezapisane();
      restart = wynik.restart = opcje.restart && !wynik.niezapisaneZmiany;
      if (!restart) wynik.uwaga = info.rodzaj === 'kod' ? 'nowa wersja uruchomi się przy następnym starcie aplikacji'
        : 'aplikacja podmieni się po zamknięciu';
    }
  } catch (e) { wynik.ok = false; wynik.blad = String((e && e.message) || e); }
  finally { zlecenieTrwa(p, false); }
  try { fs.rmSync(plik, { force: true }); fs.writeFileSync(wynikPlik, JSON.stringify(wynik, null, 1)); } catch (e) { /* trudno */ }
  if (restart && !testowy) setTimeout(zrestartuj, 500);
}
// Usunięcie znacznika startu nakładki – nowy kod uruchomił się poprawnie (nakladka.js).
function potwierdzStart() {
  if (KOD.znacznik) try { fs.rmSync(KOD.znacznik, { force: true }); } catch (e) { /* trudno */ }
}

// ── Menu ────────────────────────────────────────────────────────────────────
// Menu działa na aktywny projekt (widok w oknie), a nie na samo okno.
const wStronie = (kod) => () => aktywny && aktywny.wc && aktywny.wc.executeJavaScript(kod).catch(() => {});
const powieksz = (krok) => () => {                         // jak role zoomIn/zoomOut/resetZoom (krok 0,5), ale na widoku projektu
  const w = aktywny && aktywny.wc;
  if (w) w.setZoomLevel(krok ? w.getZoomLevel() + krok : 0);
};

function zbudujMenu() {
  const ost = ostatnie();
  const przyk = listaPrzykladow();
  const p = aktywny || {};
  const menu = [
    {
      label: 'KarKa',
      submenu: [
        { role: 'about', label: 'O aplikacji KarKa' },
        { label: 'Sprawdź aktualizacje…', enabled: !AKT.trwa, click: () => sprawdzAktualizacje({ cicho: false }) },
        { label: 'Folder z projektami', submenu: [
          { label: ustawienia().folderProjektow || 'Wyłączony – zlecenia tylko w otwartych zakładkach', enabled: false },
          { type: 'separator' },
          { label: 'Wybierz…', click: () => wybierzFolderProjektow() },
          { label: 'Wyłącz', enabled: !!ustawienia().folderProjektow, click: () => ustawFolderProjektow(null) },
        ] },
        { type: 'separator' },
        { role: 'services', label: 'Usługi' },
        { type: 'separator' },
        { role: 'hide', label: 'Ukryj KarKę' },
        { role: 'hideOthers', label: 'Ukryj pozostałe' },
        { role: 'unhide', label: 'Pokaż wszystkie' },
        { type: 'separator' },
        { role: 'quit', label: 'Zakończ KarKę' },
      ],
    },
    {
      label: 'Plik',
      submenu: [
        { label: 'Nowa zakładka', accelerator: 'CmdOrCtrl+T', click: () => nowaZakladka() },
        { label: 'Nowy projekt…', accelerator: 'CmdOrCtrl+N', click: () => nowyProjekt() },
        { label: 'Otwórz szablon…', accelerator: 'CmdOrCtrl+O', click: () => wybierzSzablon() },
        {
          label: 'Ostatnie projekty',
          submenu: ost.length
            ? [...ost.map((s) => ({ label: `${path.basename(folderProjektu(s))} – ${path.basename(s)}`, sublabel: s, click: () => otworzWZakladce(s) })),
               { type: 'separator' },
               { label: 'Wyczyść listę', click: () => { const u = ustawienia(); u.ostatnie = []; zapiszUstawienia(u); app.clearRecentDocuments(); zbudujMenu(); } }]
            : [{ label: 'Brak', enabled: false }],
        },
        {
          label: 'Przykłady',
          submenu: przyk.length ? przyk.map((n) => ({ label: n, click: () => otworzWZakladce(path.join(PRZYKLADY, n)) })) : [{ label: 'Brak', enabled: false }],
        },
        { type: 'separator' },
        { label: 'Pokaż folder projektu w Finderze', enabled: !!p.folder, click: () => aktywny && aktywny.folder && shell.openPath(aktywny.folder) },
        { type: 'separator' },
        { label: 'Zapisz szablon', accelerator: 'CmdOrCtrl+S', enabled: !!p.szablon && !jestPrzykladem(p.szablon), click: wStronie('window.zapiszSzablon && zapiszSzablon()') },
        { label: 'Historia wersji…', enabled: !!p.folder, click: wStronie('window.pokazHistorie && pokazHistorie(true)') },
        { type: 'separator' },
        // #85, etap 1 (0.6.7): dwa okna zamiast „Druk i PDF” – każde tylko ze swoimi opcjami.
        { label: 'Druk domowy A4…', accelerator: 'CmdOrCtrl+P', enabled: !!p.folder, click: wStronie('window.oknoDrukuA4 && oknoDrukuA4()') },
        { label: 'PDF dla drukarni…', accelerator: 'Shift+CmdOrCtrl+S', enabled: !!p.folder, click: wStronie('window.oknoPdfDrukarni && oknoPdfDrukarni()') },
        {
          label: 'Eksport',
          submenu: [
            { label: 'Obrazki kart (JPG / PNG)…', accelerator: 'CmdOrCtrl+E', enabled: !!p.folder, click: wStronie('window.oknoObrazkow && oknoObrazkow()') },
            { label: 'Pokój playingcards.io…', enabled: !!p.folder, click: wStronie('window.oknoPcio && oknoPcio()') },
            { label: 'Katalog talii (JPG)…', enabled: !!p.folder, click: wStronie('window.oknoKatalogu && oknoKatalogu()') },
          ],
        },
        { type: 'separator' },
        { label: 'Zamknij zakładkę', accelerator: 'CmdOrCtrl+W', click: () => zamknijZakladke() },
        { role: 'close', label: 'Zamknij okno', accelerator: 'Shift+CmdOrCtrl+W' },
      ],
    },
    { role: 'editMenu', label: 'Edycja' },
    {
      label: 'Widok',
      submenu: [
        { label: 'Edytor szablonu', accelerator: 'Alt+CmdOrCtrl+E', enabled: !!p.szablon, click: wStronie('window.przelaczEdytor && przelaczEdytor()') },
        { label: 'Raport projektu', enabled: !!p.folder, click: wStronie('window.pokazRaport && pokazRaport(true)') },
        // #47: podgląd rewersów zamiast awersów – stan zakładki, bez zapisu (po wczytaniu strony od nowa wyłączony).
        { label: 'Pokaż rewersy kart', type: 'checkbox', checked: !!p.pokazRewersy, enabled: !!p.szablon, click: (mi) => {
          if (!aktywny) return;
          aktywny.pokazRewersy = mi.checked;
          wStronie(`window.pokazRewersyKart && pokazRewersyKart(${mi.checked})`)();
        } },
        { type: 'separator' },
        { label: 'Odśwież karty', accelerator: 'CmdOrCtrl+R', click: wStronie('window.odswiezKarty && odswiezKarty()') },
        { label: 'Odświeżaj automatycznie', type: 'checkbox', checked: ustawienia().auto !== false, click: (mi) => {
          const u = ustawienia(); u.auto = mi.checked; zapiszUstawienia(u);
          for (const x of projekty) if (x.wc) x.wc.executeJavaScript(`window.ustawAuto && ustawAuto(${mi.checked})`).catch(() => {});
        } },
        { type: 'separator' },
        { label: 'Rzeczywisty rozmiar', accelerator: 'CmdOrCtrl+0', click: powieksz(0) },
        { label: 'Powiększ', accelerator: 'CmdOrCtrl+Plus', click: powieksz(0.5) },
        { label: 'Powiększ', accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: powieksz(0.5) },
        { label: 'Pomniejsz', accelerator: 'CmdOrCtrl+-', click: powieksz(-0.5) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pełny ekran' },
        { label: 'Narzędzia deweloperskie', accelerator: 'Alt+CmdOrCtrl+I', click: () => aktywny && aktywny.wc && aktywny.wc.toggleDevTools() },
      ],
    },
    {
      label: 'Okno',
      submenu: [
        { role: 'minimize', label: 'Minimalizuj' },
        { role: 'zoom', label: 'Dopasuj wielkość' },
        { type: 'separator' },
        { label: 'Następna zakładka', accelerator: 'Ctrl+Tab', enabled: projekty.length > 1, click: () => przesunZakladke(1) },
        { label: 'Poprzednia zakładka', accelerator: 'Ctrl+Shift+Tab', enabled: projekty.length > 1, click: () => przesunZakladke(-1) },
        { type: 'separator' },
        // Lista zakładek: ⌘1–⌘9 (⌥⌘1–9 zostaje wolne dla szablonów z #54).
        ...projekty.map((x, i) => ({ label: x.nazwaZakladki, type: 'radio', checked: x === aktywny,
          accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined, click: () => wybierzZakladke(i) })),
        { type: 'separator' },
        { role: 'front', label: 'Wszystkie na wierzch' },
      ],
    },
    { role: 'help', label: 'Pomoc', submenu: [{ label: 'Dokumentacja', click: () => shell.openExternal(DOKUMENTACJA) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
}

// ── Okno ────────────────────────────────────────────────────────────────────
// Samo okno (ramka, tytuł, kropka zmian) – BaseWindow, bez własnej strony (BrowserWindow trzymał pusty proces
// renderera). Widoki w nim: pasek zakładek i strona aktywnego projektu – pokazProjekt().
function utworzOkno() {
  okno = new BaseWindow({
    width: 1400, height: 900, minWidth: 800, minHeight: 500, title: 'KarKa',
    backgroundColor: '#ece9e4', show: false,
  });
  pasek = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload-zakladki.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  pasek.setBackgroundColor('#d9d4cc');
  pasek.webContents.loadFile(path.join(__dirname, 'zakladki.html'));
  pasek.webContents.on('did-finish-load', odswiezPasek);
  okno.contentView.addChildView(pasek);
  okno.on('resize', ulozWidok);
  okno.on('show', ulozWidok);
  okno.contentView.on('bounds-changed', ulozWidok);         // np. ramka okna dodana po pokazaniu
  okno.on('focus', () => { if (aktywny && aktywny.wc) aktywny.wc.focus(); });
  okno.on('close', (e) => {                                   // niezapisany szablon przy zamykaniu okna
    if (!niezapisane() || testowy) return;
    e.preventDefault();
    czyMoznaPorzucicWszystkie().then((ok) => { if (ok && okno) okno.close(); });
  });
  okno.on('closed', () => {
    okno = null;
    [...projekty].forEach((p) => p.zamknij());
    try { const w = pasek && pasek.webContents; if (w && !w.isDestroyed()) w.close(); } catch (e) { /* już zamknięty */ }
    pasek = null;
  });
}
// Okno pokazuje się po wczytaniu strony projektu (jak dawniej „ready-to-show” okna), najpóźniej po 3 s.
// Start w tle (--w-tle, #120) – okno zostaje ukryte do pokazUkryteOkno().
function pokazOknoPoWczytaniu(p) {
  if (startWTle) return;
  const pokaz = () => { if (okno && !okno.isDestroyed() && !okno.isVisible()) { okno.show(); ulozWidok(); if (p.wc) p.wc.focus(); } };
  p.wc.once('did-finish-load', pokaz);
  setTimeout(pokaz, 3000);
}
// Zakładki z poprzedniego razu (ustawienia: otwarteZakladki, aktywnaZakladka) – tylko istniejące szablony,
// bez przykładów, jeden folder raz, do limitu. Bez klucza w ustawieniach: ostatni projekt (jak do 0.5.7).
// Zwraca listę przywróconych projektów (może być pusta – wtedy wywołujący otwiera pustą zakładkę).
async function przywrocZakladki() {
  const u = ustawienia();
  let lista = Array.isArray(u.otwarteZakladki) ? u.otwarteZakladki : [ostatnie()[0]];
  const foldery = new Set();
  lista = lista.map(naSzablon).filter((s) => {
    if (!s || jestPrzykladem(s) || foldery.has(path.resolve(folderProjektu(s)))) return false;
    foldery.add(path.resolve(folderProjektu(s)));
    return true;
  }).slice(0, LIMIT_ZAKLADEK);
  if (!lista.length) return [];
  const nr = Math.min(Math.max(0, Number(u.aktywnaZakladka) || 0), lista.length - 1);
  przywracanie = true;
  const otwarte = [];
  try {
    for (const s of lista) { const p = await new Projekt().uruchom(); otwarte.push(p); await otworzSzablon(s, p); }
    pokazProjekt(otwarte[nr]);
  } finally { przywracanie = false; }
  zapiszZakladki();
  return otwarte;
}

// Biblioteki i czcionki z CDN podmieniamy na kopie w aplikacji – działa bez internetu.
// Adres zastępczy prowadzi do serwera projektu, z którego przyszło żądanie (każdy serwer podaje /.app/).
function przekierujCdn() {
  const portDla = (id) => { const p = projekty.find((x) => x.wc && x.wc.id === id) || aktywny || projekty[0]; return p ? p.port : 0; };
  const lokalnie = (d, p) => ({ redirectURL: `http://127.0.0.1:${portDla(d.webContentsId)}/.app/${p}` });
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['https://cdn.jsdelivr.net/*', 'https://fonts.googleapis.com/*'] },
    (d, cb) => {
      const u = d.url;
      if (/\/html-to-image(@[^/]*)?\/dist\/html-to-image\.js/.test(u)) return cb(lokalnie(d, 'vendor/html-to-image.js'));
      if (/\/jszip(@[^/]*)?\/dist\/jszip\.min\.js/.test(u)) return cb(lokalnie(d, 'vendor/jszip.min.js'));
      if (/\/xlsx(@[^/]*)?\/dist\/xlsx\.full\.min\.js/.test(u)) return cb(lokalnie(d, 'vendor/xlsx.full.min.js'));
      if (u.startsWith('https://fonts.googleapis.com/css2') && u.includes('EB+Garamond') && u.includes('Patrick+Hand')) return cb(lokalnie(d, 'fonts/fonts.css'));
      cb({});                                               // inne czcionki Google (CZCIONKA_GOOGLE) – z internetu
    });
  // Pobrane pliki (JPG, .pcio) domyślnie do folderu projektu, z którego przyszło pobieranie.
  session.defaultSession.on('will-download', (e, item, wc) => {
    const p = projektWc(wc) || aktywny;
    const katalog = p && p.zapisywalny ? p.folder : app.getPath('downloads');
    item.setSaveDialogOptions({ defaultPath: path.join(katalog, item.getFilename()) });
  });
}

// Szerokość obrazka JPG (znacznik SOF) – do testu katalogu.
function szerokoscJpg(b) {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xFF) return 0;
    const m = b[i + 1], dl = b.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return b.readUInt16BE(i + 7);
    i += 2 + dl;
  }
  return 0;
}
// ── Tryb testowy (CI): --test-pdf <szablon.txt|folder|-> <plik.pdf> ──────────
// Otwiera projekt, czeka na karty, zapisuje PDF i zrzut podglądu, wypisuje stan i kończy.
// Bloki --test-edytor (#88). --test-bloki a,b uruchamia tylko wymienione bloki, --test-bloki -a,-b – wszystkie poza
// wymienionymi (CI w pull requeście dzieli pełny zestaw 07-gildie na dwa równoległe procesy: lista i jej dopełnienie, więc
// nowy blok zawsze trafia do jednego z nich); bez opcji – wszystkie jak dotąd. Nieznana nazwa = błąd testu (literówka nie
// może po cichu wyłączyć bloku). Lista bloków z własnego kodu (każde wywołanie testBloku('nazwa')) – bez dopisywania tutaj.
const BLOKI_TESTU = () => [...new Set([...fs.readFileSync(__filename, 'utf8').matchAll(/\(testBloku\('(\w+)'\)/g)].map((m) => m[1]))];
function wybraneBlokiTestu() {
  const i = process.argv.indexOf('--test-bloki');
  if (i < 0) return null;
  const lista = String(process.argv[i + 1] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const bez = lista.filter((x) => x.startsWith('-')).map((x) => x.slice(1)), tylko = lista.filter((x) => !x.startsWith('-'));
  const znane = BLOKI_TESTU(), zle = [...bez, ...tylko].filter((x) => !znane.includes(x));
  if (zle.length || !lista.length || (bez.length && tylko.length))
    throw new Error('--test-bloki: ' + (zle.length ? 'nieznane bloki ' + zle.join(', ') : !lista.length ? 'pusta lista' : 'nie łącz nazw z -nazwami')
      + ' – dostępne: ' + znane.join(', '));
  return { tylko: tylko.length ? tylko : null, bez };
}
// Czas bloku = od jego testBloku() do następnego (albo do końca testu) – pole czasyBlokow w wyniku (obserwacja CI, #88).
const CZASY_TESTU = [];
function testBloku(nazwa) {
  const w = process.argv.includes('--test-edytor') ? wybraneBlokiTestu() : { tylko: [], bez: [] };
  const tak = !w || ((!w.tylko || w.tylko.includes(nazwa)) && !w.bez.includes(nazwa));
  CZASY_TESTU.push([tak ? nazwa : null, Date.now()]);
  return tak;
}
function czasyBlokow() {
  const t = [...CZASY_TESTU, [null, Date.now()]], wynik = {};
  for (let i = 0; i + 1 < t.length; i++) if (t[i][0]) wynik[t[i][0]] = Math.round((t[i + 1][1] - t[i][1]) / 100) / 10;
  return wynik;
}
async function trybTestowy(folder, wynik, przywrocone = []) {
  const P = aktywny, wc = P.wc, szablon = P.szablon, projekt = P.folder;   // projekt testowy = aktywna zakładka
  const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));
  wybraneBlokiTestu();                                    // sprawdzenie nazw od razu (błąd → { ok: false, blad })
  // Raport drukarni zaraz po starcie (#111): zlecenie raport (drukarnia = tak), gdy tylko strona przyjmuje zlecenia
  // (warunek jak w wykonajPlikZlecenia), potem panel Raport, zlecenie i przebudowa naraz z filtrem podglądu, na końcu
  // raport po ustaleniu się strony. Te same pozycje odstępu, żadnej karty niezmierzonej, filtr bez zmian; karta odpięta
  // od strony = niezmierzona (nie „OK”). 05-zaklecia ma stopkę „nr [ID]” 2,15 mm od dolnej krawędzi – tam pozycje muszą być.
  let raportStart = null;
  if (testBloku('raportStart') && folder !== '-') {
    for (let i = 0; i < 2400 && !(await wc.executeJavaScript('!!(window.wykonajZlecenie && window.zbudowano)').catch(() => false)); i++) await czekaj(25);
    raportStart = await wc.executeJavaScript(`(async () => {
      const lista = (d) => d ? d.odstep.map((x) => x.karta + ' ' + x.odstep).join('|') : null;
      const opis = (d) => d && { karty: d.karty, odstep: d.odstep.length, niezmierzone: d.niezmierzone.length };
      const start = (await wykonajZlecenie('raport', { drukarnia: 'tak' })).drukarnia;
      const filtr = $('filtr').options[1] ? $('filtr').options[1].value : '';
      $('filtr').value = filtr; applyFilter();
      let bylo = null; try { bylo = localStorage.getItem('raportDrukarnia'); localStorage.setItem('raportDrukarnia', '1'); } catch (e) { /* bez zapisu */ }
      const [panelHtml, z] = await Promise.all([raportProjektu(), wykonajZlecenie('raport', { drukarnia: 'tak' }), build(), pokazRaport(true)]);
      const panel = /Nie zmierzono/.test(panelHtml) || !/Drukarnia: tekst/.test(panelHtml);
      await pokazRaport(false);
      // Przebudowa przy widocznym panelu Raport sama uruchamia jeszcze jeden raport (zbudujTeraz → pokazRaport(true), bez
      // czekania) – trwa on dalej po Promise.all. Do 0.7.1 miał do końca pusty filtr i pod obciążeniem (CI, 4 procesy naraz)
      // przywracał potem filtr testu kolejnym blokom (od 0.7.2 filtr bez zmian – #114). Czekamy, aż kolejki ustaną.
      for (let r = null, b = null; r !== KOLEJKA_RAPORTU_DRUKARNI || b !== KOLEJKA_BUDOWY;) {
        r = KOLEJKA_RAPORTU_DRUKARNI; b = KOLEJKA_BUDOWY; await Promise.all([r, b]);
      }
      try { if (bylo === null) localStorage.removeItem('raportDrukarnia'); else localStorage.setItem('raportDrukarnia', bylo); } catch (e) { /* bez zapisu */ }
      const filtrPo = $('filtr').value; $('filtr').value = ''; applyFilter();
      await KOLEJKA_BUDOWY;
      const potem = await raportDrukarni();
      const odpieta = odstepyKarty(document.querySelector('#podglad .karta').cloneNode(true));
      // Ścieżka błędu: wynik z kartami niezmierzonymi / bez kart → pozycja-błąd w sekcji odstępu zamiast ✓.
      const oryg = window.raportDrukarni, sekcja = async (r) => {
        window.raportDrukarni = async () => ({ margines: 3, odstep: [], czern: [], krawedz: [], spad: [], spadSzablonu: { talie: {}, bez: [], pliki: [], zmiesc: [] }, ...r });
        try { const d = document.createElement('div'); d.innerHTML = await raportProjektu({ drukarnia: true });
          const h = [...d.querySelectorAll('h3')].find((x) => /Drukarnia: tekst/.test(x.textContent));
          return h && h.nextElementSibling ? h.nextElementSibling.textContent : ''; } finally { window.raportDrukarni = oryg; }
      };
      const bledy = { czesc: /Nie zmierzono 1 z 3 kart/.test(await sekcja({ karty: 3, niezmierzone: ['Próba 1'] })),
        zadna: /Nie zmierzono żadnej karty/.test(await sekcja({ karty: 0, niezmierzone: [] })),
        wszystkie: /✓/.test(await sekcja({ karty: 3, niezmierzone: [] })) };
      return { start: opis(start), naraz: opis(z.drukarnia), potem: opis(potem), filtr: filtrPo === filtr, panelBezBledu: !panel,
        zgodne: lista(start) === lista(potem) && lista(z.drukarnia) === lista(potem), odpieta: !!(odpieta && odpieta.niezmierzona), bledy };
    })()`);
    const r = raportStart, stopka = /"nr \[ID\]"/.test(fs.readFileSync(szablon, 'utf8'));
    r.ok = !!(r.start && r.naraz && r.potem) && [r.start, r.naraz, r.potem].every((x) => x.karty > 0 && x.niezmierzone === 0)
      && r.zgodne && r.filtr && r.panelBezBledu && r.odpieta && Object.values(r.bledy).every(Boolean) && (!stopka || r.start.odstep > 0);
  }
  let stan = '';
  for (let i = 0; folder !== '-' && i < 120; i++) {
    await czekaj(500);
    stan = await wc.executeJavaScript("document.getElementById('status').textContent").catch(() => '');
    if (/ kart /.test(stan)) break;
  }
  await czekaj(1000);
  const zrzut = await wc.capturePage();
  fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '.png', zrzut.toPNG());
  if (folder === '-') {                                   // sam ekran powitalny
    process.stdout.write(JSON.stringify({ start: await wc.executeJavaScript("document.getElementById('start').innerText") }) + '\n');
    return app.exit(0);
  }
  const uwagi = await wc.executeJavaScript("document.getElementById('uwagi').innerText").catch(() => '');
  // Obiekt Projekt (#59, etap 1): projekt testowy aktywny, widok w oknie, strona z jego serwera (własny port),
  // IPC rozpoznaje projekt po nadawcy (projekt:info zwraca folder tego projektu). Z --test-przywroc: przywrócone
  // zakładki z ustawień (test-aktualizacje.js) + projekt testowy, pasek widoczny (34 px nad widokiem).
  const info = await wc.executeJavaScript('window.generatorApp.info()').catch((e) => ({ blad: e.message }));
  const obszar = () => { const [w, h] = okno.getContentSize(), b = P.widok.getBounds(), g = projekty.length > 1 ? PASEK_WYSOKOSC : 0;
    return b.x === 0 && b.y === g && b.width === w && b.height === h - g && (!pasek || pasek.getBounds().height === g); };
  const projektyTest = { liczba: projekty.length, przywrocone: przywrocone.map((x) => x.szablon), aktywny: aktywny === P, port: P.port, portStrony: Number(new URL(wc.getURL()).port),
    widok: (okno.contentView.children || []).includes(P.widok), rozmiar: obszar(), sciezka: info.sciezka === P.folder, szablon: info.szablon === P.szablon };
  projektyTest.ok = projektyTest.liczba === 1 + przywrocone.length && przywrocone.every((x) => x.wc && x !== P && projekty.includes(x))
    && projektyTest.aktywny && P.port > 0 && projektyTest.portStrony === P.port
    && projektyTest.widok && projektyTest.rozmiar && projektyTest.sciezka && projektyTest.szablon;
  // Zakładki (#59, etap 2; --test-edytor albo --test-zakladki, poza przykładami): druga zakładka z kopią przykładu
  // 01-wyprawa obok projektu testowego (poza przyklady/), zlecenia w nieaktywnej zakładce, kropka zmian, przełączanie,
  // zamykanie, limit 8, zapis listy zakładek w ustawieniach. Zrzuty: -zakladki.png (pasek), -zakladka2.png (drugi widok).
  let zakladki = null;
  if ((testBloku('zakladki') || process.argv.includes('--test-zakladki')) && !jestPrzykladem(szablon)) {
    const z = {};
    const js = (w, k) => w.wc.executeJavaScript(k);
    const czekajNaKarty = async (w) => { for (let i = 0; i < 120; i++) { if (/ kart /.test(await js(w, "document.getElementById('status').textContent").catch(() => ''))) return true; await czekaj(500); } return false; };
    const wChildren = (w) => (okno.contentView.children || []).includes(w.widok);
    const pasekStan = () => pasek.webContents.executeJavaScript(`[...document.querySelectorAll('.zakladka')].map((e) => ({ nazwa: e.querySelector('.nazwa').textContent, aktywna: e.classList.contains('aktywna'), zmiany: e.classList.contains('zmiany'), zlecenie: e.classList.contains('zlecenie') }))`);
    const portZamkniety = (port) => new Promise((r) => { const q = require('http').get({ host: '127.0.0.1', port, path: '/.wersja' }, (res) => { res.resume(); r(false); }); q.on('error', () => r(true)); });
    const kopia = path.join(path.dirname(projekt), path.basename(projekt) + '-zakladka2');
    fs.rmSync(kopia, { recursive: true, force: true });
    fs.cpSync(path.join(PRZYKLADY, '01-wyprawa'), kopia, { recursive: true });
    const przed = projekty.length;
    // 1. Druga zakładka: nowa aktywna, własny port, stary widok odpięty (strona „ukryta”), IPC do właściwego projektu, pasek.
    const P2 = await otworzWZakladce(kopia);
    z.druga = { otwarta: !!P2 && P2 !== P && projekty.length === przed + 1 && projekty[projekty.length - 1] === P2, wczytana: P2 ? await czekajNaKarty(P2) : false,
      porty: P2 ? [P.port, P2.port] : [], aktywna: aktywny === P2, widok: P2 ? wChildren(P2) && !wChildren(P) : false, rozmiar: P2 ? P2.widok.getBounds().y === PASEK_WYSOKOSC && pasek.getBounds().height === PASEK_WYSOKOSC : false,
      ukryta: await czekaj(500).then(() => js(P, 'document.hidden')), widoczna: P2 ? await js(P2, '!document.hidden') : false,
      info: [await js(P, 'generatorApp.info().then((i) => i.sciezka)'), P2 ? await js(P2, 'generatorApp.info().then((i) => i.sciezka)') : null],
      tytul: okno.getTitle(), nazwa: P2 ? P2.nazwaZakladki : '', pasek: await pasekStan() };
    z.druga.ok = z.druga.otwarta && z.druga.wczytana && P2.port !== P.port && z.druga.aktywna && z.druga.widok && z.druga.rozmiar && z.druga.ukryta && z.druga.widoczna
      && z.druga.info[0] === projekt && z.druga.info[1] === kopia && z.druga.tytul.startsWith(P2.nazwa) && P2.tytul === 'Wyprawa' && z.druga.nazwa === 'Wyprawa'
      && z.druga.pasek.length === 2 && z.druga.pasek[0].nazwa === P.nazwaZakladki && z.druga.pasek[1].nazwa === 'Wyprawa' && !z.druga.pasek[0].aktywna && z.druga.pasek[1].aktywna;
    await czekaj(300);
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-zakladki.png', (await pasek.webContents.capturePage()).toPNG());
    if (P2) fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-zakladka2.png', (await P2.wc.capturePage()).toPNG());
    // 2. Zlecenia: „stan” w obu folderach naraz; obrazki (PNG) i pdf w nieaktywnej zakładce → pliki w jej folderze.
    const zl = (w) => path.join(w.folder, ...FOLDER_ZLECEN);
    const czytaj = (w, pol) => { try { return JSON.parse(fs.readFileSync(path.join(zl(w), `wynik-${pol}.json`), 'utf8')); } catch (e) { return null; } };
    const zlec = (w, pol, tresc = '') => { fs.mkdirSync(zl(w), { recursive: true }); fs.rmSync(path.join(zl(w), `wynik-${pol}.json`), { force: true }); fs.writeFileSync(path.join(zl(w), pol), tresc); sprawdzZlecenia(); };
    const czekajNa = async (w, pol) => { let r = null; for (let i = 0; i < 1200 && !r; i++) { await czekaj(100); r = czytaj(w, pol); } return r; };
    const kartyNaStronie = (w) => js(w, 'Promise.resolve(stanKart()).then((r) => r.karty)');   // to samo, co liczy zlecenie „stan”
    if (P2) {
      zlec(P, 'stan'); zlec(P2, 'stan');
      const s1 = await czekajNa(P, 'stan'), s2 = await czekajNa(P2, 'stan');
      const pierwsza = await js(P, "(() => { const k = document.querySelector('#podglad .karta:not(.rewers)'); return { talia: k.dataset.talia, id: k.dataset.id }; })()");
      const szerMin = Math.floor(await js(P, 'Math.min(...kartyEksportu({}).map((k) => cardMm(k)[0])) / 25.4 * 150 * 0.97'));
      zlec(P, 'obrazki', `format = png\ndpi = 150\ntalie = ${pierwsza.talia}\nid = ${pierwsza.id}\nrewersy = nie\n`);
      const obr = await czekajNa(P, 'obrazki');
      const png = obr && obr.ok && obr.pliki && obr.pliki.length ? path.join(projekt, obr.pliki[0]) : null;
      const szerPng = png && fs.existsSync(png) ? fs.readFileSync(png).readUInt32BE(16) : 0;
      (obr && obr.pliki || []).forEach((f) => fs.rmSync(path.join(projekt, f), { force: true }));   // test okien liczy nowe PNG w Export/
      zlec(P, 'pdf', 'uklad = a4\nplik = Export/zakladka.pdf\n');
      const pdf = await czekajNa(P, 'pdf');
      z.zlecenia = { stan: [s1 && { ok: s1.ok, karty: s1.karty, strona: await kartyNaStronie(P) }, s2 && { ok: s2.ok, karty: s2.karty, strona: await kartyNaStronie(P2) }],
        aktywna: aktywny === P2 && wChildren(P2) && !wChildren(P), obrazki: obr && { ok: obr.ok, pliki: obr.pliki, szer: szerPng, szerMin },
        pdf: pdf && { ok: pdf.ok, pliki: pdf.pliki, rozmiar: fs.existsSync(path.join(projekt, 'Export', 'zakladka.pdf')) ? fs.statSync(path.join(projekt, 'Export', 'zakladka.pdf')).size : 0 },
        bezZnaku: !P.zlecenieTrwa && !P2.zlecenieTrwa && (await pasekStan()).every((x) => !x.zlecenie) };
      z.zlecenia.ok = !!(s1 && s1.ok && s1.karty > 0 && s1.karty === z.zlecenia.stan[0].strona && s2 && s2.ok && s2.karty > 0 && s2.karty === z.zlecenia.stan[1].strona
        && z.zlecenia.aktywna && obr && obr.ok && obr.pliki.length >= 1 && z.zlecenia.obrazki.szer >= szerMin && pdf && pdf.ok && z.zlecenia.pdf.rozmiar > 1000 && z.zlecenia.bezZnaku);
      // 3. Kropka zmian: w nieaktywnej zakładce – tylko w pasku, nie w oknie; po przełączeniu – także w oknie.
      await js(P, 'generatorApp.edytorZmiany(true)'); await czekaj(300);
      // setDocumentEdited działa tylko na macOS – w kontenerze sprawdzamy stan projektu.
      const kropkaOkna = () => (process.platform === 'darwin' ? okno.isDocumentEdited() : !!(aktywny && aktywny.zmiany));
      const kropka = { okno: kropkaOkna(), pasek: (await pasekStan()).map((x) => x.zmiany) };
      pokazProjekt(P); await czekaj(300);
      kropka.poPrzelaczeniu = kropkaOkna();
      await js(P, 'generatorApp.edytorZmiany(false)'); await czekaj(300);
      kropka.zdjeta = !kropkaOkna() && (await pasekStan()).every((x) => !x.zmiany);
      z.kropka = { ...kropka, ok: !kropka.okno && kropka.pasek[0] === true && kropka.pasek[1] === false && kropka.poPrzelaczeniu && kropka.zdjeta };
      // 4. Przełączanie (funkcje ⌃Tab / ⌃⇧Tab / ⌘1–2) i ponowne otwarcie tego samego folderu bez nowej zakładki.
      przesunZakladke(1); const a1 = aktywny === P2 && wChildren(P2) && okno.getTitle().startsWith(P2.nazwa);
      przesunZakladke(1); const a2 = aktywny === P && wChildren(P) && !wChildren(P2);
      wybierzZakladke(1); const a3 = aktywny === P2;
      przesunZakladke(-1); const a4 = aktywny === P && okno.getTitle().startsWith(P.nazwa);
      const znow = await otworzWZakladce(kopia);
      z.przelaczanie = { kolejno: [a1, a2, a3, a4], znow: znow === P2 && projekty.length === przed + 1 && aktywny === P2, menu: (Menu.getApplicationMenu().items.find((i) => i.label === 'Okno') || { submenu: { items: [] } }).submenu.items.filter((i) => i.type === 'radio').map((i) => i.label + (i.checked ? ' ✓' : '')) };
      z.przelaczanie.ok = a1 && a2 && a3 && a4 && z.przelaczanie.znow && z.przelaczanie.menu.length === przed + 1 && z.przelaczanie.menu.includes('Wyprawa ✓');
      // 5. Zamknięcie drugiej zakładki (ze „zmianami” – w teście pytanie liczone, nie pokazywane): widok zniszczony,
      // port zamknięty, aktywna = sąsiednia (po lewej), punkt „zamknięcie projektu” w jej historii (zmieniony szablon).
      const szablon2 = P2.szablon, port2 = P2.port, wc2 = P2.wc;
      fs.appendFileSync(szablon2, '\n; zmiana przed zamknięciem zakładki\n'); await czekaj(300);
      P2.zmiany = true;
      const pytaniaPrzed = TEST.pytania;
      const zamknieta = await zamknijZakladke(P2);
      await czekaj(500);
      let punkty = [];
      try { punkty = historia.wczytajIndeks(kopia).punkty.map((x) => x.etykieta); } catch (e) { /* brak historii */ }
      z.zamykanie = { zamknieta, pytania: TEST.pytania - pytaniaPrzed, zniszczony: wc2.isDestroyed(), port: await portZamkniety(port2), liczba: projekty.length,
        aktywna: aktywny === P && wChildren(P) && P.widok.getBounds().y === (projekty.length > 1 ? PASEK_WYSOKOSC : 0), punkty, pasek: (await pasekStan()).length };
      z.zamykanie.ok = zamknieta && z.zamykanie.pytania === 1 && z.zamykanie.zniszczony && z.zamykanie.port && projekty.length === przed && z.zamykanie.aktywna
        && punkty.includes('zamknięcie projektu') && z.zamykanie.pasek === przed;
    }
    // 6. Limit 8: puste zakładki (⌘T) do 8; 9. → odmowa, gdy każda ma zmiany; pytanie z kandydatem (odpowiedź „nie” – nic
    // się nie zmienia; „tak” – najdawniej używana zamknięta, nowa otwarta). Potem zamknięcie dodatkowych.
    const puste = [];
    while (projekty.length < LIMIT_ZAKLADEK) { const n = await nowaZakladka(); if (!n) break; puste.push(n); }
    // Stan paska dochodzi osobnym komunikatem (zakladki:stan) – pod obciążeniem (CI, kilka procesów) jeszcze go nie było.
    const plusUkryty = () => pasek.webContents.executeJavaScript("document.getElementById('nowa').classList.contains('ukryty')");
    let pasekPlus = false;
    for (let i = 0; i < 40 && !(pasekPlus = await plusUkryty()); i++) await czekaj(50);
    const limit = { liczba: projekty.length, pasekPlus };
    projekty.forEach((x) => { x.zmiany = true; }); TEST.limit = null;
    limit.odmowa = { wynik: await nowaZakladka(), test: TEST.limit, liczba: projekty.length };
    projekty.forEach((x) => { x.zmiany = false; });
    pokazProjekt(P);                                        // projekt testowy najświeższy – kandydat = najdawniej używana (bez przywróconych: pierwsza pusta)
    const kand = projekty.filter((x) => !x.zmiany && !x.zlecenieTrwa).sort((a, b) => a.uzyty - b.uzyty)[0];
    TEST.limit = null; TEST.odpowiedzLimit = false;
    limit.nie = { wynik: await nowaZakladka(), test: TEST.limit, liczba: projekty.length, kandydat: kand.nazwaZakladki, pierwszaPusta: kand === puste[0] || przywrocone.length > 0, kandydatZyje: !!kand.wc };
    TEST.limit = null; TEST.odpowiedzLimit = true;
    const nowa = await nowaZakladka(); await czekaj(500);
    limit.tak = { otwarta: !!nowa && projekty.includes(nowa) && aktywny === nowa, test: TEST.limit, liczba: projekty.length, kandydatZamkniety: !kand.wc && !projekty.includes(kand) };
    TEST.odpowiedzLimit = false;
    for (const x of [...projekty]) if (x !== P && !x.szablon) await zamknijZakladke(x);
    limit.poSprzataniu = projekty.length;
    z.limit = { ...limit, ok: limit.liczba === LIMIT_ZAKLADEK && limit.pasekPlus && limit.odmowa.wynik === null && limit.odmowa.test && limit.odmowa.test.odmowa && limit.odmowa.liczba === LIMIT_ZAKLADEK
      && limit.nie.wynik === null && limit.nie.test && limit.nie.test.kandydat === limit.nie.kandydat && limit.nie.pierwszaPusta && limit.nie.liczba === LIMIT_ZAKLADEK && limit.nie.kandydatZyje
      && limit.tak.otwarta && limit.tak.liczba === LIMIT_ZAKLADEK && limit.tak.kandydatZamkniety && limit.poSprzataniu === przed };
    // 7. Ustawienia: lista otwartych zakładek (bez przykładów i pustych) i aktywna – po ponownym otwarciu kopii 2 zakładki,
    // aktywna = projekt testowy (test-aktualizacje.js sprawdza ich przywrócenie przy następnym starcie).
    const P2b = await otworzWZakladce(kopia);
    if (P2b) await czekajNaKarty(P2b);
    pokazProjekt(P);
    const u = ustawienia();
    z.ustawienia = { otwarteZakladki: u.otwarteZakladki, aktywnaZakladka: u.aktywnaZakladka, liczba: projekty.length };
    z.ustawienia.ok = !!P2b && Array.isArray(u.otwarteZakladki) && u.otwarteZakladki.length === przed + 1 && u.otwarteZakladki.includes(szablon) && u.otwarteZakladki.includes(P2b.szablon)
      && u.aktywnaZakladka === u.otwarteZakladki.indexOf(szablon) && aktywny === P && wChildren(P);
    z.ok = !!(z.druga.ok && z.zlecenia && z.zlecenia.ok && z.kropka && z.kropka.ok && z.przelaczanie && z.przelaczanie.ok && z.zamykanie && z.zamykanie.ok && z.limit.ok && z.ustawienia.ok);
    zakladki = z;
  }
  // Zlecenia w tle (#90, PR 1): „Folder z projektami” z kopiami 01-wyprawa (poziom 1 i 2), zakładki otwierane w tle przez
  // zlecenia, raport drukarni i PDF w zakładce nigdy niepokazanej, dowiązanie na zewnątrz, zaległe zlecenia, klucz
  // szablon =, przejęcie, samozamykanie, limit 8 bez pytań, lista zakładek w ustawieniach, plik stanu.
  let zleceniaWTle = null;
  if (testBloku('zleceniaWTle') && !jestPrzykladem(szablon)) {
    const z = {};
    const js = (w, k) => w.wc.executeJavaScript(k);
    const wChildren = (w) => (okno.contentView.children || []).includes(w.widok);
    const baza = path.join(path.dirname(projekt), path.basename(projekt) + '-folder');
    const zewn = path.join(path.dirname(projekt), path.basename(projekt) + '-zewn');
    fs.rmSync(baza, { recursive: true, force: true }); fs.rmSync(zewn, { recursive: true, force: true });
    const kopiuj = (cel) => { fs.cpSync(path.join(PRZYKLADY, '01-wyprawa'), cel, { recursive: true }); return realna(cel); };
    const A = kopiuj(path.join(baza, 'Alfa')), B = kopiuj(path.join(baza, 'grupa', 'Beta')), D = kopiuj(path.join(baza, 'Delta'));
    // zapasowy.txt sortuje się po wyprawa.txt – domyślnie B otwiera wyprawa.txt, a szablon = zapasowy naprawdę podmienia.
    fs.writeFileSync(path.join(B, 'Szablony', 'zapasowy.txt'), fs.readFileSync(path.join(B, 'Szablony', 'wyprawa.txt'), 'utf8').replace(/^PROJEKT\s*=\s*Wyprawa/m, 'PROJEKT = Zapas'));
    fs.writeFileSync(path.join(B, 'Szablony', '_szkic.txt'), 'PROJEKT = szkic\n');
    kopiuj(zewn);
    fs.symlinkSync(zewn, path.join(baza, 'Link'));
    const zl = (f) => path.join(f, ...FOLDER_ZLECEN);
    const czytaj = (f, pol) => { try { return JSON.parse(fs.readFileSync(path.join(zl(f), `wynik-${pol}.json`), 'utf8')); } catch (e) { return null; } };
    const zapisz = (f, pol, tresc = '', wiek = 0) => {
      fs.mkdirSync(zl(f), { recursive: true }); fs.rmSync(path.join(zl(f), `wynik-${pol}.json`), { force: true });
      const plik = path.join(zl(f), pol); fs.writeFileSync(plik, tresc);
      if (wiek) { const t = (Date.now() - wiek) / 1000; fs.utimesSync(plik, t, t); }
    };
    const czekajNa = async (f, pol) => { let r = null; for (let i = 0; i < 1200 && !r; i++) { await czekaj(100); r = czytaj(f, pol); } return r; };
    const przegladKoniec = async () => { sprawdzZlecenia(); await czekaj(50); for (let i = 0; i < 1200 && kolejkaZlecen; i++) await czekaj(50); };
    const zakladka = (f) => projekty.find((x) => x.folder && realna(x.folder) === f) || null;
    const przed = [...projekty], pytania = TEST.pytania;
    ustawFolderProjektow(baza);
    // 1. Dwa projekty bez zakładek naraz (poziom 1 i 2): dwie zakładki w tle na końcu, aktywna bez zmian, widoki nieprzypięte,
    // strony bez sprawdzania plików, wynik z polem zakladka; poza ustawieniami zakładek i „Ostatnimi projektami”.
    zapisz(A, 'stan'); zapisz(B, 'stan');
    sprawdzZlecenia();
    const sA = await czekajNa(A, 'stan'), sB = await czekajNa(B, 'stan');
    const PA = zakladka(A), PB = zakladka(B);
    const u1 = ustawienia();
    z.dwa = { wyniki: [sA && { ok: sA.ok, karty: sA.karty, zakladka: sA.zakladka }, sB && { ok: sB.ok, karty: sB.karty, zakladka: sB.zakladka, szablon: sB.szablon, projekt: sB.projekt }],
      liczba: projekty.length - przed.length, aktywna: aktywny === P && wChildren(P), naKoncu: !!PA && !!PB && projekty.indexOf(PA) >= przed.length && projekty.indexOf(PB) >= przed.length,
      nieprzypiete: !!PA && !!PB && !wChildren(PA) && !wChildren(PB), zeZlecenia: !!PA && !!PB && PA.zeZlecenia && PB.zeZlecenia,
      wTle: PA ? await js(PA, 'W_TLE') : null, rozmiar: PA ? await js(PA, '[innerWidth, innerHeight]') : null,
      ustawienia: (u1.otwarteZakladki || []).filter((x) => [A, B].includes(realna(folderProjektu(x)))).length,
      ostatnie: (u1.ostatnie || []).filter((x) => [A, B].includes(realna(folderProjektu(x)))).length };
    z.dwa.ok = !!(sA && sA.ok && sA.karty > 0 && sA.zakladka === 'otwarta przez zlecenie' && sB && sB.ok && sB.zakladka === 'otwarta przez zlecenie'
      && sB.szablon === path.join('Szablony', 'wyprawa.txt') && sB.projekt === 'Wyprawa')
      && z.dwa.liczba === 2 && z.dwa.aktywna && z.dwa.naKoncu && z.dwa.nieprzypiete && z.dwa.zeZlecenia && z.dwa.wTle === true
      && z.dwa.rozmiar && z.dwa.rozmiar[0] > 0 && z.dwa.ustawienia === 0 && z.dwa.ostatnie === 0;
    // 2. Praca w zakładce nigdy niepokazanej: raport drukarni (klatki – ukladDoPomiaru) i PDF.
    zapisz(A, 'raport', 'drukarnia = tak\n'); zapisz(A, 'pdf', 'uklad = a4\nplik = Export/tlo.pdf\n');
    sprawdzZlecenia();
    const rA = await czekajNa(A, 'raport'), pA = await czekajNa(A, 'pdf');
    const pdfTlo = path.join(A, 'Export', 'tlo.pdf');
    await czekaj(300);
    z.praca = { raport: rA && { ok: rA.ok, karty: rA.drukarnia && rA.drukarnia.karty, niezmierzone: rA.drukarnia && (rA.drukarnia.niezmierzone || []).length, blad: rA.blad },
      pdf: pA && { ok: pA.ok, blad: pA.blad, strony: pA.strony, rozmiar: fs.existsSync(pdfTlo) ? fs.statSync(pdfTlo).size : 0 }, aktywna: aktywny === P,
      dlawiona: PA ? await js(PA, 'document.hidden') : null };   // po zleceniu zakładka w tle znów dławiona
    z.praca.ok = !!(rA && rA.ok && z.praca.raport.karty > 0 && z.praca.raport.niezmierzone === 0 && pA && pA.ok && pA.strony >= 1 && z.praca.pdf.rozmiar > 1000
      && z.praca.aktywna && z.praca.dlawiona === true);
    // 3. Dowiązanie symboliczne na zewnątrz „Folderu z projektami” – pomijane (zlecenie zostaje, bez wyniku i zakładki).
    zapisz(zewn, 'stan');
    await przegladKoniec(); await przegladKoniec();
    z.dowiazanie = { wynik: !!czytaj(zewn, 'stan'), zlecenie: fs.existsSync(path.join(zl(zewn), 'stan')), zakladka: !!zakladka(realna(zewn)) };
    z.dowiazanie.ok = !z.dowiazanie.wynik && z.dowiazanie.zlecenie && !z.dowiazanie.zakladka;
    // 4. Zaległe (sprzed godziny): w otwartej zakładce i w projekcie bez zakładki (jak przy starcie – świeże wykonane,
    // zaległe odłożone do przeterminowane/).
    zapisz(A, 'stan', '', 3600e3);
    zapisz(D, 'pdf', 'uklad = a4\nplik = Export/stare.pdf\n', 3600e3); zapisz(D, 'stan');
    sprawdzZlecenia();
    const zA = await czekajNa(A, 'stan'), zDp = await czekajNa(D, 'pdf'), zDs = await czekajNa(D, 'stan');
    const odlozone = (f) => { try { return fs.readdirSync(path.join(zl(f), 'przeterminowane')); } catch (e) { return []; } };
    z.zalegle = { a: zA && { ok: zA.ok, blad: zA.blad, przeterminowane: zA.przeterminowane }, d: zDp && { ok: zDp.ok, przeterminowane: zDp.przeterminowane },
      dStan: zDs && { ok: zDs.ok, zakladka: zDs.zakladka }, odlozoneA: odlozone(A), odlozoneD: odlozone(D), pdf: fs.existsSync(path.join(D, 'Export', 'stare.pdf')),
      zostaly: [fs.existsSync(path.join(zl(A), 'stan')), fs.existsSync(path.join(zl(D), 'pdf'))] };
    z.zalegle.ok = !!(zA && !zA.ok && /zaległe/.test(zA.blad || '') && /^\.generator\/zlecenia\/przeterminowane\/\d{4}-\d\d-\d\d-\d\d-\d\d-stan$/.test(zA.przeterminowane || '')
      && zDp && !zDp.ok && /-pdf$/.test(zDp.przeterminowane || '') && zDs && zDs.ok && zDs.zakladka === 'otwarta przez zlecenie')
      && z.zalegle.odlozoneA.length === 1 && z.zalegle.odlozoneD.length === 1 && !z.zalegle.pdf && z.zalegle.zostaly.every((x) => !x);
    // 5. Klucz szablon =: zakładka ze zlecenia – podmiana; zakładka właściciela z innym szablonem – błąd bez podmiany;
    // nieistniejący szablon – błąd.
    zapisz(B, 'stan', 'szablon = zapasowy\n');
    sprawdzZlecenia();
    const kB = await czekajNa(B, 'stan');
    const inny = path.join(path.dirname(szablon), '_inny-test.txt');
    fs.copyFileSync(szablon, inny);
    zapisz(projekt, 'stan', 'szablon = _inny-test.txt\n'); sprawdzZlecenia();
    const kP = await czekajNa(projekt, 'stan');
    fs.rmSync(inny, { force: true });
    zapisz(projekt, 'stan', 'Szablon = nie-ma-takiego\n'); sprawdzZlecenia();
    const kN = await czekajNa(projekt, 'stan');
    z.szablon = { b: kB && { ok: kB.ok, szablon: kB.szablon, projekt: kB.projekt, ostrzezenia: kB.ostrzezenia }, bZakladka: PB ? path.basename(PB.szablon || '') : null, p: kP && { ok: kP.ok, blad: kP.blad, zakladka: kP.zakladka },
      n: kN && { ok: kN.ok, blad: kN.blad }, szablonP: P.szablon === szablon };
    z.szablon.ok = !!(kB && kB.ok && kB.szablon === path.join('Szablony', 'zapasowy.txt') && kB.projekt === 'Zapas' && z.szablon.bZakladka === 'zapasowy.txt' && !(kB.ostrzezenia || []).length
      && kP && !kP.ok && /innym szablonem/.test(kP.blad || '') && kP.zakladka === 'aktywna' && kN && !kN.ok && /nie-ma-takiego/.test(kN.blad || '')) && z.szablon.szablonP;
    // 6. Przejęcie (kliknięcie = wybierzZakladke): zwykła zakładka – sprawdza pliki, w ustawieniach i Ostatnich projektach.
    wybierzZakladke(projekty.indexOf(PA));
    await czekaj(300);
    const u2 = ustawienia();
    z.przejecie = { aktywna: aktywny === PA && wChildren(PA), zeZlecenia: PA.zeZlecenia, wTle: await js(PA, 'W_TLE'),
      ustawienia: (u2.otwarteZakladki || []).some((x) => realna(folderProjektu(x)) === A), ostatnie: (u2.ostatnie || []).some((x) => realna(folderProjektu(x)) === A) };
    pokazProjekt(P);
    await czekaj(300);
    z.przejecie.poPowrocie = { wTle: await js(PA, 'W_TLE'), wTleB: PB && PB.wc ? await js(PB, 'W_TLE') : null };
    z.przejecie.ok = z.przejecie.aktywna && !z.przejecie.zeZlecenia && z.przejecie.wTle === false && z.przejecie.ustawienia && z.przejecie.ostatnie
      && z.przejecie.poPowrocie.wTle === false && z.przejecie.poPowrocie.wTleB === true;
    // 7. Plik stanu (stan.json): wersja, pid, rodzaje zakładek, ostatnie zlecenie.
    zapiszStanTeraz();
    let st = null;
    try { st = JSON.parse(fs.readFileSync(plikStanu(), 'utf8')); } catch (e) { /* brak */ }
    z.stanPlik = st && { dziala: st.dziala, wersja: st.wersja, pid: st.pid === process.pid, folder: st.folderProjektow === baza,
      rodzaje: [...new Set(st.zakladki.map((x) => x.rodzaj))].sort(), ostatnie: st.ostatnieZlecenie && st.ostatnieZlecenie.polecenie, kolejka: st.kolejka };
    z.stanPlik = { ...z.stanPlik, ok: !!(st && st.dziala === true && st.wersja === WERSJA && z.stanPlik.pid && z.stanPlik.folder && z.stanPlik.rodzaje.includes('aktywna')
      && z.stanPlik.rodzaje.includes('otwarta przez zlecenie') && z.stanPlik.rodzaje.includes('w tle') && z.stanPlik.ostatnie && Number.isInteger(st.kolejka)) };
    // 8. Samozamykanie (czas skrócony do 0): nieprzejęte zakładki ze zleceń znikają, przejęta zostaje.
    TEST.bezczynnosc = 0;
    await przegladKoniec();
    TEST.bezczynnosc = null;
    z.samozamykanie = { b: !!zakladka(B), d: !!zakladka(D), a: !!zakladka(A), aktywna: aktywny === P, bWc: PB ? !projekty.includes(PB) : null };
    z.samozamykanie.ok = !z.samozamykanie.b && !z.samozamykanie.d && z.samozamykanie.a && z.samozamykanie.aktywna && z.samozamykanie.bWc === true;
    // 9. Limit 8: zlecenie zamyka najdawniej używaną zakładkę ze zlecenia (bez pytania); gdy takiej nie ma – ok: false
    // „limit zakładek”, bez okna (TEST.pytania bez zmian), zlecenie usunięte.
    zapisz(B, 'stan'); sprawdzZlecenia(); await czekajNa(B, 'stan');
    const PB2 = zakladka(B);
    const puste = [];
    while (projekty.length < LIMIT_ZAKLADEK) { const n = await nowaZakladka(); if (!n) break; puste.push(n); }
    pokazProjekt(P);
    projekty.forEach((x) => { if (x !== PB2) x.zmiany = true; });
    const pytaniaLimit = TEST.pytania;
    zapisz(D, 'stan'); sprawdzZlecenia();
    const l1 = await czekajNa(D, 'stan');
    const PD = zakladka(D);
    const poPierwszym = { liczba: projekty.length, bZamknieta: !zakladka(B), dOtwarta: !!PD };
    if (PD) PD.zmiany = true;
    zapisz(B, 'stan'); sprawdzZlecenia();
    const l2 = await czekajNa(B, 'stan');
    z.limit = { l1: l1 && { ok: l1.ok, zakladka: l1.zakladka }, poPierwszym, l2: l2 && { ok: l2.ok, blad: l2.blad }, liczba: projekty.length,
      pytania: TEST.pytania - pytaniaLimit, zlecenie: fs.existsSync(path.join(zl(B), 'stan')), aktywna: aktywny === P };
    projekty.forEach((x) => { x.zmiany = false; });
    // Zamknięcie ostatniej zakładki właściciela (pustej, aktywnej) – sąsiadem nie jest zakładka ze zlecenia z prawej.
    const ostPusta = puste[puste.length - 1];
    if (ostPusta && PD) { pokazProjekt(ostPusta); await zamknijZakladke(ostPusta); }
    z.limit.sasiad = { aktywnaZeZlecenia: !!(aktywny && aktywny.zeZlecenia), pdNadal: !!PD && PD.zeZlecenia && projekty.includes(PD), aktywnaToPd: aktywny === PD };
    pokazProjekt(P);
    z.limit.ok = !!(l1 && l1.ok && poPierwszym.liczba === LIMIT_ZAKLADEK && poPierwszym.bZamknieta && poPierwszym.dOtwarta
      && l2 && !l2.ok && l2.blad === 'limit zakładek') && z.limit.liczba === LIMIT_ZAKLADEK && z.limit.pytania === 0 && !z.limit.zlecenie && z.limit.aktywna
      && !z.limit.sasiad.aktywnaZeZlecenia && z.limit.sasiad.pdNadal && !z.limit.sasiad.aktywnaToPd;
    // Sprzątanie: folder wyłączony, zakładki spoza stanu sprzed bloku zamknięte, aktywny projekt testowy.
    ustawFolderProjektow(null);
    for (const x of [...projekty]) if (!przed.includes(x)) await zamknijZakladke(x);
    pokazProjekt(P);
    z.sprzatanie = { liczba: projekty.length === przed.length, pytania: TEST.pytania - pytania, folder: !ustawienia().folderProjektow };
    z.ok = !!(z.dwa.ok && z.praca.ok && z.dowiazanie.ok && z.zalegle.ok && z.szablon.ok && z.przejecie.ok && z.stanPlik.ok && z.samozamykanie.ok && z.limit.ok
      && z.sprzatanie.liczba && z.sprzatanie.pytania === 0 && z.sprzatanie.folder);
    zleceniaWTle = z;
  }
  // Eksport JPG z biblioteką wbudowaną w aplikację (sprawdza podmianę CDN → zasoby).
  const jpg = await wc.executeJavaScript(`(async () => {
    await loadScript('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js');
    const b = await jpegBlob(document.querySelector('.karta:not(.rewers)'), { pixelRatio: 1, quality: 0.9 });
    return b.type + ' ' + b.size;
  })()`).catch((e) => 'błąd: ' + e.message);
  // Czcionki osadzone w obrazkach kart (bez nich JPG/PNG wychodziły czcionką zastępczą).
  const czcionki = await wc.executeJavaScript(`cssCzcionek().then((c) => ({ dlugosc: c.length, garamond: /font-family:\\s*'EB Garamond'/.test(c), patrick: /Patrick Hand/.test(c), data: (c.match(/url\\(data:/g) || []).length }))`).catch((e) => ({ blad: e.message }));
  czcionki.ok = czcionki.garamond && czcionki.patrick && czcionki.data >= 4;
  // Eksport JPG do folderu Export (tylko poza przykładami – przykłady pytają o folder).
  let eksport = '';
  if (!jestPrzykladem(szablon)) {
    wc.executeJavaScript('eksportObrazkow({})');
    for (let i = 0; i < 240 && !/^(Zapisano|Eksport obrazków nie)/.test(eksport); i++) {
      await czekaj(500);
      eksport = await wc.executeJavaScript("document.getElementById('status').textContent").catch(() => '');
    }
  }
  // Edytor (--test-edytor, tylko poza przykładami): kolorowanie, błąd w wierszu, podgląd na żywo, zapis.
  let edytor = null;
  if (testBloku('edytor') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const oryginal = fs.readFileSync(szablon, 'utf8');
    const wpisz = (t) => js(`(() => { const p = document.getElementById('edPole'); p.value = ${JSON.stringify(t)}; p.dispatchEvent(new Event('input')); })()`);
    await js('przelaczEdytor(true)');
    const kolory = await js("document.querySelectorAll('#edKolory .sk-kmd').length");
    await wpisz(oryginal + '\nBŁĘDNA = 1\n'); await czekaj(2000);
    const bladLinia = oryginal.split('\n').length + 1;
    const blad = await js(`document.querySelector('#edNumery div:nth-child(${bladLinia})').className + ' | ' + document.getElementById('edBledy').innerText`);
    const zmianyPrzed = P.zmiany;
    const zmieniony = oryginal.replace(/^KARTA\s*=\s*63\s*,\s*88/m, 'KARTA = 70, 100');
    await wpisz(zmieniony); await czekaj(2000);
    const szer = await js("Math.round(document.querySelector('#podglad .karta:not(.rewers)').getBoundingClientRect().width * 25.4 / 96)");
    await js('zapiszSzablon()'); await czekaj(500);
    const zapisany = fs.readFileSync(szablon, 'utf8') === zmieniony && !P.zmiany;
    await wpisz(oryginal); await js('zapiszSzablon()'); await czekaj(1500);
    const przywrocony = fs.readFileSync(szablon, 'utf8') === oryginal;
    // Bez pętli odświeżania: odcisk plików nie zależy od kolejności wczytania, a po edycji napis „odświeżono” stoi.
    const odcisk = await js('(async () => { const a = await serverStamp(); serverPaths.reverse(); const b = await serverStamp(); serverPaths.reverse(); return a === b; })()');
    await czekaj(3000);
    const czas1 = await js("document.getElementById('status').textContent"); await czekaj(6000);
    const spokoj = odcisk && czas1 === await js("document.getElementById('status').textContent");
    edytor = { kolory, blad, zmianyPrzed, szer, zapisany, przywrocony, spokoj,
      ok: spokoj && kolory > 0 && /blad/.test(blad) && /nieznana komenda/.test(blad) && zmianyPrzed && (oryginal === zmieniony || szer === 70) && zapisany && przywrocony };
    await js('przelaczEdytor(true)');
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-edytor.png', (await wc.capturePage()).toPNG());
    await js('przelaczEdytor(false)');              // następne bloki zaczynają bez edytora także przy --test-bloki (#88)
  }
  // Druk wybranych kart i tryb szkicu (--test-edytor): 2 zaznaczone karty → 2 karty w wydruku, białe tło.
  let wybor = null;
  if (testBloku('wybor')) {
    wybor = await wc.executeJavaScript(`(() => {
      wybierzKarty(2); buildPrint({ szkic: true, karty: kartyEksportu({ ktore: 'zaznaczone' }) });
      const karty = document.querySelectorAll('#druk .karta:not(.rewers)').length;
      const tlo = getComputedStyle(document.querySelector('#druk .karta')).backgroundColor;
      const pasek = document.getElementById('wybor').hidden;
      wyczyscWybor();
      // Linie cięcia nożyczkami: przerywana ramka wokół każdej karty, bez znaczników na marginesie.
      buildPrint({ uklad: 'a4', ciecie: 'nozyczki', rewersy: false });
      const nozyczki = { linie: document.querySelectorAll('#druk .linia-ciecia').length, karty: document.querySelectorAll('#druk .karta:not(.rewers)').length,
        znaczniki: document.querySelectorAll('#druk .znacznik').length };
      buildPrint({ uklad: 'a4', ciecie: 'oba', rewersy: false });
      nozyczki.oba = document.querySelectorAll('#druk .znacznik').length > 0 && document.querySelectorAll('#druk .linia-ciecia').length === nozyczki.linie;
      return { karty, tlo, pasek, nozyczki };
    })()`);
    wybor.raport = await wc.executeJavaScript(`raportProjektu().then((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.innerText; })`).catch((e) => 'BŁĄD ' + e.message);
    wybor.ok = /Talia /.test(wybor.raport) && wybor.karty === 2 && wybor.tlo === 'rgb(255, 255, 255)' && !wybor.pasek
      && wybor.nozyczki.linie === wybor.nozyczki.karty && wybor.nozyczki.znaczniki === 0 && wybor.nozyczki.oba;
  }
  // Druk tylko zmienionych (--test-edytor): zapamiętanie odcisków → 0 zmian; zmiana szablonu → zmienione wszystkie.
  let zmienione = null;
  if (testBloku('zmienione') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const oryginal = fs.readFileSync(szablon, 'utf8');
    const wpisz = (t) => js(`(() => { const p = document.getElementById('edPole'); p.value = ${JSON.stringify(t)}; p.dispatchEvent(new Event('input')); })()`);
    const liczby = () => js("({ zm: +document.getElementById('zmLiczba').textContent, nowe: +document.getElementById('noweLiczba').textContent, widoczne: !document.getElementById('zmiany').hidden })");
    await js('zapamietajDruk(visibleCards())');
    const poZapisie = await liczby();
    await js('przelaczEdytor(true)');
    // Dopisany element tylko w pierwszej talii (część wspólna dotknęłaby wszystkich) – na końcu pliku = ostatnia talia.
    await wpisz(oryginal + '\n[AWERS]\nPROSTOKĄT = 1, 1, 3, 3, kolor=#ff00ff\n'); await czekaj(3500);
    const poZmianie = await liczby();
    const porownanie = await js("pokazPorownanie(true); document.querySelectorAll('#porownanie .para').length");
    await js('pokazPorownanie(false)');
    await js("buildPrint({ karty: kartyEksportu({ ktore: 'zmienione' }) })");
    const doDruku = await js("document.querySelectorAll('#druk .karta:not(.rewers)').length");
    await wpisz(oryginal); await czekaj(3500);
    const poPowrocie = await liczby();
    await js('przelaczEdytor(false)');              // jak po bloku edytor – kolejne bloki bez edytora (#88)
    zmienione = { poZapisie, poZmianie, porownanie, doDruku, poPowrocie };
    zmienione.ok = poZapisie.widoczne && poZapisie.zm === 0 && poZapisie.nowe === 0 && poZmianie.zm > 0
      && porownanie >= Math.min(poZmianie.zm, 40) && doDruku === poZmianie.zm && poPowrocie.zm === 0;
  }
  // Historia wersji (--test-edytor): punkt „otwarcie”, kopia po zmianie z zewnątrz, podgląd i przywrócenie.
  let hist = null;
  if (testBloku('hist') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const oryginal = fs.readFileSync(szablon, 'utf8');
    const lista = () => js('window.generatorApp.historiaLista()');
    const przed = await lista();
    const otwarcie = przed.punkty.find((p) => p.powod === 'otwarcie');
    const kopie = (l) => l.wersje.filter((v) => szablon.endsWith(v.plik)).length;
    const kopiePrzed = kopie(przed);
    fs.writeFileSync(szablon, oryginal + '\n; zmiana z innego edytora\n'); await czekaj(4500);
    const bezKopii = kopie(await lista()) === kopiePrzed;            // zwykła zmiana pliku – bez kopii
    await js('siatkaHistorii(0)');                                     // siatka bezpieczeństwa (bez czekania godziny)
    const po = await lista();
    const kopieSzablonu = kopie(po);
    fs.writeFileSync(szablon, oryginal + '\n; druga zmiana\n'); await czekaj(2500);
    await js('siatkaHistorii()');                                      // ostatnia kopia sprzed chwili – bez nowej
    const siatkaOdstep = kopie(await lista()) === kopieSzablonu;
    await js('pokazHistorie(true)');
    const wiersze = await js("document.querySelectorAll('#historia .wiersz').length");
    const diff = await js(`(async () => { const b = document.querySelector('#historia .wiersz:last-child [data-akcja="zmiany"]'); const sz = b.closest('.wiersz').querySelector('.szczegoly'); await akcjaHistorii(b, +b.closest('.wiersz').dataset.czas); return sz.innerText; })()`);
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-historia.png', (await wc.capturePage()).toPNG());
    await js(`podgladWersji(${otwarcie ? otwarcie.czas : 0})`);
    const baner = await js("!document.getElementById('wersjaBaner').hidden && / kart /.test(document.getElementById('status').textContent)");
    await js(`przywrocWersje(${otwarcie ? otwarcie.czas : 0})`); await czekaj(3500);
    const przywrocony = fs.readFileSync(szablon, 'utf8') === oryginal;
    // Skrzynka: punkt z opisem od zewnętrznego narzędzia trafia do historii sam.
    const skr = path.join(projekt, historia.FOLDER, historia.SKRZYNKA, 'test');
    const rel = path.relative(projekt, szablon);
    fs.mkdirSync(path.dirname(path.join(skr, rel)), { recursive: true });
    fs.writeFileSync(path.join(skr, rel), oryginal + '\n; ze skrzynki\n');
    fs.writeFileSync(path.join(skr, 'opis.txt'), 'Claude: test skrzynki');
    await czekaj(4000);
    const zeSkrzynki = (await lista()).punkty.some((p) => p.etykieta === 'Claude: test skrzynki') && !fs.existsSync(skr);
    const punkty = (await lista()).punkty.map((p) => p.powod);
    await js('pokazHistorie(false)');
    hist = { otwarcie: !!otwarcie, bezKopii, siatkaOdstep, kopieSzablonu, wiersze, diff: diff.slice(0, 120), baner, przywrocony, punkty, zeSkrzynki };
    hist.ok = !!otwarcie && bezKopii && siatkaOdstep && kopieSzablonu === kopiePrzed + 1 && po.punkty.some((p) => p.powod === 'siatka' && p.etykieta === 'Siatka bezpieczeństwa')
      && po.punkty.some((p) => p.powod === 'eksport') && wiersze >= 2 && /druga zmiana/.test(diff) && baner && przywrocony
      && punkty.includes('przed przywróceniem') && zeSkrzynki;
  }
  // Eksport playingcards.io (poza przykładami): nowy pokój – stos na talię, wszystkie karty.
  let pcio = null;
  if (!jestPrzykladem(szablon)) {
    pcio = await wc.executeJavaScript(`exportPcio().then((r) => ({ ...r, talieWidok: document.querySelectorAll('#podglad .talia').length,
      kartyWidok: document.querySelectorAll('#podglad .karta:not(.rewers)').length }), (e) => ({ blad: String((e && (e.message || e.type)) || e) }))`);
    const zip = pcio && pcio.plik && fs.existsSync(pcio.plik) ? fs.readFileSync(pcio.plik) : null;
    pcio.ok = !!zip && zip.slice(0, 2).toString() === 'PK' && pcio.holdery === pcio.talieWidok && pcio.karty === pcio.kartyWidok;
  }
  // Okna eksportu (--test-edytor, poza przykładami): PNG 300 dpi przez okno, zapamiętane ustawienia, okno druku.
  let okna = null;
  if (testBloku('okna') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const exportDir = path.join(projekt, 'Export');
    const przed = new Set(fs.existsSync(exportDir) ? fs.readdirSync(exportDir) : []);
    await js(`(async () => { const p = oknoObrazkow(); const f = document.getElementById('oknoForm');
      f.querySelector('[name=format][value=png]').checked = true; f.querySelector('[name=dpi][value="300"]').checked = true;
      f.querySelector('[name=rewersy]').checked = false; document.querySelector('#oknoPrzyciski .domyslny').click(); await p; })()`);
    const png = fs.readdirSync(exportDir).filter((n) => n.endsWith('.png') && !przed.has(n));
    const szer = png.length ? fs.readFileSync(path.join(exportDir, png[0])).readUInt32BE(16) : 0;
    // Oczekiwana szerokość: najwęższa karta przy 300 dpi (karta 63 mm ≈ 744 px, mini 44 mm ≈ 520 px).
    const szerMin = Math.floor(await js("(() => { return Math.min(...kartyEksportu({}).map((k) => cardMm(k)[0])) / 25.4 * 300 * 0.97; })()"));
    const zapamietane = await js(`(async () => { const p = otworzOkno('obrazki'); const f = document.getElementById('oknoForm');
      const r = { format: f.querySelector('[name=format]:checked').value, dpi: f.querySelector('[name=dpi]:checked').value, rewersy: f.querySelector('[name=rewersy]').checked };
      document.querySelector('#oknoPrzyciski button').click(); await p; return r; })()`);
    const plik = await js('window.generatorApp.eksportUstawienia()');
    const druk = await js(`(() => { window.__okno = otworzOkno('a4', 'drukuj'); const f = document.getElementById('oknoForm');
      return { pola: ['ciecie', 'rewersy', 'szkic', 'ktore'].filter((n) => f.querySelector('[name=' + n + ']')).length, domyslny: document.querySelector('#oknoPrzyciski .domyslny').textContent }; })()`);
    await czekaj(300);
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-okno.png', (await wc.capturePage()).toPNG());
    await js("document.getElementById('okno').dispatchEvent(new Event('cancel')); window.__okno");
    const kartyWidok = await js("document.querySelectorAll('#podglad .karta:not(.rewers)').length");
    okna = { png: png.length, kartyWidok, szer, zapamietane, plik: plik && plik.obrazki, druk };
    okna.ok = png.length === kartyWidok && szer >= szerMin && zapamietane.format === 'png' && zapamietane.dpi === '300' && !zapamietane.rewersy
      && plik && plik.obrazki && plik.obrazki.format === 'png' && druk.pola === 4 && druk.domyslny === 'Drukuj…';
  }
  // Okna druku (#85, etap 1, --test-edytor, każdy projekt): „Druk domowy A4…” i „PDF dla drukarni…” – każde tylko ze swoimi
  // polami, „Drukuj…” tylko w A4; zapamiętane ustawienia dawnego okna „Druk i PDF” przeniesione (każde okno bierze swoje pola);
  // zapis z okna ustawia układ zlecenia pdf, a zlecenie bierze pola okna swojego układu (ukryte pola drugiego nie przeciekają); zlecenie bez ustawień = wartości
  // domyślne jak do 0.6.6; uklad = pojedyncze – działa z ostrzeżeniem; menu Plik – pozycje i skróty. Zrzuty -okno-a4.png i
  // -okno-drukarnia.png. Ustawienia okien na końcu jak przed blokiem (także w pliku ustawień projektu).
  let oknaDruku = null;
  if (testBloku('oknaDruku')) {
    const js = (k) => wc.executeJavaScript(k);
    const ustPrzed = await js('JSON.stringify(USTAWIENIA_OKIEN)');
    const bledy = [];
    oknaDruku = { bledy };
    try {
      // Zapamiętane ustawienia dawnego okna (0.6.6): układ drukarnia, wszystkie pola inne niż domyślne.
      const DAWNE = { uklad: 'drukarnia', ciecie: 'oba', wspolne: false, przesuniecieX: 1.5, przesuniecieY: -0.5, szkic: true, spad: 2, strony: 'naprzemian',
        cmyk: true, profil: 'fogra51', nadrukCzerni: false, rewersy: false, ktore: 'wszystkie', pominTalie: [] };
      // Domyślne zlecenia bez żadnych ustawień – jak dawnego okna (te same klucze i wartości).
      oknaDruku.domyslneZlecenia = await js(`(() => { const p = USTAWIENIA_OKIEN; USTAWIENIA_OKIEN = {};
        try { return opcjeZlecenia('pdf', {}).o; } finally { USTAWIENIA_OKIEN = p; } })()`);
      const dz = oknaDruku.domyslneZlecenia, OCZ = { uklad: 'a4', ciecie: 'znaczniki', spad: 3, strony: 'osobno', rewersy: true, wspolne: true, przesuniecieX: 0, przesuniecieY: 0, szkic: false, ktore: 'wszystkie', cmyk: false };
      for (const [k, v] of Object.entries(OCZ)) if (dz[k] !== v) bledy.push(`zlecenie bez ustawień: ${k} = ${JSON.stringify(dz[k])}, oczekiwane ${JSON.stringify(v)}`);
      await js(`USTAWIENIA_OKIEN = { druk: ${JSON.stringify(DAWNE)} }; odswiezCmyk()`);
      // Stan otwartego okna: nazwy pól, przyciski, przycisk domyślny, wartości.
      const POLA = ['uklad', 'ciecie', 'wspolne', 'przesuniecieX', 'przesuniecieY', 'szkic', 'spad', 'strony', 'cmyk', 'profil', 'nadrukCzerni', 'rewersy', 'ktore', 'drukarnia', 'wlSpad'];
      const otworz = (rodzaj) => js(`(() => { window.__okno = otworzOkno('${rodzaj}'); const f = document.getElementById('oknoForm'), q = (n) => f.querySelector('[name=' + n + ']');
        const zazn = (n) => (f.querySelector('[name=' + n + ']:checked') || {}).value;
        return { tytul: document.getElementById('oknoTytul').textContent, pola: ${JSON.stringify(POLA)}.filter(q),
          przyciski: [...document.querySelectorAll('#oknoPrzyciski button')].map((b) => b.textContent), domyslny: document.querySelector('#oknoPrzyciski .domyslny').textContent,
          ciecie: zazn('ciecie'), wspolne: q('wspolne') && q('wspolne').checked, przesuniecieX: q('przesuniecieX') && q('przesuniecieX').value,
          szkic: q('szkic') && q('szkic').checked, rewersy: q('rewersy') && q('rewersy').checked, spad: zazn('spad'), spadWylaczony: !!q('spad') && q('spad').disabled,
          strony: zazn('strony'), drukarnia: zazn('drukarnia'), wlSpad: q('wlSpad') && q('wlSpad').value, profil: q('profil') && q('profil').value, profilWylaczony: !!q('profil') && q('profil').disabled, nadruk: q('nadrukCzerni') && q('nadrukCzerni').checked };
      })()`);
      const zrzut = async (nazwa) => { await czekaj(300); fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-okno-' + nazwa + '.png', (await wc.capturePage()).toPNG()); };
      const klik = (akcja) => js(`(async () => { document.querySelector('#oknoPrzyciski [data-akcja="${akcja}"]').click(); return await window.__okno; })()`);
      // a) Druk domowy A4
      const a4 = oknaDruku.a4 = await otworz('a4');
      await zrzut('a4');
      if (a4.tytul !== 'Druk domowy A4') bledy.push('a4: tytuł ' + a4.tytul);
      if (a4.pola.join() !== 'ciecie,wspolne,przesuniecieX,przesuniecieY,szkic,rewersy,ktore') bledy.push('a4: pola ' + a4.pola.join());
      if (a4.przyciski.join() !== 'Anuluj,Zapisz PDF,Drukuj…' || a4.domyslny !== 'Drukuj…') bledy.push('a4: przyciski ' + a4.przyciski.join() + ' / ' + a4.domyslny);
      if (a4.ciecie !== 'oba' || a4.wspolne !== false || a4.przesuniecieX !== '1.5' || a4.szkic !== true || a4.rewersy !== false) bledy.push('a4: nie przeniesiono ustawień ' + JSON.stringify(a4));
      const rA4 = oknaDruku.zapisA4 = await klik('pdf');
      const poA4 = await js('({ a4: USTAWIENIA_OKIEN.a4, druk: USTAWIENIA_OKIEN.druk, zlecenie: opcjeZlecenia("pdf", {}).o, zlecDr: opcjeZlecenia("pdf", { uklad: "drukarnia" }).o })');
      if (!rA4 || rA4.akcja !== 'pdf' || rA4.opcje.uklad !== 'a4' || rA4.opcje.ciecie !== 'oba') bledy.push('a4: wynik okna ' + JSON.stringify(rA4));
      if (!poA4.a4 || 'uklad' in poA4.a4 || 'spad' in poA4.a4 || poA4.a4.ciecie !== 'oba') bledy.push('a4: zapamiętane ' + JSON.stringify(poA4.a4));
      // zlecenie bez uklad – układ okna użytego ostatnio i jego pola; uklad = drukarnia – pola drukarni przeniesione z dawnego okna, szkic A4 nie przecieka
      const zA = poA4.zlecenie, zD = poA4.zlecDr;
      if (poA4.druk.uklad !== 'a4' || zA.uklad !== 'a4' || zA.ciecie !== 'oba' || zA.szkic !== true || zA.przesuniecieX !== 1.5) bledy.push('a4: zlecenie po zapisie ' + JSON.stringify(zA));
      if (zD.uklad !== 'drukarnia' || zD.spad !== 2 || zD.strony !== 'naprzemian' || zD.szkic !== false || zD.ciecie !== 'znaczniki') bledy.push('a4: zlecenie drukarnia ' + JSON.stringify(zD));
      // b) PDF dla drukarni
      const dr = oknaDruku.drukarnia = await otworz('drukarnia');
      await zrzut('drukarnia');
      // 0.7.0 (#85, etap 2): profil drukarni; dawne pola okna (0.6.x) → „Własne ustawienia” (wybrane, bo okno drukarni było używane).
      if (dr.tytul !== 'PDF dla drukarni') bledy.push('drukarnia: tytuł ' + dr.tytul);
      if (dr.pola.join() !== 'strony,cmyk,profil,nadrukCzerni,rewersy,ktore,drukarnia,wlSpad') bledy.push('drukarnia: pola ' + dr.pola.join());
      if (dr.przyciski.join() !== 'Anuluj,Zapisz PDF' || dr.domyslny !== 'Zapisz PDF') bledy.push('drukarnia: przyciski ' + dr.przyciski.join());
      if (dr.drukarnia !== 'wlasne' || dr.wlSpad !== '2' || dr.strony !== 'naprzemian' || dr.rewersy !== false || dr.nadruk !== false
        || (!dr.profilWylaczony && dr.profil !== 'fogra51')) bledy.push('drukarnia: nie przeniesiono ustawień ' + JSON.stringify(dr));
      const rDr = oknaDruku.zapisDrukarnia = await klik('pdf');
      const poDr = await js('({ druk: USTAWIENIA_OKIEN.druk, drukarnia: USTAWIENIA_OKIEN.drukarnia, wlasne: DRUKARNIE.wlasne, zlecenie: opcjeZlecenia("pdf", {}).o, zlecA4: opcjeZlecenia("pdf", { uklad: "a4" }).o })');
      if (!rDr || rDr.opcje.uklad !== 'drukarnia' || rDr.opcje.strony !== 'naprzemian' || rDr.opcje.drukarnia !== 'wlasne' || rDr.opcje.spadProfilu !== 2) bledy.push('drukarnia: wynik okna ' + JSON.stringify(rDr && { ...rDr.opcje, profilDrukarni: undefined }));
      if (!poDr.drukarnia || poDr.drukarnia.drukarnia !== 'wlasne' || 'ciecie' in poDr.drukarnia || 'szkic' in poDr.drukarnia) bledy.push('drukarnia: zapamiętane ' + JSON.stringify(poDr.drukarnia));
      if (!poDr.wlasne || poDr.wlasne.spad !== 2 || poDr.wlasne.strony !== 'naprzemian' || !fs.existsSync(drukarnie.plikWlasnych(app.getPath('userData')))) bledy.push('drukarnia: Własne ustawienia nie zapisane ' + JSON.stringify(poDr.wlasne));
      const zDr = poDr.zlecenie, zA4 = poDr.zlecA4;
      if (poDr.druk.uklad !== 'drukarnia' || zDr.uklad !== 'drukarnia' || zDr.strony !== 'naprzemian' || zDr.rewersy !== false || zDr.szkic !== false || zDr.ciecie !== 'znaczniki' || zDr.przesuniecieX !== 0)
        bledy.push('drukarnia: zlecenie po zapisie (ukryte pola A4 nie mogą przeciec) ' + JSON.stringify(zDr));
      if (zA4.uklad !== 'a4' || zA4.szkic !== true || zA4.ciecie !== 'oba' || 'strony' in zA4 && zA4.strony !== 'osobno') bledy.push('drukarnia: zlecenie a4 ' + JSON.stringify(zA4));
      // c) Okno z własnymi ustawieniami nie bierze już pól z zestawu zlecenia.
      const wlasne = await js(`(() => { USTAWIENIA_OKIEN.druk = { ...USTAWIENIA_OKIEN.druk, ciecie: 'nozyczki' }; return ustawieniaOkna('a4').ciecie; })()`);
      if (wlasne !== 'oba') bledy.push('a4: własne ustawienia nadpisane zestawem zlecenia: ' + wlasne);
      // d) Zlecenie pdf: uklad = pojedyncze działa (zgodność) z ostrzeżeniem; inne układy bez niego.
      oknaDruku.pojedyncze = await js(`(() => { const z = (u) => opcjeZlecenia('pdf', { uklad: u });
        const p = z('pojedyncze'), o = z('osobne'), d = z('drukarnia'), a = z('a4'), jest = (x) => x.ostrzezenia.some((t) => /pojedyncze.*przestarzały/.test(t));
        return { uklad: p.o.uklad, ostrzezenie: jest(p), alias: o.o.uklad === 'pojedyncze' && jest(o), inne: jest(d) || jest(a) }; })()`);
      const pj = oknaDruku.pojedyncze;
      if (pj.uklad !== 'pojedyncze' || !pj.ostrzezenie || !pj.alias || pj.inne) bledy.push('zlecenie pojedyncze: ' + JSON.stringify(pj));
      // e) Menu Plik: dwie pozycje ze skrótami, bez dawnych „Drukuj…” / „Zapisz PDF…”; pozycja otwiera swoje okno.
      const plikM = Menu.getApplicationMenu().items.find((i) => i.label === 'Plik').submenu.items;
      const poz = (l) => plikM.find((i) => i.label === l);
      oknaDruku.menu = { a4: poz('Druk domowy A4…') && poz('Druk domowy A4…').accelerator, drukarnia: poz('PDF dla drukarni…') && poz('PDF dla drukarni…').accelerator,
        dawne: plikM.some((i) => i.label === 'Drukuj…' || i.label === 'Zapisz PDF…') };
      for (const [l, rodzaj] of [['Druk domowy A4…', 'Druk domowy A4'], ['PDF dla drukarni…', 'PDF dla drukarni']]) {
        if (!poz(l)) continue;
        poz(l).click();
        let t = null;
        for (let i = 0; i < 30 && !(t && t.otwarte); i++) { await czekaj(200); t = await js("({ otwarte: document.getElementById('okno').open, tytul: document.getElementById('oknoTytul').textContent })"); }
        oknaDruku.menu[rodzaj] = t;
        if (!t.otwarte || t.tytul !== rodzaj) bledy.push('menu: ' + l + ' → ' + JSON.stringify(t));
        await js("document.getElementById('okno').dispatchEvent(new Event('cancel'))");
        await czekaj(100);
      }
      const m = oknaDruku.menu;
      if (m.a4 !== 'CmdOrCtrl+P' || m.drukarnia !== 'Shift+CmdOrCtrl+S' || m.dawne) bledy.push('menu: ' + JSON.stringify(m));
    } catch (e) { bledy.push('wyjątek: ' + ((e && e.message) || e)); }
    finally {
      fs.rmSync(drukarnie.plikWlasnych(app.getPath('userData')), { force: true });     // Własne ustawienia z testu – nie dla kolejnych bloków
      await js(`(async () => { if (document.getElementById('okno').open) document.getElementById('okno').dispatchEvent(new Event('cancel'));
        USTAWIENIA_OKIEN = ${ustPrzed}; DRUKARNIE.wlasne = null; try { await window.generatorApp.zapiszEksportUstawienia(USTAWIENIA_OKIEN); } catch (e) {} })()`);
    }
    oknaDruku.ok = !bledy.length;
  }
  // Drukarnia (--test-edytor): strona na kopię (awers, rewers…), strona = karta + 2 × spad.
  let drukarnia = null;
  if (testBloku('drukarnia')) {
    drukarnia = await wc.executeJavaScript(`(() => {
      const karty = kartyEksportu({});
      const rewersy = karty.filter((k) => backOf(k.dataset.talia)).length;
      buildPrint({ uklad: 'drukarnia', spad: 2, strony: 'naprzemian', karty });
      const strony = document.querySelectorAll('#druk .arkusz');
      const [w, h] = cardMm(karty[0]), s = spadDruku(karty, 2).s;      // spad z szablonu (#84) ma pierwszeństwo
      return { strony: strony.length, oczekiwane: karty.length + rewersy, rozmiar: strony[0].style.width + ' ' + strony[0].style.height,
        karta: Math.min(w, h) + 2 * s + 'mm ' + (Math.max(w, h) + 2 * s) + 'mm', znaczniki: document.querySelectorAll('#druk .znacznik').length,
        raport: /Obrazki poniżej 300 dpi/.test(document.getElementById('raport').innerHTML) };
    })()`);
    drukarnia.raport = /Obrazki poniżej 300 dpi/.test(await wc.executeJavaScript('raportProjektu()'));
    drukarnia.ok = drukarnia.strony === drukarnia.oczekiwane && drukarnia.rozmiar === drukarnia.karta && drukarnia.znaczniki === 0 && drukarnia.raport;
    // Przesunięcie rewersów (A4): siatka rewersów o +1,5 / −2 mm względem awersów, awersy bez zmian.
    drukarnia.przesuniecie = await wc.executeJavaScript(`(() => {
      buildPrint({ uklad: 'a4', przesuniecieX: 1.5, przesuniecieY: -2, karty: kartyEksportu({}) });
      const a = document.querySelectorAll('#druk .arkusz .uklad');
      if (a.length < 2) return { brak: true };
      const d = (x, y) => Math.round((parseFloat(x) - parseFloat(y)) * 100) / 100;
      const r = { dx: d(a[1].style.left, a[0].style.left), dy: d(a[1].style.top, a[0].style.top) };
      buildPrint({ uklad: 'a4', karty: kartyEksportu({}) });
      const b = document.querySelectorAll('#druk .arkusz .uklad');
      r.bez = d(b[1].style.left, b[0].style.left) === 0 && d(b[1].style.top, b[0].style.top) === 0;
      return r;
    })()`);
    const pr = drukarnia.przesuniecie;
    drukarnia.ok = drukarnia.ok && (pr.brak || (pr.dx === 1.5 && pr.dy === -2 && pr.bez));
  }
  // PDF dla drukarni (issue #66, --test-edytor, każdy projekt, pliki w katalogu tymczasowym): a) osobno, spad 3,
  // b) naprzemian, spad 2, c) bez rewersów, d) okno Druk i PDF (spad, strony), e) raport drukarni (sekcje, odstęp, czerń).
  // Oczekiwania (liczba plików i stron) liczone z DOM – wygląd rewersu jak w wygladRewersu() w karty.html.
  let drukarniaPdf = null;
  if (testBloku('drukarniaPdf')) {
    const js = (k) => wc.executeJavaScript(k);
    const { PDFDocument } = require(path.join(ZASOBY, 'vendor', 'pdf-lib.min.js'));
    const MMpt = 72 / 25.4, bliskie = (a, b) => Math.abs(a - b) <= 0.01;
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gk-drukarnia-'));
    const o = await js(`(() => {
      const karty = kartyEksportu({});
      const wyglady = new Set(); let zRewersem = 0;
      const kom = karty.map((k) => { const [w, h] = cardMm(k); const b = backOf(k.dataset.talia);
        if (b) { zRewersem++; wyglady.add(w + 'x' + h + '|' + b.style.cssText + '|' + b.innerHTML); }
        return [Math.min(w, h), Math.max(w, h)]; });
      return { karty: karty.length, zRewersem, wyglady: wyglady.size, szer: Math.max(...kom.map((c) => c[0])), wys: Math.max(...kom.map((c) => c[1])),
        zad: Math.max(0, ...karty.map((k) => spadTalii(k.dataset.talia))) };
    })()`);
    const bledy = [];
    const sp = (x) => o.zad || x;                       // spad z szablonu (#84) wygrywa ze spadem z okna
    // Plan → zapis przez pdfDoPliku (jak IPC) → kontrola każdego pliku pdf-lib-em.
    const przebieg = async (nazwa, opcje, spad, strony, szerMm, wysMm) => {
      const b = [];
      const plan = await js(`buildPrint(${JSON.stringify({ uklad: 'drukarnia', ...opcje })})`);
      const lista = await pdfDoPliku(wc, path.join(tmp, nazwa + '.pdf'), plan);
      const wPlanie = plan.pliki.map((_, n) => plan.strony.filter((s) => s.plik === n)).filter((a) => a.length);
      if (!bliskie(plan.szer, szerMm) || !bliskie(plan.wys, wysMm) || plan.spad !== spad) b.push(`plan: ${plan.szer}×${plan.wys} spad ${plan.spad}, oczekiwano ${szerMm}×${wysMm} spad ${spad}`);
      if (lista.length !== strony.length) b.push(`plików ${lista.length}, oczekiwano ${strony.length}`);
      if (wPlanie.map((a) => a.length).join() !== strony.join()) b.push(`strony w planie ${wPlanie.map((a) => a.length)}, oczekiwano ${strony}`);
      const W = szerMm * MMpt, H = wysMm * MMpt;
      let przySpadzie = 0;
      for (let n = 0; n < lista.length; n++) {
        if (!fs.existsSync(lista[n])) { b.push('brak pliku ' + lista[n]); continue; }
        if (lista.length === 2 && !lista[n].endsWith(n ? ' – rewersy.pdf' : ' – awersy.pdf')) b.push('nazwa pliku ' + path.basename(lista[n]));
        if (lista.length === 1 && !lista[0].endsWith(nazwa + '.pdf')) b.push('nazwa pliku ' + path.basename(lista[0]));
        const strony_ = (await PDFDocument.load(fs.readFileSync(lista[n]))).getPages();
        if (strony_.length !== strony[n]) b.push(`plik ${n}: stron ${strony_.length}, oczekiwano ${strony[n]}`);
        strony_.forEach((s, i) => {
          const mb = s.getMediaBox(), tb = s.getTrimBox(), bb = s.getBleedBox(), cb = s.getCropBox();
          if (!(bliskie(mb.x, 0) && bliskie(mb.y, 0) && bliskie(mb.width, W) && bliskie(mb.height, H))) b.push(`plik ${n} str. ${i + 1}: MediaBox ${[mb.x, mb.y, mb.width, mb.height].map((x) => x.toFixed(2))}`);
          for (const [nz, x] of [['BleedBox', bb], ['CropBox', cb]]) if (!(bliskie(x.x, mb.x) && bliskie(x.y, mb.y) && bliskie(x.width, mb.width) && bliskie(x.height, mb.height))) b.push(`plik ${n} str. ${i + 1}: ${nz} ≠ MediaBox`);
          const l = tb.x, d = tb.y, p = W - tb.x - tb.width, g = H - tb.y - tb.height, min = spad * MMpt - 0.01;
          if (!(bliskie(l, p) && bliskie(d, g)) || Math.min(l, p, d, g) < min) b.push(`plik ${n} str. ${i + 1}: TrimBox ${[l, p, d, g].map((x) => x.toFixed(2))} (marginesy)`);
          if (bliskie(l, spad * MMpt) && bliskie(d, spad * MMpt)) przySpadzie++;
          const c = wPlanie[n][i] && wPlanie[n][i].ciecie;       // zgodność z planem: [x, y, w, h] od lewego górnego rogu
          if (!c || !bliskie(tb.x, c[0] * MMpt) || !bliskie(tb.width, c[2] * MMpt) || !bliskie(tb.height, c[3] * MMpt) || !bliskie(tb.y, H - (c[1] + c[3]) * MMpt)) b.push(`plik ${n} str. ${i + 1}: TrimBox ≠ ciecie z planu`);
        });
      }
      if (!przySpadzie) b.push('żadna strona nie ma TrimBox = MediaBox − spad (karta największego rozmiaru)');
      bledy.push(...b.map((x) => nazwa + ': ' + x));
      return { nazwa, pliki: lista.map((p) => path.basename(p)), strony, szer: szerMm, wys: wysMm, bledy: b };
    };
    const osobnoStrony = !o.zRewersem ? [o.karty] : (o.wyglady === 1 && o.zRewersem === o.karty ? [o.karty + 1] : [o.karty, o.karty]);
    drukarniaPdf = { oczekiwanie: o };
    drukarniaPdf.osobno = await przebieg('osobno', { spad: 3, strony: 'osobno' }, sp(3), osobnoStrony, o.szer + 2 * sp(3), o.wys + 2 * sp(3));
    drukarniaPdf.naprzemian = await przebieg('naprzemian', { spad: 2, strony: 'naprzemian' }, sp(2), [o.karty + o.zRewersem], o.szer + 2 * sp(2), o.wys + 2 * sp(2));
    drukarniaPdf.bezRewersow = await przebieg('bez-rewersow', { spad: 3, strony: 'osobno', rewersy: false }, sp(3), [o.karty], o.szer + 2 * sp(3), o.wys + 2 * sp(3));
    // d) okno PDF dla drukarni (0.7.0 – „Własne ustawienia” bez zapisanego pliku): domyślnie spad 3 i strony „osobno”;
    //    zapamiętany w oknie 0.6.x spad 2,5 → wybrane Własne ustawienia ze spadem 2,5.
    drukarniaPdf.okno = await js(`(async () => {
      const przed = USTAWIENIA_OKIEN.druk, przedD = USTAWIENIA_OKIEN.drukarnia, f = () => document.getElementById('oknoForm');
      const stan = async (ust) => {
        if (ust) USTAWIENIA_OKIEN.drukarnia = ust; else delete USTAWIENIA_OKIEN.drukarnia;
        delete USTAWIENIA_OKIEN.druk;
        const p = otworzOkno('drukarnia');
        const r = { drukarnia: (f().querySelector('[name=drukarnia]:checked') || {}).value, spad: (f().querySelector('[name=wlSpad]') || {}).value,
          strony: [...f().querySelectorAll('[name=strony]')].map((x) => x.value), stronyWybrane: (f().querySelector('[name=strony]:checked') || {}).value };
        document.getElementById('okno').dispatchEvent(new Event('cancel')); await p;
        return r;
      };
      const wl = DRUKARNIE.wlasne; DRUKARNIE.wlasne = null;
      try { return { domyslnie: await stan(null), zapamietane: await stan({ spad: 2.5 }) }; }
      finally { DRUKARNIE.wlasne = wl; if (przed) USTAWIENIA_OKIEN.druk = przed; else delete USTAWIENIA_OKIEN.druk; if (przedD) USTAWIENIA_OKIEN.drukarnia = przedD; else delete USTAWIENIA_OKIEN.drukarnia; }
    })()`);
    const ow = drukarniaPdf.okno;
    drukarniaPdf.okno.ok = ow.domyslnie.spad === '3' && ow.domyslnie.strony.join() === 'osobno,dwapliki,naprzemian' && ow.domyslnie.stronyWybrane === 'osobno'
      && ow.zapamietane.drukarnia === 'wlasne' && ow.zapamietane.spad === '2.5';
    if (!ow.ok) bledy.push('okno: ' + JSON.stringify(ow));
    // e) raport drukarni: sekcje tylko z drukarnia: true.
    const sekcje = await js(`(async () => ({ z: (await raportJson({ drukarnia: true })).map((x) => x.tytul), bez: (await raportJson({})).map((x) => x.tytul) }))()`);
    drukarniaPdf.raport = { z: sekcje.z.filter((t) => t.startsWith('Drukarnia:')).length, pierwsze: sekcje.z.slice(0, 8).every((t) => t.startsWith('Drukarnia:')), bez: sekcje.bez.filter((t) => t.startsWith('Drukarnia:')).length };
    drukarniaPdf.raport.ok = drukarniaPdf.raport.z === 8 && drukarniaPdf.raport.pierwsze && drukarniaPdf.raport.bez === 0;
    if (!drukarniaPdf.raport.ok) bledy.push('raport: ' + JSON.stringify(drukarniaPdf.raport));
    // Zmiana szablonu (tylko testowa kopia): tekst 1 mm od krawędzi, kolor „prawie czerń” – w pierwszej talii, przed jej [REWERS].
    if (!jestPrzykladem(szablon)) {
      const oryginal = fs.readFileSync(szablon, 'utf8');
      const edytorByl = !(await js("document.getElementById('edytor').hidden"));
      const wpisz = (t) => js(`(() => { const p = document.getElementById('edPole'); p.value = ${JSON.stringify(t)}; p.dispatchEvent(new Event('input')); })()`);
      const talia = await js("document.querySelector('#podglad .talia').dataset.talia");
      const start = Math.max(0, oryginal.search(/^\[TALIA\b/mi));
      const nast = oryginal.slice(start + 1).search(/^\[TALIA\b/mi);
      const koniec = nast < 0 ? oryginal.length : start + 1 + nast;
      const wBloku = oryginal.slice(start, koniec).search(/^\[REWERS\]/mi);
      const miejsce = wBloku < 0 ? koniec : start + wBloku;
      const dopisek = '\nTEKST = 1, 1, 40, 8, "Próba drukarni", rozmiar=10, kolor=#2a1a3a\n';
      await js('przelaczEdytor(true)');
      await wpisz(oryginal.slice(0, miejsce) + dopisek + oryginal.slice(miejsce)); await czekaj(3500);
      const z = await js('raportDrukarni()');
      await wpisz(oryginal); await czekaj(3500);
      const po = await js('raportDrukarni()');
      if (!edytorByl) await js('przelaczEdytor(false)');
      const probaOdstep = (r) => r.odstep.filter((x) => x.tekst === 'Próba drukarni');
      drukarniaPdf.szablon = { talia,
        zmiana: { odstep: z.odstep.filter((x) => x.talia === talia).map((x) => x.odstep).slice(0, 3), czern: z.czern.map((x) => x.kolor) },
        po: { odstepProba: probaOdstep(po).length, czern: po.czern.map((x) => x.kolor) } };
      drukarniaPdf.szablon.ok = z.odstep.some((x) => x.talia === talia && x.odstep >= 0.8 && x.odstep <= 1.6) && z.czern.some((x) => x.kolor.toLowerCase() === '#2a1a3a')
        && !po.czern.some((x) => x.kolor.toLowerCase() === '#2a1a3a') && !probaOdstep(po).some((x) => x.odstep < 1.6);
      if (!drukarniaPdf.szablon.ok) bledy.push('szablon: ' + JSON.stringify(drukarniaPdf.szablon));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    drukarniaPdf.bledy = bledy;
    drukarniaPdf.ok = !bledy.length;
  }
  // Spad obrazków przy krawędzi (#74; --test-edytor, poza przykładami – zmienia szablon testowej kopii i dopisuje obrazek):
  // do pierwszej talii trafiają obrazek „wypełnij” (3 krawędzie) i „rozciągnij” (dolna krawędź) o znanym rozmiarze.
  // a) DOM: obraz w klonie ze spadem ma tę samą skalę i położenie co w pierwotnej ramce;
  // b) PDF drukarni ze spadem 0 i 3 mm → pdftoppm 254 dpi (1 mm = 10 px) → obszar cięcia (TrimBox) piksel po pikselu:
  //    w ramkach obrazków średnia różnica < 2/255 i < 1 % pikseli różnych o > 32 (wygładzanie krawędzi); bez pdftoppm – tylko a);
  // c) Raport drukarni zgłasza obrazek, który w spadzie nie ma czym wypełnić tła (nadmiar cover < 3 mm).
  let spadTest = null;
  if (testBloku('spadTest') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const bledy = [];
    spadTest = {};
    const oryginal = fs.readFileSync(szablon, 'utf8');
    const edytorByl = !(await js("document.getElementById('edytor').hidden"));
    const wpisz = (t) => js(`(() => { const p = document.getElementById('edPole'); p.value = ${JSON.stringify(t)}; p.dispatchEvent(new Event('input')); })()`);
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gk-spad-'));
    const obrazek = path.join(projekt, 'spad-test.png');
    try {
      // PNG 400 × 200 px (2 : 1): szachownica 32 px + gradient – każda zmiana skali widać w pikselach.
      const NW = 400, NH = 200, bmp = Buffer.alloc(NW * NH * 4);
      for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
        const i = (y * NW + x) * 4, sz = (((x >> 5) + (y >> 5)) & 1) ? 255 : 40;
        bmp[i] = sz; bmp[i + 1] = Math.round(y * 255 / NH); bmp[i + 2] = Math.round(x * 255 / NW); bmp[i + 3] = 255;   // BGRA
      }
      fs.writeFileSync(obrazek, require('electron').nativeImage.createFromBitmap(bmp, { width: NW, height: NH }).toPNG());
      const talia = await js("document.querySelector('#podglad .talia').dataset.talia");
      // Talia ze spadem w szablonie (#84) ma obrazki przy krawędzi z plikiem ze spadem – dorabianie spadu (#74) jej nie dotyczy.
      if (await js(`spadTalii(${JSON.stringify(talia)})`)) throw Object.assign(new Error('pominięty'), { pominiety: true });
      const pierwsza = `document.querySelector('#podglad .talia[data-talia=' + JSON.stringify(${JSON.stringify(talia)}) + '] .karta:not(.rewers)')`;
      const [kw, kh] = await js(`cardMm(${pierwsza})`);
      const start = Math.max(0, oryginal.search(/^\[TALIA\b/mi));
      const nast = oryginal.slice(start + 1).search(/^\[TALIA\b/mi);
      const koniec = nast < 0 ? oryginal.length : start + 1 + nast;
      const wBloku = oryginal.slice(start, koniec).search(/^\[REWERS\]/mi);
      const miejsce = wBloku < 0 ? koniec : start + wBloku;
      // Ramka 1: 3 krawędzie (lewa, górna, prawa), 30 mm wysokości – obraz 2 : 1 jest w niej szerszy niż wyższy,
      // więc nadmiar jest tylko w pionie; ramka 2: dolna krawędź, rozciągnięty obraz (nic nie wystaje).
      const r1 = [0, 0, kw, 30], r2 = [kw / 4, kh - 15, kw / 2, 15];
      const dopisek = `\nOBRAZEK = ${r1.join(', ')}, spad-test.png, dopasuj=wypełnij\nOBRAZEK = ${r2.join(', ')}, spad-test.png, dopasuj=rozciągnij\n`;
      await js('przelaczEdytor(true)');
      await wpisz(oryginal.slice(0, miejsce) + dopisek + oryginal.slice(miejsce)); await czekaj(3500);
      // a) geometria w klonie ze spadem
      spadTest.dom = await js(`(() => {
        const k = ${pierwsza};
        const [w, h] = cardMm(k), s = 3, PX = 96 / 25.4;
        const c = kartaZeSpadem(k, w, h, s);
        const tlo = document.createElement('div'); tlo.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden'; tlo.appendChild(c); document.body.appendChild(tlo);
        try {
          const cr = c.getBoundingClientRect();
          return [...c.querySelectorAll('.el.obrazek img')].filter((i) => /spad-test/.test(URL_PLIK.get(i.src) || '')).map((i) => {
            const r = i.getBoundingClientRect(), f = i.parentElement.getBoundingClientRect();
            return { x: (r.left - cr.left) / PX - s, y: (r.top - cr.top) / PX - s, w: r.width / PX, h: r.height / PX,
              fx: (f.left - cr.left) / PX - s, fy: (f.top - cr.top) / PX - s, fw: f.width / PX, fh: f.height / PX };
          });
        } finally { tlo.remove(); }
      })()`);
      const bl = (a, b) => Math.abs(a - b) < 0.05;
      const [i1, i2] = spadTest.dom;
      const sk1 = Math.max(kw / 400, 30 / 200);       // skala cover w pierwotnej ramce (mm na px obrazu)
      if (!i1 || !bl(i1.w, 400 * sk1) || !bl(i1.h, 200 * sk1) || !bl(i1.x, (kw - 400 * sk1) / 2) || !bl(i1.y, (30 - 200 * sk1) / 2)) bledy.push('dom: wypełnij ' + JSON.stringify(i1));
      if (!i1 || !bl(i1.fx, -3) || !bl(i1.fy, -3) || !bl(i1.fw, kw + 6) || !bl(i1.fh, 33)) bledy.push('dom: ramka wypełnij ' + JSON.stringify(i1));
      if (!i2 || !bl(i2.x, r2[0]) || !bl(i2.y, r2[1]) || !bl(i2.w, r2[2]) || !bl(i2.h, r2[3]) || !bl(i2.fh, 18) || !bl(i2.fy, r2[1])) bledy.push('dom: rozciągnij ' + JSON.stringify(i2));

      // b) PDF-y ze spadem 0 i 3 → piksele
      const pdftoppm = require('child_process').spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' });
      if (pdftoppm.error) spadTest.piksele = 'brak narzędzia pdftoppm';
      else {
        const DPI = 254, pxMm = DPI / 25.4;      // 10 px / mm
        const nativeImage = require('electron').nativeImage;
        const renderuj = async (spad) => {
          const plan = await js(`buildPrint({ uklad: 'drukarnia', spad: ${spad}, strony: 'osobno', rewersy: false, karty: [${pierwsza}] })`);
          const pdf = path.join(tmp, `spad${spad}.pdf`);
          const pliki = await pdfDoPliku(wc, pdf, plan);
          const wynikPng = path.join(tmp, `spad${spad}`);
          const pp = require('child_process').spawnSync('pdftoppm', ['-r', String(DPI), '-f', '1', '-l', '1', '-png', '-singlefile', pliki[0], wynikPng], { encoding: 'utf8' });
          if (pp.status !== 0) throw new Error('pdftoppm: ' + pp.stderr);
          const obraz = nativeImage.createFromPath(wynikPng + '.png');
          return { plan, bmp: obraz.toBitmap(), rozm: obraz.getSize(), png: wynikPng + '.png' };
        };
        const A = await renderuj(0), B = await renderuj(3);
        const ciecie = (r) => r.plan.strony[0].ciecie.map((v) => Math.round(v * pxMm));
        const ca = ciecie(A), cb = ciecie(B);
        spadTest.rozmiary = { a: [A.rozm.width, A.rozm.height], b: [B.rozm.width, B.rozm.height], ciecieA: ca, ciecieB: cb };
        if (ca[2] !== cb[2] || ca[3] !== cb[3]) bledy.push('piksele: różne obszary cięcia ' + JSON.stringify([ca, cb]));
        // Chromium przyciąga położenie obrazu do pikseli CSS (0,26 mm), więc przy przesunięciu o 3 mm obraz w PDF może
        // się różnić o ≤ 0,3 mm – szukamy najlepszego przesunięcia ±3 px (0,3 mm); błąd skali o 10 % (stary kod) jest
        // dużo większy (średnia różnica > 30/255).
        const porownaj = (rect) => {      // rect w mm względem karty (po cięciu)
          const [rx, ry, rw, rh] = rect.map((v) => Math.round(v * pxMm));
          let najlepszy = null;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            let suma = 0, duze = 0, n = 0;
            for (let y = ry + 4; y < ry + rh - 4; y++) for (let x = rx + 4; x < rx + rw - 4; x++) {      // 4 px marginesu przy krawędzi ramki
              const ia = ((ca[1] + y) * A.rozm.width + ca[0] + x) * 4, ib = ((cb[1] + y + dy) * B.rozm.width + cb[0] + x + dx) * 4;
              let m = 0;
              for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(A.bmp[ia + c] - B.bmp[ib + c]));
              suma += m; if (m > 32) duze++; n++;
            }
            if (!najlepszy || suma / n < najlepszy.srednia) najlepszy = { srednia: suma / n, duze: duze / n * 100, n, dx, dy };
          }
          return { ...najlepszy, srednia: Math.round(najlepszy.srednia * 100) / 100, duze: Math.round(najlepszy.duze * 100) / 100 };
        };
        spadTest.piksele = { wypelnij: porownaj(r1), rozciagnij: porownaj(r2), progi: 'srednia < 6/255, > 32 w < 5 % pikseli, przesuniecie <= 3 px' };
        for (const nazwa of ['wypelnij', 'rozciagnij']) {
          const r = spadTest.piksele[nazwa];
          if (!(r.n > 1000 && r.srednia < 6 && r.duze < 5)) bledy.push(`piksele: ${nazwa} ${JSON.stringify(r)}`);
        }
        if (process.env.KARKA_TEST_SPAD_ZRZUT) for (const x of [A, B]) fs.copyFileSync(x.png, path.join(process.env.KARKA_TEST_SPAD_ZRZUT, path.basename(x.png)));
      }

      // c) raport drukarni: ramka 1 (lewa, górna, prawa) – zgłaszane są krawędzie, przy których obraz wystaje poza ramkę o mniej
      //    niż spad (3 mm); ramka 2 (rozciągnij) – dolna krawędź, nic nie wystaje
      const rap = await js('raportDrukarni()');
      spadTest.raport = (rap.spad || []).filter((x) => /spad-test/.test(x.plik)).map((x) => ({ karta: x.karta, brak: x.brak }));
      const zaokr = (v) => Math.round(Math.max(0, v) * 100) / 100;
      const nadX = (400 * sk1 - kw) / 2, nadY = (200 * sk1 - 30) / 2;
      const oczekiwane = [['lewa', nadX], ['prawa', nadX], ['górna', nadY]].filter(([, v]) => v < 3 - 0.01).map(([n, v]) => n + ':' + zaokr(v)).sort().join();
      const pierwsza1 = spadTest.raport.find((x) => !x.brak.some((b) => b.krawedz === 'dolna'));
      const rozciagnij = spadTest.raport.find((x) => x.brak.some((b) => b.krawedz === 'dolna'));
      const dostalem = pierwsza1 ? pierwsza1.brak.map((b) => b.krawedz + ':' + b.wystaje).sort().join() : '';
      spadTest.raportOczekiwane = oczekiwane;
      if (dostalem !== oczekiwane || !rozciagnij || rozciagnij.brak.length !== 1 || rozciagnij.brak[0].wystaje !== 0) bledy.push('raport: ' + dostalem + ' ≠ ' + oczekiwane + ' / ' + JSON.stringify(spadTest.raport.slice(0, 2)));
      const sekcje = await js(`(async () => (await raportJson({ drukarnia: true })).filter((x) => /nie sięga do końca spadu/.test(x.tytul)).length)()`);
      if (sekcje !== 1) bledy.push('raport: sekcja spadu ×' + sekcje);
    } catch (e) { if (e.pominiety) spadTest.pominiety = 'talia ze spadem w szablonie (#84)'; else bledy.push('wyjątek: ' + e.message); }
    finally {
      try { await wpisz(oryginal); await czekaj(3500); if (!edytorByl) await js('przelaczEdytor(false)'); } catch (e) { /* koniec testu */ }
      try { fs.rmSync(obrazek, { force: true }); } catch (e) { /* brak */ }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    spadTest.bledy = bledy;
    spadTest.ok = !bledy.length;
  }
  // Spad z szablonu (#84; --test-edytor, każdy projekt): KARTA = w, h, spad=N. a) parser (spad=, błędy); b) talie z deklaracją:
  // TŁO z pliku jako element na kartę + spad, obrazki przy krawędzi sięgają spadu, w karcie ze spadem (PDF drukarni) tło i
  // nakładka rysują się w pierwotnej skali i miejscu (krawędzie się pokrywają), plan.spad = spad szablonu mimo spadu z okna,
  // raport bez uwag o spadzie, plik bez spadu (proporcje karty) zgłoszony; c) talie bez deklaracji: HTML bez nowych elementów,
  // plan ze spadem z okna, ostrzeżenie w planie, raporcie i oknie.
  let spadSzablonu = null;
  if (testBloku('spadSzablonu')) {
    const js = (k) => wc.executeJavaScript(k);
    try {
      spadSzablonu = await js(`(async () => {
        const b = [], r = {};
        const p = (t) => parseTemplate(t, 'test.txt');
        const a = p('KARTA = 63, 88, spad=3\\n[TALIA X]\\n[TALIA Y]\\nKARTA = 44, 68\\n');
        r.parser = { x: a.talie[0].spad, y: a.talie[1].spad, zly: p('KARTA = 63, 88, spad=abc').bledy.length, zlyRewers: p('KARTA = 63, 88\\n[REWERS]\\nKARTA = 63, 88, spad=3').bledy.length,
          bez: p('KARTA = 63, 88').talie[0].spad, dziesietny: p('KARTA = 63, 88, spad=2.5').talie[0].spad };
        // Talia bez KARTA we własnej sekcji dziedziczy spad z części wspólnej; własna KARTA bez spad= – bez spadu.
        if (r.parser.x !== 3 || r.parser.y !== 0 || r.parser.zly !== 1 || r.parser.zlyRewers !== 1 || r.parser.bez !== 0 || r.parser.dziesietny !== 2.5) b.push('parser ' + JSON.stringify(r.parser));
        const PX = 96 / 25.4, bl = (x, y) => Math.abs(x - y) < 0.06;
        const talie = [...document.querySelectorAll('#podglad .talia')].map((t) => t.dataset.talia);
        r.talie = Object.fromEntries(talie.map((t) => [t, spadTalii(t)]));
        const zSpadem = talie.filter((t) => spadTalii(t)), bez = talie.filter((t) => !spadTalii(t));
        const karty = kartyEksportu({});
        // c) bez deklaracji
        for (const t of bez) {
          const k = document.querySelector('#podglad .talia[data-talia=' + JSON.stringify(t) + '] .karta');
          if (k.querySelector('.el.obrazek.tlo')) b.push(t + ': element tła bez deklaracji spadu');
        }
        const plan = buildPrint({ uklad: 'drukarnia', spad: 2, strony: 'osobno', karty });
        r.plan = { spad: plan.spad, zSzablonu: plan.spadZSzablonu, bezSpadu: plan.bezSpadu, ostrzezenia: plan.ostrzezenia };
        if (!zSpadem.length && (plan.spad !== 2 || plan.spadZSzablonu || plan.bezSpadu.length !== talie.length || plan.ostrzezenia.length !== 1 || !/nie deklaruje spadu/.test(plan.ostrzezenia[0]))) b.push('plan bez deklaracji ' + JSON.stringify(r.plan));
        if (zSpadem.length && (plan.spad !== Math.max(...zSpadem.map(spadTalii)) || !plan.spadZSzablonu || plan.bezSpadu.length !== bez.length)) b.push('plan z deklaracją ' + JSON.stringify(r.plan));
        buildPrint({ uklad: 'a4', karty });
        // okno PDF dla drukarni (0.7.0 – profil LongPack, spad 3 mm): ostrzeżenie przy braku deklaracji, przy pełnej – spad z szablonu
        // (równy, przycięty albo za mały – opis w podsumowaniu profilu), bez ostrzeżenia o dorabianiu.
        const pOkno = otworzOkno('drukarnia'), f = document.getElementById('oknoForm');
        const panel = f.querySelector('.profil-drukarni[data-id=longpack] .spad-profilu');
        r.okno = { ostrzezenie: !!(panel && panel.querySelector('.ostrzezenie-spadu')), tekst: panel ? panel.textContent : null };
        document.getElementById('okno').dispatchEvent(new Event('cancel')); await pOkno;
        if (bez.length && !r.okno.ostrzezenie) b.push('okno: brak ostrzeżenia');
        if (!bez.length && (r.okno.ostrzezenie || !/Spad z szablonu|przycięty|PDF nie powstanie/.test(r.okno.tekst || ''))) b.push('okno: ' + JSON.stringify(r.okno));
        // talie mieszane (sztuczne wpisy w TALIE): spad = największy zadeklarowany, ostrzeżenia dla talii bez spadu i z mniejszym
        TALIE.push({ nazwa: '__bez', spad: 0 }, { nazwa: '__dwa', spad: 2 }, { nazwa: '__trzy', spad: 3 });
        try {
          const m = spadDruku(['__bez', '__dwa', '__trzy'].map((t) => ({ dataset: { talia: t } })), 1);
          r.mieszane = m;
          if (m.s !== 3 || !m.zSzablonu || m.bez.join() !== '__bez' || m.ostrzezenia.length !== 2 || !/talie bez spadu w szablonie: __bez/.test(m.ostrzezenia[0]) || !/talia __dwa: .*bez obrazu/.test(m.ostrzezenia[1])) b.push('mieszane ' + JSON.stringify(m));
        } finally { TALIE.splice(-3); }
        // raport drukarni
        const rap = await raportDrukarni(), ss = rap.spadSzablonu;
        r.raport = { bez: ss.bez, pliki: ss.pliki.length, zmiesc: ss.zmiesc.length };
        if (ss.bez.join() !== bez.join() || ss.pliki.length || ss.zmiesc.length) b.push('raport ' + JSON.stringify(r.raport));
        // b) z deklaracją: geometria tła i nakładki
        for (const t of zSpadem) {
          const s = spadTalii(t), k = document.querySelector('#podglad .talia[data-talia=' + JSON.stringify(t) + '] .karta:not(.rewers)');
          const [w, h] = cardMm(k);
          const tlo = k.querySelector(':scope > .el.obrazek.tlo');
          if (!tlo) { b.push(t + ': brak elementu tła'); continue; }
          if (/url\\(/.test(k.style.background || '')) b.push(t + ': tło nadal w background karty');
          const ramki = [...k.querySelectorAll(':scope > .el.obrazek')].map((el) => ['left', 'top', 'width', 'height'].map((x) => parseFloat(el.style[x])));
          r[t] = { ramki };
          if (ramki[0].join() !== [-s, -s, w + 2 * s, h + 2 * s].join()) b.push(t + ': ramka tła ' + ramki[0]);
          // karta ze spadem (jak w PDF drukarni: spad + zapas 0,5 mm): obrazy na pełną kartę w miejscu i skali
          const z = s + 0.5, c = kartaZeSpadem(k, w, h, z);
          const ukr = document.createElement('div'); ukr.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden'; ukr.appendChild(c); document.body.appendChild(ukr);
          try {
            const cr = c.getBoundingClientRect();
            const obrazy = [...c.querySelectorAll('.el.obrazek img')].map((i) => { const q = i.getBoundingClientRect();
              return [(q.left - cr.left) / PX - z, (q.top - cr.top) / PX - z, q.width / PX, q.height / PX].map((v) => Math.round(v * 100) / 100); });
            r[t].wKarcieZeSpadem = obrazy;
            const pelne = obrazy.filter((o) => bl(o[2], w + 2 * s) && bl(o[3], h + 2 * s));
            if (pelne.length < 2 || !pelne.every((o) => bl(o[0], -s) && bl(o[1], -s))) b.push(t + ': tło / nakładka w karcie ze spadem ' + JSON.stringify(obrazy));
          } finally { ukr.remove(); }
          // plik bez spadu (proporcje karty) → zgłoszony w raporcie
          const kl = k.cloneNode(true), img = kl.querySelector('.el.obrazek.tlo img');
          const ukr2 = document.createElement('div'); ukr2.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden'; ukr2.appendChild(kl); document.body.appendChild(ukr2);
          try {
            img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w * 10 + '" height="' + h * 10 + '"><rect width="100%" height="100%" fill="red"/></svg>');
            await img.decode();
            const zle = plikiZeSpadem(kl);
            r[t].bezSpaduWykryty = zle.map((x) => ({ tlo: x.tlo, bezSpadu: x.bezSpadu }));
            if (!zle.some((x) => x.tlo && x.bezSpadu)) b.push(t + ': plik tła bez spadu niezgłoszony ' + JSON.stringify(zle));
          } finally { ukr2.remove(); }
          // #94: nakładka ze spadem (plik o proporcjach karty ze spadem) w ramce „zmieść” na całą kartę – raport i
          // ostrzeżenie zlecenia pdf (spadDruku); „rozciągnij” i tło (cover) – bez zgłoszeń.
          if (plikiZmiesc(k).length) b.push(t + ': plikiZmiesc zgłasza kartę bez „zmieść” ' + JSON.stringify(plikiZmiesc(k)));
          const kz = k.cloneNode(true), nak = [...kz.querySelectorAll(':scope > .el.obrazek:not(.tlo)')].find((el) => parseFloat(el.style.left) < 0);
          if (!nak) { b.push(t + ': brak nakładki ze spadem w przykładzie'); continue; }
          Object.assign(nak.style, { left: '0mm', top: '0mm', width: w + 'mm', height: h + 'mm' });
          nak.querySelector('img').style.objectFit = 'contain';
          const ukr3 = document.createElement('div'); ukr3.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden'; ukr3.appendChild(kz); document.body.appendChild(ukr3);
          try {
            await nak.querySelector('img').decode();
            const zm = plikiZmiesc(kz), oczSkala = Math.round(Math.min(w / (w + 2 * s), h / (h + 2 * s)) * 1000) / 1000;
            const ostr = spadDruku([kz], 0).ostrzezenia.filter((x) => /zmieść/.test(x));
            r[t].zmiesc = { zgloszone: zm, ostrzezenia: ostr };
            if (zm.length !== 1 || zm[0].skala !== oczSkala || zm[0].ramkaZeSpadem.join() !== [w + 2 * s, h + 2 * s].join() || !/dopasuj=wypełnij/.test(opisZmiesc(zm[0])))
              b.push(t + ': nakładka „zmieść” ' + JSON.stringify(zm));
            if (ostr.length !== 1 || !/\\(1 karta\\) – plik ze spadem w ramce „zmieść” – zostanie pomniejszony/.test(ostr[0])) b.push(t + ': ostrzeżenie pdf ' + JSON.stringify(ostr));
          } finally { ukr3.remove(); }
        }
        r.bledy = b; r.ok = !b.length;
        return r;
      })()`);
    } catch (e) { spadSzablonu = { ok: false, blad: e.message }; }
  }
  // CMYK (issue #66, etap 2; --test-edytor, każdy projekt, pliki w katalogu tymczasowym): a) okno Druk i PDF (pole cmyk, profil),
  // b) PDF drukarni przez pdfDoPliku z profilem testowym (Ghostscript): kontrola każdego pliku, ramki z planu, pdfimages (jeśli jest).
  // c) zlecenia z profilem – w bloku zlecenia (cmykTest.profil). Bez Ghostscripta ≥ 10 albo profilu CMYK: { pominiety } (w CI to błąd).
  let cmykTest = null;
  if (testBloku('cmykTest')) {
    const js = (k) => wc.executeJavaScript(k);
    const CI = !!process.env.GITHUB_ACTIONS;
    const gs = cmyk.znajdzGs({ odswiez: true });
    const szukajIcc = () => {   // KARKA_TEST_ICC, potem instalacja Ghostscripta (Linux, Homebrew)
      const kandydaci = [process.env.KARKA_TEST_ICC, '/usr/share/color/icc/ghostscript/default_cmyk.icc'];
      for (const baza of [gs.sciezka && path.resolve(path.dirname(fs.realpathSync(gs.sciezka)), '..'), '/opt/homebrew', '/usr/local']) {
        if (!baza) continue;
        try { for (const w of fs.readdirSync(path.join(baza, 'share', 'ghostscript'))) kandydaci.push(path.join(baza, 'share', 'ghostscript', w, 'iccprofiles', 'default_cmyk.icc')); } catch (e) { /* brak */ }
      }
      const katalog = gs.ok && cmyk.katalogIccGs(gs);   // także profile wypakowane z %rom% (Homebrew)
      if (katalog) kandydaci.push(path.join(katalog, 'default_cmyk.icc'));
      return kandydaci.filter(Boolean).find((p) => { try { cmyk.sprawdzPlikIcc(p); return true; } catch (e) { return false; } }) || null;
    };
    const icc = gs.ok ? szukajIcc() : null;
    if (!gs.ok || !icc) {
      const powod = !gs.ok ? gs.powod : 'brak profilu CMYK do testu (default_cmyk.icc z Ghostscripta albo KARKA_TEST_ICC)';
      cmykTest = CI ? { ok: false, blad: 'w CI wymagany Ghostscript ≥ 10 i profil testowy: ' + powod } : { pominiety: powod };
    } else {
      const { PDFDocument } = require('./drukarnia').pdfLib(ZASOBY);   // lokalna zmienna drukarnia (wynik testu) przesłania moduł
      const MMpt = 72 / 25.4, bliskie = (a, b) => Math.abs(a - b) <= 0.01;
      const bledy = [];
      cmykTest = { gs: gs.wersja, profil: icc };
      // a) okno: pole cmyk włączone i zaznaczone, profile fogra39 / fogra51 / „inny plik”.
      cmykTest.okno = await js(`(async () => {
        const przed = USTAWIENIA_OKIEN.druk, przedD = USTAWIENIA_OKIEN.drukarnia, f = () => document.getElementById('oknoForm');
        delete USTAWIENIA_OKIEN.druk; delete USTAWIENIA_OKIEN.drukarnia;
        try {
          const stan = await odswiezCmyk();
          const p = otworzOkno('drukarnia');
          const c = f().querySelector('[name=cmyk]'), s = f().querySelector('[name=profil]'), n = f().querySelector('[name=nadrukCzerni]');
          const r = { gs: !!(stan && stan.gs && stan.gs.ok), cmyk: !!c, wlaczony: !!c && !c.disabled, zaznaczony: !!c && c.checked,
            profil: !!s && !s.disabled, opcje: s ? [...s.options].map((x) => x.value) : [], wybrany: s ? s.value : null,
            nadruk: !!n && !n.disabled && n.checked };
          document.getElementById('okno').dispatchEvent(new Event('cancel')); await p;
          return r;
        } finally { if (przed) USTAWIENIA_OKIEN.druk = przed; else delete USTAWIENIA_OKIEN.druk; if (przedD) USTAWIENIA_OKIEN.drukarnia = przedD; else delete USTAWIENIA_OKIEN.drukarnia; }
      })()`);
      const ow = cmykTest.okno;
      ow.ok = ow.gs && ow.cmyk && ow.wlaczony && ow.zaznaczony && ow.profil && ow.opcje.join() === 'iso300,fogra39,fogra51,__inny' && ow.wybrany === 'fogra39' && ow.nadruk;
      if (!ow.ok) bledy.push('okno: ' + JSON.stringify(ow));
      // b) PDF: awersy i rewersy (spad 3) w CMYK.
      const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gk-cmyk-'));
      try {
        const t0 = Date.now();
        const plan = await js(`buildPrint(${JSON.stringify({ uklad: 'drukarnia', spad: 3, strony: 'osobno' })})`);
        const w = await pdfDoPliku(wc, path.join(tmp, 'cmyk.pdf'), { ...plan, cmyk: { plik: icc, nazwa: 'test' } });
        const wPlanie = plan.pliki.map((_, n) => plan.strony.filter((s) => s.plik === n)).filter((a) => a.length);
        const W = plan.szer * MMpt, H = plan.wys * MMpt;
        cmykTest.pdf = { pliki: (w.pliki || []).map((p) => path.basename(p)), czas: Date.now() - t0, gsCzas: w.cmyk && w.cmyk.czas, profil: w.cmyk && w.cmyk.profil,
          kontrola: ((w.cmyk && w.cmyk.pliki) || []).map((k) => ({ strony: k.strony, rgb: k.rgb, przestrzenieRgb: k.przestrzenieRgb, czern: k.czern, obrazki: k.obrazki, trimBox: k.trimBox, nadruk: k.nadruk, ok: k.ok })) };
        if (!w.cmyk || w.cmyk.nadrukCzerni !== true) bledy.push('pdf: nadruk czerni nie jest domyślnie włączony');
        if (!w.cmyk || w.cmyk.profil !== 'test' || w.cmyk.ghostscript !== gs.wersja) bledy.push('pdf: raport cmyk: ' + JSON.stringify(w.cmyk && { profil: w.cmyk.profil, gs: w.cmyk.ghostscript }));
        if (!w.pliki || w.pliki.length !== wPlanie.length) bledy.push(`pdf: plików ${w.pliki && w.pliki.length}, w planie ${wPlanie.length}`);
        for (let n = 0; n < (w.pliki || []).length; n++) {
          const k = w.cmyk.pliki[n];
          if (!fs.existsSync(w.pliki[n])) { bledy.push('pdf: brak pliku ' + w.pliki[n]); continue; }
          if (!k || !k.ok || k.rgb !== 0 || k.przestrzenieRgb !== 0 || k.trimBox !== k.strony || k.strony !== wPlanie[n].length) bledy.push(`pdf: plik ${n}: kontrola ${JSON.stringify(k && { ok: k.ok, rgb: k.rgb, strony: k.strony, trimBox: k.trimBox })}`);
          const strony_ = (await PDFDocument.load(fs.readFileSync(w.pliki[n]))).getPages();
          if (strony_.length !== wPlanie[n].length) bledy.push(`pdf: plik ${n}: stron ${strony_.length}, w planie ${wPlanie[n].length}`);
          // Nadruk czerni (#92): liczba obiektów ↔ stany /KarkaNadruk z /op true w pliku.
          const surowy = fs.readFileSync(w.pliki[n]).toString('latin1');
          if (!Number.isInteger(k && k.nadruk) || (k.nadruk > 0) !== /\/KarkaNadruk[13]\b/.test(surowy)) bledy.push(`pdf: plik ${n}: nadruk ${k && k.nadruk}, a stany nadruku w pliku: ${/KarkaNadruk[13]/.test(surowy)}`);
          strony_.forEach((s, i) => {
            const mb = s.getMediaBox(), tb = s.getTrimBox(), c = wPlanie[n][i] && wPlanie[n][i].ciecie;
            if (!(bliskie(mb.x, 0) && bliskie(mb.y, 0) && bliskie(mb.width, W) && bliskie(mb.height, H))) bledy.push(`pdf: plik ${n} str. ${i + 1}: MediaBox ${[mb.x, mb.y, mb.width, mb.height].map((x) => x.toFixed(2))}`);
            if (!c || !bliskie(tb.x, c[0] * MMpt) || !bliskie(tb.width, c[2] * MMpt) || !bliskie(tb.height, c[3] * MMpt) || !bliskie(tb.y, H - (c[1] + c[3]) * MMpt)) bledy.push(`pdf: plik ${n} str. ${i + 1}: TrimBox ≠ ciecie z planu`);
          });
        }
        // Obrazki w pliku: pdfimages -list (kolumna „color”: cmyk / gray; icc przy N = 4 też jest CMYK) – tylko gdy narzędzie istnieje.
        const pi = require('child_process').spawnSync('pdfimages', ['-list', w.pliki[0]], { encoding: 'utf8' });
        if (!pi.error && pi.status === 0) {
          const wiersze = pi.stdout.split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 6);
          const zle = wiersze.filter((c) => !(c[5] === 'cmyk' || c[5] === 'gray' || (c[5] === 'icc' && c[6] === '4')));
          cmykTest.pdfimages = { obrazkow: wiersze.length, kolory: [...new Set(wiersze.map((c) => c[5] + '/' + c[6]))] };
          if (zle.length) bledy.push('pdfimages: obrazki nie w CMYK/gray: ' + zle.map((c) => c.slice(0, 8).join(' ')).join(' | '));
        } else cmykTest.pdfimages = 'brak narzędzia pdfimages';
        // c) bez nadruku (nadrukCzerni = nie): w wyniku nadruk null, w plikach żadnych stanów nadruku.
        const bez = await pdfDoPliku(wc, path.join(tmp, 'bez-nadruku.pdf'), { ...plan, cmyk: { plik: icc, nazwa: 'test', nadruk: false } });
        cmykTest.bezNadruku = { nadrukCzerni: bez.cmyk && bez.cmyk.nadrukCzerni, nadruk: ((bez.cmyk && bez.cmyk.pliki) || []).map((k) => k.nadruk),
          stanyWPliku: (bez.pliki || []).some((f) => /KarkaNadruk/.test(fs.readFileSync(f).toString('latin1'))) };
        const bn = cmykTest.bezNadruku;
        if (bn.nadrukCzerni !== false || bn.nadruk.some((x) => x !== null) || bn.stanyWPliku) bledy.push('pdf bez nadruku: ' + JSON.stringify(bn));
      } catch (e) { bledy.push('pdf: ' + e.message); }
      finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      cmykTest.bledy = bledy;
      cmykTest.ok = !bledy.length;
    }
  }
  // Profile drukarni (#85, etap 2, 0.7.0; --test-edytor, poza przykładami, Ghostscript): zlecenia pdf z drukarnia = longpack | printnet |
  // wlasne. Profil ICC: KARKA_TEST_PROFIL_KLUCZA (domyślnie default_cmyk.icc Ghostscripta; prawdziwy ISO Coated v2 300 % → sprawdzane maksTAC ≤ 300).
  // Każdy plik: PDF/X-4 (pdfinfo, Output Intent z profilem, Info + XMP, PDF 1.6, bez ArtBox), MediaBox = karta + 2 × spad profilu, TrimBox = karta;
  // LongPack – dwa pliki z nazwami z profilu, rewersy w osobnym pliku; Printnet – jeden plik, awers i rewers na zmianę (2 × liczba kart),
  // spad z szablonu przycięty do 2 mm (informacje); pdfx = nie – bez metadanych PDF/X; spad szablonu mniejszy niż profil – ok: false.
  // Okno: trzy profile, podsumowanie wybranego, zrzut -okno-printnet.png.
  let profileDr = null;
  if (testBloku('profileDrukarni') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const gs = cmyk.znajdzGs({ odswiez: true });
    const kat = gs.ok && cmyk.katalogIccGs(gs);
    const icc = process.env.KARKA_TEST_PROFIL_KLUCZA || (kat && path.join(kat, 'default_cmyk.icc'));
    if (!gs.ok || !icc || !fs.existsSync(icc)) profileDr = process.env.GITHUB_ACTIONS ? { ok: false, blad: 'w CI wymagany Ghostscript: ' + gs.powod } : { pominiety: gs.ok ? 'brak profilu testowego' : gs.powod };
    else {
      const bledy = [], zEnv = process.env.KARKA_TEST_PROFIL_KLUCZA;
      process.env.KARKA_TEST_PROFIL_KLUCZA = icc;
      const prawdziwy300 = cmyk.sha256(fs.readFileSync(icc)) === cmyk.PROFILE.iso300.sha256;
      profileDr = { profil: path.basename(icc), prawdziwy300, bledy };
      const zl = path.join(projekt, ...FOLDER_ZLECEN);
      fs.mkdirSync(zl, { recursive: true });
      const czytaj = (p) => { try { return JSON.parse(fs.readFileSync(path.join(zl, `wynik-${p}.json`), 'utf8')); } catch (e) { return null; } };
      const zlec = async (tresc) => { fs.rmSync(path.join(zl, 'wynik-pdf.json'), { force: true }); fs.writeFileSync(path.join(zl, 'pdf'), tresc);
        let w = null; for (let i = 0; i < 240 && !w; i++) { await czekaj(500); w = czytaj('pdf'); } return w; };
      const { PDFDocument, PDFName } = require('./drukarnia').pdfLib(ZASOBY);
      const MMpt = 72 / 25.4, bliskie = (a, b) => Math.abs(a - b) <= 0.02;
      const stan = await js(`(() => { const k = [...document.querySelectorAll('#podglad .siatka .karta:not(.rewers)')];
        const r = k.map((x) => cardMm(x).slice().sort((a, b) => a - b).join('x'));
        return { kopie: k.length, projekt: PROJEKT || null, wersja: WERSJA, karta: cardMm(k[0]), jedenRozmiar: new Set(r).size === 1,
          spad: Math.min(...[...document.querySelectorAll('#podglad .talia')].map((t) => spadTalii(t.dataset.talia))),
          zRewersem: kartyEksportu({}).filter((x) => rewersKarty(x)).length }; })()`);
      if (!stan.projekt) stan.projekt = await js('APP.info().then((i) => i.nazwa)');     // bez PROJEKT = – nazwa projektu
      profileDr.stan = stan;
      const pdfinfo = (f) => { const r = require('child_process').spawnSync('pdfinfo', [f], { encoding: 'utf8' }); return r.error || r.status ? null : r.stdout; };
      // Plik PDF/X-4: Output Intent (profil osadzony = plik konwersji), Info i XMP zgodne, PDF 1.6, bez ArtBox; ramki wg spadu.
      const sprawdzPlik = async (f, spad, opis, strona) => {
        const buf = fs.readFileSync(f), surowy = buf.toString('latin1'), doc = await PDFDocument.load(buf, { updateMetadata: false });
        const w = { plik: path.basename(f), stron: doc.getPageCount(), naglowek: surowy.slice(0, 8) };
        const oi = doc.catalog.lookup(PDFName.of('OutputIntents'));
        const intent = oi && oi.lookup(0);
        const prof = intent && intent.lookup(PDFName.of('DestOutputProfile'));
        w.outputIntent = !!prof && Buffer.from(prof.contents).length > 0;
        const info = doc.getInfoDict();
        w.info = { pdfx: String(info.get(PDFName.of('GTS_PDFXVersion')) || ''), trapped: String(info.get(PDFName.of('Trapped')) || '') };
        const xmpS = doc.catalog.lookup(PDFName.of('Metadata')), xmp = xmpS ? Buffer.from(xmpS.contents).toString('utf8') : '';
        w.xmp = { pdfx: /<pdfxid:GTS_PDFXVersion>PDF\/X-4</.test(xmp), trapped: /<pdf:Trapped>False</.test(xmp), docId: /<xmpMM:DocumentID>uuid:/.test(xmp) };
        w.artBox = doc.getPages().some((s) => s.node.get(PDFName.of('ArtBox')));
        const pi = pdfinfo(f);
        w.pdfinfo = pi ? (pi.match(/PDF subtype:\s*(.*)/) || [])[1] || '' : 'brak pdfinfo';
        if (w.naglowek !== '%PDF-1.6' || !w.outputIntent || w.info.pdfx !== '(PDF/X-4)' || w.info.trapped !== '/False' || !w.xmp.pdfx || !w.xmp.trapped || !w.xmp.docId || w.artBox
          || (pi && !/PDF\/X-4/.test(w.pdfinfo))) bledy.push(`${opis}: ${w.plik} nie jest PDF/X-4: ` + JSON.stringify(w));
        // Strona z wyniku zlecenia (największa karta + 2 × spad profilu); TrimBox = karta, co najmniej spad od krawędzi strony.
        const W = strona[0] * MMpt, H = strona[1] * MMpt, sp = spad * MMpt;
        doc.getPages().forEach((s, i) => {
          const mb = s.getMediaBox(), bb = s.getBleedBox(), tb = s.getTrimBox();
          if (!bliskie(mb.width, W) || !bliskie(mb.height, H) || !bliskie(bb.width, W) || !bliskie(bb.height, H) || tb.x < sp - 0.02 || tb.y < sp - 0.02
            || tb.x + tb.width > W - sp + 0.02 || tb.y + tb.height > H - sp + 0.02 || (stan.jedenRozmiar && (!bliskie(tb.x, sp) || !bliskie(tb.y, sp))))
            bledy.push(`${opis}: ${w.plik} str. ${i + 1}: ramki ${[mb.width, mb.height, tb.x, tb.width, tb.height].map((x) => (x / MMpt).toFixed(2)).join(' / ')} mm`);
        });
        return w;
      };
      try {
        // a) LongPack: dwa pliki z nazwami z profilu, rewersy osobno (wspólny rewers – plik z jedną stroną); spad = 2 pominięty z ostrzeżeniem.
        const lp = await zlec('drukarnia = longpack\nspad = 2\n');
        const nazwa = (st) => [stan.projekt, 'Playingcards', st, 'PL', stan.wersja].filter(Boolean).join('_') + '.pdf';
        profileDr.longpack = lp && { ok: lp.ok, blad: lp.blad, pliki: lp.pliki, drukarnia: lp.drukarnia, spad: lp.spad, strona: lp.strona, ostrzezenia: lp.ostrzezenia, cmyk: lp.cmyk && { pdfx: lp.cmyk.pdfx, maksTAC: lp.cmyk.maksTAC, limitTAC: lp.cmyk.limitTAC, pliki: lp.cmyk.pliki.map((k) => k.maksTAC) } };
        if (!lp || !lp.ok) bledy.push('longpack: ' + JSON.stringify(lp && lp.blad));
        else {
          const plikiLp = stan.zRewersem ? [nazwa('Front'), nazwa('Back')] : [nazwa('Front')];
          if (lp.pliki.join() !== plikiLp.join() || lp.drukarnia !== 'longpack' || lp.spad !== 3) bledy.push('longpack: pliki/spad ' + JSON.stringify(profileDr.longpack));
          if (!(lp.ostrzezenia || []).some((x) => /spad.*ustala profil drukarni LongPack/.test(x))) bledy.push('longpack: brak ostrzeżenia o pominiętym kluczu spad');
          if (lp.cmyk.pdfx !== 'PDF/X-4' || lp.cmyk.limitTAC !== 300 || !Number.isFinite(lp.cmyk.maksTAC) || profileDr.longpack.cmyk.pliki.some((x) => !Number.isFinite(x))) bledy.push('longpack: cmyk ' + JSON.stringify(profileDr.longpack.cmyk));
          if (prawdziwy300 && lp.cmyk.maksTAC > 300) bledy.push('longpack: maksTAC ' + lp.cmyk.maksTAC + ' > 300 przy ISO Coated v2 300 %');
          const pf = await sprawdzPlik(path.join(projekt, lp.pliki[0]), 3, 'longpack', lp.strona);
          const pb = lp.pliki[1] ? await sprawdzPlik(path.join(projekt, lp.pliki[1]), 3, 'longpack', lp.strona) : { stron: 0 };
          profileDr.longpack.stron = [pf.stron, pb.stron];
          // Wspólny rewers – plik rewersów z jedną stroną, różne rewersy – strona na kartę (plan druku: strony pliku 1).
          const rewersowWPlanie = await js('PLAN_DRUKU.strony.filter((s) => s.plik === 1).length');
          if (pf.stron !== stan.kopie || pb.stron !== rewersowWPlanie || !(pb.stron === 1 || pb.stron === stan.kopie || !stan.zRewersem)) bledy.push(`longpack: stron ${pf.stron} + ${pb.stron}, oczekiwane ${stan.kopie} + 1 albo ${stan.kopie}`);
        }
        // b) Printnet: jeden plik, awers/rewers na zmianę, spad 2 mm (szablon 3 mm – przycięty, informacje).
        const pn = await zlec('drukarnia = printnet\n');
        profileDr.printnet = pn && { ok: pn.ok, blad: pn.blad, pliki: pn.pliki, spad: pn.spad, informacje: pn.informacje, strona: pn.strona };
        if (!pn || !pn.ok) bledy.push('printnet: ' + JSON.stringify(pn && pn.blad));
        else {
          if (pn.pliki.length !== 1 || pn.pliki[0] !== stan.projekt + ' – printnet.pdf' || pn.spad !== 2) bledy.push('printnet: ' + JSON.stringify(profileDr.printnet));
          if (stan.spad > 2 && !(pn.informacje || []).some((x) => /przycięty do 2 mm/.test(x))) bledy.push('printnet: brak informacji o przycięciu spadu');
          const w = await sprawdzPlik(path.join(projekt, pn.pliki[0]), 2, 'printnet', pn.strona);
          profileDr.printnet.stron = w.stron;
          // Kolejność stron z arkuszy druku: awers, rewers, awers, rewers…
          const rewersy = await js("[...document.querySelectorAll('#druk .arkusz')].map((a) => !!a.querySelector('.karta.rewers'))");
          profileDr.printnet.kolejnosc = rewersy.map((r) => (r ? 'R' : 'A')).join('');
          // Każdy awers z rewersem ma go na następnej stronie; talia bez [REWERS] – same awersy.
          if (w.stron !== stan.kopie + stan.zRewersem || rewersy.length !== w.stron) bledy.push(`printnet: stron ${w.stron}, arkuszy ${rewersy.length}, oczekiwane ${stan.kopie + stan.zRewersem}`);
          const k = profileDr.printnet.kolejnosc;
          if (!/^(AR?)+$/.test(k) || (k.match(/R/g) || []).length !== stan.zRewersem) bledy.push('printnet: strony nie są na przemian awers / rewers: ' + k);
        }
        // c) Własne ustawienia: pdfx = nie – bez PDF/X (jak 0.6.8); spad 5 mm > szablon → ok: false.
        const wl = await zlec('drukarnia = wlasne\nprofil = iso300\npdfx = nie\nplik = Export/wlasne-bez-pdfx.pdf\n');
        profileDr.wlasneBezPdfx = wl && { ok: wl.ok, blad: wl.blad, pliki: wl.pliki, pdfx: wl.cmyk && wl.cmyk.pdfx };
        if (!wl || !wl.ok || wl.cmyk.pdfx !== null) bledy.push('wlasne pdfx = nie: ' + JSON.stringify(profileDr.wlasneBezPdfx));
        else for (const p of wl.pliki) {
          const t = fs.readFileSync(path.join(projekt, p)).toString('latin1');
          if (/OutputIntents|GTS_PDFXVersion/.test(t)) bledy.push('wlasne pdfx = nie: w pliku metadane PDF/X ' + p);
        }
        const za = await zlec(`drukarnia = wlasne\nspad = ${stan.spad + 2}\nprofil = iso300\nplik = Export/za-maly.pdf\n`);
        profileDr.zaMalySpad = za && { ok: za.ok, blad: za.blad, plik: fs.existsSync(path.join(projekt, 'Export', 'za-maly.pdf')) };
        if (stan.spad && (!za || za.ok !== false || !/spad/.test(za.blad || '') || profileDr.zaMalySpad.plik)) bledy.push('za mały spad szablonu: ' + JSON.stringify(profileDr.zaMalySpad));
        const zly = await zlec('drukarnia = drukarnia-x\n');
        if (!zly || zly.ok !== false || !/drukarnia/.test(zly.blad || '')) bledy.push('nieznana drukarnia: ' + JSON.stringify(zly));
        // d) Okno: trzy profile, wybór Printnet pokazuje jego podsumowanie z nazwą pliku.
        profileDr.okno = await js(`(async () => { await odswiezCmyk(); await odswiezDrukarnie(); const p = otworzOkno('drukarnia'); const f = document.getElementById('oknoForm');
          const r = f.querySelector('[name=drukarnia][value=printnet]'); r.checked = true; r.dispatchEvent(new Event('change'));
          const widoczne = [...f.querySelectorAll('.profil-drukarni')].filter((d) => !d.hidden).map((d) => d.dataset.id);
          return { profile: [...f.querySelectorAll('[name=drukarnia]')].map((x) => x.value), widoczne,
            tekst: (f.querySelector('.profil-drukarni[data-id=printnet]') || {}).textContent || '' }; })()`);
        await czekaj(300);
        fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-okno-printnet.png', (await wc.capturePage()).toPNG());
        profileDr.okno.wlasne = await js(`(() => { const f = document.getElementById('oknoForm'), r = f.querySelector('[name=drukarnia][value=wlasne]');
          r.checked = true; r.dispatchEvent(new Event('change'));
          return ['wlSpad', 'strony', 'cmyk', 'profil', 'wlPdfx', 'wlTac', 'rewersy', 'wlWzor'].filter((n) => f.querySelector('.profil-drukarni[data-id=wlasne]:not([hidden]) [name=' + n + ']')); })()`);
        await czekaj(300);
        fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-okno-wlasne.png', (await wc.capturePage()).toPNG());
        await js("document.getElementById('okno').dispatchEvent(new Event('cancel'))");
        const ok = profileDr.okno;
        if (ok.wlasne.length !== 8) bledy.push('okno: pola Własnych ustawień ' + ok.wlasne.join());
        if (ok.profile.join() !== 'longpack,printnet,wlasne' || ok.widoczne.join() !== 'printnet' || !ok.tekst.includes(stan.projekt + ' – printnet.pdf') || !/Spad 2 mm/.test(ok.tekst)) bledy.push('okno: ' + JSON.stringify(ok));
      } catch (e) { bledy.push('wyjątek: ' + ((e && e.message) || e)); }
      finally { if (zEnv === undefined) delete process.env.KARKA_TEST_PROFIL_KLUCZA; else process.env.KARKA_TEST_PROFIL_KLUCZA = zEnv; }
      profileDr.ok = !bledy.length;
    }
  }
  // Filtr talii zmieniony w trakcie raportu drukarni, katalogu i eksportu pcio (#114): praca na wszystkich taliach mimo
  // filtra, wybór użytkownika zostaje po końcu, żadna karta niezmierzona. Także raport w trakcie pcio (zagnieżdżenie)
  // i z włączonym „Pokaż rewersy kart” (#podglad.schowany). Projekt z co najmniej dwiema taliami; pcio – poza przykładami.
  let filtrWTrakcie = null;
  if (testBloku('filtrWTrakcie')) {
    filtrWTrakcie = await wc.executeJavaScript(`(async () => {
      const talie = [...$('filtr').options].map((o) => o.value).filter(Boolean);
      if (talie.length < 2) return { pominiety: true };
      const [A, B] = talie, wszystkie = document.querySelectorAll('#podglad .talia .karta').length;
      const sekcje = document.querySelectorAll('#podglad .talia').length, awersy = document.querySelectorAll('#podglad .karta:not(.rewers)').length;
      const ustaw = (v) => { $('filtr').value = v; $('filtr').dispatchEvent(new Event('change')); };
      const widoczne = () => visibleSections().map((s) => s.dataset.talia).join('|');
      // Start pracy = klasa na #podglad (przed #114: wyczyszczone pole filtra) – dopiero wtedy zmiana filtra „w trakcie”.
      const wTrakcie = async () => { for (let i = 0; i < 2000; i++) { if ($('podglad').classList.contains('wszystkie-talie') || !$('filtr').value) return true; await new Promise((r) => setTimeout(r, 2)); } return false; };
      const po = () => ({ filtr: $('filtr').value === B, widoczne: widoczne() === B, bezKlasy: !$('podglad').classList.contains('wszystkie-talie') });
      const raportOk = (r) => !!r && !r.blad && r.karty === wszystkie && r.niezmierzone.length === 0;
      const blad = (e) => ({ blad: String((e && (e.message || e.type)) || e) });
      const w = {}, start = { filtr: $('filtr').value, rewersy: POKAZ_REWERSY };   // stan strony – przywracany na końcu
      try {
        ustaw(A); let p = raportDrukarni().catch(blad); w.raportStart = await wTrakcie(); ustaw(B);
        let r = await p; w.raport = { karty: r.karty, wszystkie, niezmierzone: r.niezmierzone && r.niezmierzone.length, blad: r.blad, ...po() };
        w.raport.ok = w.raportStart && raportOk(r) && w.raport.filtr && w.raport.widoczne && w.raport.bezKlasy;
        ustaw(A); p = katalogPng({}).catch(blad); w.katalogStart = await wTrakcie(); ustaw(B);
        const k0 = await p, k = Array.isArray(k0) ? k0 : [], talieKat = [...new Set(k.map((x) => x.talia))];
        w.katalog = { blad: k0 && k0.blad, talie: talieKat.length, oczekiwane: talie.length, puste: k.filter((x) => !x.blob || x.blob.size < 1000).length, ...po() };
        w.katalog.ok = w.katalogStart && talieKat.length === talie.length && w.katalog.puste === 0 && w.katalog.filtr && w.katalog.widoczne && w.katalog.bezKlasy;
        pokazRewersyKart(true);
        ustaw(A); p = raportDrukarni().catch(blad); w.rewersyStart = await wTrakcie(); ustaw(B);
        r = await p; pokazRewersyKart(false);
        w.rewersy = { karty: r.karty, niezmierzone: r.niezmierzone && r.niezmierzone.length, blad: r.blad, ...po() };
        w.rewersy.ok = w.rewersyStart && raportOk(r) && w.rewersy.filtr && w.rewersy.bezKlasy;
        if (${!jestPrzykladem(szablon)}) {
          ustaw(A); p = exportPcio().catch(blad); w.pcioStart = await wTrakcie();
          const q = raportDrukarni().catch(blad);                          // w trakcie eksportu – bez kolejki (EKSPORT_TRWA)
          ustaw(B);
          const [x, rz] = await Promise.all([p, q]);
          w.pcio = { blad: (x && x.blad) || (rz && rz.blad), holdery: x && x.holdery, sekcje, karty: x && x.karty, awersy, raport: rz && rz.karty, niezmierzone: rz && rz.niezmierzone && rz.niezmierzone.length, ...po() };
          w.pcio.ok = w.pcioStart && !!x && x.holdery === sekcje && x.karty === awersy && raportOk(rz) && w.pcio.filtr && w.pcio.widoczne && w.pcio.bezKlasy;
          // Eksport obrazków (JPG) przy filtrze na jedną talię: karty talii ukrytych filtrem też (html-to-image – karta z wymiarami).
          ustaw(A); p = eksportObrazkow({ zlecenie: true, rewersy: false }).catch(blad); w.obrazkiStart = await wTrakcie(); ustaw(B);
          const o = await p;
          w.obrazki = { blad: o && o.blad, pliki: o && o.pliki, awersy, ...po() };
          w.obrazki.ok = w.obrazkiStart && !!o && !o.blad && o.pliki === awersy && w.obrazki.filtr && w.obrazki.widoczne && w.obrazki.bezKlasy;
        }
        return w;
      } finally { ustaw(start.filtr); pokazRewersyKart(start.rewersy); }
    })()`);
    const f = filtrWTrakcie;
    f.ok = !!f.pominiety || !!(f.raport.ok && f.katalog.ok && f.rewersy.ok && (!f.pcio || (f.pcio.ok && f.obrazki.ok)));
  }
  // Katalog (--test-edytor, poza przykładami): A – Export/katalog; B – zlecenie z pliku → wynik.json.
  let katalog = null;
  if (testBloku('katalog') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const a = await js("zapiszKatalog({}, 'katalog')");
    const kat = path.join(projekt, 'Export', 'katalog');
    const pngA = a && a.pliki ? a.pliki.filter((n) => fs.existsSync(path.join(kat, n))) : [];
    const szer = pngA.length ? szerokoscJpg(fs.readFileSync(path.join(kat, pngA[0]))) : 0;
    const talia = a && a.talie && a.talie[0] ? a.talie[0].nazwa : '';
    const zl = path.join(projekt, ...FOLDER_ZLECEN);
    fs.mkdirSync(zl, { recursive: true });
    fs.writeFileSync(path.join(zl, 'katalog'), `talie = ${talia}\n`);
    let w = null;
    for (let i = 0; i < 60 && !w; i++) { await czekaj(500); try { w = JSON.parse(fs.readFileSync(path.join(zl, 'wynik.json'), 'utf8')); } catch (e) { /* jeszcze nie */ } }
    const pngB = w && w.pliki ? w.pliki.filter((n) => fs.existsSync(path.join(projekt, '.generator', 'katalog', n))).length : 0;
    katalog = { a: pngA.length, szer, talia, b: w && { ok: w.ok, pliki: w.pliki, talie: (w.talie || []).map((t) => t.nazwa), uwagi: w.uwagi }, pngB,
      zlecenieUsuniete: !fs.existsSync(path.join(zl, 'katalog')) };
    katalog.ok = pngA.length > 0 && szer > 300 && szer <= 2000 && !!w && w.ok && pngB === w.pliki.length && pngB > 0
      && katalog.b.talie.length === 1 && katalog.b.talie[0] === talia && katalog.zlecenieUsuniete;
  }
  // Zlecenia z pliku dla całej gry (--test-edytor, poza przykładami): stan, raport, pdf, obrazki, pcio,
  // dwa zlecenia naraz, błędne opcje, „tylko zmienione”, niezapisany edytor (karty z dysku), ustawienia okien bez zmian.
  let zlecenia = null;
  if (testBloku('zlecenia') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const zl = path.join(projekt, ...FOLDER_ZLECEN);
    fs.mkdirSync(zl, { recursive: true });
    const czytaj = (p) => { try { return JSON.parse(fs.readFileSync(path.join(zl, `wynik-${p}.json`), 'utf8')); } catch (e) { return null; } };
    // #102: przegląd folderu zleceń od razu po zapisie pliku (zamiast czekania na cykl co 3 s), odpytywanie co 100 ms.
    const czekajNa = async (pol) => { let w = null; for (let i = 0; i < 1200 && !w; i++) { await czekaj(100); w = czytaj(pol); } return w; };
    const zlec = async (pol, tresc = '') => { fs.rmSync(path.join(zl, `wynik-${pol}.json`), { force: true }); fs.writeFileSync(path.join(zl, pol), tresc); sprawdzZlecenia(); return czekajNa(pol); };
    // Blok sam zapamiętuje druk wszystkich kart (#102, #101 A) – „tylko zmienione” nie zależy od bloku zmienione.
    await js('zapamietajDruk(kartyEksportu({}))');
    const ustPrzed = JSON.stringify(await js('USTAWIENIA_OKIEN'));
    const pierwsza = await js("(() => { const k = document.querySelector('#podglad .karta:not(.rewers)'); return { talia: k.dataset.talia, id: k.dataset.id }; })()");
    const z = { talia: pierwsza.talia };
    // Dwa naraz: stan i raport.
    fs.writeFileSync(path.join(zl, 'raport'), '');
    const stan = await zlec('stan', '# komentarz\n');
    const raport = await czekajNa('raport');
    z.stan = stan && { ok: stan.ok, karty: stan.karty, talie: (stan.talie || []).length, wersja: stan.wersjaAplikacji, ostatniPdf: stan.ostatniPdf };
    z.raport = raport && { ok: raport.ok, sekcje: (raport.raport || []).length, pierwsza: raport.raport && raport.raport[0] && raport.raport[0].tytul };
    // PDF jednej talii bez rewersów do wskazanego pliku; potem „tylko zmienione” = brak kart.
    const pdf = await zlec('pdf', `uklad = a4\nrewersy = nie\ntalia = ${pierwsza.talia}\nplik = Export/zlecenie.pdf\nkolor = czerwony\n`);
    const pdfPlik = path.join(projekt, 'Export', 'zlecenie.pdf');
    z.pdf = pdf && { ok: pdf.ok, pliki: pdf.pliki, strony: pdf.strony, rozmiar: fs.existsSync(pdfPlik) ? fs.statSync(pdfPlik).size : 0, ostrzezenia: pdf.ostrzezenia };
    const pdfZm = await zlec('pdf', 'tylkoZmienione = tak\n');
    z.pdfZmienione = pdfZm && { ok: pdfZm.ok, blad: pdfZm.blad };
    const zle = await zlec('pdf', 'uklad = plakat\ntalie = Nie ma takiej\n');
    z.bledne = zle && { ok: zle.ok, blad: zle.blad };
    const stan2 = await zlec('stan');
    z.stanPoPdf = stan2 && { ostatniPdf: !!stan2.ostatniPdf, zmienione: stan2.zmienione };
    // Obrazki: jedna karta (wszystkie kopie) PNG bez rewersu.
    const obr = await zlec('obrazki', `format = png\ndpi = 150\ntalie = ${pierwsza.talia}\nid = ${pierwsza.id}, nie-ma-takiej\nrewersy = nie\n`);
    z.obrazki = obr && { ok: obr.ok, pliki: obr.pliki, sa: (obr.pliki || []).every((p) => fs.existsSync(path.join(projekt, p))), ostrzezenia: obr.ostrzezenia };
    // playingcards.io (issue #32): jedna talia → jeden holder i tylko jej karty (+ nieznana talia = ostrzeżenie);
    // id → tylko karty o tym ID. Zawartość sprawdzana w widgets.json z ZIP-a (STORE, bez kompresji).
    const widgetsPcio = (p) => {
      try {
        const b = fs.readFileSync(path.join(projekt, p));
        for (let i = 0; i + 30 <= b.length && b.readUInt32LE(i) === 0x04034b50;) {
          const rozm = b.readUInt32LE(i + 18), dl = b.readUInt16LE(i + 26), ex = b.readUInt16LE(i + 28);
          const nazwa = b.slice(i + 30, i + 30 + dl).toString(), start = i + 30 + dl + ex;
          if (nazwa === 'widgets.json') return JSON.parse(b.slice(start, start + rozm).toString('utf8'));
          i = start + rozm;
        }
      } catch (e) {}
      return null;
    };
    const opisPcio = (w) => w && { holdery: w.filter((x) => x.type === 'holder').map((x) => x.label), karty: w.filter((x) => x.type === 'card').length };
    const oczek = await js(`(() => { const k = [...document.querySelectorAll('#podglad .karta:not(.rewers)')];
      return { talie: document.querySelectorAll('#podglad .talia').length, wTalii: k.filter((x) => x.dataset.talia === ${JSON.stringify(pierwsza.talia)}).length,
        zId: k.filter((x) => x.dataset.id === ${JSON.stringify(pierwsza.id)}).length,
        taliiZId: new Set(k.filter((x) => x.dataset.id === ${JSON.stringify(pierwsza.id)}).map((x) => x.dataset.talia)).size }; })()`);
    const pcio = await zlec('pcio', `talie = ${pierwsza.talia}, Nie ma takiej\n`);
    z.pcio = pcio && { ok: pcio.ok, pliki: pcio.pliki, sa: (pcio.pliki || []).every((p) => fs.existsSync(path.join(projekt, p))), karty: pcio.karty,
      holdery: pcio.holdery, ostrzezenia: pcio.ostrzezenia, zip: opisPcio(pcio.pliki && widgetsPcio(pcio.pliki[0])), oczek };
    const pcioId = await zlec('pcio', `id = ${pierwsza.id}\n`);
    z.pcioId = pcioId && { ok: pcioId.ok, karty: pcioId.karty, ostrzezenia: pcioId.ostrzezenia, zip: opisPcio(pcioId.pliki && widgetsPcio(pcioId.pliki[0])) };
    // Drukarnia (issue #66): PDF z układem drukarnia (osobno / na przemian), błędna wartość „strony”, raport z sekcjami drukarni.
    {
      const { PDFDocument } = require(path.join(ZASOBY, 'vendor', 'pdf-lib.min.js'));
      const stronyPliku = async (pliki) => { const a = []; for (const p of pliki || []) a.push((await PDFDocument.load(fs.readFileSync(path.join(projekt, p)))).getPageCount()); return a; };
      const dr = {};
      // Spad z szablonu (#84): bez deklaracji – spad z klucza / domyślny i ostrzeżenie, z deklaracją – spad szablonu.
      const zad = await wc.executeJavaScript("Math.max(0, ...kartyEksportu({}).map((k) => spadTalii(k.dataset.talia)))");
      const d1 = await zlec('pdf', 'uklad = drukarnia\nplik = Export/drukarnia.pdf\n');
      dr.osobno = d1 && { ok: d1.ok, pliki: d1.pliki, stronyPlikow: d1.stronyPlikow, spad: d1.spad, strona: d1.strona, blad: d1.blad,
        spadZSzablonu: d1.spadZSzablonu, bezSpadu: d1.bezSpadu, ostrzezenia: d1.ostrzezenia };
      if (dr.osobno && d1.ok) dr.osobno.naDysku = await stronyPliku(d1.pliki);
      dr.osobno.ok = !!(d1 && d1.ok && [1, 2].includes(d1.pliki.length) && d1.pliki.every((p) => fs.existsSync(path.join(projekt, p)))
        && (d1.pliki.length === 1 || (d1.pliki[0].endsWith(' – awersy.pdf') && d1.pliki[1].endsWith(' – rewersy.pdf')))
        && Array.isArray(d1.stronyPlikow) && d1.stronyPlikow.join() === dr.osobno.naDysku.join() && d1.spad === (zad || 3) && d1.strona && d1.strona.length === 2
        && d1.spadZSzablonu === !!zad && (zad ? !d1.bezSpadu && !(d1.ostrzezenia || []).some((x) => /spad/.test(x))
          : Array.isArray(d1.bezSpadu) && d1.bezSpadu.length > 0 && (d1.ostrzezenia || []).some((x) => /nie deklaruje spadu|bez spadu w szablonie/.test(x))));
      const d2 = await zlec('pdf', 'uklad = drukarnia\nstrony = na przemian\nspad = 2\nplik = Export/przemian.pdf\n');
      dr.naprzemian = d2 && { ok: d2.ok, pliki: d2.pliki, stronyPlikow: d2.stronyPlikow, spad: d2.spad, blad: d2.blad };
      if (d2 && d2.ok) dr.naprzemian.naDysku = await stronyPliku(d2.pliki);
      dr.naprzemian.ok = !!(d2 && d2.ok && d2.pliki.length === 1 && fs.existsSync(path.join(projekt, d2.pliki[0])) && d2.spad === (zad || 2)
        && Array.isArray(d2.stronyPlikow) && d2.stronyPlikow.join() === dr.naprzemian.naDysku.join());
      const d3 = await zlec('pdf', 'uklad = drukarnia\nstrony = bokiem\nplik = Export/bokiem.pdf\n');
      dr.bokiem = d3 && { ok: d3.ok, blad: d3.blad, plik: fs.existsSync(path.join(projekt, 'Export', 'bokiem.pdf')) };
      dr.bokiem.ok = !!(d3 && d3.ok === false && /strony/i.test(d3.blad || '') && !dr.bokiem.plik);
      const r1 = await zlec('raport', 'drukarnia = tak\n');
      dr.raportTak = r1 && { ok: r1.ok, sekcje: (r1.raport || []).map((x) => x.tytul).filter((t) => t.startsWith('Drukarnia:')).length,
        pola: r1.drukarnia ? ['odstep', 'czern', 'krawedz', 'spad'].map((k) => Array.isArray(r1.drukarnia[k])) : null };
      dr.raportTak.ok = !!(r1 && r1.ok && dr.raportTak.sekcje === 8 && dr.raportTak.pola && dr.raportTak.pola.every(Boolean));
      const r2 = await zlec('raport');
      dr.raportBez = r2 && { ok: r2.ok, sekcje: (r2.raport || []).map((x) => x.tytul).filter((t) => t.startsWith('Drukarnia:')).length, wynikDrukarnia: 'drukarnia' in r2 };
      dr.raportBez.ok = !!(r2 && r2.ok && dr.raportBez.sekcje === 0 && !dr.raportBez.wynikDrukarnia);
      dr.ok = ['osobno', 'naprzemian', 'bokiem', 'raportTak', 'raportBez'].every((k) => dr[k] && dr[k].ok);
      z.drukarnia = dr;
    }
    // CMYK (issue #66, etap 2): zlecenie pdf z kluczem profil – ścieżka .icc (Ghostscript), fogra39 bez sieci (błąd z eci.org),
    // nieznany profil, profil bez układu drukarnia, brak klucza = RGB mimo cmyk: true w ustawieniach okna.
    if (cmykTest && cmykTest.profil) {
      const cz = {};
      const wProjekcie = (p) => path.join(projekt, p);
      const c1 = await zlec('pdf', `uklad = drukarnia\nprofil = ${cmykTest.profil}\nplik = Export/cmyk.pdf\n`);
      cz.icc = c1 && { ok: c1.ok, pliki: c1.pliki, blad: c1.blad, profil: c1.cmyk && c1.cmyk.profil, kontrola: c1.cmyk && c1.cmyk.pliki.map((k) => ({ rgb: k.rgb, ok: k.ok, trimBox: k.trimBox, strony: k.strony })) };
      cz.icc.ok = !!(c1 && c1.ok && c1.cmyk && c1.cmyk.pliki.length === c1.pliki.length && c1.cmyk.pliki.every((k) => k.rgb === 0 && k.ok && Number.isInteger(k.nadruk)) && c1.pliki.every((p) => fs.existsSync(wProjekcie(p))));
      // Nadruk czerni (#92): bez klucza – włączony (domyślne okna), nadrukczerni = nie → wyłączony; bez profilu – ostrzeżenie.
      const c1n = await zlec('pdf', `uklad = drukarnia\nprofil = ${cmykTest.profil}\nnadrukczerni = nie\nplik = Export/cmyk-bez-nadruku.pdf\n`);
      const c1r = await zlec('pdf', 'uklad = drukarnia\nnadruk = tak\nplik = Export/rgb-nadruk.pdf\n');
      cz.nadruk = { domyslnie: c1 && c1.cmyk && c1.cmyk.nadrukCzerni, nie: c1n && c1n.cmyk && { nadrukCzerni: c1n.cmyk.nadrukCzerni, pliki: c1n.cmyk.pliki.map((k) => k.nadruk) },
        rgb: c1r && { ok: c1r.ok, ostrzezenia: c1r.ostrzezenia, cmyk: 'cmyk' in c1r } };
      cz.nadruk.ok = cz.nadruk.domyslnie === true && !!(c1n && c1n.ok && c1n.cmyk.nadrukCzerni === false && c1n.cmyk.pliki.every((k) => k.nadruk === null))
        && !!(c1r && c1r.ok && !('cmyk' in c1r) && (c1r.ostrzezenia || []).some((x) => /nadrukczerni/.test(x)));
      // Bez sieci: adres udawany (nic tam nie nasłuchuje) i brak pobranego profilu → błąd z eci.org, bez pliku.
      // „Fogra39” (inna wielkość liter niż klucz) – patrz niżej: dokładne „fogra39” trafia dziś w błąd opcjeZlecenia (karty.html).
      const adresPrzed = process.env.KARKA_PROFILE_ADRES;
      process.env.KARKA_PROFILE_ADRES = 'http://127.0.0.1:9/';
      let c2, c2m;
      try {
        c2 = await zlec('pdf', 'uklad = drukarnia\nprofil = Fogra39\nplik = Export/cmyk-eci.pdf\n');
        c2m = await zlec('pdf', 'uklad = drukarnia\nprofil = fogra39\nplik = Export/cmyk-eci-male.pdf\n');
      } finally { if (adresPrzed === undefined) delete process.env.KARKA_PROFILE_ADRES; else process.env.KARKA_PROFILE_ADRES = adresPrzed; }
      const pobrany = !!cmyk.profilLokalny('fogra39', folderProfili());
      cz.fogra39 = { ok: c2 && c2.ok, blad: c2 && c2.blad, plik: fs.existsSync(wProjekcie('Export/cmyk-eci.pdf')), pobrany };
      cz.fogra39.ok = !!(c2 && c2.ok === false && /eci\.org/.test(c2.blad || '') && !cz.fogra39.plik && !pobrany);
      // Dokładnie „fogra39” (małe litery) – ten sam błąd z eci.org.
      cz.fogra39Male = { blad: c2m && c2m.blad, plik: fs.existsSync(wProjekcie('Export/cmyk-eci-male.pdf')) };
      cz.fogra39Male.ok = !!(c2m && c2m.ok === false && !cz.fogra39Male.plik && /eci\.org/.test(c2m.blad || ''));
      const c3 = await zlec('pdf', 'uklad = drukarnia\nprofil = cośtam\nplik = Export/cmyk-zly.pdf\n');
      cz.nieznany = { ok: c3 && c3.ok, blad: c3 && c3.blad, plik: fs.existsSync(wProjekcie('Export/cmyk-zly.pdf')) };
      cz.nieznany.ok = !!(c3 && c3.ok === false && /profil/.test(c3.blad || '') && !cz.nieznany.plik);
      const c4 = await zlec('pdf', `uklad = a4\nprofil = ${cmykTest.profil}\nplik = Export/cmyk-a4.pdf\n`);
      cz.a4 = { ok: c4 && c4.ok, blad: c4 && c4.blad, plik: fs.existsSync(wProjekcie('Export/cmyk-a4.pdf')) };
      cz.a4.ok = !!(c4 && c4.ok === false && /drukarnia/.test(c4.blad || '') && !cz.a4.plik);
      // Okno ma cmyk: true, ale zlecenie bez klucza profil zostaje w RGB (jak do 0.5.10).
      await js("USTAWIENIA_OKIEN.druk = { ...(USTAWIENIA_OKIEN.druk || {}), cmyk: true }");
      const c5 = await zlec('pdf', 'uklad = drukarnia\nplik = Export/rgb.pdf\n');
      await js(ustPrzed === 'null' || !JSON.parse(ustPrzed).druk ? 'delete USTAWIENIA_OKIEN.druk' : `USTAWIENIA_OKIEN.druk = ${JSON.stringify(JSON.parse(ustPrzed).druk)}`);
      cz.bezProfilu = { ok: c5 && c5.ok, cmyk: c5 && 'cmyk' in c5, pliki: c5 && c5.pliki };
      cz.bezProfilu.ok = !!(c5 && c5.ok && !('cmyk' in c5) && c5.pliki.every((p) => fs.existsSync(wProjekcie(p))));
      cz.ok = ['icc', 'nadruk', 'fogra39', 'fogra39Male', 'nieznany', 'a4', 'bezProfilu'].every((k) => cz[k] && cz[k].ok);
      z.cmyk = cz;
    } else if (cmykTest) z.cmyk = cmykTest.pominiety ? { pominiety: cmykTest.pominiety } : { ok: false, blad: cmykTest.blad };
    // Niezapisany edytor: zmiana tytułu kart w edytorze; zlecenie widzi wersję z dysku, edytor zostaje bez zmian.
    const nazwaKarty = await js("document.querySelector('#podglad .karta:not(.rewers)').title");
    await js("(() => { const p = document.getElementById('edPole'); p.value = p.value.replace(/^PROJEKT(\\s*)=(\\s*)/m, 'PROJEKT$1=$2ZMIANA ') + '\\n; zmiana z testu\\n'; p.dispatchEvent(new Event('input')); })()");
    await czekaj(1500);
    const projektEd = await js('PROJEKT');
    const stanEd = await zlec('stan');
    await czekaj(1500);
    const poEd = await js("({ zmiany: ED.zmiany, tekst: edytorTekst().includes('zmiana z testu') })");
    z.edytor = stanEd && { niezapisane: stanEd.niezapisaneZmiany, projekt: stanEd.projekt, projektEd, poZleceniu: { ...poEd, projekt: await js('PROJEKT') } };
    await js("(() => { const p = document.getElementById('edPole'); p.value = ED.dysk; p.dispatchEvent(new Event('input')); })()");
    await czekaj(1500);
    // Issue #30: odświeżanie stoi (okno zasłonięte / wyłączone w menu) – zlecenie i tak bierze plik z dysku.
    const tekstSzablonu = fs.readFileSync(szablon, 'utf8');
    await js('ustawAuto(false)');
    // #99: sprawdzanie rozpoczęte przed wyłączeniem (SPRAWDZANIE) mogło skończyć się już po zapisie pliku niżej
    // i wczytać „ZDYSKU” przed zleceniem – czekamy na jego koniec.
    for (let i = 0; i < 400 && await js('SPRAWDZANIE'); i++) await czekaj(25);
    fs.writeFileSync(szablon, tekstSzablonu.replace(/^PROJEKT(\s*)=(\s*)/m, 'PROJEKT$1=$2ZDYSKU '));
    await czekaj(2500);
    const przedZleceniem = await js('PROJEKT');
    const stanDysk = await zlec('stan');
    fs.writeFileSync(szablon, tekstSzablonu);
    await js('ustawAuto(true)');
    await czekaj(2500);
    z.zDysku = { przedZleceniem, wZleceniu: stanDysk && stanDysk.projekt, poPrzywroceniu: await js('PROJEKT') };
    z.ustawieniaBezZmian = JSON.stringify(await js('USTAWIENIA_OKIEN')) === ustPrzed;
    z.pozostale = fs.readdirSync(zl).filter((n) => POLECENIA.includes(n));
    z.ok = !!(z.stan && z.stan.ok && z.stan.karty > 0 && z.stan.talie > 0 && z.stan.wersja
      && z.raport && z.raport.ok && z.raport.sekcje > 0
      && z.pdf && z.pdf.ok && z.pdf.rozmiar > 1000 && z.pdf.pliki[0] === path.join('Export', 'zlecenie.pdf') && z.pdf.strony >= 1
      && (z.pdf.ostrzezenia || []).some((x) => x.includes('kolor'))
      && z.pdfZmienione && !z.pdfZmienione.ok && /zmienionych/.test(z.pdfZmienione.blad)
      && z.bledne && !z.bledne.ok && /uklad/.test(z.bledne.blad) && /Nie ma takiej/.test(z.bledne.blad)
      && z.stanPoPdf && z.stanPoPdf.ostatniPdf && Array.isArray(z.stanPoPdf.zmienione)
      && z.obrazki && z.obrazki.ok && z.obrazki.pliki.length >= 1 && z.obrazki.sa && z.obrazki.pliki.every((p) => /\.png$/.test(p))
      && (z.obrazki.ostrzezenia || []).some((x) => x.includes('nie-ma-takiej'))
      && z.pcio && z.pcio.ok && z.pcio.sa && z.pcio.karty > 0 && z.pcio.holdery === 1
      && z.pcio.zip && z.pcio.zip.holdery.length === 1 && z.pcio.zip.holdery[0] === z.talia && z.pcio.zip.karty === z.pcio.oczek.wTalii
      && (z.pcio.ostrzezenia || []).some((x) => x.includes('Nie ma takiej'))
      && z.pcioId && z.pcioId.ok && !(z.pcioId.ostrzezenia || []).length && z.pcioId.zip && z.pcioId.zip.karty === z.pcio.oczek.zId && z.pcioId.zip.holdery.length === z.pcio.oczek.taliiZId
      && z.edytor && z.edytor.niezapisane && !/ZMIANA/.test(z.edytor.projekt) && /ZMIANA/.test(z.edytor.projektEd) && /ZMIANA/.test(z.edytor.poZleceniu.projekt) && z.edytor.poZleceniu.zmiany && z.edytor.poZleceniu.tekst
      && z.drukarnia && z.drukarnia.ok
      && (!z.cmyk || z.cmyk.pominiety || z.cmyk.ok)
      && z.ustawieniaBezZmian && !z.pozostale.length
      && !/ZDYSKU/.test(z.zDysku.przedZleceniem) && /ZDYSKU/.test(z.zDysku.wZleceniu) && !/ZDYSKU/.test(z.zDysku.poPrzywroceniu));
    z.nazwaKarty = nazwaKarty;
    zlecenia = z;
  }
  // Aktualizacja zleceniem z pliku (--test-aktualizacja, serwer testowy w KARKA_AKTUALIZACJE;
  // scripts/test-aktualizacje.js --electron): samo sprawdzenie, potem instalacja nakładki (bez restartu w teście).
  let aktualizacja = null;
  if (process.argv.includes('--test-aktualizacja') && !jestPrzykladem(szablon)) {
    const zl = path.join(projekt, ...FOLDER_ZLECEN), wp = path.join(zl, 'wynik-aktualizacja.json');
    fs.mkdirSync(zl, { recursive: true });
    const zlec = async (tresc) => {
      fs.rmSync(wp, { force: true }); fs.writeFileSync(path.join(zl, 'aktualizacja'), tresc);
      for (let i = 0; i < 120; i++) { await czekaj(500); try { return JSON.parse(fs.readFileSync(wp, 'utf8')); } catch (e) { /* jeszcze nie */ } }
      return null;
    };
    const spr = await zlec('');
    const inst = await zlec('instaluj = tak\nnieznany = 1\n');
    aktualizacja = { sprawdzenie: spr && { ok: spr.ok, dostepna: spr.dostepna, rodzaj: spr.rodzaj, zainstalowano: spr.zainstalowano, blad: spr.blad },
      instalacja: inst && { ok: inst.ok, zainstalowano: inst.zainstalowano, restart: inst.restart, ostrzezenia: inst.ostrzezenia, blad: inst.blad } };
    aktualizacja.ok = !!(spr && spr.ok && spr.dostepna && spr.rodzaj === 'kod' && !spr.zainstalowano
      && inst && inst.ok && inst.zainstalowano && inst.restart && (inst.ostrzezenia || []).length === 1
      && fs.existsSync(path.join(app.getPath('userData'), 'kod', 'main.js')));
  }
  // Dane w podfolderze (issue #52, --test-edytor, poza przykładami): jawna ścieżka w DANE → bez Uwagi;
  // plik przeniesiony do podfolderu bez zmiany DANE → Uwaga „Nie znaleziono plików z kartami”.
  let podfolder = null;
  if (testBloku('podfolder') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const tekst = fs.readFileSync(szablon, 'utf8');
    const m = /^\s*DANE\s*=\s*([^;#\n,/]+?\.(?:csv|xlsx))/mi.exec(tekst);
    if (m) {
      const plik = m[1].trim(), zrodlo = path.join(projekt, plik), zapas = zrodlo + '.test-schowany';
      const naDANE = new RegExp('^(\\s*DANE\\s*=\\s*)' + plik.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gmi');
      const stan = async () => { await js('odswiezKarty()'); await czekaj(300);
        return { uwagi: await js("document.getElementById('uwagi').innerText"), status: await js("document.getElementById('status').textContent") }; };
      fs.mkdirSync(path.join(projekt, 'dane-test'), { recursive: true });
      fs.copyFileSync(zrodlo, path.join(projekt, 'dane-test', plik));
      fs.renameSync(zrodlo, zapas);
      fs.writeFileSync(szablon, tekst.replace(naDANE, '$1dane-test/' + plik));
      const jawna = await stan();
      fs.writeFileSync(szablon, tekst);
      const zapasowa = await stan();
      fs.renameSync(zapas, zrodlo); fs.rmSync(path.join(projekt, 'dane-test'), { recursive: true, force: true });
      const koniec = await stan();
      podfolder = { plik, jawna: jawna.uwagi.slice(0, 200), zapasowa: zapasowa.uwagi.slice(0, 300), koniec: koniec.uwagi.slice(0, 200) };
      podfolder.ok = / kart /.test(jawna.status) && !jawna.uwagi.trim()
        && /Nie znaleziono plików z kartami/.test(zapasowa.uwagi) && !/podfolder/.test(zapasowa.uwagi) && !koniec.uwagi.trim();
    }
  }
  // Formatowanie z danych i znaczniki HTML (issue #55, --test-edytor, bez zmian w plikach projektu):
  // karta testowa z <b> <i> <u> <s> **…** ~~…~~ <img> i niedomkniętym <b> – z formatowaniem i z bez_formatowania.
  let formatowanie = null;
  if (testBloku('formatowanie')) {
    formatowanie = await wc.executeJavaScript(`(() => {
      const t = parseTemplate('[TALIA Test]\\nKARTA = 63, 44, zaokrąglenie=2\\nTŁO = #f4ecd8\\n'
        + 'TEKST = 3, 3, 57, 18, "<em>Dane:</em> [A]", rozmiar=9\\n'
        + 'TEKST = 3, 22, 57, 18, "<em>Bez:</em> [A]", rozmiar=9, bez_formatowania\\n', 'test.txt').talie[0];
      const row = { A: '<b>pogrubienie</b> <i>kursywa</i> <u>podkreślenie</u> <s>przekreślenie</s> **gwiazdki** ~~tyldy~~ <img src=x> 5* <B>niedomknięty' };
      const warn = new Set(), fmt = new Set();
      const r = renderCard(t, t.awers, row, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, formatowanie: fmt, wbudowane: {} });
      const d = document.createElement('div');
      d.id = 'test-formatowanie';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:8px;display:flex;gap:8px';
      const stary = parseTemplate('[TALIA Test]\\nKARTA = 63, 44\\nTEKST = 3, 3, 57, 38, [A], rozmiar=9, bez_formatowania\\n', 'test.txt').talie[0];
      const r0 = renderCard(stary, stary.awers, row, { warn: new Set(), icons: RAPORT.icons, label: 'Test 0', plik: 'test.txt', kolumny: true, wbudowane: {} });
      d.innerHTML = '<div class="karta" data-talia="Test" title="przed" style="' + esc(r0.style) + 'background:#f4ecd8">' + r0.html + '</div>'
        + '<div class="karta" data-talia="Test" title="po" style="' + esc(r.style) + '">' + r.html + '</div>';
      document.body.appendChild(d);
      fitAll(d);
      const [z, b] = [...d.querySelectorAll('.karta')[1].querySelectorAll('.el.tekst .tresc')];
      const h = z.innerHTML, hb = b.innerHTML;
      const ok = /<b>pogrubienie<\\/b>/.test(h) && /<i>kursywa<\\/i>/.test(h) && /<u>podkreślenie<\\/u>/.test(h) && /<s>przekreślenie<\\/s>/.test(h)
        && /<b>gwiazdki<\\/b>/.test(h) && /<s>tyldy<\\/s>/.test(h) && /<em>Dane:<\\/em>/.test(h) && !z.querySelector('img') && /&lt;img src=x&gt;/.test(h) && /5\\*/.test(h)
        && /<b>niedomknięty<\\/b>$/.test(h) && !d.querySelector('.el.tekst b .el, b .tresc')
        && /<em>Bez:<\\/em>/.test(hb) && !b.querySelector('b, i, u, s') && hb.includes('&lt;b&gt;pogrubienie') && hb.includes('**gwiazdki**') && hb.includes('~~tyldy~~')
        && [...warn].some((w) => /Test 1 \\(kolumna \\[A\\]\\): niedomknięty znacznik <b>/.test(w)) && fmt.has('Test 1 – [A]');
      const rect = d.getBoundingClientRect();
      return { ok, html: h.slice(0, 400), bez: hb.slice(0, 200), uwagi: [...warn], raport: [...fmt],
        rect: { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) } };
    })()`);
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-formatowanie.png', (await wc.capturePage(formatowanie.rect)).toPNG());
    await wc.executeJavaScript("document.getElementById('test-formatowanie').remove()");
  }
  // Układ z danych (issue #70, --test-edytor, bez zmian w plikach projektu): pozycje, obrót, kadr, odbicie i krycie z [Kolumn].
  // Obrazek testowy to tymczasowy plik w `files` (usuwany po teście).
  let uklad = null;
  if (testBloku('uklad')) {
    uklad = await wc.executeJavaScript(`(() => {
      files.set('test-obraz.svg', new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#c0504d"/><circle cx="50" cy="50" r="30" fill="#f4d58d"/><path d="M0 0L100 100" stroke="#1d1b19" stroke-width="6"/></svg>'], 'test-obraz.svg', { type: 'image/svg+xml' }));
      const r = (linie, row, naglowek) => {
        const t = parseTemplate('[TALIA Test]\\n' + (naglowek || 'KARTA = 63, 88\\n') + linie + '\\n', 'test.txt').talie[0];
        const warn = new Set();
        const w = renderCard(t, t.awers, row || {}, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, wbudowane: {} });
        return { html: w.html, style: w.style, uwagi: [...warn] };
      };
      const wyniki = {};
      const spr = (nazwa, warunek) => { wyniki[nazwa] = !!warunek; };
      const img = (x) => (/<img[^>]*style="([^"]*)"/.exec(x.html) || [])[1] || '';
      // 1. pozycja z kolumn, przecinek dziesiętny
      let a = r('OBRAZEK = [X], [Y], 10, 10, test-obraz.svg', { X: '12,5', Y: '3' });
      spr('pozycja', a.html.includes('left:12.5mm;top:3mm;width:10mm;height:10mm;') && !a.uwagi.length);
      // 2. puste / częściowo puste / nieliczbowe
      a = r('OBRAZEK = [X], [Y], 10, 10, test-obraz.svg', { X: '', Y: '' });
      spr('pustaPozycja', !a.html.includes('class="el obrazek"') && !a.uwagi.length);
      a = r('OBRAZEK = [X], [Y], 10, 10, test-obraz.svg', { X: '5', Y: '' });
      spr('czescPusta', !a.html.includes('class="el obrazek"') && a.uwagi.length === 1 && /część pozycji/.test(a.uwagi[0]) && /^test\\.txt, wiersz \\d+: /.test(a.uwagi[0]));
      a = r('OBRAZEK = [X], [Y], 10, 10, test-obraz.svg', { X: 'abc', Y: '2' });
      spr('nieLiczba', !a.html.includes('class="el obrazek"') && a.uwagi.length === 1 && /nie liczba/.test(a.uwagi[0]) && /^test\\.txt, wiersz \\d+: /.test(a.uwagi[0]));
      // 3. kadr
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, kadr=-1.5 -3.5 108');
      spr('kadrStaly', /class="el obrazek" style="[^"]*overflow:hidden;/.test(a.html) && img(a).includes('translate(-1.5mm,-3.5mm) scale(1.08)') && img(a).includes('object-fit:cover'));
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, kadr=[KX] [KY] [S]', { KX: '2,5', KY: '-1', S: '120' });
      spr('kadrZDanych', img(a).includes('translate(2.5mm,-1mm) scale(1.2)') && a.html.includes('overflow:hidden;'));
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, kadr=[KX] [KY] [S]', { KX: '', KY: '', S: '' });
      spr('kadrPusty', img(a).includes('object-fit:cover') && !img(a).includes('transform') && !a.html.includes('overflow:hidden') && !a.uwagi.length);
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, kadr=a b c');
      spr('kadrZly', a.uwagi.length === 1 && /kadr=/.test(a.uwagi[0]) && /^test\\.txt, wiersz \\d+: /.test(a.uwagi[0]));
      // 4. krycie
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, krycie=50%\\nOBRAZEK = 1, 1, 10, 10, test-obraz.svg, krycie=0.5\\n'
        + 'IKONA = 1, 1, 5, 5, A, krycie=50%\\nIKONA = 1, 1, 5, 5, A, krycie=0.5\\nPROSTOKĄT = 1, 1, 5, 5, kolor=#f00, krycie=50%\\nPROSTOKĄT = 1, 1, 5, 5, kolor=#f00, krycie=0.5');
      spr('krycieStale', (a.html.match(/opacity:0\\.5;/g) || []).length === 6 && !a.uwagi.length);
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, krycie=[K]\\nPROSTOKĄT = 1, 1, 5, 5, kolor=#f00, krycie=[K]', { K: '25%' });
      spr('krycieZDanych', (a.html.match(/opacity:0\\.25;/g) || []).length === 2);
      a = r('PROSTOKĄT = 1, 1, 5, 5, kolor=#f00, krycie=[K]', { K: 'dużo' });
      spr('kryciePrzeciez', a.uwagi.length === 1 && /krycie/.test(a.uwagi[0]) && !a.html.includes('opacity'));
      // 5. odbicie
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, odbicie=poziome');
      spr('odbicieObrazek', img(a).includes('transform:scale(-1,1)'));
      a = r('IKONA = 1, 1, 5, 5, A, obrót=10, odbicie=poziome');
      spr('odbicieIkona', /class="el ikony" style="[^"]*transform:rotate\\(10deg\\) scale\\(-1,1\\);/.test(a.html));
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, odbicie=[O]\\nIKONA = 1, 1, 5, 5, A, odbicie=[O]', { O: '' });
      spr('odbiciePuste', !a.html.includes('scale(-1') && !/<img[^>]*transform/.test(a.html) && !/class="el ikony" style="[^"]*transform/.test(a.html) && !a.uwagi.length);
      a = r('OBRAZEK = 1, 1, 10, 10, test-obraz.svg, odbicie=[O]', { O: 'oba' });
      spr('odbicieOba', img(a).includes('transform:scale(-1,-1)'));
      // 6. obrót z kolumny
      a = r('PROSTOKĄT = 1, 1, 5, 5, kolor=#f00, obrót=[R]', { R: '15' });
      spr('obrotZDanych', a.html.includes('transform:rotate(15deg);'));
      // 8. zgodność wstecz: szablon bez nowych opcji daje HTML jak w 0.5.11 (wzorzec ustalony na kodzie z main)
      a = r('PROSTOKĄT = 1, 2, 3, 4, kolor=#f00, krycie=0.4, obrót=5\\nOBRAZEK = 5, 6, 10, 10, test-obraz.svg, dopasuj=wypełnij\\nIKONA = 20, 6, 8, 8, A, obrót=10', {}, 'KARTA = 63, 44\\nTŁO = #f4ecd8\\n');
      const wzorzec = '<div class="el ksztalt" style="left:1mm;top:2mm;width:3mm;height:4mm;transform:rotate(5deg);background:#f00;opacity:0.4;"></div><div class="el obrazek" style="left:5mm;top:6mm;width:10mm;height:10mm;"><img src="BLOB" alt="" style="object-fit:cover;object-position:center center"></div><div class="el ikony" style="left:20mm;top:6mm;width:8mm;height:8mm;transform:rotate(10deg);align-items:center;justify-content:center;font-size:8mm">A</div>';
      spr('zgodnosc', a.html.replace(/blob:[^"]+/, 'BLOB') === wzorzec);
      // karta z kilkoma elementami do zrzutu
      const t = parseTemplate('[TALIA Test]\\nKARTA = 63, 88, zaokrąglenie=3\\nTŁO = #e9dcc0\\n'
        + 'PROSTOKĄT = 4, 4, 55, 38, kolor=#d8c7a4\\n'
        + 'OBRAZEK = 4, 4, 26, 38, test-obraz.svg, kadr=-4 3 130\\nOBRAZEK = 33, 4, 26, 38, test-obraz.svg, kadr=[KX] [KY] [S], odbicie=poziome\\n'
        + 'ELIPSA = [X], [Y], 12, 12, kolor=#fffaf0, obwódka=0.4, krycie=[K]\\nIKONA = 30, 50, 12, 12, A, obrót=20, odbicie=poziome, krycie=50%\\n'
        + 'PROSTOKĄT = 8, 70, 20, 8, kolor=#5a4632, obrót=[R], krycie=0.6\\n', 'test.txt').talie[0];
      const warn = new Set();
      const rt = renderCard(t, t.awers, { KX: '-2', KY: '0', S: '150', X: '10', Y: '50', K: '40%', R: '-8' }, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, wbudowane: {} });
      const d = document.createElement('div');
      d.id = 'test-uklad';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:8px';
      d.innerHTML = '<div class="karta" data-talia="Test" title="uklad" style="' + esc(rt.style) + '">' + rt.html + '</div>';
      document.body.appendChild(d);
      fitAll(d);
      spr('zrzutBezUwag', warn.size === 0);
      const ok = Object.values(wyniki).every(Boolean);
      const rect = d.getBoundingClientRect();
      return { ok, wyniki, zgodnosc: a.html, uwagi: [...warn], rect: { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) } };
    })()`);
    // zrzut dopiero po wczytaniu obrazków i odmalowaniu (inaczej capturePage łapie poprzednią klatkę)
    await wc.executeJavaScript(`new Promise((r) => { const im = [...document.querySelectorAll('#test-uklad img')];
      Promise.all(im.map((i) => (i.complete ? 0 : new Promise((z) => { i.onload = i.onerror = z; }))))
        .then(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))); })`);
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-uklad.png', (await wc.capturePage(uklad.rect)).toPNG());
    await wc.executeJavaScript("document.getElementById('test-uklad').remove(); files.delete('test-obraz.svg')");
  }
  // Warunki jeśli= (issue #72, --test-edytor, bez zmian w plikach projektu): pusta kolumna, & i |, porównania liczb, Uwagi.
  let jesli = null;
  if (testBloku('jesli')) {
    jesli = await wc.executeJavaScript(`(() => {
      const r = (linie, row) => {
        const t = parseTemplate('[TALIA Test]\\nKARTA = 63, 88\\n' + linie + '\\n', 'test.txt').talie[0];
        const warn = new Set();
        const w = renderCard(t, t.awers, row || {}, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, wbudowane: {} });
        return { html: w.html, n: (w.html.match(/class="el /g) || []).length, uwagi: [...warn] };
      };
      const wyniki = {};
      const spr = (nazwa, warunek) => { wyniki[nazwa] = !!warunek; };
      const p = (warunek, row) => r('PROSTOKĄT = 1, 1, 5, 5, kolor=#f00, jeśli=' + warunek, row);
      // 1. pusta / niepusta kolumna (też same spacje) i dotychczasowe formy
      spr('pusta', p('[A]=', { A: '' }).n === 1 && p('[A]=', { A: 'x' }).n === 0 && p('[A]=', { A: '  ' }).n === 1);
      spr('niepusta', p('[A]!=', { A: 'x' }).n === 1 && p('[A]!=', { A: '' }).n === 0);
      spr('stare', p('[A]', { A: 'x' }).n === 1 && p('[A]', { A: '' }).n === 0 && p('[A]=Tak', { A: 'tAK' }).n === 1
        && p('[A]!=tak', { A: 'nie' }).n === 1 && p('[A]=1', { A: '001' }).n === 1 && p('[A]=1', { A: '2' }).n === 0);
      // 2. & (i) i | (lub), & mocniej niż |
      const ab = (a, b, c) => ({ A: a, B: b, C: c });
      spr('i', p('[A]=x & [B]=y', ab('x', 'y')).n === 1 && p('[A]=x & [B]=y', ab('x', 'z')).n === 0 && p('[A]=x & [B]=y', ab('q', 'y')).n === 0);
      spr('lub', p('[A]=x | [B]=y', ab('q', 'y')).n === 1 && p('[A]=x | [B]=y', ab('x', 'q')).n === 1 && p('[A]=x | [B]=y', ab('q', 'q')).n === 0);
      // A | B & C = A lub (B i C)
      spr('priorytet', p('[A]=x | [B]=y & [C]=z', ab('x', 'q', 'q')).n === 1 && p('[A]=x | [B]=y & [C]=z', ab('q', 'y', 'z')).n === 1
        && p('[A]=x | [B]=y & [C]=z', ab('q', 'y', 'q')).n === 0 && p('[A]=x & [B]=y | [C]=z', ab('x', 'q', 'z')).n === 1 && p('[A]=x & [B]=y | [C]=z', ab('x', 'q', 'q')).n === 0);
      spr('puste_i_niepuste', p('[A]= & [B]!=', ab('', 'x')).n === 1 && p('[A]= & [B]!=', ab('', '')).n === 0);
      // 3. liczby
      const l = (w, a) => p(w, { A: a }).n === 1;
      spr('wieksze', l('[A]>10', '11') && !l('[A]>10', '10') && l('[A]>=10', '10') && !l('[A]>=10', '9'));
      spr('mniejsze', l('[A]<10', '9') && !l('[A]<10', '10') && l('[A]<=10', '10') && !l('[A]<=10', '11'));
      spr('przecinek', l('[A]>2.5', '2,6') && !l('[A]<2.5', '2,6') && l('[A]<=2.5', '2,5') && l('[A]>-1', '-0,5'));
      spr('dwieKolumny', p('[A]<[B]', ab('3', '12')).n === 1 && p('[A]<[B]', ab('30', '12')).n === 0);
      spr('liczbyBezUwag', !p('[A]>10', { A: '11' }).uwagi.length);
      // 4. nie liczba: fałsz + Uwaga zależna od danych (raz), pusta kolumna – fałsz bez Uwagi
      let a = r('PROSTOKĄT = 1, 1, 5, 5, kolor=#f00, jeśli=[A]>10\\nTEKST = 1, 10, 20, 5, "x", jeśli=[A]>10', { A: 'dużo' });
      spr('nieLiczba', a.n === 0 && a.uwagi.length === 2 && a.uwagi.every((u) => /^test\\.txt, wiersz \\d+: Test 1: „dużo” w warunku jeśli=\\[A\\]>10 to nie liczba/.test(u)));
      a = p('[A]>10', { A: '' });
      spr('pustaLiczba', a.n === 0 && !a.uwagi.length);
      a = p('[A]>10 | [B]=x', { A: 'abc', B: 'x' });
      spr('lubPoBledzie', a.n === 1 && a.uwagi.length === 1);
      // 5. zgodność wstecz: HTML kart bez nowych form jak dotąd
      a = r('PROSTOKĄT = 1, 2, 3, 4, kolor=#f00, jeśli=[A]=tak', { A: 'tak' });
      spr('zgodnosc', a.html === '<div class="el ksztalt" style="left:1mm;top:2mm;width:3mm;height:4mm;background:#f00;"></div>');
      // 6. edytor: kolorowanie nowych form bez wyjątku, tekst zachowany
      const kol = kolorujLinie('PROSTOKĄT = 1, 1, 5, 5, kolor=#f00, jeśli=[Plon]>=7 & [Lubi]= | [Rzadka]!=');
      const tekst = new DOMParser().parseFromString(kol, 'text/html').body.textContent;
      spr('kolorowanie', tekst === 'PROSTOKĄT = 1, 1, 5, 5, kolor=#f00, jeśli=[Plon]>=7 & [Lubi]= | [Rzadka]!=');
      // karta do zrzutu: każdy kwadrat to inny warunek; rysować się mają tylko pierwszy, trzeci, czwarty, szósty i siódmy
      const kw = (i, w, kolor) => 'PROSTOKĄT = ' + (4 + (i % 4) * 14) + ', ' + (4 + Math.floor(i / 4) * 14) + ', 12, 12, kolor=' + kolor + ', jeśli=' + w + '\\n';
      const t = parseTemplate('[TALIA Test]\\nKARTA = 63, 88, zaokrąglenie=3\\nTŁO = #e9dcc0\\n'
        + kw(0, '[Opis]=', '#4e7a3a') + kw(1, '[Opis]!=', '#b23a48') + kw(2, '[Plon]>=7 & [Opis]=', '#2f5d8a') + kw(3, '[Plon]<5 | [Rzadka]=', '#c9a227')
        + kw(4, '[Plon]>10', '#000001') + kw(5, '[Plon]>=7 & [Rzadka]=tak | [Plon]=8', '#6e9f5a') + kw(6, '[Rzadka]=', '#4a4e69') + kw(7, '[Plon]<[Opis]', '#000002') + '\\n', 'test.txt').talie[0];
      const warn = new Set();
      const rt = renderCard(t, t.awers, { Opis: '', Plon: '8', Rzadka: '' }, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, wbudowane: {} });
      spr('zrzutKwadraty', (rt.html.match(/class="el ksztalt"/g) || []).length === 5 && !rt.html.includes('#000001') && !rt.html.includes('#000002') && rt.html.includes('#4e7a3a') && !rt.html.includes('#b23a48'));
      spr('zrzutUwaga', warn.size === 0);
      const d = document.createElement('div');
      d.id = 'test-jesli';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:8px';
      d.innerHTML = '<div class="karta" data-talia="Test" title="jesli" style="' + esc(rt.style) + '">' + rt.html + '</div>';
      document.body.appendChild(d);
      const ok = Object.values(wyniki).every(Boolean);
      const rect = d.getBoundingClientRect();
      return { ok, wyniki, uwagi: [...warn], rect: { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) } };
    })()`);
    await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))))');
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-jesli.png', (await wc.capturePage(jesli.rect)).toPNG());
    await wc.executeJavaScript("document.getElementById('test-jesli').remove()");
  }
  // Mieszane rozmiary w polu TEKST (issue #71 a, --test-edytor, bez zmian w plikach projektu):
  // <small> 0,6, <big> 1,4, <rozmiar=N> w pt względem pola; całość skaluje się razem w fitAll (także z grupa=).
  let rozmiary = null;
  if (testBloku('rozmiary')) {
    rozmiary = await wc.executeJavaScript(`(() => {
      const wyniki = {};
      const spr = (nazwa, warunek) => { wyniki[nazwa] = !!warunek; };
      const d = document.createElement('div');
      d.id = 'test-rozmiary';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:8px;display:flex;gap:8px';
      document.body.appendChild(d);
      const karta = (linie, row, naglowek) => {
        const t = parseTemplate('[TALIA Test]\\n' + (naglowek || 'KARTA = 63, 88, zaokrąglenie=3\\nTŁO = #f4ecd8\\n') + linie + '\\n', 'test.txt').talie[0];
        const warn = new Set(), fmt = new Set();
        const r = renderCard(t, t.awers, row || {}, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, formatowanie: fmt, wbudowane: {} });
        const k = document.createElement('div');
        k.className = 'karta'; k.dataset.talia = 'Test'; k.title = 'rozmiary'; k.style.cssText = r.style;
        k.innerHTML = r.html;
        d.appendChild(k);
        return { k, uwagi: [...warn], fmt: [...fmt], html: r.html };
      };
      const px = (el) => parseFloat(getComputedStyle(el).fontSize);
      const blisko = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
      // 1. stosunki rozmiarów (pole 20 pt), pion=środek
      const a = karta('TEKST = 4, 4, 55, 40, "Efekt główny <small>(dopisek)</small> <big>Duży</big> <rozmiar=12>dwanaście</rozmiar> <big><small>razem</small></big> <big><rozmiar=10,5>pt</rozmiar></big>", rozmiar=20, wyrównanie=środek, pion=środek');
      fitAll(d);
      const pa = a.k.querySelector('.el.tekst'), P = px(pa);
      const sm = a.k.querySelector('.tresc > small'), bg = a.k.querySelector('.tresc > big'), rz = a.k.querySelector('.tresc > .rozmiar');
      const zag = a.k.querySelector('big > small'), rzb = a.k.querySelector('big > .rozmiar');
      spr('bezZmniejszania', blisko(P, 20 * 96 / 72, 0.05) && !a.k.classList.contains('za-dlugi'));
      spr('small', !!sm && blisko(px(sm) / P, 0.6));
      spr('big', !!bg && blisko(px(bg) / P, 1.4));
      spr('rozmiarPt', !!rz && blisko(px(rz), 12 * 96 / 72, 0.05));
      spr('zagniezdzone', !!zag && blisko(px(zag) / P, 0.84));
      spr('rozmiarWBig', !!rzb && blisko(px(rzb), 10.5 * 96 / 72, 0.05));
      spr('bezUwag', !a.uwagi.length);
      const er = pa.getBoundingClientRect(), tr = pa.firstElementChild.getBoundingClientRect();
      spr('pionSrodek', Math.abs((er.top + er.bottom) / 2 - (tr.top + tr.bottom) / 2) < 1.5 && tr.height < er.height - 10);
      // 2. za długi tekst: całość zmniejsza się, stosunki zostają
      const b = karta('TEKST = 4, 4, 55, 14, "Bardzo długi efekt, który się nie mieści w polu, więc musi się zmniejszyć <small>(dopisek, który też się zmniejsza)</small> <big>Duży</big> <rozmiar=12>dwanaście</rozmiar>", rozmiar=20, min=0.3');
      fitAll(d);
      const pb = b.k.querySelector('.el.tekst'), Pb = px(pb);
      const ratio = (sel) => px(b.k.querySelector(sel)) / Pb;
      spr('zmniejszone', Pb < 20 * 96 / 72 * 0.9 && !b.k.classList.contains('za-dlugi'));
      spr('zmniejszoneStosunki', blisko(ratio('.tresc > small'), 0.6) && blisko(ratio('.tresc > big'), 1.4) && blisko(ratio('.tresc > .rozmiar'), 0.6));
      // 3. grupa=: dwa pola skalują się razem, fragmenty zachowują stosunki
      const g = karta('TEKST = 4, 4, 26, 12, "Koszt <small>(za sztukę i jeszcze trochę tekstu)</small>", rozmiar=16, grupa=g\\nTEKST = 33, 4, 26, 12, "<big>Punkty</big>", rozmiar=16, grupa=g');
      fitAll(d);
      const [g1, g2] = g.k.querySelectorAll('.el.tekst');
      spr('grupa', blisko(px(g1), px(g2), 0.05) && px(g1) < 16 * 96 / 72 && blisko(px(g1.querySelector('small')) / px(g1), 0.6) && blisko(px(g2.querySelector('big')) / px(g2), 1.4));
      // 4. dane, niedomknięty znacznik, bez_formatowania, zły rozmiar
      const c = karta('TEKST = 4, 4, 55, 20, "[A]", rozmiar=14\\nTEKST = 4, 26, 55, 20, "[A]", rozmiar=14, bez_formatowania\\nTEKST = 4, 50, 55, 20, "x <rozmiar=abc>y</rozmiar>", rozmiar=14', { A: 'Efekt <small>(dopisek' });
      const [c1, c2, c3] = [...c.k.querySelectorAll('.el.tekst .tresc')];
      spr('daneNiedomkniete', /<small>\\(dopisek<\\/small>$/.test(c1.innerHTML) && c.uwagi.some((w) => /Test 1 \\(kolumna \\[A\\]\\): niedomknięty znacznik <small>/.test(w)) && c.fmt.includes('Test 1 – [A]'));
      spr('bezFormatowania', !c2.querySelector('small') && c2.innerHTML.includes('&lt;small&gt;(dopisek'));
      spr('zlyRozmiar', !c3.querySelector('.rozmiar') && c3.innerHTML.includes('&lt;rozmiar=abc&gt;') && c.uwagi.some((w) => /<rozmiar=abc> – potrzebny rozmiar/.test(w)));
      d.removeChild(g.k); d.removeChild(c.k);
      // 5. raport drukarni: obwiednia glifów liczona osobno dla fragmentów o różnym rozmiarze
      const o = karta('TEKST = 4, 4, 55, 20, "MMM", rozmiar=20\\nTEKST = 4, 30, 55, 20, "<small>MMM</small>", rozmiar=20\\nTEKST = 4, 56, 55, 20, "<rozmiar=12>MMM</rozmiar>", rozmiar=20');
      fitAll(d);
      const [o1, o2, o3] = [...o.k.querySelectorAll('.el.tekst')].map(obwiedniaGlifow).map((x) => x.y2 - x.y1);
      spr('obwiednia', blisko(o2 / o1, 0.6, 0.06) && blisko(o3 / o1, 0.6, 0.06));
      d.removeChild(o.k);
      // 6. zgodność: pole bez nowych znaczników – HTML jak w 0.5.14
      const z = karta('TEKST = 1, 2, 30, 10, "<b>A</b> <i>b</i>", rozmiar=9, pion=środek', {}, 'KARTA = 63, 44\\n');
      spr('zgodnosc', z.html === '<div class="el tekst" style="left:1mm;top:2mm;width:30mm;height:10mm;;font-size:9pt;line-height:1.15;text-align:left;justify-content:center" data-pt="9"><div class="tresc"><b>A</b> <i>b</i></div></div>');
      d.removeChild(z.k);
      const ok = Object.values(wyniki).every(Boolean);
      const rect = d.getBoundingClientRect();
      return { ok, wyniki, html: pa.innerHTML.slice(0, 500), uwagi: [...a.uwagi, ...c.uwagi], obwiednia: [o1, o2, o3], zgodnosc: z.html,
        rect: { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) } };
    })()`);
    await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))))');
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-rozmiary.png', (await wc.capturePage(rozmiary.rect)).toPNG());
    await wc.executeJavaScript("document.getElementById('test-rozmiary').remove()");
  }
  // Akapity w polu TEKST (issue #71 b, --test-edytor, bez zmian w plikach projektu):
  // <lewo>/<środek>/<prawo> na początku wiersza i lista=tak z wcięciem wiszącym.
  let akapity = null;
  if (testBloku('akapity')) {
    akapity = await wc.executeJavaScript(`(() => {
      const wyniki = {};
      const spr = (nazwa, warunek) => { wyniki[nazwa] = !!warunek; };
      const d = document.createElement('div');
      d.id = 'test-akapity';
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;padding:8px;display:flex;gap:8px';
      document.body.appendChild(d);
      const karta = (linie, row, naglowek) => {
        const t = parseTemplate('[TALIA Test]\\n' + (naglowek || 'KARTA = 63, 88, zaokrąglenie=3\\nTŁO = #f4ecd8\\n') + linie + '\\n', 'test.txt').talie[0];
        const warn = new Set(), fmt = new Set();
        const r = renderCard(t, t.awers, row || {}, { warn, icons: RAPORT.icons, label: 'Test 1', plik: 'test.txt', kolumny: true, formatowanie: fmt, wbudowane: {} });
        const k = document.createElement('div');
        k.className = 'karta'; k.dataset.talia = 'Test'; k.title = 'akapity'; k.style.cssText = r.style;
        k.innerHTML = r.html;
        d.appendChild(k);
        return { k, uwagi: [...warn], fmt: [...fmt], html: r.html };
      };
      const zakres = document.createRange();
      const tekstRect = (el) => {
        let l = Infinity, r = -Infinity;
        const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = it.nextNode(); n; n = it.nextNode()) { zakres.selectNodeContents(n); for (const q of zakres.getClientRects()) if (q.width > 0.5) { l = Math.min(l, q.left); r = Math.max(r, q.right); } }
        return { left: l, right: r };
      };
      const blisko = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
      // 1. wyrównanie wierszy: pole wyrównane do prawej, wiersze ze znacznikami (dane i szablon)
      const a = karta('TEKST = 4, 4, 55, 40, "[A]", rozmiar=12, wyrównanie=prawo\\nTEKST = 4, 46, 55, 12, "<środek>Szablon\\\\nZwykły", rozmiar=12', {
        A: 'Domyślny\\n<środek>Środek\\n<lewo>Lewo\\n<srodek>Bez ogonków</srodek>\\n**<prawo>Pogrubiony</prawo>**\\n<b>Gruby\\n<środek>dalej</b>' });
      fitAll(d);
      const [pa, ps] = a.k.querySelectorAll('.el.tekst');
      const ak = [...pa.querySelectorAll('.akapit')];
      const er = pa.getBoundingClientRect();
      const ta = ak.map((x) => getComputedStyle(x).textAlign);
      spr('wyrownanieLiczba', ak.length === 7 && pa.firstElementChild.children.length === 7);
      spr('wyrownanieStyl', ta.join(',') === 'right,center,left,center,right,right,center');
      const r1 = ak.map(tekstRect);
      spr('wyrownaniePozycja', blisko(r1[0].right, er.right) && blisko((r1[1].left + r1[1].right) / 2, (er.left + er.right) / 2) && blisko(r1[2].left, er.left)
        && blisko(r1[4].right, er.right) && r1[1].left > er.left + 20 && r1[1].right < er.right - 20);
      spr('znacznikiZdjete', !pa.innerHTML.includes('&lt;') && ak[4].querySelector('b')?.textContent === 'Pogrubiony');
      spr('przezWiersze', ak[5].querySelector('b')?.textContent === 'Gruby' && ak[6].querySelector('b')?.textContent === 'dalej' && !pa.querySelector('b:empty'));
      spr('wyrownanieUwagi', !a.uwagi.length && a.fmt.includes('Test 1 – [A]'));
      const sa = [...ps.querySelectorAll('.akapit')];
      spr('wyrownanieSzablon', sa.length === 2 && getComputedStyle(sa[0]).textAlign === 'center' && getComputedStyle(sa[1]).textAlign === 'left');
      // 2. lista=tak: wcięcie wiszące, pogrubiony numer, wiersze bez punktora zwykłe
      const b = karta('TEKST = 4, 4, 40, 78, "[A]", rozmiar=11, lista=tak', {
        A: '**1.** Pierwszy punkt jest na tyle długi, że zawija się na kilka linii tekstu.\\n- Myślnik też ma długi tekst, który zawija się w następną linię.\\nZwykły wiersz bez punktora, też dość długi, żeby się zawinął.\\n12. Dwunasty punkt z długim tekstem do zawinięcia w polu.\\n• Kropka\\n-5 obrażeń\\n1.5 punktu\\n* gwiazdka' });
      fitAll(d);
      const pb = b.k.querySelector('.el.tekst');
      const ab = [...pb.querySelectorAll('.akapit')];
      spr('listaKlasy', ab.map((x) => (x.classList.contains('lista') ? 'L' : '-')).join('') === 'LL-LL---');
      spr('listaPogrubiony', ab[0].querySelector('.punkt b')?.textContent === '1.' && !pb.querySelector('b:empty') && ab[3].querySelector('.punkt').textContent.trim() === '12.');
      // druga linia tekstu za punktem zaczyna się tam, gdzie pierwsza litera po numerze
      const wiszace = (akapit) => {
        const w = akapit.querySelector('.wiersz');
        const it = document.createTreeWalker(w, NodeFilter.SHOW_TEXT);
        const rects = [];
        for (let n = it.nextNode(); n; n = it.nextNode()) { zakres.selectNodeContents(n); rects.push(...[...zakres.getClientRects()].filter((q) => q.width > 0.5)); }
        const linie = [...new Set(rects.map((q) => Math.round(q.top)))];
        const lewa = (top) => Math.min(...rects.filter((q) => Math.round(q.top) === top).map((q) => q.left));
        const punkt = akapit.querySelector('.punkt').getBoundingClientRect();
        return { linie: linie.length, l1: lewa(linie[0]), l2: lewa(linie[1]), punkt: punkt.left };
      };
      const w0 = wiszace(ab[0]), w1 = wiszace(ab[1]), w3 = wiszace(ab[3]);
      spr('listaWiszace', [w0, w1, w3].every((w) => w.linie >= 2 && blisko(w.l1, w.l2, 0.6) && w.l1 > w.punkt + 3));
      const zr = document.createRange(); zr.selectNodeContents(ab[2].firstChild);
      const zwRects = [...zr.getClientRects()].filter((q) => q.width > 0.5);
      spr('listaZwykly', zwRects.length >= 2 && blisko(Math.min(...zwRects.map((q) => q.left)), pb.getBoundingClientRect().left, 0.6));
      spr('listaUwagi', !b.uwagi.length && !b.k.classList.contains('za-dlugi'));
      // 3. lista + wyrównanie, za długi tekst (fitAll), pion=środek
      const c = karta('TEKST = 4, 4, 55, 16, "[A]", rozmiar=14, lista=tak, pion=środek, min=0.3\\nTEKST = 4, 30, 55, 40, "[B]", rozmiar=12, lista=tak, pion=środek', {
        A: '1. Bardzo długi punkt, który na pewno się nie mieści w tak niskim polu i musi się zmniejszyć.\\n2. Drugi punkt też.\\n<środek>Wyśrodkowany akapit pod listą.',
        B: '1. Krótko.\\n<środek>Środek' });
      fitAll(d);
      const [c1, c2] = c.k.querySelectorAll('.el.tekst');
      spr('fitAll', parseFloat(c1.style.fontSize) < 14 * 0.9 && !c.k.classList.contains('za-dlugi') && !overflows(c1));
      const e2 = c2.getBoundingClientRect(), t2 = c2.firstElementChild.getBoundingClientRect();
      spr('pionSrodek', blisko((e2.top + e2.bottom) / 2, (t2.top + t2.bottom) / 2) && t2.height < e2.height - 20
        && getComputedStyle(c2.querySelectorAll('.akapit')[1]).textAlign === 'center');
      // 4. grupa=: bloki akapitów na całą szerokość nie liczą się jako kolizja – liczy się tylko tekst
      const g = karta('TEKST = 4, 4, 34, 10, "<lewo>Koszt", rozmiar=16, grupa=g\\nTEKST = 25, 4, 34, 10, "<prawo>Punkty", rozmiar=16, grupa=g');
      fitAll(d);
      const [g1, g2] = g.k.querySelectorAll('.el.tekst');
      spr('grupa', parseFloat(g1.style.fontSize) === 16 && parseFloat(g2.style.fontSize) === 16 && !g.k.classList.contains('za-dlugi'));
      // 5. dane: bez_formatowania, znacznik w środku wiersza, zamknięcie bez otwarcia, niedomknięte
      const n = karta('TEKST = 4, 4, 55, 12, "[A]", rozmiar=10, bez_formatowania\\nTEKST = 4, 20, 55, 12, "[B]", rozmiar=10\\nTEKST = 4, 36, 55, 12, "[C]", rozmiar=10\\nTEKST = 4, 52, 55, 12, "[D]", rozmiar=10', {
        A: '<środek>Tekst', B: 'Tekst <środek>w środku', C: 'Linia</prawo>', D: '<prawo>Bez zamknięcia\\n<środek>Drugi</prawo>' });
      const [n1, n2, n3, n4] = [...n.k.querySelectorAll('.el.tekst .tresc')];
      spr('bezFormatowania', !n1.querySelector('.akapit') && n1.innerHTML === '&lt;środek&gt;Tekst');
      spr('wSrodkuWiersza', !n2.querySelector('.akapit') && n2.innerHTML === 'Tekst &lt;środek&gt;w środku' && n.uwagi.some((w) => /Test 1 \\(kolumna \\[B\\]\\): znacznik <środek> działa tylko na początku wiersza/.test(w)));
      spr('nadmiarowe', !n3.querySelector('.akapit') && n3.innerHTML === 'Linia&lt;/prawo&gt;' && n.uwagi.some((w) => /\\[C\\]\\): znacznik <\\/prawo> działa tylko na końcu wiersza/.test(w)));
      const n4a = n4.querySelectorAll('.akapit');
      spr('niedomkniete', n4a.length === 2 && getComputedStyle(n4a[0]).textAlign === 'right' && n4a[1].innerHTML === 'Drugi&lt;/prawo&gt;' && n.uwagi.length === 3);
      d.removeChild(g.k); d.removeChild(n.k);
      // 6. raport drukarni: obwiednia glifów wyśrodkowanego akapitu jak w polu wyrównanym do środka
      const o = karta('TEKST = 4, 4, 55, 20, "<środek>MMM", rozmiar=20\\nTEKST = 4, 30, 55, 20, "MMM", rozmiar=20, wyrównanie=środek');
      fitAll(d);
      const [o1, o2] = [...o.k.querySelectorAll('.el.tekst')].map(obwiedniaGlifow);
      spr('obwiednia', blisko(o1.x1, o2.x1, 0.5) && blisko(o1.x2, o2.x2, 0.5) && blisko(o1.y2 - o1.y1, o2.y2 - o2.y1, 0.5));
      d.removeChild(o.k);
      // 7. zgodność: pole bez nowych znaczników – HTML jak w 0.5.15; lista=tak bez punktorów – ten sam HTML
      const z = karta('TEKST = 1, 2, 30, 10, "<b>A</b> <i>b</i>\\\\nDrugi", rozmiar=9, pion=środek\\nTEKST = 1, 14, 30, 10, "<b>A</b> <i>b</i>\\\\nDrugi", rozmiar=9, pion=środek, lista=tak', {}, 'KARTA = 63, 44\\n');
      const pole = '<div class="el tekst" style="left:1mm;top:2mm;width:30mm;height:10mm;;font-size:9pt;line-height:1.15;text-align:left;justify-content:center" data-pt="9"><div class="tresc"><b>A</b> <i>b</i><br>Drugi</div></div>';
      spr('zgodnosc', z.html === pole + pole.replace('top:2mm', 'top:14mm'));
      d.removeChild(z.k);
      // 8. edytor: lista= koloruje się jak opcja, znaczniki akapitu w tekście bez błędów
      const kol = kolorujLinie('TEKST = 1, 1, 10, 10, "<środek>a", lista=tak');
      spr('edytor', kol.includes('<span class="sk-opc">lista</span>') && kol.includes('&lt;środek&gt;a'));
      const ok = Object.values(wyniki).every(Boolean);
      const rect = d.getBoundingClientRect();
      return { ok, wyniki, html: pa.innerHTML.slice(0, 600), lista: pb.innerHTML.slice(0, 600), uwagi: [...a.uwagi, ...b.uwagi, ...n.uwagi], wiszace: [w0, w1, w3], obwiednia: [o1, o2], zgodnosc: z.html,
        rect: { x: 0, y: 0, width: Math.ceil(rect.width), height: Math.ceil(rect.height) } };
    })()`);
    await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))))');
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-akapity.png', (await wc.capturePage(akapity.rect)).toPNG());
    await wc.executeJavaScript("document.getElementById('test-akapity').remove()");
  }
  // Talie na wspólnych arkuszach (issue #34, --test-edytor, każdy projekt): liczba arkuszy z opcją i bez,
  // lustro arkusza rewersów (pozycja i geometria względem awersu, z przesunięciem), pełna siatka przy jednym rewersie,
  // puste miejsca przy różnych, obrót rewersu kart poziomych w drugą stronę; zrzut -arkusze.png; zlecenie pdf z kluczem.
  let arkusze = null;
  if (testBloku('arkusze')) {
    arkusze = await wc.executeJavaScript(`(() => {
      const wyniki = {}, bledy = [];
      const spr = (nazwa, warunek, opis) => { wyniki[nazwa] = !!warunek; if (!warunek && opis) bledy.push(nazwa + ': ' + opis); };
      const karty = kartyEksportu({});
      // Oczekiwana liczba arkuszy z liczby kart i siatki (A4: margines 8 mm z każdej strony).
      const oczekiwane = (wspolne) => {
        const grupy = new Map();
        for (const k of karty) {
          const [w, h] = cardMm(k), cw = Math.min(w, h), ch = Math.max(w, h);
          const klucz = wspolne ? cw + 'x' + ch : k.dataset.talia + '|' + w + 'x' + h;
          if (!grupy.has(klucz)) grupy.set(klucz, { cw, ch, karty: [] });
          grupy.get(klucz).karty.push(k);
        }
        let awersy = 0, rewersy = 0;
        for (const g of grupy.values()) {
          const per = Math.max(1, Math.floor(194 / g.cw)) * Math.max(1, Math.floor(281 / g.ch));
          for (let i = 0; i < g.karty.length; i += per) { awersy++; if (g.karty.slice(i, i + per).some((k) => rewersKarty(k))) rewersy++; }
        }
        return { awersy, rewersy };
      };
      const liczba = { bez: buildPrint({ uklad: 'a4', wspolne: false }).arkusze, z: buildPrint({ uklad: 'a4' }).arkusze };
      liczba.arkuszeZ = document.querySelectorAll('#druk .arkusz').length;
      const ocz = { bez: oczekiwane(false), z: oczekiwane(true) };
      spr('liczbaBez', JSON.stringify(liczba.bez) === JSON.stringify(ocz.bez), JSON.stringify([liczba.bez, ocz.bez]));
      spr('liczbaZ', JSON.stringify(liczba.z) === JSON.stringify(ocz.z) && liczba.arkuszeZ === ocz.z.awersy + ocz.z.rewersy, JSON.stringify([liczba.z, ocz.z]));
      // Przykład 07-gildie: 22 karty 63×88 / 88×63 z 6 talii + 6 kart 44×68 – 13 arkuszy bez opcji, 8 z opcją.
      if (PROJEKT === 'Gildie') spr('gildie', liczba.bez.awersy + liczba.bez.rewersy === 13 && liczba.z.awersy + liczba.z.rewersy === 8, JSON.stringify(liczba));
      // Geometria: arkusze widoczne na ekranie (na co dzień #druk jest tylko w druku), pomiar w mm względem arkusza.
      const PX = 1.5, PY = -2;
      buildPrint({ uklad: 'a4', przesuniecieX: PX, przesuniecieY: PY });
      const styl = document.createElement('style'); styl.id = 'test-arkusze-styl';
      styl.textContent = '#druk{display:block;position:fixed;left:0;top:0;z-index:99999;background:#777;zoom:0.33;white-space:nowrap;padding:8px}'
        + '#druk .arkusz{position:relative;overflow:hidden;background:#fff;display:inline-block;margin:0 12px 0 0;vertical-align:top;white-space:normal}'
        + '#druk .uklad{display:grid}#druk .znacznik{position:absolute;background:#000}#druk .linia-ciecia{position:absolute;z-index:2}';
      document.head.appendChild(styl);
      const kartaW = (el) => el && (el.classList.contains('karta') ? el : el.querySelector('.karta'));
      const srodek = (el, ark) => { const a = ark.getBoundingClientRect(), r = el.getBoundingClientRect(), s = 210 / a.width;
        return [((r.left + r.right) / 2 - a.left) * s, ((r.top + r.bottom) / 2 - a.top) * s]; };
      const blisko = (a, b) => Math.abs(a - b) <= 0.05;
      const wKomorce = (k, c, ark) => { const s = 210 / ark.getBoundingClientRect().width, a = c.getBoundingClientRect(), b = k.getBoundingClientRect();
        return k !== c && [b.left - a.left, b.top - a.top, a.right - b.right, a.bottom - b.bottom].every((d) => blisko(d * s, 0)); };
      const ark = [...document.querySelectorAll('#druk .arkusz')];
      const st = { pary: 0, pozycje: 0, lustro: 0, geometria: 0, puste: 0, pelne: 0, rozne: 0, poziome: 0, obrot: 0, wKomorce: 0 };
      for (let i = 0; i < ark.length; i++) {
        const fu = ark[i].querySelector('.uklad');
        if (!fu.querySelector('[data-karta]')) { bledy.push('arkusz ' + i + ' bez awersów'); continue; }
        const nast = ark[i + 1], bu = nast && !nast.querySelector('[data-karta]') ? nast.querySelector('.uklad') : null;
        const awersy = [...fu.children];
        const zRewersem = awersy.map((el) => rewersKarty(karty.find((k) => kluczKarty(k) === el.dataset.karta)));
        if (!bu) { if (zRewersem.some(Boolean)) bledy.push('arkusz ' + i + ': brak arkusza rewersów'); continue; }
        i++; st.pary++;
        const uc = getComputedStyle(fu).gridTemplateColumns.split(' ').length, rewersy = [...bu.children];
        const jeden = zRewersem.every(Boolean) && new Set(zRewersem.map((b, j) => { const k = karty.find((x) => kluczKarty(x) === awersy[j].dataset.karta);
          const [w, h] = cardMm(k); return wygladRewersu(b, w, h); })).size === 1;
        const wiersze = Math.ceil(awersy.length / uc);
        if (rewersy.length !== wiersze * uc) bledy.push('arkusz ' + i + ': ' + rewersy.length + ' komórek rewersów zamiast ' + wiersze * uc);
        if (jeden) { st.pelne++; if (rewersy.some((el) => !kartaW(el))) bledy.push('arkusz ' + i + ': jeden rewers, a siatka niepełna'); }
        else st.rozne++;
        awersy.forEach((el, j) => {
          const r = Math.floor(j / uc), c = j % uc, be = rewersy[r * uc + (uc - 1 - c)], b = zRewersem[j];
          st.pozycje++;
          const k = karty.find((x) => kluczKarty(x) === el.dataset.karta), [w, h] = cardMm(k);
          if (!b) { if (!jeden && !kartaW(be)) st.puste++; else bledy.push('arkusz ' + i + ' poz. ' + j + ': rewers u karty bez rewersu'); return; }
          const kb = kartaW(be);
          if (kb && be.dataset.dla === el.dataset.karta && kb.dataset.talia === b.dataset.talia && kb.innerHTML === b.innerHTML) st.lustro++;
          else bledy.push('arkusz ' + i + ' poz. ' + j + ': rewers nie tej karty (' + (be && be.dataset.dla) + ')');
          const [fx, fy] = srodek(el, ark[i - 1]), [bx, by] = srodek(be, ark[i]);
          if (blisko(bx, 210 - fx + PX) && blisko(by, fy + PY)) st.geometria++;
          else bledy.push('arkusz ' + i + ' poz. ' + j + ': środek rewersu ' + bx.toFixed(2) + ',' + by.toFixed(2) + ' zamiast ' + (210 - fx + PX).toFixed(2) + ',' + (fy + PY).toFixed(2));
          if (w > h) { st.poziome++;
            if (/rotate\\(90deg\\)/.test(kartaW(el).style.transform) && /rotate\\(-90deg\\)/.test(kb.style.transform)) st.obrot++;
            else bledy.push('arkusz ' + i + ' poz. ' + j + ': obrót rewersu karty poziomej');
            // Obrócona karta (awers i rewers) leży dokładnie w komórce – komórka ma overflow:hidden, zły translate by ją obciął.
            if (wKomorce(kartaW(el), el, ark[i - 1]) && wKomorce(kb, be, ark[i])) st.wKomorce++;
            else bledy.push('arkusz ' + i + ' poz. ' + j + ': obrócona karta wystaje poza komórkę'); }
        });
        // Różne rewersy: miejsca bez karty (niepełny ostatni rząd) puste.
        if (!jeden) rewersy.forEach((be, j) => { const r = Math.floor(j / uc), c = j % uc;
          if (r * uc + (uc - 1 - c) >= awersy.length && kartaW(be)) bledy.push('arkusz ' + i + ' poz. ' + j + ': rewers na pustym miejscu'); });
      }
      spr('pary', st.pary === liczba.z.rewersy, st.pary + ' par');
      spr('lustro', st.lustro + st.puste === st.pozycje, '');
      spr('geometria', st.geometria === st.lustro, '');
      spr('obrot', st.obrot === st.poziome, '');
      spr('wKomorce', st.wKomorce === st.poziome, '');
      spr('bezBledow', !bledy.length, '');
      if (PROJEKT === 'Gildie') spr('gildieArkusze', st.pelne >= 2 && st.rozne >= 2 && st.puste >= 2 && st.poziome >= 4, JSON.stringify(st));
      // Zrzut: pierwsze 4 arkusze (awersy + rewersy dwóch arkuszy).
      ark.slice(4).forEach((a) => { a.style.display = 'none'; });
      const r = document.getElementById('druk').getBoundingClientRect();
      return { ok: Object.values(wyniki).every(Boolean), wyniki, liczba, oczekiwane: ocz, st, bledy: bledy.slice(0, 10),
        rect: { x: 0, y: 0, width: Math.ceil(Math.min(r.width, window.innerWidth)), height: Math.ceil(Math.min(r.height, window.innerHeight)) } };
    })()`);
    await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))');
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-arkusze.png', (await wc.capturePage(arkusze.rect)).toPNG());
    await wc.executeJavaScript("document.getElementById('test-arkusze-styl').remove(); buildPrint(); true");
    // Zlecenie pdf (poza przykładami): wspolnearkusze = nie → arkusze jak bez opcji; alias wspolne; zła wartość → błąd.
    if (!jestPrzykladem(szablon)) {
      const zl = path.join(projekt, ...FOLDER_ZLECEN);
      fs.mkdirSync(zl, { recursive: true });
      const zlec = async (tresc) => {
        const w = path.join(zl, 'wynik-pdf.json');
        fs.rmSync(w, { force: true }); fs.writeFileSync(path.join(zl, 'pdf'), tresc);
        for (let i = 0; i < 240; i++) { await czekaj(500); try { return JSON.parse(fs.readFileSync(w, 'utf8')); } catch (e) { /* jeszcze nie */ } }
        return null;
      };
      const bez = await zlec('uklad = a4\nwspolnearkusze = nie\nplik = Export/arkusze-bez.pdf\n');
      const z = await zlec('uklad = a4\nwspolne = tak\nplik = Export/arkusze-z.pdf\n');
      const zle = await zlec('uklad = a4\nwspolnearkusze = może\n');
      const ob = arkusze.oczekiwane;
      arkusze.zlecenie = { bez: bez && { ok: bez.ok, strony: bez.strony, arkusze: bez.arkusze }, z: z && { ok: z.ok, strony: z.strony, arkusze: z.arkusze }, zle: zle && { ok: zle.ok, blad: zle.blad } };
      arkusze.zlecenie.ok = !!(bez && bez.ok && bez.strony === ob.bez.awersy + ob.bez.rewersy && bez.arkusze && bez.arkusze.wspolne === false
        && z && z.ok && z.strony === ob.z.awersy + ob.z.rewersy && z.arkusze && z.arkusze.awersy === ob.z.awersy && z.arkusze.wspolne === true
        && zle && zle.ok === false && /wspolnearkusze/.test(zle.blad || ''));
      arkusze.ok = arkusze.ok && arkusze.zlecenie.ok;
    }
  }
  // Rewersy zależne od karty (issue #47, --test-edytor, każdy projekt): talie bez kolumn w [REWERS] – rewers wspólny jak dotąd;
  // 07-gildie (Magowie): warianty rewersu w podglądzie, A4 (lustro), drukarnia osobno / na przemian, pojedyncze, odciski z polem r
  // (stary zapis bez r → nic zmienionego, zmiana kolumny rewersu → ta karta zmieniona); poza przykładami zlecenie pcio
  // (najczęstszy rewers + ostrzeżenie). Zrzuty -rewersy.png (podgląd) i -rewersy-a4.png (arkusz awersów i rewersów).
  let rewersy = null;
  if (testBloku('rewersy')) {
    rewersy = await wc.executeJavaScript(`(async () => {
      const wyniki = {}, bledy = [];
      const spr = (nazwa, warunek, opis) => { wyniki[nazwa] = !!warunek; if (!warunek) bledy.push(nazwa + (opis ? ': ' + opis : '')); };
      const podglad = document.getElementById('podglad');
      const karty = kartyEksportu({});
      const zalezne = [...REWERSY_KART.keys()];
      // Zgodność: talie bez kolumn w [REWERS] – najwyżej jeden rewers, bez data-rewers, rewersKarty = rewers talii.
      const wspolne = [...podglad.querySelectorAll('.talia')].filter((s) => !REWERSY_KART.has(s.dataset.talia));
      spr('wspolne', wspolne.every((s) => s.querySelectorAll('.karta.rewers').length <= 1 && !s.querySelector('[data-rewers]'))
        && karty.filter((k) => !REWERSY_KART.has(k.dataset.talia)).every((k) => rewersKarty(k) === backOf(k.dataset.talia)));
      spr('flaga', TALIE.every((t) => !REWERSY_KART.has(t.nazwa) || t.rewersZalezny));
      const wynik = { zalezne, wspolneTalie: wspolne.length };
      if (PROJEKT === 'Gildie') {
        const sek = podglad.querySelector('.talia[data-talia="Magowie"]');
        const mag = karty.filter((k) => k.dataset.talia === 'Magowie');
        const id = (n) => mag.find((k) => k.dataset.id === String(n));
        const ety = [...sek.querySelectorAll('.rewers-podglad .etykieta')].map((e) => e.textContent);
        wynik.magowie = { rewersy: sek.querySelectorAll('.karta.rewers').length, etykiety: ety };
        spr('magowie', zalezne.join() === 'Magowie' && wynik.magowie.rewersy === 3 && mag.length === 7 && mag.every((k) => rewersKarty(k)), JSON.stringify(wynik.magowie));
        // Uczeń i Astrolog (Runy) – ten sam rewers; Iluzjonista (Księgi) – inny; Alchemik – dwustronny.
        const r = (n) => rewersKarty(id(n));
        spr('warianty', r(1) === r(3) && r(1) !== r(4) && r(2) !== r(1) && r(2) !== r(4) && r(1).dataset.odcisk !== r(4).dataset.odcisk);
        spr('etykiety', JSON.stringify(ety) === JSON.stringify(['Rewers 1 · ×2', 'Rewers 2 · ×1', 'Rewers 3 · ×4']), JSON.stringify(ety));
        spr('dwustronna', /Kamień filozoficzny/.test(r(2).textContent) && /#c9a227/i.test(r(2).getAttribute('style')) && !/Magowie/.test(r(2).textContent)
          && /szkoła Runy/.test(r(1).textContent) && /szkoła Księgi/.test(r(4).textContent));
        // Karty awersów bez nowych atrybutów (odciski!).
        spr('awersBezZmian', mag.every((k) => !k.hasAttribute('data-rewers')));
        // A4 (sama talia – 7 kart, 3 kolumny): rewers z lustrzanej pozycji = rewers tej karty.
        const kartaW = (el) => el && (el.classList.contains('karta') ? el : el.querySelector('.karta'));
        buildPrint({ uklad: 'a4', karty: mag });
        const ark = [...document.querySelectorAll('#druk .arkusz')];
        let a4 = 0, puste = 0;
        for (const el of ark[1] ? ark[1].querySelectorAll('.uklad > *') : []) {
          if (!el.dataset.dla) { puste += !kartaW(el); continue; }
          const k = mag.find((x) => kluczKarty(x) === el.dataset.dla);
          if (k && kartaW(el).innerHTML === rewersKarty(k).innerHTML) a4++;
        }
        spr('a4', ark.length === 2 && a4 === 7 && puste === 2, ark.length + ' arkuszy, ' + a4 + '/7, puste ' + puste);
        // Drukarnia (spad 0 – strona = klon karty): osobno – plik rewersów, strona N = rewers awersu N; na przemian; pojedyncze.
        const strony = () => [...document.querySelectorAll('#druk .arkusz')].map((a) => a.querySelector('.karta'));
        const ten = (el, k) => !!el && el.innerHTML === rewersKarty(k).innerHTML;
        const plan = buildPrint({ uklad: 'drukarnia', spad: 0, karty: mag });
        let s = strony();
        spr('osobno', plan.pliki.length === 2 && s.length === 14 && mag.every((k, n) => ten(s[7 + n], k)) && plan.strony.slice(7).every((x) => x.plik === 1), JSON.stringify(plan.pliki) + ' ' + s.length);
        buildPrint({ uklad: 'drukarnia', spad: 0, strony: 'naprzemian', karty: mag }); s = strony();
        spr('naprzemian', s.length === 14 && mag.every((k, n) => ten(s[2 * n + 1], k)));
        buildPrint({ uklad: 'pojedyncze', karty: mag }); s = strony();
        spr('pojedyncze', s.length === 14 && mag.every((k, n) => ten(s[2 * n + 1], k)));
        // Odciski: a) zapis sprzed 0.6.1 (bez pola r) – nic nie jest zmienione.
        const przed = ODCISKI ? JSON.parse(JSON.stringify(ODCISKI)) : null;
        const liczby = () => ({ zm: podglad.querySelectorAll('.karta.zmieniona:not(.rewers)').length, nowe: podglad.querySelectorAll('.karta.nowa:not(.rewers)').length });
        const stary = { data: new Date().toISOString(), karty: {} };
        for (const k of podglad.querySelectorAll('.siatka .karta')) stary.karty[kluczDruku(k)] = { h: k.dataset.odcisk, html: '' };
        await APP.zapiszOdciski(stary); await oznaczZmiany(podglad);
        wynik.bezR = liczby();
        spr('bezR', wynik.bezR.zm === 0 && wynik.bezR.nowe === 0, JSON.stringify(wynik.bezR));
        // b) zapis z PDF: pole r tylko u kart z rewersem zależnym.
        await zapamietajDruk(karty);
        const zap = await APP.odciski();
        const zR = Object.entries(zap.karty).filter(([, v]) => 'r' in v);
        spr('poleR', zR.length === 7 && zR.every(([kl, v]) => kl.startsWith('Magowie|') && v.r && v.rhtml) && liczby().zm === 0, String(zR.length));
        // c) zmiana kolumny rewersu w jednym wierszu (Astrolog: Runy → Księgi) → tylko ta karta zmieniona, awers ten sam.
        const tal = RAPORT.talie.find((t) => t.nazwa === 'Magowie'), nazwaPliku = tal.plik.replace(/#.*$/, ''), plik = files.get(nazwaPliku);
        const tekst = await plik.text();
        files.set(nazwaPliku, new File([tekst.replace(/^(3;Astrolog;[^;]*;)Runy/m, '$1Księgi')], plik.name, { lastModified: plik.lastModified }));
        await build();
        const zm = [...podglad.querySelectorAll('.karta.zmieniona:not(.rewers)')];
        spr('zmianaRewersu', zm.length === 1 && zm[0].dataset.talia === 'Magowie' && zm[0].dataset.id === '3' && zm[0].dataset.odcisk === zap.karty[kluczDruku(zm[0])].h
          && podglad.querySelectorAll('.talia[data-talia="Magowie"] .karta.rewers').length === 3, zm.map(kluczDruku).join());
        pokazPorownanie(true);
        spr('porownanie', document.querySelectorAll('#porownanie .para').length === 1 && /rewers przed/.test(document.getElementById('porownanie').textContent));
        pokazPorownanie(false);
        files.set(nazwaPliku, plik); await build();
        spr('powrot', liczby().zm === 0);
        await APP.zapiszOdciski(przed || { data: new Date().toISOString(), karty: {} }); await oznaczZmiany(podglad);
        buildPrint();
        const sek2 = podglad.querySelector('.talia[data-talia="Magowie"]');
        sek2.scrollIntoView();
        const rr = sek2.getBoundingClientRect();
        wynik.rect = { x: 0, y: Math.max(0, Math.floor(rr.top)), width: Math.ceil(Math.min(rr.width, window.innerWidth)), height: Math.ceil(Math.min(rr.height, window.innerHeight - Math.max(0, rr.top))) };
      }
      return { ok: Object.values(wyniki).every(Boolean), wyniki, ...wynik, bledy };
    })()`);
    if (rewersy.rect) {
      await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))');
      fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-rewersy.png', (await wc.capturePage(rewersy.rect)).toPNG());
      // Arkusz A4 talii Magowie: awersy i rewersy obok siebie (pod Alchemikiem – rewers dwustronny, w lustrze).
      const rect = await wc.executeJavaScript(`(() => {
        buildPrint({ uklad: 'a4', karty: kartyEksportu({ talie: ['Magowie'] }) });
        const styl = document.createElement('style'); styl.id = 'test-rewersy-styl';
        styl.textContent = '#druk{display:block;position:fixed;left:0;top:0;z-index:99999;background:#777;zoom:0.4;white-space:nowrap;padding:8px}'
          + '#druk .arkusz{position:relative;overflow:hidden;background:#fff;display:inline-block;margin:0 12px 0 0;vertical-align:top;white-space:normal}'
          + '#druk .uklad{display:grid}#druk .znacznik{position:absolute;background:#000}';
        document.head.appendChild(styl);
        const r = document.getElementById('druk').getBoundingClientRect();
        return { x: 0, y: 0, width: Math.ceil(Math.min(r.width, window.innerWidth)), height: Math.ceil(Math.min(r.height, window.innerHeight)) };
      })()`);
      await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))');
      fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-rewersy-a4.png', (await wc.capturePage(rect)).toPNG());
      await wc.executeJavaScript("document.getElementById('test-rewersy-styl').remove(); buildPrint(); true");
      delete rewersy.rect;
    }
    // Zlecenie pcio (poza przykładami, 07-gildie): talia z 3 rewersami → najczęstszy w backTemplate + ostrzeżenie w wyniku.
    if (!jestPrzykladem(szablon) && rewersy.zalezne.includes('Magowie')) {
      const zl = path.join(projekt, ...FOLDER_ZLECEN), w = path.join(zl, 'wynik-pcio.json');
      fs.mkdirSync(zl, { recursive: true }); fs.rmSync(w, { force: true });
      fs.writeFileSync(path.join(zl, 'pcio'), 'talie = Magowie\n');
      let r = null;
      for (let i = 0; i < 240 && !r; i++) { await czekaj(500); try { r = JSON.parse(fs.readFileSync(w, 'utf8')); } catch (e) { /* jeszcze nie */ } }
      let widgets = null;
      try {
        const b = fs.readFileSync(path.join(projekt, r.pliki[0]));
        for (let i = 0; i + 30 <= b.length && b.readUInt32LE(i) === 0x04034b50;) {
          const rozm = b.readUInt32LE(i + 18), dl = b.readUInt16LE(i + 26), ex = b.readUInt16LE(i + 28);
          const nazwa = b.slice(i + 30, i + 30 + dl).toString(), start = i + 30 + dl + ex;
          if (nazwa === 'widgets.json') { widgets = JSON.parse(b.slice(start, start + rozm).toString('utf8')); break; }
          i = start + rozm;
        }
      } catch (e) { /* brak pliku – ok = false niżej */ }
      const deck = widgets && widgets.find((x) => x.type === 'cardDeck');
      const tyl = deck && deck.backTemplate.objects[0];
      rewersy.pcio = { ok: !!(r && r.ok && r.holdery === 1 && r.karty === 7 && (r.ostrzezenia || []).some((o) => /Magowie ma 3 różne rewersy.*najczęstszego \(4 z 7 kart\)/.test(o))
        && tyl && tyl.valueType === 'static' && /^package:\/\/userassets\//.test(tyl.value)), ostrzezenia: r && r.ostrzezenia, blad: r && r.blad };
      rewersy.ok = rewersy.ok && rewersy.pcio.ok;
    }
  }
  // Dodatki #47 (--test-edytor, każdy projekt): stan (liczba rewersów talii), raport (sekcja tylko przy rewersie zależnym),
  // podgląd „Pokaż rewersy kart” (menu Widok), nazwy plików eksportu obrazków; w 07-gildie także klony rewersów w podglądzie,
  // katalog z wariantami (i przy filtrze id), rewersZmieniony w stanie, brakujące kolumny w raporcie. Zrzut -rewersy-kart.png.
  let rewersyDodatki = null;
  if (testBloku('rewersyDodatki')) {
    rewersyDodatki = await wc.executeJavaScript(`(async () => { try {
      const wyniki = {}, bledy = [], wynik = {};
      const spr = (nazwa, warunek, opis) => { wyniki[nazwa] = !!warunek; if (!warunek) bledy.push(nazwa + (opis ? ': ' + opis : '')); };
      const podglad = document.getElementById('podglad'), cel = document.getElementById('podgladRewersy');
      const raport = async () => { const d = document.createElement('div'); d.innerHTML = await raportProjektu(); return d.innerText; };
      // Stan: rewersy = warianty rewersu zależnego, 1 przy wspólnym, 0 bez [REWERS].
      const st = stanKart();
      wynik.stan = st.talie.map((t) => t.nazwa + ':' + t.rewersy);
      spr('stanRewersy', st.talie.every((t) => REWERSY_KART.has(t.nazwa) ? t.rewersy === REWERSY_KART.get(t.nazwa).els.length : t.rewersy === (t.rewers ? 1 : 0)), wynik.stan.join());
      const r0 = await raport();
      spr('raportSekcja', /Rewersy zależne od karty/.test(r0) === REWERSY_KART.size > 0);
      // Podgląd rewersów: klony poza #podglad, karty i eksport bez zmian.
      const kartyPrzed = podglad.querySelectorAll('.siatka .karta').length, eksPrzed = kartyEksportu({}).length;
      // Odciski kart (HTML po dopasowaniu tekstu) – przebudowa przy schowanym podglądzie musi dać te same karty.
      const odciski = () => [...podglad.querySelectorAll('.siatka .karta')].map((k) => k.dataset.odcisk).join(), odcPrzed = odciski();
      pokazRewersyKart(true);
      const klony = [...cel.querySelectorAll('[data-dla]')];
      const sekcje = [...cel.querySelectorAll('.talia')];
      const zgodne = klony.filter((el) => {
        const k = [...podglad.querySelectorAll('.siatka .karta:not(.rewers)')].find((x) => kluczKarty(x) === el.dataset.dla);
        const b = k && rewersKarty(k);
        return b ? el.innerHTML === b.innerHTML : el.classList.contains('brak-rewersu');
      }).length;
      spr('podglad', podglad.classList.contains('schowany') && podglad.getBoundingClientRect().height === 0 && getComputedStyle(cel).display !== 'none' && sekcje.length === visibleSections().length
        && klony.length === visibleCards().length && zgodne === klony.length && klony.every((el) => el.getBoundingClientRect().width > 0),
        sekcje.length + ' sekcji, ' + zgodne + '/' + klony.length + ' klonów');
      spr('podgladBezSkutkow', podglad.querySelectorAll('.siatka .karta').length === kartyPrzed && kartyEksportu({}).length === eksPrzed
        && !cel.querySelector('[data-odcisk]'));
      await build();
      spr('podgladPoPrzebudowie', cel.querySelectorAll('[data-dla]').length === klony.length && podglad.classList.contains('schowany')
        && odciski() === odcPrzed, 'odciski kart po przebudowie przy schowanym podglądzie: ' + (odciski() === odcPrzed));
      // Nazwy plików eksportu obrazków: wspólny rewers raz, rewers zależny – plik na kartę z jej ID.
      const plan = planEksportuObrazkow(kartyEksportu({}), {}, 'jpg');
      const wspolneRew = [...podglad.querySelectorAll('.siatka .karta.rewers')].filter((k) => !REWERSY_KART.has(k.dataset.talia)).length;
      const zalKarty = kartyEksportu({}).filter((k) => REWERSY_KART.has(k.dataset.talia) && rewersKarty(k));
      spr('eksportNazwy', plan.length === eksPrzed + wspolneRew + zalKarty.length && new Set(plan.map((x) => x.name)).size === plan.length
        && planEksportuObrazkow(kartyEksportu({}), { rewersy: false }).length === eksPrzed, plan.length + ' plików');
      if (PROJEKT === 'Gildie') {
        const sek = cel.querySelector('.talia[data-talia="Magowie"]');
        const ety = [...sek.querySelectorAll('.etykieta')].map((e) => e.textContent);
        wynik.etykiety = ety;
        spr('etykiety', JSON.stringify(ety) === JSON.stringify(['1 · Rewers 1', '2 · Rewers 2', '3 · Rewers 1', '4 · Rewers 3', '5 · Rewers 3', '6 · Rewers 3', '7 · Rewers 3']), JSON.stringify(ety));
        const zl = cel.querySelector('.talia[data-talia="Złodzieje"]');
        spr('bezRewersu', !!zl && zl.querySelectorAll('.brak-rewersu').length === zl.querySelectorAll('[data-dla]').length && zl.querySelectorAll('[data-dla]').length > 0);
        const pm = planEksportuObrazkow(kartyEksportu({ talie: ['Magowie', 'Ratusz'] }));
        const rew = pm.filter((x) => /_rewers\\.jpg$/.test(x.name)).map((x) => x.name);
        wynik.eksport = rew;
        const mag = kartyEksportu({ talie: ['Magowie'] });
        spr('eksportMagowie', JSON.stringify(rew) === JSON.stringify(['Gildie_Ratusz_rewers.jpg', ...[1, 2, 3, 4, 5, 6, 7].map((n) => 'Gildie_Magowie_' + n + '_rewers.jpg')])
          && pm.filter((x) => /Magowie_\\d+_rewers/.test(x.name)).every((x, n) => x.el === rewersKarty(mag[n])), JSON.stringify(rew));
        // Katalog: wszystkie warianty; przy filtrze id – warianty wybranych kart; wspólny rewers przy filtrze id – pominięty (jak dotąd).
        const kat = async (o) => (await katalogPng(o)).map((s) => s.talia + ':' + s.rewersy.join('|'));
        wynik.katalog = [...await kat({ talie: ['Magowie', 'Ratusz'] }), ...await kat({ talie: ['Magowie', 'Ratusz'], id: ['1', '4'] })];
        spr('katalog', JSON.stringify(wynik.katalog) === JSON.stringify(['Ratusz:Rewers', 'Magowie:Rewers 1 · ×2|Rewers 2 · ×1|Rewers 3 · ×4',
          'Ratusz:', 'Magowie:Rewers 1 · ×1|Rewers 3 · ×1']), JSON.stringify(wynik.katalog));
        spr('raportMagowie', /Talia Magowie: 3 warianty rewersu \\(×2, ×1, ×4\\)/.test(r0) && !/brak kolumn/.test(r0), r0.slice(r0.indexOf('Rewersy zależne'), r0.indexOf('Rewersy zależne') + 120));
        // rewersZmieniony: zapis „PDF”, zmiana szkoły Astrologa (tylko rewers) → stan karty 3, potem powrót.
        const przed = ODCISKI ? JSON.parse(JSON.stringify(ODCISKI)) : null;
        await zapamietajDruk(kartyEksportu({}));
        const tal = RAPORT.talie.find((t) => t.nazwa === 'Magowie'), nazwaPliku = tal.plik.replace(/#.*$/, ''), plik = files.get(nazwaPliku);
        const tekst = await plik.text();
        files.set(nazwaPliku, new File([tekst.replace(/^(3;Astrolog;[^;]*;)Runy/m, '$1Księgi')], plik.name, { lastModified: plik.lastModified }));
        await build();
        const s2 = stanKart(), m2 = s2.talie.find((t) => t.nazwa === 'Magowie');
        wynik.rewersyZmienione = s2.rewersyZmienione;
        spr('rewersZmieniony', JSON.stringify(s2.rewersyZmienione) === '["Magowie 3"]' && m2.lista.filter((k) => k.rewersZmieniony).map((k) => k.id).join() === '3'
          && m2.lista.find((k) => k.id === '3').zmieniona === true, JSON.stringify(s2.rewersyZmienione));
        // Brakująca kolumna rewersu w danych → raport ją podaje.
        files.set(nazwaPliku, new File([tekst.replace(/^ID;Nazwa;Opis;Szkoła;/, 'ID;Nazwa;Opis;Szkola2;')], plik.name, { lastModified: plik.lastModified }));
        await build();
        const r1 = await raport();
        spr('raportBrak', /brak kolumn: Szkoła/.test(r1), r1.slice(r1.indexOf('Rewersy zależne'), r1.indexOf('Rewersy zależne') + 160));
        files.set(nazwaPliku, plik); await build();
        await APP.zapiszOdciski(przed || { data: new Date().toISOString(), karty: {} }); await oznaczZmiany(podglad);
        spr('powrot', stanKart().rewersyZmienione === null || stanKart().rewersyZmienione.length === 0);
        const s = cel.querySelector('.talia[data-talia="Magowie"]');
        s.scrollIntoView(); window.scrollBy(0, -(document.querySelector('.pasek') || { offsetHeight: 0 }).offsetHeight);
        const rr = s.getBoundingClientRect();
        wynik.rect = { x: 0, y: Math.max(0, Math.floor(rr.top)), width: Math.ceil(Math.min(rr.width, window.innerWidth)), height: Math.ceil(Math.min(rr.height, window.innerHeight - Math.max(0, rr.top))) };
      }
      return { ok: Object.values(wyniki).every(Boolean), wyniki, ...wynik, bledy };
    } catch (e) { return { ok: false, bledy: ['wyjątek: ' + ((e && e.stack) || e)] }; } })()`);
    if (rewersyDodatki.rect) {
      await wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))');
      fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-rewersy-kart.png', (await wc.capturePage(rewersyDodatki.rect)).toPNG());
      delete rewersyDodatki.rect;
    }
    await wc.executeJavaScript('pokazRewersyKart(false)');   // menu ma włączyć podgląd samo (przegląd #97)
    // Menu Widok → Pokaż rewersy kart: przełącza stronę, stan zakładki; wyłączenie wraca do awersów.
    const pozycja = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Widok')?.submenu.items.find((i) => i.label === 'Pokaż rewersy kart');
    const naStronie = () => wc.executeJavaScript("getComputedStyle(document.getElementById('podgladRewersy')).display !== 'none'");
    let menuWl = null, menuWyl = null;
    if (pozycja) {
      pozycja.click(); await czekaj(300); menuWl = await naStronie() && aktywny.pokazRewersy === true;
      const p2 = Menu.getApplicationMenu().items.find((i) => i.label === 'Widok').submenu.items.find((i) => i.label === 'Pokaż rewersy kart');
      p2.click(); await czekaj(300); menuWyl = !(await naStronie()) && aktywny.pokazRewersy === false;
    }
    rewersyDodatki.menu = { jest: !!pozycja, wlacz: menuWl, wylacz: menuWyl };
    rewersyDodatki.ok = rewersyDodatki.ok && !!pozycja && menuWl && menuWyl;
  }
  // Raport drukarni – rozmiar tekstu, obwódki przy cięciu, dpi ikon i zaokrąglenie dpi (#110; --test-edytor, każdy projekt):
  // karta testowa (renderCard poza podglądem, pliki PNG z canvas dopisane na czas testu do files) o znanych wymiarach.
  let raportProgi = null;
  if (testBloku('raportProgi')) {
    raportProgi = await wc.executeJavaScript(`(async () => {
      const b = [], w = {}, dodane = ['Ikony/proba-64.png', 'Grafika/proba-815.png'];
      const d = document.createElement('div');
      try {
        const png = async (x, y) => { const c = document.createElement('canvas'); c.width = x; c.height = y; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, x, y);
          return new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'p.png', { type: 'image/png', lastModified: 1 }); };
        files.set(norm(dodane[0]), await png(64, 64)); files.set(norm(dodane[1]), await png(815, 600));
        const icons = { proba: { url: fileUrl(dodane[0]), plik: dodane[0] } };
        const dlugi = 'Bardzo długi opis karty, który nie mieści się w małym polu i musi zostać mocno zmniejszony przez dopasowanie. '.repeat(3);
        const t = parseTemplate('[TALIA Próba]\\nKARTA = 63, 88, obwódka=0.5\\nTŁO = #f4ecd8\\n'
          + 'TEKST = 10, 10, 43, 5, "' + dlugi + '", rozmiar=8\\n'                   // dopasowanie do min 0,6 → 4,8 pt, kolor domyślny – próg 8
          + 'TEKST = 10, 20, 43, 10, "Duży <small>drobny</small>", rozmiar=9, kolor=#000\\n'   // <small> 5,4 pt < 6
          + 'TEKST = 10, 32, 43, 8, "Kolorowy", rozmiar=7, kolor=#cc0000\\n'        // 7 < 8
          + 'TEKST = 10, 42, 43, 8, "Czarny siedem", rozmiar=7, kolor=#000\\n'      // 7 ≥ 6 – bez uwagi
          + 'PROSTOKĄT = 1, 1, 61, 86, obwódka=0.5\\n'                              // 1 mm – BŁĄD
          + 'PROSTOKĄT = 4, 4, 55, 80, obwódka=0.3\\n'                              // 4 mm – UWAGA
          + 'PROSTOKĄT = 20, 52, 20, 6, obwódka=0.3\\n'                             // daleko – bez uwagi
          + 'PROSTOKĄT = -3, 60, 69, 10, kolor=#336699, obwódka=0.3\\n'             // boki w spadzie, góra/dół przechodzą przez cięcie – bez uwagi
          + 'ELIPSA = 50, 30, 12, 12, obwódka=0.3\\n'                               // prawa 1 mm – BŁĄD
          + 'LINIA = 10, 85, 50, 85\\n'                                             // dolna 2,85 mm – BŁĄD
          + 'LINIA = 30, -3, 30, 15\\n'                                             // przez linię cięcia – bez uwagi
          + 'LINIA = 40, 30, 40, 86\\n'                                             // prostopadła, koniec 2 mm przed cięciem (− grubość/2) – UWAGA
          + 'IKONA = 20, 70, 15, 10, {proba}\\n'                                  // 64 px na 10 mm ≈ 162,5 dpi (CI: 162,6 – układ w 1/64 px)
          + 'OBRAZEK = -3, 72, 69, 60, "' + dodane[1] + '", dopasuj=zmieść\\n', 'test.txt').talie[0];   // 815 px na 69 mm = 299,98 dpi – OK
        const r = renderCard(t, t.awers, {}, { warn: new Set(), icons, label: 'Próba 1', plik: 'test.txt', kolumny: true, wbudowane: {} });
        d.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden';
        d.innerHTML = '<div class="karta" data-talia="Próba" title="Próba 1" style="' + esc(r.style) + '">' + r.html + '</div>';
        document.body.appendChild(d);
        const k = d.firstElementChild;
        await waitForImages(d); fitAll(d); await ukladDoPomiaru([k]);
        const maly = malyTekstKarty(k, { czarny: 6, kontra: 8 });
        w.maly = maly.map((x) => x.tekst.slice(0, 12) + ':' + x.rozmiar + '/' + x.prog);
        const dl = maly.find((x) => /^Bardzo/.test(x.tekst)), sm = maly.find((x) => x.tekst === 'drobny'), kol = maly.find((x) => x.tekst === 'Kolorowy');
        if (!dl || dl.rozmiar > 5 || dl.prog !== 8 || !sm || Math.abs(sm.rozmiar - 5.4) > 0.05 || sm.prog !== 6 || !kol || kol.rozmiar !== 7 || kol.prog !== 8
          || maly.some((x) => /^(Duży|Czarny)/.test(x.tekst))) b.push('mały tekst ' + JSON.stringify(w.maly));
        const obw = obwodkiKarty(k);
        w.obwodki = obw.map((x) => x.element + ':' + x.poziom + ':' + x.odstep + ':' + x.krawedz);
        const jest = (re, poziom, od) => obw.some((x) => re.test(x.opis) && x.poziom === poziom && (od === undefined || Math.abs(x.odstep - od) < 0.11));
        if (!jest(/^obwódka karty/, 'BŁĄD', 0) || !jest(/^PROSTOKĄT 1, 1,/, 'BŁĄD', 1) || !jest(/^PROSTOKĄT 4, 4,/, 'UWAGA', 4) || !jest(/^ELIPSA 50, 30/, 'BŁĄD', 1)
          || !jest(/^LINIA 10, 85/, 'BŁĄD', 2.9) || !obw.some((x) => /^LINIA 40, 30/.test(x.opis) && x.poziom === 'UWAGA' && x.koniec && Math.abs(x.odstep - 1.85) < 0.1) || obw.length !== 6) b.push('obwódki ' + JSON.stringify(w.obwodki));
        const dpi = await obrazkiNiskiejRozdzielczosci(300, [k]);
        w.dpi = dpi.map((x) => x.replace(/<[^>]*>/g, ''));
        if (w.dpi.length !== 1 || !/^Ikony\\/proba-64\\.png \\(ikona\\) – 162,[4-6] dpi/.test(w.dpi[0])) b.push('dpi ' + JSON.stringify(w.dpi));
        // Sekcje raportu drukarni z wynikiem testowym (bez podglądu projektu).
        const oryg = window.raportDrukarni;
        window.raportDrukarni = async () => ({ margines: 3, karty: 1, niezmierzone: [], odstep: [], czern: [], krawedz: [], spad: [], spadSzablonu: { talie: {}, bez: [], pliki: [], zmiesc: [] },
          progiTekstu: { czarny: 6, kontra: 8, profil: null }, malyTekst: [{ karta: 'Próba 1', talia: 'Próba', strona: 'awers', rozmiar: maly[0].rozmiar, prog: maly[0].prog, fragmenty: maly }],
          obwodki: obw.map((x) => ({ talia: 'Próba', strona: 'awers', ...x, karty: ['Próba 1'] })) });
        try {
          const sek = await raportJson({ drukarnia: true });
          const s1 = sek.find((x) => /^Drukarnia: tekst mniejszy niż 6 pt/.test(x.tytul)), s2 = sek.find((x) => x.tytul === 'Drukarnia: obwódki i ramki przy linii cięcia');
          w.sekcje = { maly: s1 && s1.pozycje, obwodki: s2 && s2.pozycje };
          if (!s1 || s1.ok || !/^\\d,\\d pt – Próba 1: „Bardzo/.test(s1.pozycje[0] || '') || !s2 || s2.ok || s2.pozycje.length !== 6 || !s2.pozycje.some((t) => /^UWAGA 1,[89] mm .*LINIA 40, 30 .*kończy się bliżej niż 3 mm przed linią cięcia/.test(t)) || !/^BŁĄD – Próba – awersy \\(1\\): obwódka karty/.test(s2.pozycje[0])) b.push('sekcje ' + JSON.stringify(w.sekcje));
        } finally { window.raportDrukarni = oryg; }
      } catch (e) { b.push('wyjątek: ' + ((e && e.stack) || e)); }
      finally { d.remove(); dodane.forEach((p) => files.delete(norm(p))); }
      return { ok: !b.length, bledy: b, ...w };
    })()`);
  }
  CZASY_TESTU.push([null, Date.now()]);                  // koniec ostatniego bloku
  await wc.executeJavaScript('buildPrint()');
  await pdfDoPliku(wc, wynik);
  // Menu aplikacji: własne (polskie), a nie domyślne Electrona.
  const menu = (Menu.getApplicationMenu()?.items || []).map((i) => i.label);
  const plik = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Plik');
  const menuOk = menu.includes('Plik') && menu.includes('Widok') && !!plik && plik.submenu.items.some((i) => i.label === 'Zapisz szablon')
    && Menu.getApplicationMenu().items[0].submenu.items.some((i) => i.label === 'Sprawdź aktualizacje…');
  const ok = menuOk && czcionki.ok && / kart /.test(stan) && !uwagi.trim() && /^image\/jpeg [1-9]/.test(jpg) && (!eksport || eksport.startsWith('Zapisano'))
    && (!edytor || edytor.ok) && (!wybor || wybor.ok) && (!zmienione || zmienione.ok) && (!hist || hist.ok) && (!pcio || pcio.ok) && (!okna || okna.ok) && (!oknaDruku || oknaDruku.ok)
    && (!drukarnia || drukarnia.ok) && (!raportStart || raportStart.ok) && (!drukarniaPdf || drukarniaPdf.ok) && (!spadTest || spadTest.ok) && (!spadSzablonu || spadSzablonu.ok) && (!cmykTest || cmykTest.pominiety || cmykTest.ok) && (!profileDr || profileDr.pominiety || profileDr.ok) && (!filtrWTrakcie || filtrWTrakcie.ok) && (!katalog || katalog.ok) && (!zlecenia || zlecenia.ok) && (!aktualizacja || aktualizacja.ok) && (!podfolder || podfolder.ok)
    && (!formatowanie || formatowanie.ok) && (!uklad || uklad.ok) && (!jesli || jesli.ok) && (!rozmiary || rozmiary.ok) && (!akapity || akapity.ok) && (!arkusze || arkusze.ok) && (!rewersy || rewersy.ok) && (!rewersyDodatki || rewersyDodatki.ok) && projektyTest.ok && (!zakladki || zakladki.ok) && (!zleceniaWTle || zleceniaWTle.ok) && (!raportProgi || raportProgi.ok);
  process.stdout.write(JSON.stringify({ szablon, bloki: Object.keys(czasyBlokow()), stan, czasyBlokow: czasyBlokow(), uwagi, czcionki, jpg, eksport, edytor, wybor, zmienione, hist, pcio, okna, oknaDruku, drukarnia, raportStart, drukarniaPdf, spad: spadTest, spadSzablonu, cmyk: cmykTest, profileDrukarni: profileDr, filtrWTrakcie, katalog, zlecenia, aktualizacja, podfolder, formatowanie, uklad, jesli, rozmiary, akapity, arkusze, rewersy, rewersyDodatki, projekty: projektyTest, zakladki, zleceniaWTle, raportProgi, menu, kod: { zrodlo: KOD.zrodlo, wersja: WERSJA, powod: KOD.powod || null }, pdf: wynik, ok }) + '\n');
  app.exit(ok ? 0 : 1);
}

// ── Start ───────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) app.quit();
// Start w tle (#120): `open -g -a KarKa --args --w-tle` – okno ukryte (ikona w Docku), bez fokusu i bez okna
// aktualizacji. Zakładki, zlecenia i plik stanu działają jak zwykle (aktywna zakładka nie ma dławienia timerów).
// Okno pokazuje się, gdy użytkownik przełączy się na KarKę (Dock, ⌘Tab, open bez -g); wtedy też sprawdzenie aktualizacji.
// Nie przy „activate” ani „second-instance” – przychodzą też z ponownego `open -g` i pokazanie okna zabrałoby fokus.
let startWTle = process.argv.includes('--w-tle');
let sprawdzanieZaplanowane = false;                      // ciche sprawdzenie aktualizacji raz po pokazaniu okna
function zaplanujSprawdzenie() {
  if (sprawdzanieZaplanowane) return;
  sprawdzanieZaplanowane = true;
  setTimeout(() => sprawdzAktualizacje({ cicho: true }), 4000);
}
function pokazUkryteOkno() {
  if (!startWTle) return;
  startWTle = false;                                     // aktywacja przed utworzeniem okna – pokaże je pokazOknoPoWczytaniu
  if (!okno || okno.isDestroyed()) return;
  okno.show(); ulozWidok();
  if (aktywny && aktywny.wc) aktywny.wc.focus();
  zaplanujSprawdzenie();
}
app.on('did-become-active', pokazUkryteOkno);
app.on('second-instance', () => { if (okno && !startWTle) { if (okno.isMinimized()) okno.restore(); okno.focus(); } });

let doOtwarcia = null;                                   // szablon otwarty z Findera przed startem aplikacji
app.on('open-file', (e, plik) => {
  e.preventDefault();
  if (app.isReady() && okno) otworzWZakladce(plik); else doOtwarcia = plik;
});

// Okno z zakładkami: przywrócone z ustawień (nie w trybie testowym – chyba że --test-przywroc), plik z Findera
// jako kolejna zakładka, a gdy nic nie ma – jedna pusta zakładka z ekranem startowym.
async function oknoZZakladkami(plik, przywroc) {
  utworzOkno();
  const przywrocone = przywroc ? await przywrocZakladki() : [];
  if (plik) await otworzWZakladce(plik);
  if (!projekty.length) await nowaZakladka();
  pokazOknoPoWczytaniu(aktywny);
  return przywrocone;
}
const bladTestu = (e) => {                                 // błąd testu = wynik z opisem zamiast zawieszenia
  process.stdout.write(JSON.stringify({ ok: false, blad: (e && e.stack) || JSON.stringify(e) || String(e) }) + '\n');
  app.exit(1);
};

app.whenReady().then(async () => {
  przekierujCdn();
  let nazwaWydania = '';
  try { nazwaWydania = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).nazwaWydania || ''; } catch (e) { /* bez nazwy */ }
  app.setAboutPanelOptions({ applicationName: 'KarKa', credits: 'Kawia Karciana – generator kart do gier (dawniej Generator kart)', applicationVersion: WERSJA + (nazwaWydania ? ` „${nazwaWydania}”` : ''),
    version: `${KOD.zrodlo === 'nakładka' ? 'kod z aktualizacji, ' : ''}Electron ${process.versions.electron}` });

  const argi = process.argv;
  const t = argi.indexOf('--test-pdf');
  const tn = argi.indexOf('--test-nowy');                 // --test-nowy <nowy folder gry> --test-pdf - <wynik.pdf>
  if (t >= 0) {
    testowy = true;
    try {
      // --test-przywroc: zakładki z ustawień też w teście (test-aktualizacje.js sprawdza przywrócenie po restarcie);
      // projekt testowy otwiera się jako kolejna zakładka, a sprawdzane liczby uwzględniają przywrócone.
      const przywrocone = await oknoZZakladkami(null, argi.includes('--test-przywroc'));
      const plik = tn >= 0 ? utworzProjekt(path.resolve(argi[tn + 1])) : argi[t + 1] === '-' ? null : path.resolve(argi[t + 1]);
      const p = plik ? await otworzWZakladce(plik) : aktywny;
      if (!p) throw new Error('nie udało się otworzyć projektu testowego');
      p.wc.once('did-finish-load', () => trybTestowy(tn >= 0 ? argi[tn + 1] : argi[t + 1], path.resolve(argi[t + 2]), przywrocone).catch(bladTestu));
    } catch (e) { bladTestu(e); }
    return;
  }
  await oknoZZakladkami(doOtwarcia, true);
  if (!startWTle) zaplanujSprawdzenie();
});

app.on('activate', async () => {
  if (okno || !app.isReady()) return;
  await oknoZZakladkami(null, true);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => projekty.forEach((p) => historiaZamkniecie(p)));
app.on('before-quit', (e) => {                               // ⌘Q z niezapisanym szablonem
  if (!niezapisane() || testowy) return;
  e.preventDefault();
  czyMoznaPorzucicWszystkie().then((ok) => { if (ok) app.quit(); });
});
