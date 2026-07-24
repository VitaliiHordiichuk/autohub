AUTOHUB — ЧТЕНИЕ И РЕДАКТИРОВАНИЕ КОРЗИНЫ

Добавляются защищённые маршруты:

GET
/api/cart/:cartId

PATCH
/api/cart/:cartId/items/:itemId

DELETE
/api/cart/:cartId/items/:itemId

Для гостевой корзины каждый запрос должен передавать:

X-Cart-Token: <токен корзины>

Для зарегистрированного пользователя доступ определяется
по защищённой cookie.

Ответ корзины содержит:

cart
items
summary.itemsCount
summary.totalQuantity
summary.totalAmount

УСТАНОВКА

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-cart-crud-backend.zip \
  -d .

ПРОВЕРКА

node --check src/controllers/cart.controller.js
node --check src/repositories/CartRepository.js
node --check src/services/CartService.js
node --check src/routes/cart.routes.js

echo "Проверка завершена"

Миграции базы данных не нужны.
