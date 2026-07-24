AUTOHUB — ИСПРАВЛЕНИЕ ПОИСКА АРТИКУЛОВ

Патч исправляет поиск по визуально одинаковым кириллическим буквам:

А→A
В→B
Е→E
К→K
М→M
Н→H
О→O
Р→P
С→C
Т→T
Х→X

Также игнорируются пробелы, тире, точки и слеши.

Установка из корня backend:

unzip -o ~/Downloads/autohub-search-normalization-patch.zip -d .

После установки перезапустить backend:

Control + C
node src/server.js
