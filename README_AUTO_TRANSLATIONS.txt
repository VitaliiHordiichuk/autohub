AUTOHUB — АВТОМАТИЧНІ ПЕРЕКЛАДИ DEEPL

1. Розпакувати у backend:

cd ~/autohub-backend

unzip -o \
  ~/Downloads/autohub-deepl-auto-translations.zip \
  -d .

2. Встановити:

node scripts/install-automatic-translations.js

3. Перевірити .env:

DEEPL_AUTH_KEY=ваш_справжній_ключ
AUTO_TRANSLATION_ENABLED=true
AUTO_TRANSLATION_INTERVAL_MINUTES=5
AUTO_TRANSLATION_BATCH_SIZE=25
AUTO_TRANSLATION_MAX_BATCHES_PER_RUN=20

Останні три рядки необов'язкові:
за замовчуванням перевірка кожні 5 хвилин,
25 товарів у пакеті та до 20 пакетів за запуск
(до 500 товарів за один запуск).

4. Перезапустити backend:

Control + C
node src/server.js

5. Перевірити статус:

curl \
  http://localhost:4000/api/admin/automatic-translations/status

6. Запустити чергу негайно:

curl -X POST \
  http://localhost:4000/api/admin/automatic-translations/process

API:

GET
/api/admin/automatic-translations/status

POST
/api/admin/automatic-translations/process

POST
/api/admin/automatic-translations/retry-failed

ЛОГІКА:

- товар і ціна завантажуються одразу;
- переклад не блокує імпорт;
- кожна назва обробляється окремо;
- DeepL сам визначає мову;
- створюються UK, EN та RU;
- точні повтори беруться з translation_memory;
- ручне виправлення має пріоритет і не перезаписується;
- невдала спроба повторюється автоматично.
