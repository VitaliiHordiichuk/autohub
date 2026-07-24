AUTOHUB — ПЕРЕКЛАДИ НАЗВ ТОВАРІВ

Установлення:

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-product-translations-backend.zip \
  -d .

node scripts/install-product-translations.js

Перезапуск backend:

Control + C
node src/server.js

Перевірка української назви:

curl \
  "http://localhost:4000/api/admin/warehouses/1/offers?search=HU718&locale=uk"

Перевірка англійської назви:

curl \
  "http://localhost:4000/api/admin/warehouses/1/offers?search=HU718&locale=en"

Перевірка російської назви:

curl \
  "http://localhost:4000/api/admin/warehouses/1/offers?search=HU718&locale=ru"

API редагування перекладів:

GET
/api/admin/products/:productId/translations

PUT
/api/admin/products/:productId/translations/:languageCode

Body:
{
  "name": "Oil filter"
}
