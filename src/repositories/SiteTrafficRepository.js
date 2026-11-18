import { pool } from "../config/db.js";

export const SiteTrafficRepository = {
  async record(event, db = pool) {
    const result = await db.query(`INSERT INTO site_page_views(id, visitor_key, visit_key, route, locale)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [event.id, event.visitorKey, event.visitKey, event.route, event.locale]);
    return result.rowCount > 0;
  },

  async dashboard(date, db = pool) {
    const result = await db.query(`SELECT COUNT(*)::integer AS page_views,
      COUNT(DISTINCT visitor_key)::integer AS visitors,
      COUNT(DISTINCT visit_key)::integer AS visits
      FROM site_page_views
      WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Kyiv')
        AND created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Europe/Kyiv')`, [date]);
    const migration = await db.query(`SELECT executed_at AT TIME ZONE 'UTC' AS started_at
      FROM schema_migrations WHERE version='133_create_site_traffic'`);
    const row = result.rows[0];
    return {
      summary: { visitors: Number(row.visitors), visits: Number(row.visits), pageViews: Number(row.page_views) },
      startedAt: migration.rows[0]?.started_at ?? null,
    };
  },
};
