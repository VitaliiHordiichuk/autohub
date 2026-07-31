import { pool } from "../config/db.js";

export const ClientSearchHistoryRepository = {
  async list({ userId, search = "", limit = 20 }, db = pool) {
    const query = String(search).trim();
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const result = await db.query(`
      SELECT DISTINCT ON (COALESCE(se.normalized_query,se.raw_query))
        se.id,se.raw_query,se.normalized_query,se.searched_article,se.found,se.created_at,
        p.article AS product_article,p.name AS product_name
      FROM search_events se
      LEFT JOIN products p ON p.id=se.exact_product_id
      WHERE se.user_id=$1 AND se.event_type='SEARCH'
        AND ($2='' OR se.raw_query ILIKE '%'||$2||'%'
          OR se.normalized_query ILIKE '%'||$2||'%'
          OR se.searched_article ILIKE '%'||$2||'%')
      ORDER BY COALESCE(se.normalized_query,se.raw_query),se.created_at DESC`, [userId, query]);
    return result.rows
      .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
      .slice(0,safeLimit)
      .map(row=>({
        id:Number(row.id),query:row.raw_query,normalized:row.normalized_query,
        searchedArticle:row.searched_article,found:row.found,createdAt:row.created_at,
        productArticle:row.product_article,productName:row.product_name,
      }));
  },
};
