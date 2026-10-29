"""Wspólna reguła dla hooków wersja-pr.py i koniec-zadania.py: które zmiany wymagają podbicia wersji aplikacji.
Zasada z CLAUDE.md (decyzja właściciela 27.10.2026, #101; hook pod zasadę – #141): wersję podbija tylko PR ze zmianą
w plikach aplikacji – app/ poza app/scripts/ (build.files, generator/, szablon-startowy/, drukarnie/ …) i przyklady/.
CI (.github/), skrypty testów (app/scripts/), dokumentacja (docs/) i hooki (.claude/) – bez wersji."""

OPIS = "app/ poza app/scripts/, przyklady/"


def plik_aplikacji(sciezka):
    return (sciezka.startswith("app/") and not sciezka.startswith("app/scripts/")) or sciezka.startswith("przyklady/")


def wymaga_wersji(sciezki):
    return any(plik_aplikacji(p) for p in sciezki)
