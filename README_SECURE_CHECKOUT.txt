AUTOHUB — БЕЗОПАСНАЯ КОРЗИНА И ДОСТАВКА В ЗАКАЗЕ

Что меняется:

1. userId и customerId больше не принимаются от клиента.
2. Авторизованный пользователь определяется только по cookie.
3. Гостевая корзина защищена случайным X-Cart-Token.
4. Доставка сохраняется отдельной копией в order_delivery_details.
5. Зарегистрированный клиент может сохранить выбранные данные в профиль.

УСТАНОВКА

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-secure-checkout.zip \
  -d .

psql -d autohub \
  -f migrations/024_add_guest_cart_token.sql

Проверка синтаксиса:

node --check src/services/CartAccessService.js
node --check src/services/CartService.js
node --check src/services/CheckoutService.js
node --check src/use-cases/checkout/SubmitOrder.js
node --check src/controllers/cart.controller.js
node --check src/controllers/checkout.controller.js

После этого перезапустить backend:

Ctrl + C
node src/server.js

ВАЖНО

Интеграция со справочником Новой почты пока не включена.
Поля и проверка для неё уже готовы.

Для теста сейчас используется PICKUP.
