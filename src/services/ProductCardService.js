import { ProductRepository } from "../repositories/ProductRepository.js";
import { OfferService } from "./OfferService.js";

async function buildRelatedProducts(productId, relationType, pricingContext) {
  const relatedProducts =
    await ProductRepository.findRelatedProducts(
      productId,
      relationType
    );

  const result = [];

  for (const relatedProduct of relatedProducts) {
    const offers = await OfferService.getOffersByProductId(
      relatedProduct.id,
      pricingContext
    );

    result.push({
      product: relatedProduct,
      offers,
    });
  }

  return result;
}

async function buildArticleNumberRelatedProducts(product, relationType, pricingContext) {
  const relatedProducts = await ProductRepository.findArticleNumberRelatedProducts(
    product.brand_id,
    product.article_normalized,
    relationType
  );
  return Promise.all(relatedProducts.map(async (relatedProduct) => ({
    product: relatedProduct,
    offers: await OfferService.getOffersByProductId(relatedProduct.id, pricingContext),
  })));
}

function uniqueRelated(...groups) {
  return [...new Map(groups.flat().map((item) => [Number(item.product.id), item])).values()];
}

export const ProductCardService = {
  async build(product, pricingContext = null) {
    if (!product) {
      return null;
    }

    const [offers, analogs, replacements, linkedAnalogs, linkedReplacements] = await Promise.all([
      OfferService.getOffersByProductId(product.id, pricingContext),
      buildRelatedProducts(product.id, "ANALOG", pricingContext),
      buildRelatedProducts(product.id, "REPLACEMENT", pricingContext),
      buildArticleNumberRelatedProducts(product, "ANALOG", pricingContext),
      buildArticleNumberRelatedProducts(product, "REPLACEMENT", pricingContext),
    ]);

    return {
      product,
      offers,
      analogs: uniqueRelated(analogs, linkedAnalogs),
      replacements: uniqueRelated(replacements, linkedReplacements),
    };
  },
};
