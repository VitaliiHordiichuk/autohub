AUTOHUB — ПУБЛИЧНЫЙ ПОИСК: ЯЗЫК И БЕЗОПАСНЫЙ ОТВЕТ

Что делает патч:

1. Использует только публично включённый язык.
2. Если запрошен отключённый язык, берёт язык сайта по умолчанию.
3. Возвращает переведённые названия товара, семейства, аналогов и замен.
4. Не отдаёт клиенту:
   - purchasePrice;
   - warehouse.name;
   - warehouse.city;
   - supplier.name.
5. Не показывает предложения:
   - без остатка;
   - без розничной цены;
   - помеченные недоступными.
6. is_hidden и is_available уже фильтруются ProductRepository.
7. Локализует наличие и срок доставки для uk/en.

Установка:

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-public-search-localization.zip \
  -d .

Проверка синтаксиса:

node --check \
  src/services/PublicSearchPresenterService.js

node --check \
  src/controllers/search.controller.js

Перезапуск:

Control + C
node src/server.js

Проверка:

curl \
  "http://localhost:4000/api/search?article=HU718%2F5X&locale=uk"

В ответе должно быть:

"locale":"uk"
"name":"Фільтр масляний"

И не должно быть:

purchasePrice
supplier
warehouse
