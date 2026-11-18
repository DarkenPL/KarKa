# Nowa talia krok po kroku

Przykład: talia **Zaklęć** z nazwą, kosztem many i opisem.

## 1. Plik z kartami

Utwórz w folderze projektu `zaklecia.csv` (w Excelu, Numbers albo edytorze tekstu, zapisz jako CSV UTF-8):

```
ID;Ilość;Nazwa;Szkoła;Koszt;Opis
1;3;Kula ognia;ogień;{mana}{mana};Zadaj 3 obrażenia.
2;2;Lodowa tarcza;woda;{mana};Zablokuj następny atak.
```

## 2. Ikona many (opcjonalnie)

Dodaj obrazek `Ikony/mana.svg` i wiersz w `ikony.csv`:

```
Znacznik;Znak;Odstęp;Plik;Opis
{mana};💧;tak;Ikony/mana.svg;Mana
```

## 3. Szablon

Utwórz `Szablony/zaklecia.txt`:

```
NAZWA = Zaklęcia
DANE  = zaklecia.csv
KARTA = 63, 88
IKONY = środek                ; ikony w tekście na środku cyfr

KOLOR = ogień, #D9534F
KOLOR = woda,  #5BC0DE

TŁO       = [Szkoła] | #cccccc
PROSTOKĄT = 3, 3, 57, 82, kolor=#ffffff, zaokrąglenie=3

TEKST = 6, 6, 51, 10, [Nazwa], rozmiar=16, wyrównanie=środek, pion=środek
TEKST = 6, 18, 51, 8, [Koszt], ikony=1.5, wyrównanie=środek
TEKST = 6, 50, 51, 30, [Opis], rozmiar=11, wyrównanie=środek, pion=środek

[REWERS]
TŁO   = #2b2b40
TEKST = 0, 0, 63, 88, "Zaklęcia", rozmiar=26, kolor=#ffffff, wyrównanie=środek, pion=środek
```

Zapisz i otwórz szablon w aplikacji (**Plik → Otwórz szablon…**). Każda kolejna zmiana pojawi się sama po zapisie.

## 4. Dopracowanie

- **Przesuwanie pól.** Zmieniaj liczby `x, y, szer, wys`; odświeżenie jest natychmiastowe po zapisie.
- **Za długi tekst.** Generator zmniejsza czcionkę. Czerwona ramka oznacza, że nawet to nie pomogło: powiększ pole albo skróć tekst.
- **Kolejna talia w istniejącej grze.** Dopisz `[TALIA Zaklęcia]` do szablonu gry, jak w przykładzie [03-ogrod](../przyklady/03-ogrod/Szablony/ogrod.txt). Aplikacja pokazuje talie z jednego otwartego szablonu.

Pełny opis komend: [komendy.md](komendy.md).
