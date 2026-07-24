import {
  searchByArticle,
} from "./src/controllers/search.controller.js";

import {
  SupplierService,
} from "./src/services/SupplierService.js";

import {
  WarehouseService,
} from "./src/services/WarehouseService.js";

import {
  pool,
} from "./src/config/db.js";

const supplierIds = [];
const productIds = [];

try {
  const suffix = String(Date.now());
  const articleBase = `A${suffix.slice(-10)}`;
  const article64 = `${articleBase}64`;
  const article9051 = `${articleBase}9051`;

  const ownSupplier =
    await SupplierService.createSupplier({
      name: `ТЕСТ MERCEDES МОЙ ${suffix}`,
      type: "OWN",
      warehousePriorityEnabled: true,
    });

  supplierIds.push(ownSupplier.id);

  await SupplierService.setArticleSearchRule(
    ownSupplier.id,
    "MERCEDES_SUFFIX_FAMILY",
    true
  );

  const ownWarehouse1 =
    await WarehouseService.createWarehouse({
      supplierId: ownSupplier.id,
      name: "Наш Mercedes склад №1",
      city: "Харьков",
      priority: 1,
    });

  const ownWarehouse2 =
    await WarehouseService.createWarehouse({
      supplierId: ownSupplier.id,
      name: "Наш Mercedes склад №2",
      city: "Харьков",
      priority: 2,
    });

  const partnerSupplier =
    await SupplierService.createSupplier({
      name: `ТЕСТ MERCEDES ПАРТНЁР ${suffix}`,
      type: "PARTNER",
      warehousePriorityEnabled: false,
    });

  supplierIds.push(partnerSupplier.id);

  const partnerWarehouse =
    await WarehouseService.createWarehouse({
      supplierId: partnerSupplier.id,
      name: "Партнёрский Mercedes склад",
      city: "Киев",
      priority: null,
    });

  const productsResult =
    await pool.query(
      `
        INSERT INTO products (
          article,
          article_normalized,
          article_base,
          article_suffix,
          article_suffix_length,
          variant_type,
          name,
          is_active
        )
        VALUES
          (
            $1, $1, $1,
            '', 0, 'BASE',
            'Тестовый базовый товар',
            TRUE
          ),
          (
            $2, $2, $1,
            '64', 2, 'SAME',
            'Тестовый вариант 64',
            TRUE
          ),
          (
            $3, $3, $1,
            '9051', 4, 'VARIANT',
            'Тестовый вариант 9051',
            TRUE
          )
        RETURNING id, article
      `,
      [articleBase, article64, article9051]
    );

  for (const product of productsResult.rows) {
    productIds.push(product.id);
  }

  const productByArticle =
    new Map(
      productsResult.rows.map(
        (product) => [
          product.article,
          product.id,
        ]
      )
    );

  await pool.query(
    `
      INSERT INTO product_offers (
        product_id,
        warehouse_id,
        quantity,
        retail_price,
        delivery_days,
        is_available,
        source_type
      )
      VALUES
        ($1, $2, 2, 1200, 0, TRUE, 'OWN_STOCK'),
        ($1, $3, 5, 1000, 0, TRUE, 'OWN_STOCK'),
        ($4, $3, 3, 1500, 0, TRUE, 'OWN_STOCK'),
        ($1, $5, 8, 800, 2, TRUE, 'SUPPLIER')
    `,
    [
      productByArticle.get(article64),
      ownWarehouse1.id,
      ownWarehouse2.id,
      productByArticle.get(article9051),
      partnerWarehouse.id,
    ]
  );

  let statusCode = 200;
  let responseBody = null;

  const req = {
    query: {
      article: articleBase,
      locale: "uk",
    },
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },

    json(data) {
      responseBody = data;
      return data;
    },
  };

  await searchByArticle(req, res);

  console.log("\nСтатус:", statusCode);

  console.log(
    "\nНайденные варианты:",
    responseBody?.family?.map(
      (item) => ({
        article: item.product.article,
        offers: item.offers.map(
          (offer) => ({
            price: offer.retailPrice,
            quantity: offer.quantity,
          })
        ),
      })
    )
  );

  if (statusCode !== 200) {
    throw new Error(
      "Поиск завершился с ошибкой"
    );
  }

  if (responseBody.family.length !== 2) {
    throw new Error(
      "Должно быть найдено два продолжения номера"
    );
  }

  const variant64 =
    responseBody.family.find(
      (item) =>
        item.product.article === article64
    );

  const variant9051 =
    responseBody.family.find(
      (item) =>
        item.product.article === article9051
    );

  if (
    !variant64 ||
    variant64.offers.length !== 1 ||
    variant64.offers[0].retailPrice !== 1200
  ) {
    throw new Error(
      "Неверно выбран приоритетный склад для варианта 64"
    );
  }

  if (
    !variant9051 ||
    variant9051.offers.length !== 1 ||
    variant9051.offers[0].retailPrice !== 1500
  ) {
    throw new Error(
      "Вариант 9051 не попал в выдачу"
    );
  }

  console.log(
    "\nТЕСТ УСПЕШЕН: все доступные продолжения показываются отдельно"
  );
} finally {
  if (productIds.length > 0) {
    await pool.query(
      `
        DELETE FROM products
        WHERE id = ANY($1::integer[])
      `,
      [productIds]
    );
  }

  if (supplierIds.length > 0) {
    await pool.query(
      `
        DELETE FROM warehouses
        WHERE supplier_id = ANY($1::integer[])
      `,
      [supplierIds]
    );

    await pool.query(
      `
        DELETE FROM suppliers
        WHERE id = ANY($1::integer[])
      `,
      [supplierIds]
    );
  }

  await pool.end();
}
