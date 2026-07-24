AUTOHUB — МОВИ САЙТУ З БАЗИ ДАНИХ

Установлення:

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-site-languages-backend.zip \
  -d .

node scripts/install-site-languages.js

Після успішного встановлення
перезапустіть backend:

Control + C
node src/server.js

Перевірка публічних мов:

curl \
  http://localhost:4000/api/site/languages

Очікується:
- uk: увімкнено та основна;
- en: увімкнено;
- ru: у публічній відповіді відсутня.

Перевірка всіх мов для адмінки:

curl \
  http://localhost:4000/api/admin/site-languages

У наступному кроці підключається
сторінка керування мовами у frontend.
