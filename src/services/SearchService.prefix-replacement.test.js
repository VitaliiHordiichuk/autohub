import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../config/db.js';
import { ArticleNumberRepository as numbers } from '../repositories/ArticleNumberRepository.js';
import { ProductRepository as products } from '../repositories/ProductRepository.js';
import { SearchService } from './SearchService.js';
import { readWebsiteArticleSearch } from './WebsiteArticleSearchService.js';

const product = (article, id = 1, brand = 'Mercedes-Benz') => ({
  id, brand_id: brand === 'Mercedes-Benz' ? 1 : 2, brand_name: brand,
  article, article_normalized: article, name: 'Test product',
});
const link = (source, target, type = 'REPLACEMENT', brand = 'Mercedes-Benz') => ({
  linkType: type, sourceBrandId: brand === 'Mercedes-Benz' ? 1 : 2,
  sourceBrandName: brand, sourceArticle: source, sourceArticleNormalized: source,
  targetBrandId: brand === 'Mercedes-Benz' ? 1 : 2,
  targetBrandName: brand, targetArticle: target, targetArticleNormalized: target,
});
function fixture(t, { stock = [], links = [], suggestions = [] } = {}) {
  // A regression suite must never reach a local or production database.
  t.mock.method(pool, 'query', async () => { throw new Error('Unexpected database access'); });
  t.mock.method(numbers, 'findOutgoing', async ({ articleNormalized, brandId }) =>
    links.filter(l => l.sourceArticleNormalized === articleNormalized && (!brandId || l.sourceBrandId === brandId)));
  t.mock.method(numbers, 'findSearchProductsByArticle', async ({ articleNormalized }) =>
    stock.filter(p => p.article_normalized === articleNormalized));
  t.mock.method(numbers, 'findSearchProductByBrandAndArticle', async ({ articleNormalized, brandId }) =>
    stock.find(p => p.article_normalized === articleNormalized && p.brand_id === brandId) || null);
  t.mock.method(numbers, 'findSearchProductsByPrefixes', async () => suggestions);
  t.mock.method(products, 'findMercedesFamilyByBase', async () => []);
}

for (const query of ['A2222700512', '2222700512', 'А2222700512', '222 270 05 12', 'а 222-270-05-12']) {
  test(`old number ${query} resolves to the stocked replacement`, async t => {
    fixture(t, { stock: [product('A9062700501')], links: [link('A2222700512', 'A9062700501')] });
    const result = await SearchService.searchByArticle(query);
    assert.equal(result.query, query);
    assert.equal(result.exactProduct?.article, 'A9062700501');
    assert.equal(result.numberResolution, 'REPLACEMENT');
    assert.equal(result.replacementPath[0].sourceArticle, 'A2222700512');
  });
}

test('restored A follows an alias and the full replacement chain', async t => {
  fixture(t, { stock: [product('A9062700502')], links: [
    link('A2222700512', 'A2222700513', 'ALIAS'),
    link('A2222700513', 'A9062700501'), link('A9062700501', 'A9062700502'),
  ] });
  const result = await SearchService.searchByArticle('2222700512');
  assert.equal(result.exactProduct.article, 'A9062700502');
  assert.equal(result.replacementPath.length, 3);
});

test('an exact numeric product takes priority over an inferred Mercedes number', async t => {
  fixture(t, { stock: [product('2222700512', 2, 'Other'), product('A9062700501')], links: [link('A2222700512', 'A9062700501')] });
  const result = await SearchService.searchByArticle('2222700512');
  assert.equal(result.exactProduct.article, '2222700512');
  assert.equal(result.numberResolution, 'DIRECT');
});

test('an explicit link for the numeric query takes priority over adding A', async t => {
  fixture(t, { stock: [product('OTHER', 2, 'Other'), product('A9062700501')], links: [link('2222700512', 'OTHER', 'ALIAS', 'Other'), link('A2222700512', 'A9062700501')] });
  assert.equal((await SearchService.searchByArticle('2222700512')).exactProduct.article, 'OTHER');
});

test('adding A cannot activate another brand replacement graph', async t => {
  fixture(t, { stock: [product('OTHER', 2, 'Other')], links: [link('A2222700512', 'OTHER', 'REPLACEMENT', 'Other')] });
  assert.equal((await SearchService.searchByArticle('2222700512')).found, false);
});

test('existing source product remains the fallback when the terminal is not stocked', async t => {
  fixture(t, { stock: [product('A2222700512')], links: [link('A2222700512', 'A9062700501')] });
  const result = await SearchService.searchByArticle('2222700512');
  assert.equal(result.exactProduct.article, 'A2222700512');
  assert.equal(result.replacementPath.length, 0);
});

test('unresolved explicit replacement does not turn a prefix suggestion into an exact match', async t => {
  fixture(t, { links: [link('A2222700512', 'A9062700501')], suggestions: [product('A222270051299')] });
  const result = await SearchService.searchByArticle('2222700512');
  assert.equal(result.found, false);
  assert.equal(result.exactProduct, null);
});

test('a complete B number uses the same restored-prefix replacement rule', async t => {
  fixture(t, { stock: [product('B87654321')], links: [link('B12345678', 'B87654321')] });
  assert.equal((await SearchService.searchByArticle('12345678')).exactProduct?.article, 'B87654321');
});

test('a partial number does not activate a full-number replacement', async t => {
  fixture(t, { stock: [product('A9062700501')], links: [link('A2222700512', 'A9062700501')] });
  assert.equal((await SearchService.searchByArticle('222270')).found, false);
});

test('stocked replacement blocks TXT fallback in the shared website and bot model', async t => {
  fixture(t, { stock: [product('A9062700501')], links: [link('A2222700512', 'A9062700501')] });
  let txtCalls = 0;
  const deps = {
    search: query => SearchService.searchByArticle(query),
    pricing: async () => ({ priceGroupName: 'Guest' }),
    findPrevious: async () => [], buildPrevious: async () => [],
    findSource: async () => null,
    buildCard: async p => ({ product: p, offers: [{ id: 1, isAvailable: true, quantity: 1, retailPrice: 100, sourceType: 'OWN_STOCK' }] }),
    present: async ({ productCard, family }) => ({ locale: 'uk', productCard, family, replacementSourceCard: null }),
    specialOrderEnabled: true,
    specialOrder: async () => { txtCalls++; return { article: 'A2222700512' }; },
  };
  for (const query of ['2222700512', 'A2222700512']) {
    const result = await readWebsiteArticleSearch({ article: query }, deps);
    assert.equal(result.response.productCard?.product.article, 'A9062700501');
    assert.equal(result.response.replacement?.targetArticle, 'A9062700501');
    assert.equal(result.response.specialOrder, undefined);
  }
  assert.equal(txtCalls, 0);
});
