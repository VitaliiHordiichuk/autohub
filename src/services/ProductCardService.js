import { ProductRepository } from "../repositories/ProductRepository.js";
import { OfferService } from "./OfferService.js";

async function findArticleNumberRelatedProducts(product, relationType) {
  return ProductRepository.findArticleNumberRelatedProducts(
    product.brand_id,
    product.article_normalized,
    relationType
  );
}

function uniqueRelated(...groups) {
  return [...new Map(groups.flat().map((item) => [Number(item.product.id), item])).values()];
}

export const ProductCardService = {
  async build(product, pricingContext = null, availabilityContext = null) {
    if (!product) {
      return null;
    }

    const [analogProducts, replacementProducts, linkedAnalogProducts, linkedReplacementProducts] = await Promise.all([
      ProductRepository.findRelatedProducts(product.id, "ANALOG"),
      ProductRepository.findRelatedProducts(product.id, "REPLACEMENT"),
      findArticleNumberRelatedProducts(product, "ANALOG"),
      findArticleNumberRelatedProducts(product, "REPLACEMENT"),
    ]);

    const offersByProductId = await OfferService.getOffersByProductIds([
      product.id,
      ...analogProducts.map((item) => item.id),
      ...replacementProducts.map((item) => item.id),
      ...linkedAnalogProducts.map((item) => item.id),
      ...linkedReplacementProducts.map((item) => item.id),
    ], pricingContext, "uk", availabilityContext);
    const withOffers = (relatedProduct) => ({
      product: relatedProduct,
      offers: offersByProductId.get(Number(relatedProduct.id)) || [],
    });

    const analogs = analogProducts.map(withOffers);
    const replacements = replacementProducts.map(withOffers);
    const linkedAnalogs = linkedAnalogProducts.map(withOffers);
    const linkedReplacements = linkedReplacementProducts.map(withOffers);

    return {
      product,
      offers: offersByProductId.get(Number(product.id)) || [],
      analogs: uniqueRelated(analogs, linkedAnalogs),
      replacements: uniqueRelated(replacements, linkedReplacements),
    };
  },
};
