import {
  BrandAdminService,
} from "../services/BrandAdminService.js";


export async function getBrands(
  req,
  res
) {
  try {
    const brands =
      await BrandAdminService
        .getBrands({
          includeInactive:
            req.query.includeInactive ===
            "true",
        });

    return res.json({
      success: true,
      brands,
    });
  } catch(error) {
    console.error(
      "Ошибка получения брендов:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function getBrand(
  req,
  res
) {
  try {
    const brand =
      await BrandAdminService
        .getBrand(
          req.params.brandId
        );

    return res.json({
      success: true,
      brand,
    });
  } catch(error) {
    console.error(
      "Ошибка получения бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function createBrand(
  req,
  res
) {
  try {
    const brand =
      await BrandAdminService
        .createBrand(
          req.body
        );

    return res
      .status(201)
      .json({
        success: true,
        message:
          "Бренд создан",
        brand,
      });
  } catch(error) {
    console.error(
      "Ошибка создания бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function updateBrand(
  req,
  res
) {
  try {
    const brand =
      await BrandAdminService
        .updateBrand(
          req.params.brandId,
          req.body
        );

    return res.json({
      success: true,
      message:
        "Бренд обновлён",
      brand,
    });
  } catch(error) {
    console.error(
      "Ошибка обновления бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function addBrandAlias(
  req,
  res
) {
  try {
    const alias =
      await BrandAdminService
        .addAlias(
          req.params.brandId,
          req.body
        );

    return res
      .status(201)
      .json({
        success: true,
        message:
          "Вариант написания добавлен",
        alias,
      });
  } catch(error) {
    console.error(
      "Ошибка добавления варианта бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function updateBrandAlias(
  req,
  res
) {
  try {
    const alias =
      await BrandAdminService
        .updateAlias(
          req.params.brandId,
          req.params.aliasId,
          req.body
        );

    return res.json({
      success: true,
      message:
        "Вариант написания обновлён",
      alias,
    });
  } catch(error) {
    console.error(
      "Ошибка обновления варианта бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function deleteBrandAlias(
  req,
  res
) {
  try {
    const alias =
      await BrandAdminService
        .deleteAlias(
          req.params.brandId,
          req.params.aliasId
        );

    return res.json({
      success: true,
      message:
        "Вариант написания удалён",
      alias,
    });
  } catch(error) {
    console.error(
      "Ошибка удаления варианта бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}



export async function deleteBrand(
  req,
  res
) {
  try {
    const brand =
      await BrandAdminService
        .deleteBrand(
          req.params.brandId
        );

    return res.json({
      success: true,
      message:
        "Бренд удалён",
      brand,
    });
  } catch(error) {
    console.error(
      "Ошибка удаления бренда:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
