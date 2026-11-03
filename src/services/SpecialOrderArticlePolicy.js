import { normalizeArticle } from "./articleEngine/normalize.js";

/**
 * Special-order-only article eligibility. Use the SECOND TXT article.
 * W... is an allowed tool article; ...W is excluded (including W...W).
 * Never use the first article to override this rule.
 */
export function specialOrderArticle(value) {
  if (typeof value !== "string") return null;
  const article = value.trim();
  const normalized = normalizeArticle(article);
  if (!/^[A-Z0-9]{2,120}$/.test(normalized)) return null;

  // Always check the terminal W first, even for tool codes starting with W.
  if (normalized.endsWith("W")) return null;

  return {
    article,
    normalized,
    isTool: normalized.startsWith("W"),
  };
}
