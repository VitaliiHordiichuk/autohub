import "dotenv/config";

import { pool } from "../config/db.js";
import { EmailImportService } from "../services/EmailImportService.js";


try {
  const result = await EmailImportService.processMailbox({
    source: "MANUAL",
    rescanRecent: true,
  });

  console.log(
    JSON.stringify(result, null, 2)
  );

} catch (error) {
  console.error(
    `❌ Ошибка EMAIL-импорта: ${error.message}`
  );

  process.exitCode = 1;

} finally {
  await pool.end().catch(() => {});
}
