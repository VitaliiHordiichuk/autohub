import { ProductRepository } from "../repositories/ProductRepository.js";
import { OfferService } from "./OfferService.js";

async function buildRelatedProducts(productId, relationType) {
  const relatedProducts =
    await ProductRepository.findRelatedProducts(
      productId,
      relationType
    );

  const result = [];

  for (const relatedProduct of relatedProducts) {
    const offers = await OfferService.getOffersByProductId(
      relatedProduct.id
    );

    result.push({
      product: relatedProduct,
      offers,
    });
  }

  return result;
}

export const ProductCardService = {
  async build(product) {
    if (!product) {
      return null;
    }

    const [offers, analogs, replacements] = await Promise.all([
      OfferService.getOffersByProductId(product.id),
      buildRelatedProducts(product.id, "ANALOG"),
      buildRelatedProducts(product.id, "REPLACEMENT"),
    ]);

    return {
      product,
      offers,
      analogs,
      replacements,
    };
  },
};