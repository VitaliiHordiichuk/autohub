import { CheckoutService } from "../../services/CheckoutService.js";

export const StartCheckout = {
  async execute({
    cartId,
    itemIds = null,
    userId = null,
    guestToken = null,
    pricingUserId = null,
  }) {
    if (!cartId) {
      throw new Error("cartId є обов’язковим");
    }

    const result =
      await CheckoutService.start({
        cartId,
        itemIds,
        userId,
        guestToken,
        pricingUserId,
      });

    const expiresAt = result.checkoutSession.expires_at
      ? new Date(result.checkoutSession.expires_at)
      : null;

    const secondsLeft = expiresAt ? Math.max(
      0,
      Math.floor(
        (expiresAt.getTime() - Date.now()) /
          1000
      )
    ) : null;

    return {
      checkoutId:
        result.checkoutSession.id,
      cartId:
        result.checkoutSession.cart_id,
      status:
        result.checkoutSession.status,
      expiresAt:
        result.checkoutSession.expires_at,
      secondsLeft,
      inventoryModel:
        result.checkoutSession.inventory_model,
      reused: result.reused,
      reservations:
        result.reservations ?? [],
      items:
        result.items ?? [],
    };
  },
};
