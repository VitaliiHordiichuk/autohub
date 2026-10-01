import { CartAccessService } from "./CartAccessService.js";

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export const PublicAvailabilityContextService = {
  async fromRequest(req) {
    const userId = positiveInteger(req.auth?.userId);
    if (userId) return { userId, cartId: null };

    const header = (name) => req.get?.(name)
      ?? req.headers?.[name.toLowerCase()]
      ?? null;
    const cartId = positiveInteger(header("X-Cart-Id"));
    const guestToken = String(header("X-Cart-Token") || "").trim();
    if (!cartId || !guestToken) return { userId: null, cartId: null };

    try {
      const cart = await CartAccessService.assertAccess({
        cartId,
        guestToken,
      });
      return { userId: null, cartId: Number(cart.id) };
    } catch {
      // Public product responses never expose whether a supplied cart token exists.
      return { userId: null, cartId: null };
    }
  },
};
