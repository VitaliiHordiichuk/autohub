import {
  SearchService,
} from "../src/services/SearchService.js";

import {
  pool,
} from "../src/config/db.js";


try {
  const withoutN =
    await SearchService
      .searchByArticle(
        "000000000069"
      );

  const withN =
    await SearchService
      .searchByArticle(
        "N000000000069"
      );

  const expected =
    "N000000000069";

  for (const result of [
    withoutN,
    withN,
  ]) {
    if (!result.found) {
      throw new Error(
        "Проверочная позиция не найдена"
      );
    }

    if (
      result.exactProduct?.article !==
      expected
    ) {
      throw new Error(
        `Ожидался ${expected}, получен ${result.exactProduct?.article ?? "пустой номер"}`
      );
    }
  }

  console.log(
    "Без N и с N найдена одна каноническая карточка: N000000000069"
  );
} finally {
  await pool.end();
}
