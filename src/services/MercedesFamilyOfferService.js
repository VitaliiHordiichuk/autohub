import {
  SupplierRepository,
} from "../repositories/SupplierRepository.js";

import {
  OfferService,
} from "./OfferService.js";


const RULE_CODE =
  "MERCEDES_SUFFIX_FAMILY";


export const MercedesFamilyOfferService = {
  async build({
    family = [],
    exactProductId = null,
  } = {}) {
    const enabledSupplierIds =
      await SupplierRepository
        .findEnabledSupplierIdsByArticleSearchRule(
          RULE_CODE
        );

    const enabledSupplierIdSet =
      new Set(
        enabledSupplierIds.map(Number)
      );

    if (
      enabledSupplierIdSet.size === 0
    ) {
      return [];
    }

    const result = [];

    for (const product of family) {
      if (
        exactProductId !== null &&
        Number(product.id) ===
          Number(exactProductId)
      ) {
        continue;
      }

      const offers =
        await OfferService
          .getOffersByProductId(
            product.id
          );

      const allowedOffers =
        offers.filter(
          (offer) => {
            const supplierId =
              Number(
                offer.supplier?.id
              );

            return (
              Number.isInteger(
                supplierId
              ) &&
              enabledSupplierIdSet.has(
                supplierId
              )
            );
          }
        );

      if (
        allowedOffers.length === 0
      ) {
        continue;
      }

      result.push({
        product,
        offers: allowedOffers,
      });
    }

    return result;
  },
};
