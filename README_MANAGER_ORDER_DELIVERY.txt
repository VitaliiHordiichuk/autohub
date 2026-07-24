AUTOHUB — ДОСТАВКА В API ЗАКАЗОВ МЕНЕДЖЕРА

Что добавляется:

GET /api/manager/orders

В каждом заказе списка появится краткий объект delivery:
- способ получения;
- имя и фамилия;
- телефон;
- город Новой почты;
- отделение или почтомат.

GET /api/manager/orders/:orderId

В карточке заказа появится полный объект delivery:
- данные получателя;
- самовывоз;
- отделение или почтомат;
- курьерский адрес.

УСТАНОВКА

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-manager-order-delivery.zip \
  -d .

ПРОВЕРКА СИНТАКСИСА

node --check \
  src/repositories/OrderDeliveryRepository.js

node --check \
  src/use-cases/manager/GetManagerOrder.js

node --check \
  src/use-cases/manager/GetManagerOrders.js

echo "Проверка завершена"

После проверки перезапустить backend:

Ctrl + C
node src/server.js

ПРОВЕРКА API

curl -s \
  http://localhost:4000/api/manager/orders/6

Защита маршрутов ролями ADMIN/MANAGER будет
отдельным этапом после создания входа в админку.
