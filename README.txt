AutoHub EMAIL Import Service

Файлы распаковываются в корень проекта autohub-backend:

unzip -o ~/Downloads/autohub-email-service.zip -d .

Сначала тест:

node src/scripts/test-email-import-service.js

После успешного теста подключить маршрут в Express:

import adminEmailImportRoutes from "./routes/admin-email-import.routes.js";
app.use("/api/admin/email-import", adminEmailImportRoutes);

И запустить планировщик один раз после запуска сервера:

import { startEmailImportScheduler } from "./services/EmailImportScheduler.js";
startEmailImportScheduler();

API:
GET  /api/admin/email-import/status
POST /api/admin/email-import/process
