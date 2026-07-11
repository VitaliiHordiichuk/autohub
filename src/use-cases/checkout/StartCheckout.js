import { CheckoutService } from "../../services/CheckoutService.js";

export const StartCheckout = {
  async execute({
    cartId,
    userId = null,
  }) {
    if (!cartId) {
      throw new Error("cartId обязателен");
    }

    const result = await CheckoutService.start({
      cartId,
      userId,
    });

    const expiresAt = new Date(
      result.checkoutSession.expires_at
    );

    const secondsLeft = Math.max(
      0,
      Math.floor(
        (expiresAt.getTime() - Date.now()) / 1000
      )
    );

    return {
      checkoutId: result.checkoutSession.id,
      cartId: result.checkoutSession.cart_id,
      status: result.checkoutSession.status,
      expiresAt: result.checkoutSession.expires_at,
      secondsLeft,
      reused: result.reused,
      reservations: result.reservations ?? [],
    };
  },
};