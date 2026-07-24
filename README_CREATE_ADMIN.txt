AUTOHUB — СОЗДАНИЕ УЧЁТНОЙ ЗАПИСИ ADMIN

Скрипт создаёт пользователя с ролью ADMIN.
Пароль хешируется через bcryptjs и не выводится на экран.

УСТАНОВКА

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-create-admin.zip \
  -d .

ЗАПУСК

read "ADMIN_EMAIL?Email администратора: "
read "ADMIN_FIRST_NAME?Имя администратора: "
read "ADMIN_LAST_NAME?Фамилия администратора: "
read -s "ADMIN_PASSWORD?Пароль администратора: "
echo

ADMIN_EMAIL="$ADMIN_EMAIL" \
ADMIN_FIRST_NAME="$ADMIN_FIRST_NAME" \
ADMIN_LAST_NAME="$ADMIN_LAST_NAME" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
node scripts/create-admin.js

unset ADMIN_PASSWORD

Пароль должен содержать минимум 10 символов.

ВАЖНО

Не присылайте пароль в чат.
Не используйте пароль тестового клиента.
