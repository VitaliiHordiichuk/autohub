AUTOHUB — ШАГ 1: СТРУКТУРА ДОСТАВКИ

Миграция создаёт две таблицы:

1. user_delivery_profiles
   Постоянные данные зарегистрированного пользователя.

2. order_delivery_details
   Неизменяемая копия данных доставки конкретного заказа.

Способы получения:

PICKUP
NOVA_POSHTA_POINT
NOVA_POSHTA_COURIER

Для NOVA_POSHTA_POINT тип точки:

BRANCH
LOCKER

Установка:

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-delivery-schema.zip \
  -d .

Применение миграции:

psql -d autohub \
  -f migrations/022_create_delivery_profiles.sql

Проверка:

PAGER=cat psql -d autohub \
  -c "\d user_delivery_profiles" \
  -c "\d order_delivery_details"

Эта миграция не меняет существующие таблицы orders и customers,
поэтому текущая корзина и заказы не ломаются.
