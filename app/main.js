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
const TEST = { pytania: 0, limit: null, odpowiedzLimit: false };

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
}
// Przełączenie na zakładkę: odpięcie starego widoku (strona widzi document.hidden → odświeża rzadziej),
// przypięcie nowego, fokus, tytuł, pasek, menu, zapis listy zakładek.
function pokazProjekt(p) {
  if (!okno || okno.isDestroyed() || !p || !p.widok) return;
  if (aktywny && aktywny !== p && aktywny.widok) {
    try { aktywny.widok.setVisible(false); okno.contentView.removeChildView(aktywny.widok); } catch (e) { /* już odpięty */ }
    if (aktywny.wc) aktywny.wc.setBackgroundThrottling(true);    // w tle: document.hidden → rzadsze odświeżanie
  }
  aktywny = p;
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

// Lista otwartych zakładek w ustawieniach (bez przykładów i pustych), zapisywana przy każdej zmianie –
// po starcie wracają te same zakładki. Brak klucza w ustawieniach → ostatni projekt (jak do 0.5.7).
function zapiszZakladki() {
  if (przywracanie || !okno) return;
  const lista = projekty.filter((p) => p.szablon && !jestPrzykladem(p.szablon));
  const u = ustawienia();
  u.otwarteZakladki = lista.map((p) => p.szablon);
  u.aktywnaZakladka = Math.max(0, lista.indexOf(aktywny));
  zapiszUstawienia(u);
}
const tenSamFolder = (a, b) => !!a && !!b && path.resolve(a) === path.resolve(b);

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
  const sasiad = projekty[i + 1] || projekty[i - 1] || null;
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
    if (p.szablon && !jestPrzykladem(p.szablon) && !przywracanie) {
      const u = ustawienia();
      u.ostatnie = [p.szablon, ...(u.ostatnie || []).map(naSzablon).filter((x) => x && x !== p.szablon)].slice(0, 10);
      zapiszUstawienia(u);
      app.addRecentDocument(p.szablon);
    }
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
// przy błędzie nie powstaje żaden plik (RGB nie udaje CMYK). Wynik wtedy: { pliki, cmyk: { profil, ghostscript, pliki[] } }.
async function pdfDoPliku(webContents, plik, druk) {
  const dane = await webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  if (!druk) { fs.writeFileSync(plik, dane); return plik; }
  const czesci = await drukarnia.przygotujDruk(dane, druk, plik, ZASOBY);
  let raport = null;
  if (druk.cmyk) {
    const gs = cmyk.znajdzGs({ odswiez: true });
    if (!gs.ok) throw new Error(gs.powod);
    if (!druk.cmyk.plik) throw new Error('brak profilu CMYK');
    raport = { profil: druk.cmyk.nazwa, ghostscript: gs.wersja, czas: 0, pliki: [] };
    const PDFLib = drukarnia.pdfLib(ZASOBY);
    for (const c of czesci) {
      const w = await cmyk.konwertujBufor(c.bufor, { gs, profil: druk.cmyk.plik, PDFLib,
        po: (b) => drukarnia.ustawRamki(b, druk, c.indeksy, ZASOBY) });
      const k = w.kontrola, nazwa = path.basename(c.plik);
      if (k.strony !== c.strony) throw new Error(`${nazwa}: po konwersji ${k.strony} stron zamiast ${c.strony}`);
      const zle = [k.rgb && `${k.rgb}× kolor RGB w treści`, k.przestrzenieRgb && `${k.przestrzenieRgb}× przestrzeń barw RGB`,
        k.obrazki.inne.length && `obrazki nie w CMYK: ${[...new Set(k.obrazki.inne)].join(', ')}`, k.trimBox !== k.strony && 'brak TrimBox'].filter(Boolean);
      if (zle.length) throw new Error(`kontrola CMYK: ${nazwa} – ${zle.join('; ')}`);
      c.bufor = w.bufor;
      raport.czas += w.czas;
      raport.pliki.push({ plik: c.plik, ...k, czas: w.czas });
    }
  }
  for (const c of czesci) fs.writeFileSync(c.plik, c.bufor);
  const pliki = czesci.map((c) => c.plik);
  return raport ? { pliki, cmyk: raport } : pliki;
}

// ── CMYK (issue #66, etap 2) ─────────────────────────────────────────────────
// Profil drukarni: klucz (fogra39 / fogra51 – pobierany raz z eci.org do <dane>/profile) albo plik .icc.
// pytaj: okno PDF pyta przed pobraniem; zlecenie pobiera samo. null = użytkownik zrezygnował.
const folderProfili = () => path.join(app.getPath('userData'), 'profile');
async function profilDoDruku(profil, { pytaj, folder }) {
  if (profil && !cmyk.czyKlucz(profil) && folder && !path.isAbsolute(profil)) profil = path.resolve(folder, profil);
  const r = cmyk.rozwiazProfil(profil, folderProfili());
  if (r.plik) return r;
  const opis = cmyk.PROFILE[r.brak];
  if (pytaj) {
    const o = await dialog.showMessageBox(okno, { type: 'question', buttons: ['Pobierz', 'Anuluj'], defaultId: 0, cancelId: 1,
      message: `Pobrać profil kolorów ${opis.nazwa} z eci.org?`,
      detail: `Do PDF w CMYK potrzebny jest profil drukarni (paczka ok. ${opis.paczkaMB} MB). Pobierany jest raz i zostaje w danych aplikacji. Możesz też wskazać własny plik .icc w oknie Druk i PDF.` });
    if (o.response !== 0) return null;
  }
  try {
    const plik = await cmyk.pobierzProfil(r.brak, folderProfili(), { fetch: pobieraj, zasoby: ZASOBY,
      postep: (u) => { if (okno && !okno.isDestroyed()) okno.setProgressBar(u); } });
    return { plik, nazwa: opis.nazwa, klucz: r.brak };
  } finally { if (okno && !okno.isDestroyed()) okno.setProgressBar(-1); }
}
// Stan do okna Druk i PDF: Ghostscript (opcja wyszarzona bez niego) i które profile są już pobrane.
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
      druk = { ...druk, cmyk: { ...druk.cmyk, plik: prof.plik, nazwa: prof.nazwa } };
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
async function wykonajPlikZlecenia(p, polecenie) {
  const folder = path.join(p.folder, ...FOLDER_ZLECEN), plik = path.join(folder, polecenie);
  let tekst;
  try { if (!fs.statSync(plik).isFile()) return false; tekst = fs.readFileSync(plik, 'utf8'); } catch (e) { return false; }
  // Strona jeszcze się wczytuje – spróbujemy przy następnym sprawdzeniu.
  const gotowa = await p.wc.executeJavaScript('!!(window.wykonajZlecenie && window.zbudowano)').catch(() => false);
  if (!gotowa) return false;
  const wyniki = [path.join(folder, `wynik-${polecenie}.json`)];
  if (polecenie === 'katalog') wyniki.push(path.join(folder, 'wynik.json'));     // zgodność z v0.4.6–0.4.10
  const naglowek = { zlecenie: polecenie, czas: new Date().toISOString(), szablon: p.szablon && path.relative(p.folder, p.szablon), wersjaAplikacji: WERSJA };
  let wynik;
  zlecenieTrwa(p, true);
  try {
    wyniki.forEach((w) => fs.rmSync(w, { force: true }));
    const surowe = czytajZlecenie(tekst);
    const w = await p.wc.executeJavaScript(`wykonajZlecenie(${JSON.stringify(polecenie)}, ${JSON.stringify(surowe)})`);
    wynik = { ...naglowek, ok: false, pliki: [], blad: null, ...w };
    const wzgledna = (x) => (typeof x === 'string' && path.isAbsolute(x) ? path.relative(p.folder, x) : x);
    wynik.pliki = (wynik.pliki || []).map(wzgledna);
    if (wynik.folder) wynik.folder = wzgledna(wynik.folder);
  } catch (e) {
    wynik = { ...naglowek, ok: false, pliki: [], blad: String((e && e.message) || e) };
  } finally { zlecenieTrwa(p, false); }
  try {
    fs.rmSync(plik, { force: true });                     // najpierw zlecenie – plik wyniku = koniec pracy
    for (const w of wyniki) fs.writeFileSync(w, JSON.stringify(wynik, null, 1));
  } catch (e) { /* trudno – folder zniknął */ }
  return true;
}
// Znak „trwa zlecenie” tylko przy prawdziwym zleceniu (nie przez cały przegląd folderu) – kropka w pasku nie miga.
function zlecenieTrwa(p, czy) {
  if (p.zlecenieTrwa === czy) return;
  p.zlecenieTrwa = czy;
  odswiezPasek();
}
async function sprawdzZlecenia() {
  if (kolejkaZlecen || !okno) return;
  kolejkaZlecen = true;
  try {
    for (const p of [...projekty]) {
      if (!p.zapisywalny || !p.wc) continue;
      await zlecenieAktualizacji(p);
      for (const pol of POLECENIA) if (p.zapisywalny && p.wc) await wykonajPlikZlecenia(p, pol);
    }
  } finally { kolejkaZlecen = false; }
}
setInterval(sprawdzZlecenia, 3000);
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
    druk = { ...druk, cmyk: { ...druk.cmyk, plik: prof.plik, nazwa: prof.nazwa } };
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
        { label: 'Drukuj…', accelerator: 'CmdOrCtrl+P', enabled: !!p.folder, click: wStronie("window.oknoDruku && oknoDruku('drukuj')") },
        { label: 'Zapisz PDF…', accelerator: 'Shift+CmdOrCtrl+S', enabled: !!p.folder, click: wStronie("window.oknoDruku && oknoDruku('pdf')") },
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
function pokazOknoPoWczytaniu(p) {
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
async function trybTestowy(folder, wynik, przywrocone = []) {
  const P = aktywny, wc = P.wc, szablon = P.szablon, projekt = P.folder;   // projekt testowy = aktywna zakładka
  const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));
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
  if ((process.argv.includes('--test-edytor') || process.argv.includes('--test-zakladki')) && !jestPrzykladem(szablon)) {
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
    const zlec = (w, pol, tresc = '') => { fs.mkdirSync(zl(w), { recursive: true }); fs.rmSync(path.join(zl(w), `wynik-${pol}.json`), { force: true }); fs.writeFileSync(path.join(zl(w), pol), tresc); };
    const czekajNa = async (w, pol) => { let r = null; for (let i = 0; i < 240 && !r; i++) { await czekaj(500); r = czytaj(w, pol); } return r; };
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
    const limit = { liczba: projekty.length, pasekPlus: await pasek.webContents.executeJavaScript("document.getElementById('nowa').classList.contains('ukryty')") };
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
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
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
  }
  // Druk wybranych kart i tryb szkicu (--test-edytor): 2 zaznaczone karty → 2 karty w wydruku, białe tło.
  let wybor = null;
  if (process.argv.includes('--test-edytor')) {
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
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
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
    await js('przelaczEdytor(true)');
    zmienione = { poZapisie, poZmianie, porownanie, doDruku, poPowrocie };
    zmienione.ok = poZapisie.widoczne && poZapisie.zm === 0 && poZapisie.nowe === 0 && poZmianie.zm > 0
      && porownanie >= Math.min(poZmianie.zm, 40) && doDruku === poZmianie.zm && poPowrocie.zm === 0;
  }
  // Historia wersji (--test-edytor): punkt „otwarcie”, kopia po zmianie z zewnątrz, podgląd i przywrócenie.
  let hist = null;
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
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
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
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
    const druk = await js(`(() => { window.__okno = otworzOkno('druk', 'drukuj'); const f = document.getElementById('oknoForm');
      return { pola: ['uklad', 'rewersy', 'szkic', 'ktore'].filter((n) => f.querySelector('[name=' + n + ']')).length, domyslny: document.querySelector('#oknoPrzyciski .domyslny').textContent }; })()`);
    await czekaj(300);
    fs.writeFileSync(wynik.replace(/\.pdf$/i, '') + '-okno.png', (await wc.capturePage()).toPNG());
    await js("document.getElementById('okno').dispatchEvent(new Event('cancel')); window.__okno");
    const kartyWidok = await js("document.querySelectorAll('#podglad .karta:not(.rewers)').length");
    okna = { png: png.length, kartyWidok, szer, zapamietane, plik: plik && plik.obrazki, druk };
    okna.ok = png.length === kartyWidok && szer >= szerMin && zapamietane.format === 'png' && zapamietane.dpi === '300' && !zapamietane.rewersy
      && plik && plik.obrazki && plik.obrazki.format === 'png' && druk.pola === 4 && druk.domyslny === 'Drukuj…';
  }
  // Drukarnia (--test-edytor): strona na kopię (awers, rewers…), strona = karta + 2 × spad.
  let drukarnia = null;
  if (process.argv.includes('--test-edytor')) {
    drukarnia = await wc.executeJavaScript(`(() => {
      const karty = kartyEksportu({});
      const rewersy = karty.filter((k) => backOf(k.dataset.talia)).length;
      buildPrint({ uklad: 'drukarnia', spad: 2, strony: 'naprzemian', karty });
      const strony = document.querySelectorAll('#druk .arkusz');
      const [w, h] = cardMm(karty[0]);
      return { strony: strony.length, oczekiwane: karty.length + rewersy, rozmiar: strony[0].style.width + ' ' + strony[0].style.height,
        karta: Math.min(w, h) + 4 + 'mm ' + (Math.max(w, h) + 4) + 'mm', znaczniki: document.querySelectorAll('#druk .znacznik').length,
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
  if (process.argv.includes('--test-edytor')) {
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
      return { karty: karty.length, zRewersem, wyglady: wyglady.size, szer: Math.max(...kom.map((c) => c[0])), wys: Math.max(...kom.map((c) => c[1])) };
    })()`);
    const bledy = [];
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
    drukarniaPdf.osobno = await przebieg('osobno', { spad: 3, strony: 'osobno' }, 3, osobnoStrony, o.szer + 6, o.wys + 6);
    drukarniaPdf.naprzemian = await przebieg('naprzemian', { spad: 2, strony: 'naprzemian' }, 2, [o.karty + o.zRewersem], o.szer + 4, o.wys + 4);
    drukarniaPdf.bezRewersow = await przebieg('bez-rewersow', { spad: 3, strony: 'osobno', rewersy: false }, 3, [o.karty], o.szer + 6, o.wys + 6);
    // d) okno Druk i PDF: domyślnie spad 3 i strony „osobno”; zapamiętany spad 2,5 jako trzecia pozycja.
    drukarniaPdf.okno = await js(`(async () => {
      const przed = USTAWIENIA_OKIEN.druk, f = () => document.getElementById('oknoForm');
      const stan = async (ust) => {
        if (ust) USTAWIENIA_OKIEN.druk = ust; else delete USTAWIENIA_OKIEN.druk;
        const p = otworzOkno('druk');
        const r = { spady: [...f().querySelectorAll('[name=spad]')].map((x) => x.value), spad: (f().querySelector('[name=spad]:checked') || {}).value,
          strony: [...f().querySelectorAll('[name=strony]')].map((x) => x.value), stronyWybrane: (f().querySelector('[name=strony]:checked') || {}).value };
        document.getElementById('okno').dispatchEvent(new Event('cancel')); await p;
        return r;
      };
      try { return { domyslnie: await stan(null), zapamietane: await stan({ spad: 2.5 }) }; }
      finally { if (przed) USTAWIENIA_OKIEN.druk = przed; else delete USTAWIENIA_OKIEN.druk; }
    })()`);
    const ow = drukarniaPdf.okno;
    drukarniaPdf.okno.ok = ow.domyslnie.spad === '3' && ow.domyslnie.spady.join() === '3,2' && ow.domyslnie.strony.join() === 'osobno,naprzemian' && ow.domyslnie.stronyWybrane === 'osobno'
      && ow.zapamietane.spad === '2.5' && ow.zapamietane.spady.length === 3 && ow.zapamietane.spady.includes('2.5');
    if (!ow.ok) bledy.push('okno: ' + JSON.stringify(ow));
    // e) raport drukarni: sekcje tylko z drukarnia: true.
    const sekcje = await js(`(async () => ({ z: (await raportJson({ drukarnia: true })).map((x) => x.tytul), bez: (await raportJson({})).map((x) => x.tytul) }))()`);
    drukarniaPdf.raport = { z: sekcje.z.filter((t) => t.startsWith('Drukarnia:')).length, pierwsze: sekcje.z.slice(0, 3).every((t) => t.startsWith('Drukarnia:')), bez: sekcje.bez.filter((t) => t.startsWith('Drukarnia:')).length };
    drukarniaPdf.raport.ok = drukarniaPdf.raport.z === 3 && drukarniaPdf.raport.pierwsze && drukarniaPdf.raport.bez === 0;
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
  // CMYK (issue #66, etap 2; --test-edytor, każdy projekt, pliki w katalogu tymczasowym): a) okno Druk i PDF (pole cmyk, profil),
  // b) PDF drukarni przez pdfDoPliku z profilem testowym (Ghostscript): kontrola każdego pliku, ramki z planu, pdfimages (jeśli jest).
  // c) zlecenia z profilem – w bloku zlecenia (cmykTest.profil). Bez Ghostscripta ≥ 10 albo profilu CMYK: { pominiety } (w CI to błąd).
  let cmykTest = null;
  if (process.argv.includes('--test-edytor')) {
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
        const przed = USTAWIENIA_OKIEN.druk, f = () => document.getElementById('oknoForm');
        delete USTAWIENIA_OKIEN.druk;
        try {
          const stan = await odswiezCmyk();
          const p = otworzOkno('druk');
          const c = f().querySelector('[name=cmyk]'), s = f().querySelector('[name=profil]');
          const r = { gs: !!(stan && stan.gs && stan.gs.ok), cmyk: !!c, wlaczony: !!c && !c.disabled, zaznaczony: !!c && c.checked,
            profil: !!s && !s.disabled, opcje: s ? [...s.options].map((x) => x.value) : [], wybrany: s ? s.value : null };
          document.getElementById('okno').dispatchEvent(new Event('cancel')); await p;
          return r;
        } finally { if (przed) USTAWIENIA_OKIEN.druk = przed; else delete USTAWIENIA_OKIEN.druk; }
      })()`);
      const ow = cmykTest.okno;
      ow.ok = ow.gs && ow.cmyk && ow.wlaczony && ow.zaznaczony && ow.profil && ow.opcje.join() === 'fogra39,fogra51,__inny' && ow.wybrany === 'fogra39';
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
          kontrola: ((w.cmyk && w.cmyk.pliki) || []).map((k) => ({ strony: k.strony, rgb: k.rgb, przestrzenieRgb: k.przestrzenieRgb, czern: k.czern, obrazki: k.obrazki, trimBox: k.trimBox, ok: k.ok })) };
        if (!w.cmyk || w.cmyk.profil !== 'test' || w.cmyk.ghostscript !== gs.wersja) bledy.push('pdf: raport cmyk: ' + JSON.stringify(w.cmyk && { profil: w.cmyk.profil, gs: w.cmyk.ghostscript }));
        if (!w.pliki || w.pliki.length !== wPlanie.length) bledy.push(`pdf: plików ${w.pliki && w.pliki.length}, w planie ${wPlanie.length}`);
        for (let n = 0; n < (w.pliki || []).length; n++) {
          const k = w.cmyk.pliki[n];
          if (!fs.existsSync(w.pliki[n])) { bledy.push('pdf: brak pliku ' + w.pliki[n]); continue; }
          if (!k || !k.ok || k.rgb !== 0 || k.przestrzenieRgb !== 0 || k.trimBox !== k.strony || k.strony !== wPlanie[n].length) bledy.push(`pdf: plik ${n}: kontrola ${JSON.stringify(k && { ok: k.ok, rgb: k.rgb, strony: k.strony, trimBox: k.trimBox })}`);
          const strony_ = (await PDFDocument.load(fs.readFileSync(w.pliki[n]))).getPages();
          if (strony_.length !== wPlanie[n].length) bledy.push(`pdf: plik ${n}: stron ${strony_.length}, w planie ${wPlanie[n].length}`);
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
      } catch (e) { bledy.push('pdf: ' + e.message); }
      finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      cmykTest.bledy = bledy;
      cmykTest.ok = !bledy.length;
    }
  }
  // Katalog (--test-edytor, poza przykładami): A – Export/katalog; B – zlecenie z pliku → wynik.json.
  let katalog = null;
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
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
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
    const js = (k) => wc.executeJavaScript(k);
    const zl = path.join(projekt, ...FOLDER_ZLECEN);
    fs.mkdirSync(zl, { recursive: true });
    const czytaj = (p) => { try { return JSON.parse(fs.readFileSync(path.join(zl, `wynik-${p}.json`), 'utf8')); } catch (e) { return null; } };
    const czekajNa = async (pol) => { let w = null; for (let i = 0; i < 240 && !w; i++) { await czekaj(500); w = czytaj(pol); } return w; };
    const zlec = async (pol, tresc = '') => { fs.rmSync(path.join(zl, `wynik-${pol}.json`), { force: true }); fs.writeFileSync(path.join(zl, pol), tresc); return czekajNa(pol); };
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
      const d1 = await zlec('pdf', 'uklad = drukarnia\nplik = Export/drukarnia.pdf\n');
      dr.osobno = d1 && { ok: d1.ok, pliki: d1.pliki, stronyPlikow: d1.stronyPlikow, spad: d1.spad, strona: d1.strona, blad: d1.blad };
      if (dr.osobno && d1.ok) dr.osobno.naDysku = await stronyPliku(d1.pliki);
      dr.osobno.ok = !!(d1 && d1.ok && [1, 2].includes(d1.pliki.length) && d1.pliki.every((p) => fs.existsSync(path.join(projekt, p)))
        && (d1.pliki.length === 1 || (d1.pliki[0].endsWith(' – awersy.pdf') && d1.pliki[1].endsWith(' – rewersy.pdf')))
        && Array.isArray(d1.stronyPlikow) && d1.stronyPlikow.join() === dr.osobno.naDysku.join() && d1.spad === 3 && d1.strona && d1.strona.length === 2);
      const d2 = await zlec('pdf', 'uklad = drukarnia\nstrony = na przemian\nspad = 2\nplik = Export/przemian.pdf\n');
      dr.naprzemian = d2 && { ok: d2.ok, pliki: d2.pliki, stronyPlikow: d2.stronyPlikow, spad: d2.spad, blad: d2.blad };
      if (d2 && d2.ok) dr.naprzemian.naDysku = await stronyPliku(d2.pliki);
      dr.naprzemian.ok = !!(d2 && d2.ok && d2.pliki.length === 1 && fs.existsSync(path.join(projekt, d2.pliki[0])) && d2.spad === 2
        && Array.isArray(d2.stronyPlikow) && d2.stronyPlikow.join() === dr.naprzemian.naDysku.join());
      const d3 = await zlec('pdf', 'uklad = drukarnia\nstrony = bokiem\nplik = Export/bokiem.pdf\n');
      dr.bokiem = d3 && { ok: d3.ok, blad: d3.blad, plik: fs.existsSync(path.join(projekt, 'Export', 'bokiem.pdf')) };
      dr.bokiem.ok = !!(d3 && d3.ok === false && /strony/i.test(d3.blad || '') && !dr.bokiem.plik);
      const r1 = await zlec('raport', 'drukarnia = tak\n');
      dr.raportTak = r1 && { ok: r1.ok, sekcje: (r1.raport || []).map((x) => x.tytul).filter((t) => t.startsWith('Drukarnia:')).length,
        pola: r1.drukarnia ? ['odstep', 'czern', 'krawedz'].map((k) => Array.isArray(r1.drukarnia[k])) : null };
      dr.raportTak.ok = !!(r1 && r1.ok && dr.raportTak.sekcje === 3 && dr.raportTak.pola && dr.raportTak.pola.every(Boolean));
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
      cz.icc.ok = !!(c1 && c1.ok && c1.cmyk && c1.cmyk.pliki.length === c1.pliki.length && c1.cmyk.pliki.every((k) => k.rgb === 0 && k.ok) && c1.pliki.every((p) => fs.existsSync(wProjekcie(p))));
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
      cz.ok = ['icc', 'fogra39', 'fogra39Male', 'nieznany', 'a4', 'bezProfilu'].every((k) => cz[k] && cz[k].ok);
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
  if (process.argv.includes('--test-edytor') && !jestPrzykladem(szablon)) {
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
  if (process.argv.includes('--test-edytor')) {
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
  if (process.argv.includes('--test-edytor')) {
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
  await wc.executeJavaScript('buildPrint()');
  await pdfDoPliku(wc, wynik);
  // Menu aplikacji: własne (polskie), a nie domyślne Electrona.
  const menu = (Menu.getApplicationMenu()?.items || []).map((i) => i.label);
  const plik = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Plik');
  const menuOk = menu.includes('Plik') && menu.includes('Widok') && !!plik && plik.submenu.items.some((i) => i.label === 'Zapisz szablon')
    && Menu.getApplicationMenu().items[0].submenu.items.some((i) => i.label === 'Sprawdź aktualizacje…');
  const ok = menuOk && czcionki.ok && / kart /.test(stan) && !uwagi.trim() && /^image\/jpeg [1-9]/.test(jpg) && (!eksport || eksport.startsWith('Zapisano'))
    && (!edytor || edytor.ok) && (!wybor || wybor.ok) && (!zmienione || zmienione.ok) && (!hist || hist.ok) && (!pcio || pcio.ok) && (!okna || okna.ok)
    && (!drukarnia || drukarnia.ok) && (!drukarniaPdf || drukarniaPdf.ok) && (!cmykTest || cmykTest.pominiety || cmykTest.ok) && (!katalog || katalog.ok) && (!zlecenia || zlecenia.ok) && (!aktualizacja || aktualizacja.ok) && (!podfolder || podfolder.ok)
    && (!formatowanie || formatowanie.ok) && (!uklad || uklad.ok) && projektyTest.ok && (!zakladki || zakladki.ok);
  process.stdout.write(JSON.stringify({ szablon, stan, uwagi, czcionki, jpg, eksport, edytor, wybor, zmienione, hist, pcio, okna, drukarnia, drukarniaPdf, cmyk: cmykTest, katalog, zlecenia, aktualizacja, podfolder, formatowanie, uklad, projekty: projektyTest, zakladki, menu, kod: { zrodlo: KOD.zrodlo, wersja: WERSJA, powod: KOD.powod || null }, pdf: wynik, ok }) + '\n');
  app.exit(ok ? 0 : 1);
}

// ── Start ───────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (okno) { if (okno.isMinimized()) okno.restore(); okno.focus(); } });

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
  setTimeout(() => sprawdzAktualizacje({ cicho: true }), 4000);
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
