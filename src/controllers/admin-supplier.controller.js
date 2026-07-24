import { SupplierService } from "../services/SupplierService.js";


export async function createSupplier(req, res) {
  try {

    const supplier =
      await SupplierService.createSupplier(
        req.body
      );

    return res.status(201).json({
      success: true,
      message: "Поставщик создан",
      supplier,
    });

  } catch (error) {

    console.error(
      "Ошибка создания поставщика:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}



export async function getSuppliers(req, res) {
  try {

    const suppliers =
      await SupplierService.getSuppliers({
        includeInactive:
          req.query.includeInactive === "true",
      });


    return res.json({
      success: true,
      suppliers,
    });


  } catch (error) {

    console.error(
      "Ошибка получения поставщиков:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}




export async function getSupplier(req, res) {
  try {

    const supplier =
      await SupplierService.getSupplier(
        req.params.supplierId
      );


    return res.json({
      success: true,
      supplier,
    });


  } catch (error) {

    console.error(
      "Ошибка получения поставщика:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}




export async function updateSupplier(req, res) {
  try {

    const supplier =
      await SupplierService.updateSupplier(
        req.params.supplierId,
        req.body
      );


    return res.json({
      success: true,
      message: "Данные поставщика обновлены",
      supplier,
    });


  } catch (error) {

    console.error(
      "Ошибка обновления поставщика:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}




export async function setSupplierActive(req, res) {
  try {

    const { isActive } = req.body;


    if (typeof isActive !== "boolean") {
      throw new Error(
        "Поле isActive должно быть true или false"
      );
    }


    const supplier =
      await SupplierService.setSupplierActive(
        req.params.supplierId,
        isActive
      );


    return res.json({
      success: true,
      message: isActive
        ? "Поставщик включён"
        : "Поставщик отключён",
      supplier,
    });


  } catch (error) {

    console.error(
      "Ошибка изменения активности поставщика:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}

export async function getSupplierDetails(
  req,
  res
) {

  try {

    const supplier =
      await SupplierService.getSupplierDetails(
        req.params.supplierId
      );


    return res.json({
      success: true,
      supplier,
    });


  } catch(error) {

    console.error(
      "Ошибка получения карточки поставщика:",
      error
    );


    return res.status(400).json({
      success:false,
      error:error.message,
    });
  }
}


export async function
getSupplierArticleSearchRules(
  req,
  res
) {
  try {
    const rules =
      await SupplierService
        .getArticleSearchRules(
          req.params.supplierId
        );

    return res.json({
      success: true,
      rules,
    });

  } catch (error) {
    console.error(
      "Ошибка получения правил поиска:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}


export async function
updateSupplierArticleSearchRule(
  req,
  res
) {
  try {
    const rule =
      await SupplierService
        .setArticleSearchRule(
          req.params.supplierId,
          req.params.ruleCode,
          req.body.isEnabled
        );

    return res.json({
      success: true,

      message:
        rule.isEnabled
          ? "Правило поиска включено"
          : "Правило поиска выключено",

      rule,
    });

  } catch (error) {
    console.error(
      "Ошибка изменения правила поиска:",
      error
    );

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
}
