AUTOHUB — ЗАЩИТА МЕНЕДЖЕРСКИХ ЗАКАЗОВ

Что меняется:

1. Все маршруты /api/manager/orders требуют входа.
2. Разрешённые роли:
   ADMIN
   MANAGER
3. CLIENT получает HTTP 403.
4. Неавторизованный пользователь получает HTTP 401.
5. changedBy больше не принимается из тела запроса.
6. changedBy автоматически берётся из защищённой cookie.

УСТАНОВКА

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-protect-manager-orders.zip \
  -d .

ПРОВЕРКА СИНТАКСИСА

node --check \
  src/controllers/manager-order.controller.js

node --check \
  src/routes/manager-order.routes.js

echo "Проверка завершена"

После проверки перезапустить backend:

Ctrl + C
node src/server.js
