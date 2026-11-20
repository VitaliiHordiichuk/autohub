import { pool } from "../config/db.js";

const dayRange = `created_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Kyiv')
  AND created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Kyiv')`;
const visitFields = `visit_key, MIN(visitor_key) AS visitor_key, MIN(created_at) AS started_at,
  MAX(created_at) AS last_seen_at, COUNT(*)::integer AS page_views,
  COALESCE((array_agg(device_type ORDER BY created_at DESC,id DESC)
    FILTER (WHERE device_type <> 'unknown'))[1], 'unknown') AS device_type`;
const iso = v => v instanceof Date ? v.toISOString() : new Date(v).toISOString();
function visit(row) {
  return { visitKey:row.visit_key, visitorLabel:row.visitor_key.trim().slice(0,8).toUpperCase(),
    deviceType:row.device_type, startedAt:iso(row.started_at), lastSeenAt:iso(row.last_seen_at), pageViews:Number(row.page_views) };
}

export const SiteTrafficRepository = {
  async record(event, db = pool) {
    const result = await db.query(`INSERT INTO site_page_views(id, visitor_key, visit_key, route, locale, device_type, page_path, page_article)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [event.id, event.visitorKey, event.visitKey, event.route, event.locale, event.deviceType, event.pagePath, event.article]);
    return result.rowCount > 0;
  },

  async dashboard(date, db = pool) {
    const result = await db.query(`SELECT COUNT(*)::integer AS page_views,
      COUNT(DISTINCT visitor_key)::integer AS visitors, COUNT(DISTINCT visit_key)::integer AS visits
      FROM site_page_views WHERE ${dayRange}`, [date]);
    const migration = await db.query(`SELECT version, executed_at AT TIME ZONE 'UTC' AS started_at
      FROM schema_migrations WHERE version IN ('133_create_site_traffic','135_site_visit_journal')`);
    const row = result.rows[0];
    return {
      summary: { visitors:Number(row.visitors), visits:Number(row.visits), pageViews:Number(row.page_views) },
      startedAt:migration.rows.find(r=>r.version==='133_create_site_traffic')?.started_at ?? null,
      journalStartedAt:migration.rows.find(r=>r.version==='135_site_visit_journal')?.started_at ?? null,
    };
  },

  async journal(date, page = 1, db = pool) {
    const result = await db.query(`SELECT ${visitFields} FROM site_page_views WHERE ${dayRange}
      GROUP BY visit_key ORDER BY MIN(created_at) DESC, visit_key DESC LIMIT 25 OFFSET $2`, [date,(page-1)*25]);
    return result.rows.map(visit);
  },

  async visitEvents(date, visitKey, page = 1, db = pool) {
    const meta = await db.query(`SELECT ${visitFields} FROM site_page_views WHERE ${dayRange}
      AND visit_key=$2 GROUP BY visit_key`, [date,visitKey]);
    if (!meta.rows.length) return null;
    const result = await db.query(`WITH events AS (
      SELECT id,route,locale,page_path,page_article,created_at FROM site_page_views
      WHERE ${dayRange} AND visit_key=$2 ORDER BY created_at,id LIMIT 100 OFFSET $3
    ) SELECT e.*, CASE WHEN route='product' AND page_article IS NOT NULL THEN
      (SELECT p.name FROM products p WHERE p.article_normalized=e.page_article AND p.is_active=TRUE ORDER BY p.id LIMIT 1)
      ELSE NULL END AS product_name FROM events e ORDER BY e.created_at,e.id`, [date,visitKey,(page-1)*100]);
    return { visit:visit(meta.rows[0]), total:Number(meta.rows[0].page_views),
      items:result.rows.map(r=>({id:r.id,route:r.route,locale:r.locale,pagePath:r.page_path,
        article:r.page_article,productName:r.product_name,createdAt:iso(r.created_at)})) };
  },
};
