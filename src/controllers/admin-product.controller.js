import {
  AdminProductService,
} from "../services/AdminProductService.js";

export async function getProductReturnPolicy(req, res) {
  try {
    const returnPolicy = await AdminProductService.getReturnPolicy(
      req.params.productId,
      req.query.offerId ?? null
    );
    return res.json({ success: true, returnPolicy });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, error: error.message });
  }
}

export async function setProductReturnPolicy(req, res) {
  try {
    const returnPolicy = await AdminProductService.setReturnPolicy(
      req.params.productId,
      req.body
    );
    return res.json({ success: true, returnPolicy });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, error: error.message });
  }
}


export async function permanentlyRemoveProduct(
  req,
  res
) {
  try {
    const product =
      await AdminProductService
        .permanentlyRemove(
          req.params.productId,
          req.auth?.userId
        );

    return res.json({
      success: true,
      product,
    });
  } catch (error) {
    console.error(
      "Ошибка удаления товара:",
      error
    );

    return res
      .status(error.statusCode || 400)
      .json({
        success: false,
        error: error.message,
      });
  }
}
