/**
 * Summarize sorted TXT rows with bounded RAM, retaining only one article at a
 * time and a few examples. This audit NEVER chooses a winning price.
 */
export function createSpecialOrderDuplicateAudit({ exampleLimit = 12 } = {}) {
  if (!Number.isSafeInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 100) {
    throw new RangeError("exampleLimit must be between 1 and 100");
  }

  const totals = {
    acceptedRows: 0,
    uniqueArticles: 0,
    articlesWithMultipleRows: 0,
    excessRowsBeyondOnePerArticle: 0,
    articlesWithDifferentPrices: 0,
    articlesWithDifferentGroups: 0,
    articlesWithDifferentNames: 0,
    articlesWithDifferentPriceOrGroup: 0,
    repeatedArticlesWithIdenticalTerms: 0,
  };
  const mostRepeated = [];
  const pricingConflicts = [];
  let current = null;

  function addTop(target, item) {
    target.push(item);
    target.sort((a, b) => b.rows - a.rows || a.article.localeCompare(b.article, "en"));
    if (target.length > exampleLimit) target.length = exampleLimit;
  }

  function finalizeCurrent() {
    if (!current) return;
    totals.uniqueArticles++;
    if (current.rows > 1) {
      totals.articlesWithMultipleRows++;
      totals.excessRowsBeyondOnePerArticle += current.rows - 1;
      if (!(current.differentPrices || current.differentGroups || current.differentNames)) {
        totals.repeatedArticlesWithIdenticalTerms++;
      }
      const snapshot = {
        article: current.article,
        rows: current.rows,
        differentPrices: current.differentPrices,
        differentGroups: current.differentGroups,
        differentNames: current.differentNames,
        examples: current.examples,
      };
      addTop(mostRepeated, snapshot);
      if (current.differentPrices || current.differentGroups) {
        addTop(pricingConflicts, snapshot);
      }
    }
    if (current.differentPrices) totals.articlesWithDifferentPrices++;
    if (current.differentGroups) totals.articlesWithDifferentGroups++;
    if (current.differentNames) totals.articlesWithDifferentNames++;
    if (current.differentPrices || current.differentGroups) {
      totals.articlesWithDifferentPriceOrGroup++;
    }
    current = null;
  }

  function consume({ article, group, price, title = "", lineNumber }) {
    if (!article || !group || !price || !Number.isSafeInteger(lineNumber)) {
      throw new TypeError("Invalid sorted price audit row");
    }
    if (current && article < current.article) {
      throw new Error("Audit input is not ordered by article");
    }
    if (!current || article !== current.article) {
      finalizeCurrent();
      current = {
        article, rows: 0, first: { group, price, title },
        differentPrices: false, differentGroups: false, differentNames: false,
        examples: [], seenExamples: new Set(),
      };
    }
    totals.acceptedRows++;
    current.rows++;
    current.differentPrices ||= price !== current.first.price;
    current.differentGroups ||= group !== current.first.group;
    current.differentNames ||= title !== current.first.title;

    // Always bounded: no per-row list or database dump in memory.
    const signature = JSON.stringify([group, price, title]);
    if (!current.seenExamples.has(signature) && current.examples.length < 4) {
      current.seenExamples.add(signature);
      current.examples.push({ lineNumber, group, price, title: title || null });
    }
  }

  function finish() {
    finalizeCurrent();
    return { ...totals, mostRepeated, pricingConflicts };
  }

  return { consume, finish };
}
