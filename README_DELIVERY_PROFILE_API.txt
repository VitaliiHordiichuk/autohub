AUTOHUB — API ПРОФИЛЯ ДОСТАВКИ

Новые маршруты:

GET /api/account/delivery-profile
PUT /api/account/delivery-profile

Оба маршрута доступны только авторизованному пользователю.

УСТАНОВКА

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-delivery-profile-api.zip \
  -d .

Перезапуск:

Ctrl + C
node src/server.js

ПРОВЕРКА

curl -s \
  -b /tmp/autohub-cookies.txt \
  http://localhost:4000/api/account/delivery-profile

СОХРАНЕНИЕ САМОВЫВОЗА

curl -s \
  -X PUT \
  -b /tmp/autohub-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "recipientFirstName":"Тест",
    "recipientLastName":"Клиент",
    "recipientPhone":"+380501112233",
    "recipientEmail":"test-1784319788@autohub.local",
    "deliveryMethod":"PICKUP",
    "pickupWarehouseId":null
  }' \
  http://localhost:4000/api/account/delivery-profile
