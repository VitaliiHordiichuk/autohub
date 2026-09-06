import { pool } from "../config/db.js";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredName(value) {
  return String(value || "").trim().slice(0, 150);
}

const transliteration = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", є: "ye",
  ё: "yo", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split("")
    .map((character) => transliteration[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 130) || "catalog-group";
}

function effectiveAssignmentCondition(productAlias = "p") {
  return `(
    pc.assignment_source = 'MANUAL'
    OR NOT EXISTS (
      SELECT 1
      FROM product_categories manual_pc
      WHERE manual_pc.product_id = ${productAlias}.id
        AND manual_pc.assignment_source = 'MANUAL'
    )
  )`;
}

function mapAssignment(row) {
  return {
    id: Number(row.category_id),
    slug: row.category_slug,
    nameUk: row.category_name_uk || row.category_name,
    nameRu: row.category_name_ru || row.category_name,
    nameEn: row.category_name_en || row.category_name,
    assignmentSource: row.assignment_source,
    confidence: row.confidence === null ? null : Number(row.confidence),
    rule: row.rule_prefix
      ? {
          prefix: row.rule_prefix,
          matchType: row.rule_match_type,
          materialSubgroup: row.rule_material_subgroup,
          notes: row.rule_notes,
        }
      : null,
  };
}

export const AdminCatalogCategoryService = {
  async listCategories(db = pool) {
    const result = await db.query(`
      SELECT
        c.id,
        c.slug,
        c.name,
        c.name_uk,
        c.name_ru,
        c.name_en,
        c.sort_order,
        c.parent_id,
        parent.name AS parent_name,
        parent.name_uk AS parent_name_uk,
        parent.name_ru AS parent_name_ru,
        parent.name_en AS parent_name_en,
        EXISTS (
          SELECT 1 FROM categories child
          WHERE child.parent_id = c.id AND child.is_active = TRUE
        ) AS has_children,
        (
          SELECT COUNT(*)::integer
          FROM product_categories pc
          JOIN products p ON p.id = pc.product_id AND p.is_active = TRUE
          WHERE pc.category_id = c.id
            AND ${effectiveAssignmentCondition("p")}
        ) AS direct_product_count
      FROM categories c
      LEFT JOIN categories parent ON parent.id = c.parent_id
      WHERE c.is_active = TRUE
      ORDER BY
        CASE WHEN c.parent_id IS NULL THEN c.sort_order ELSE parent.sort_order END,
        c.parent_id NULLS FIRST,
        c.sort_order,
        c.id
    `);

    return result.rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      nameUk: row.name_uk || row.name,
      nameRu: row.name_ru || row.name,
      nameEn: row.name_en || row.name,
      hasChildren: Boolean(row.has_children),
      directProductCount: Number(row.direct_product_count || 0),
      parent: row.parent_id
        ? {
            id: Number(row.parent_id),
            nameUk: row.parent_name_uk || row.parent_name,
            nameRu: row.parent_name_ru || row.parent_name,
            nameEn: row.parent_name_en || row.parent_name,
          }
        : null,
    }));
  },

  async getClassificationWarnings(db = pool) {
    const [countResult, examplesResult] = await Promise.all([
      db.query(`
        SELECT COUNT(DISTINCT product.id)::integer AS count
        FROM product_categories assignment
        JOIN products product
          ON product.id = assignment.product_id
          AND product.is_active = TRUE
        JOIN categories category
          ON category.id = assignment.category_id
        WHERE assignment.assignment_source = 'ACCESSORY_RULE'
          AND COALESCE(assignment.confidence, 0) = 0
          AND category.slug = 'mb-accessories-other'
      `),
      db.query(`
        SELECT product.id, product.article, product.name
        FROM product_categories assignment
        JOIN products product
          ON product.id = assignment.product_id
          AND product.is_active = TRUE
        JOIN categories category
          ON category.id = assignment.category_id
        WHERE assignment.assignment_source = 'ACCESSORY_RULE'
          AND COALESCE(assignment.confidence, 0) = 0
          AND category.slug = 'mb-accessories-other'
        ORDER BY product.id DESC
        LIMIT 10
      `),
    ]);

    return {
      unclassifiedMercedesAccessories: {
        count: Number(countResult.rows[0]?.count || 0),
        examples: examplesResult.rows.map((row) => ({
          id: Number(row.id),
          article: row.article,
          name: row.name,
        })),
      },
    };
  },

  async createCategory({ parentId: parentIdValue, nameUk, nameRu, nameEn }, db = pool) {
    const parentId = parentIdValue ? positiveInteger(parentIdValue, null) : null;
    const normalizedNames = {
      uk: requiredName(nameUk),
      ru: requiredName(nameRu),
      en: requiredName(nameEn),
    };
    const fallbackName = normalizedNames.ru || normalizedNames.uk || normalizedNames.en;
    if (!fallbackName) throw new Error("Укажите название группы");

    const client = typeof db.connect === "function" ? await db.connect() : db;
    const shouldRelease = client !== db && typeof client.release === "function";
    try {
      await client.query("BEGIN");

      if (parentId) {
        const parentResult = await client.query(`
          SELECT id FROM categories
          WHERE id = $1 AND is_active = TRUE
          FOR UPDATE
        `, [parentId]);
        if (!parentResult.rowCount) throw new Error("Родительская группа не найдена");
      }

      const baseSlug = slugify(normalizedNames.en || normalizedNames.ru || normalizedNames.uk);
      let slug = baseSlug;
      let suffix = 2;
      while ((await client.query("SELECT 1 FROM categories WHERE slug = $1", [slug])).rowCount) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const sortResult = await client.query(`
        SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort
        FROM categories
        WHERE parent_id IS NOT DISTINCT FROM $1::integer
      `, [parentId]);

      const result = await client.query(`
        INSERT INTO categories(
          parent_id, name, name_uk, name_ru, name_en, slug, sort_order, is_active
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, TRUE)
        RETURNING id
      `, [
        parentId,
        fallbackName,
        normalizedNames.uk || fallbackName,
        normalizedNames.ru || fallbackName,
        normalizedNames.en || fallbackName,
        slug,
        Number(sortResult.rows[0]?.next_sort || 10),
      ]);

      await client.query("COMMIT");
      return { id: Number(result.rows[0].id), slug };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (shouldRelease) client.release();
    }
  },

  async searchProducts({
    search = "",
    assignment = "ALL",
    categoryId: categoryIdValue = null,
    page = 1,
    limit = 50,
  } = {}, db = pool) {
    const normalizedPage = positiveInteger(page, 1);
    const normalizedLimit = Math.min(100, positiveInteger(limit, 50));
    const normalizedSearch = String(search || "").trim();
    const normalizedAssignment = ["ALL", "WITH", "WITHOUT"].includes(String(assignment).toUpperCase())
      ? String(assignment).toUpperCase()
      : "ALL";
    const categoryId = categoryIdValue ? positiveInteger(categoryIdValue, null) : null;
    const values = [];
    const conditions = ["p.is_active = TRUE"];
    const effectiveExists = `EXISTS (
      SELECT 1
      FROM product_categories pc
      WHERE pc.product_id = p.id
        AND ${effectiveAssignmentCondition("p")}
    )`;

    if (normalizedSearch) {
      values.push(`%${normalizedSearch}%`);
      conditions.push(`(
        p.article ILIKE $${values.length}
        OR p.name ILIKE $${values.length}
        OR COALESCE(b.name, '') ILIKE $${values.length}
        OR COALESCE(pm.name, '') ILIKE $${values.length}
      )`);
    }

    if (normalizedAssignment === "WITH") conditions.push(effectiveExists);
    if (normalizedAssignment === "WITHOUT") conditions.push(`NOT ${effectiveExists}`);

    if (categoryId) {
      values.push(categoryId);
      conditions.push(`EXISTS (
        WITH RECURSIVE category_scope AS (
          SELECT id FROM categories WHERE id = $${values.length} AND is_active = TRUE
          UNION ALL
          SELECT child.id
          FROM categories child
          JOIN category_scope scope ON child.parent_id = scope.id
          WHERE child.is_active = TRUE
        )
        SELECT 1
        FROM product_categories pc
        JOIN category_scope scope ON scope.id = pc.category_id
        WHERE pc.product_id = p.id
          AND ${effectiveAssignmentCondition("p")}
      )`);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const countResult = await db.query(`
      SELECT COUNT(*)::integer AS count
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
      ${where}
    `, values);

    const queryValues = [...values, normalizedLimit, (normalizedPage - 1) * normalizedLimit];
    const limitIndex = queryValues.length - 1;
    const offsetIndex = queryValues.length;
    const result = await db.query(`
      SELECT
        p.id, p.article, p.name,
        b.name AS brand_name,
        pm.name AS manufacturer,
        image.image_url,
        image.image_count
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN part_manufacturers pm ON pm.id = p.manufacturer_id
      LEFT JOIN LATERAL (
        SELECT
          (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id
            ORDER BY pi.priority, pi.id LIMIT 1) AS image_url,
          (SELECT COUNT(*)::integer FROM product_images pi_count
            WHERE pi_count.product_id = p.id) AS image_count
      ) image ON TRUE
      ${where}
      ORDER BY
        CASE WHEN image.image_url IS NULL THEN 1 ELSE 0 END,
        p.article,
        p.id
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, queryValues);

    const productIds = result.rows.map((row) => Number(row.id));
    const assignmentResult = productIds.length
      ? await db.query(`
          SELECT
            assignment.product_id,
            category.id AS category_id,
            category.slug AS category_slug,
            category.name AS category_name,
            category.name_uk AS category_name_uk,
            category.name_ru AS category_name_ru,
            category.name_en AS category_name_en,
            assignment.assignment_source,
            assignment.confidence,
            accessory_rule.article_prefix AS rule_prefix,
            accessory_rule.match_type AS rule_match_type,
            accessory_rule.material_subgroup AS rule_material_subgroup,
            accessory_rule.notes AS rule_notes
          FROM product_categories assignment
          JOIN products product ON product.id = assignment.product_id
          JOIN categories category
            ON category.id = assignment.category_id
            AND category.is_active = TRUE
          LEFT JOIN LATERAL (
            SELECT rule.*
            FROM mercedes_accessory_rules rule
            WHERE assignment.assignment_source = 'ACCESSORY_RULE'
              AND rule.active = TRUE
              AND rule.category_id = assignment.category_id
              AND (
                (rule.article_type = 'A' AND REGEXP_REPLACE(
                  UPPER(COALESCE(product.article_normalized, product.article, '')),
                  '[^A-Z0-9]', '', 'g'
                ) LIKE 'A%')
                OR (rule.article_type = 'B6' AND REGEXP_REPLACE(
                  UPPER(COALESCE(product.article_normalized, product.article, '')),
                  '[^A-Z0-9]', '', 'g'
                ) LIKE 'B6%')
              )
              AND (
                (rule.match_type = 'EXACT' AND REGEXP_REPLACE(
                  UPPER(COALESCE(product.article_normalized, product.article, '')),
                  '[^A-Z0-9]', '', 'g'
                ) = rule.article_prefix)
                OR (rule.match_type = 'PREFIX' AND REGEXP_REPLACE(
                  UPPER(COALESCE(product.article_normalized, product.article, '')),
                  '[^A-Z0-9]', '', 'g'
                ) LIKE rule.article_prefix || '%')
              )
            ORDER BY
              rule.priority,
              CASE WHEN rule.match_type = 'EXACT' THEN 0 ELSE 1 END,
              LENGTH(rule.article_prefix) DESC,
              rule.id
            LIMIT 1
          ) accessory_rule ON TRUE
          WHERE assignment.product_id = ANY($1::integer[])
            AND (
              assignment.assignment_source = 'MANUAL'
              OR NOT EXISTS (
                SELECT 1
                FROM product_categories manual_assignment
                WHERE manual_assignment.product_id = assignment.product_id
                  AND manual_assignment.assignment_source = 'MANUAL'
              )
            )
          ORDER BY
            assignment.product_id,
            CASE
              WHEN assignment.assignment_source = 'MANUAL' THEN 0
              WHEN assignment.assignment_source = 'ACCESSORY_RULE' THEN 2
              ELSE 1
            END,
            assignment.confidence DESC NULLS LAST,
            category.sort_order,
            category.id
        `, [productIds])
      : { rows: [] };
    const assignmentsByProduct = new Map();
    assignmentResult.rows.forEach((row) => {
      const productId = Number(row.product_id);
      assignmentsByProduct.set(productId, [
        ...(assignmentsByProduct.get(productId) || []),
        mapAssignment(row),
      ]);
    });

    const total = Number(countResult.rows[0]?.count || 0);
    return {
      products: result.rows.map((row) => {
        const id = Number(row.id);
        const assignments = assignmentsByProduct.get(id) || [];
        return {
          id,
          article: row.article,
          name: row.name,
          brandName: row.brand_name,
          manufacturer: row.manufacturer,
          imageUrl: row.image_url,
          imageCount: Number(row.image_count || 0),
          category: assignments[0] || null,
          assignments,
        };
      }),
      pagination: {
        page: normalizedPage,
        pageSize: normalizedLimit,
        total,
        pages: Math.max(1, Math.ceil(total / normalizedLimit)),
      },
    };
  },

  async setProductCategory(productIdValue, categoryIdValue, db = pool) {
    const productId = positiveInteger(productIdValue, null);
    const automatic = categoryIdValue === null || categoryIdValue === undefined || categoryIdValue === "";
    const categoryId = automatic ? null : positiveInteger(categoryIdValue, null);
    if (!productId) throw new Error("Некорректный товар");
    if (!automatic && !categoryId) throw new Error("Некорректная группа каталога");

    const client = typeof db.connect === "function" ? await db.connect() : db;
    const shouldRelease = client !== db && typeof client.release === "function";
    try {
      await client.query("BEGIN");
      const productResult = await client.query(
        "SELECT id FROM products WHERE id = $1 FOR UPDATE",
        [productId]
      );
      if (!productResult.rowCount) throw new Error("Товар не найден");

      if (categoryId) {
        const categoryResult = await client.query(
          "SELECT id FROM categories WHERE id = $1 AND is_active = TRUE",
          [categoryId]
        );
        if (!categoryResult.rowCount) throw new Error("Группа каталога не найдена");
      }

      await client.query("DELETE FROM product_categories WHERE product_id = $1", [productId]);
      if (categoryId) {
        await client.query(`
          INSERT INTO product_categories(product_id, category_id, assignment_source, confidence)
          VALUES ($1, $2, 'MANUAL', 100)
        `, [productId, categoryId]);
      } else {
        await client.query("SELECT classify_product_category($1)", [productId]);
        await client.query("SELECT apply_catalog_assignment_overrides($1)", [productId]);
      }

      await client.query("COMMIT");
      return { productId, categoryId, assignmentSource: categoryId ? "MANUAL" : "AUTO_RULE" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      if (shouldRelease) client.release();
    }
  },
};
