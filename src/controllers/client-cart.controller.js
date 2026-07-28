import {
  ClientCartService,
} from "../services/ClientCartService.js";


function guestTokenFromRequest(
  req
) {
  const token =
    req.get(
      "X-Cart-Token"
    );

  return token
    ? token.trim()
    : null;
}


export async function claimGuestCart(
  req,
  res
) {
  try {
    const result =
      await ClientCartService
        .claimGuestCart({
          userId:
            req.auth.userId,

          cartId:
            req.body.cartId,

          guestToken:
            guestTokenFromRequest(
              req
            ),
        });

    return res.json({
      success: true,
      ...result,
    });

  } catch (error) {
    return res
      .status(
        error.statusCode ||
        400
      )
      .json({
        success: false,

        error:
          error.message,
      });
  }
}
