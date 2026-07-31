import test, {
  after,
  before,
} from "node:test";

import assert from "node:assert/strict";

import {
  app,
} from "../../src/app.js";

import {
  pool,
} from "../../src/config/db.js";

import {
  ArticleNumberService,
} from "../../src/services/ArticleNumberService.js";


let server;
let baseUrl;
let mercedesBrandId;
let numericBrandId;
const createdProductIds = [];

const AUTO_NUMBER =
  "88000000000001";
const AUTO_CANONICAL =
  `N${AUTO_NUMBER}`;

const CHAIN_SOURCE =
  "88000000000002";
const CHAIN_MIDDLE =
  `N${CHAIN_SOURCE}`;
const CHAIN_FINAL =
  `${CHAIN_MIDDLE}99`;

const BLOCK_SOURCE =
  "88000000000003";
const BLOCK_TARGET =
  `N${BLOCK_SOURCE}99`;

const OTHER_NUMBER =
  "77000000000001";


async function insertProduct({
  brandId,
  article,
  name,
}) {
  const result = await pool.query(
    `
      INSERT INTO products (
        brand_id,
        article,
        article_normalized,
        article_no_prefix,
        name,
        is_active,
        article_base,
        article_suffix,
        article_suffix_length,
        variant_type
      )
      VALUES (
        $1::integer,
        $2::text,
        $2::text,
        CASE
          WHEN $2::text LIKE 'N%'
          THEN SUBSTRING(
            $2::text FROM 2
          )
          ELSE NULL
        END,
        $3::varchar,
        TRUE,
        CASE
          WHEN $2::text LIKE 'N%'
          THEN $2::text
          ELSE NULL
        END,
        '', 0, 'BASE'
      )
      RETURNING id;
    `,
    [
      brandId,
      article,
      name,
    ]
  );

  const id =
    Number(result.rows[0].id);
  createdProductIds.push(id);
  return id;
}


before(async () => {
  const brandResult =
    await pool.query(
      `
        SELECT id
        FROM brands
        WHERE LOWER(name) =
          LOWER('Mercedes-Benz')
        ORDER BY id
        LIMIT 1;
      `
    );

  assert.ok(
    brandResult.rows[0],
    "В тестовой базе отсутствует Mercedes-Benz"
  );

  mercedesBrandId =
    Number(brandResult.rows[0].id);

  const numericBrandResult =
    await pool.query(
      `
        INSERT INTO brands (
          name,
          is_active
        )
        VALUES (
          'TEST-NUMERIC-BRAND',
          TRUE
        )
        ON CONFLICT(name)
        DO UPDATE SET
          is_active = TRUE
        RETURNING id;
      `
    );

  numericBrandId =
    Number(
      numericBrandResult.rows[0].id
    );

  await insertProduct({
    brandId:
      mercedesBrandId,
    article:
      AUTO_NUMBER,
    name:
      "Тест автоматического N",
  });

  await insertProduct({
    brandId:
      mercedesBrandId,
    article:
      CHAIN_FINAL,
    name:
      "Тест конечной замены",
  });

  await insertProduct({
    brandId:
      mercedesBrandId,
    article:
      BLOCK_SOURCE,
    name:
      "Тест старого доступного номера",
  });

  await insertProduct({
    brandId:
      numericBrandId,
    article:
      OTHER_NUMBER,
    name:
      "Тест обычного числового артикула",
  });

  await pool.query(
    `
      INSERT INTO article_number_links (
        link_type,
        source_brand_id,
        source_article,
        source_article_normalized,
        target_brand_id,
        target_article,
        target_article_normalized
      )
      VALUES
        (
          'REPLACEMENT',
          $1, $2, $2,
          $1, $3, $3
        ),
        (
          'REPLACEMENT',
          $1, $3, $3,
          $1, $4, $4
        ),
        (
          'REPLACEMENT',
          $1, $5, $5,
          $1, $6, $6
        );
    `,
    [
      mercedesBrandId,
      CHAIN_SOURCE,
      CHAIN_MIDDLE,
      CHAIN_FINAL,
      BLOCK_SOURCE,
      BLOCK_TARGET,
    ]
  );

  await new Promise(
    (resolve, reject) => {
      server = app.listen(
        0,
        "127.0.0.1",
        () => {
          const address =
            server.address();
          baseUrl =
            `http://127.0.0.1:${address.port}`;
          resolve();
        }
      );

      server.once("error", reject);
    }
  );
});


after(async () => {
  if (server) {
    await new Promise(
      (resolve) =>
        server.close(resolve)
    );
  }

  await pool.query(
    `
      DELETE FROM article_number_links
      WHERE source_brand_id = $1
        AND source_article_normalized
          IN ($2, $3, $4);
    `,
    [
      mercedesBrandId,
      CHAIN_SOURCE,
      CHAIN_MIDDLE,
      BLOCK_SOURCE,
    ]
  );

  if (createdProductIds.length > 0) {
    await pool.query(
      `
        DELETE FROM products
        WHERE id =
          ANY($1::integer[]);
      `,
      [createdProductIds]
    );
  }

  if (numericBrandId) {
    await pool.query(
      `
        DELETE FROM brands
        WHERE id = $1;
      `,
      [numericBrandId]
    );
  }

  await pool.end();
});


test(
  "Mercedes номер длиной 12+ ищется с N и без N, а показывается как в прайсе",
  async () => {
    for (const article of [
      AUTO_NUMBER,
      AUTO_CANONICAL,
    ]) {
      const response = await fetch(
        `${baseUrl}/api/search?article=${article}`
      );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.productCard.product.article,
        AUTO_NUMBER
      );
    }
  }
);


test(
  "явная цепочка замен важнее автоматического добавления N",
  async () => {
    const resolution =
      await ArticleNumberService
        .resolveForImport({
          brandId:
            mercedesBrandId,
          article:
            CHAIN_SOURCE,
        });

    assert.equal(
      resolution.explicitReplacement,
      true
    );

    assert.equal(
      resolution.articleNormalized,
      CHAIN_SOURCE
    );

    const response = await fetch(
      `${baseUrl}/api/search?article=${CHAIN_SOURCE}`
    );

    assert.equal(
      response.status,
      200
    );

    const body =
      await response.json();

    assert.equal(
      body.productCard.product.article,
      CHAIN_FINAL
    );
  }
);


test(
  "явная замена без заведённой конечной карточки блокирует автоматический N",
  async () => {
    const response = await fetch(
      `${baseUrl}/api/search?article=${BLOCK_SOURCE}`
    );

    assert.equal(
      response.status,
      200
    );

    const body =
      await response.json();

    assert.equal(
      body.productCard.product.article,
      BLOCK_SOURCE
    );
  }
);


test(
  "числовой артикул другого бренда не получает Mercedes N",
  async () => {
    const response = await fetch(
      `${baseUrl}/api/search?article=${OTHER_NUMBER}`
    );

    assert.equal(
      response.status,
      200
    );

    const body =
      await response.json();

    assert.equal(
      body.productCard.product.article,
      OTHER_NUMBER
    );
  }
);
