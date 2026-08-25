import "dotenv/config";


import {
  startAutomaticTranslationScheduler,
} from "./services/AutomaticTranslationScheduler.js";
import { app } from "./app.js";
import {
  startEmailImportScheduler,
} from "./services/EmailImportScheduler.js";
import { startTelegramBot } from "./services/TelegramBotService.js";
import { startProductImageProcessingScheduler } from "./services/ProductImageProcessingScheduler.js";


const PORT =
  Number(process.env.PORT) || 4000;


app.listen(PORT, () => {
  console.log(
    `🚀 MAKA server started on port ${PORT}`
  );

  startEmailImportScheduler();
startAutomaticTranslationScheduler();
  startTelegramBot();
  startProductImageProcessingScheduler();
});
