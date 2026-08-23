import {
  AdminProductService,
} from "../services/AdminProductService.js";


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
