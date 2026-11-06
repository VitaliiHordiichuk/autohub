import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync(new URL("./TelegramBotService.js", import.meta.url), "utf8");

test("verified Ukrainian contact receives article search onboarding instead of deprecated VIN chat copy", () => {
  assert.match(worker, /uk:verification\.verified\s*\?\s*"Дякую! Номер телефону успішно підтверджено\. ✅\\n\\nТепер можете перевірити, як працює MAKAtron\.\\n\\nНадішліть каталожний номер запчастини, наприклад: A2711800109"/);
  assert.doesNotMatch(worker, /✅ Номер підтверджено\. Тепер можна надсилати VIN-запити та спілкуватися з менеджером\./);
});

test("verified English contact receives the same MAKAtron example and existing failure copy stays intact", () => {
  assert.match(worker, /en:verification\.verified\s*\?\s*"Thank you! Your phone number has been successfully verified\. ✅\\n\\nYou can now try MAKAtron\.\\n\\nSend a part number, for example: A2711800109"/);
  assert.match(worker, /Ой, цей номер не збігається з номером у вашому акаунті MAKA/);
  assert.match(worker, /This number does not match the phone number in your MAKA account\./);
  assert.match(worker, /const ownsContact = !message\.contact\.user_id/);
  assert.match(worker, /TelegramConnectionService\.verifyPhoneFromTelegram/);
});
