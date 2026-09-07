import { pool } from "../src/config/db.js";

const result = await pool.query(`
  SELECT
    product.article,
    product.name AS product_name,
    functional.slug AS functional_category,
    accessory.slug AS proposed_accessory_category,
    CASE
      WHEN exact_rule.id IS NOT NULL THEN 'VERIFIED_EXACT'
      WHEN name_rule.id IS NOT NULL THEN 'HIGH_CONFIDENCE_NAME'
      ELSE 'UNKNOWN'
    END AS detection_source,
    assignment.confidence::float AS confidence
  FROM products product
  JOIN product_categories assignment
    ON assignment.product_id = product.id
    AND assignment.assignment_source = 'ACCESSORY_RULE'
  JOIN categories accessory ON accessory.id = assignment.category_id
  LEFT JOIN LATERAL (
    SELECT category.slug
    FROM product_categories functional_assignment
    JOIN categories category ON category.id = functional_assignment.category_id
    WHERE functional_assignment.product_id = product.id
      AND functional_assignment.assignment_source IN ('MANUAL', 'AUTO_RULE')
      AND NOT category_is_within_tree(category.id, 'mb-accessories-b')
    ORDER BY
      CASE WHEN functional_assignment.assignment_source = 'MANUAL' THEN 0 ELSE 1 END,
      functional_assignment.confidence DESC NULLS LAST,
      category.sort_order,
      category.id
    LIMIT 1
  ) functional ON TRUE
  LEFT JOIN LATERAL (
    SELECT rule.id
    FROM mercedes_accessory_rules rule
    WHERE rule.active = TRUE
      AND rule.article_type = 'A'
      AND rule.match_type = 'EXACT'
      AND rule.category_id = assignment.category_id
      AND rule.article_prefix = REGEXP_REPLACE(
        UPPER(COALESCE(product.article_normalized, product.article, '')),
        '[^A-Z0-9]', '', 'g'
      )
    LIMIT 1
  ) exact_rule ON TRUE
  LEFT JOIN LATERAL (
    SELECT rule.id
    FROM mercedes_accessory_name_rules rule
    WHERE rule.active = TRUE
      AND rule.article_type = 'A'
      AND rule.category_id = assignment.category_id
      AND COALESCE(product.name, '') ~* rule.name_pattern
    ORDER BY rule.priority, rule.id
    LIMIT 1
  ) name_rule ON TRUE
  WHERE REGEXP_REPLACE(
    UPPER(COALESCE(product.article_normalized, product.article, '')),
    '[^A-Z0-9]', '', 'g'
  ) LIKE 'A%'
  ORDER BY detection_source, proposed_accessory_category, product.article
`);

const summary = result.rows.reduce((counts, row) => {
  const key = `${row.detection_source} -> ${row.proposed_accessory_category}`;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  total: result.rowCount,
  summary,
  products: result.rows,
}, null, 2));

await pool.end();
