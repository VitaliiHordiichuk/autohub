import { transaction } from "../db/transaction.js";
import { SupplierRepository } from "../repositories/SupplierRepository.js";


const SUPPLIER_TYPES = new Set([
  "OWN",
  "PARTNER",
]);


function normalizeSupplierType(
  value,
  fallback = "PARTNER"
) {
  const normalizedType = String(
    value ?? fallback
  )
    .trim()
    .toUpperCase();

  if (
    !SUPPLIER_TYPES.has(
      normalizedType
    )
  ) {
    throw new Error(
      "Тип источника должен быть OWN или PARTNER"
    );
  }

  return normalizedType;
}


function normalizeWarehousePriorityEnabled(
  value
) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(
      "Поле warehousePriorityEnabled должно быть true или false"
    );
  }

  return value;
}




const ARTICLE_SEARCH_RULES = [
  "MERCEDES_SUFFIX_FAMILY",
];

const ARTICLE_SEARCH_RULE_CODES =
  new Set(
    ARTICLE_SEARCH_RULES
  );


function normalizeRuleSupplierId(
  value
) {
  const supplierId = Number(value);

  if (
    !Number.isInteger(supplierId) ||
    supplierId <= 0
  ) {
    throw new Error(
      "Некорректный номер источника товара"
    );
  }

  return supplierId;
}


function normalizeArticleSearchRuleCode(
  value
) {
  const ruleCode = String(
    value ?? ""
  )
    .trim()
    .toUpperCase();

  if (
    !ARTICLE_SEARCH_RULE_CODES.has(
      ruleCode
    )
  ) {
    throw new Error(
      "Неизвестное правило поиска артикулов"
    );
  }

  return ruleCode;
}


function normalizeRuleEnabled(
  value
) {
  if (typeof value !== "boolean") {
    throw new Error(
      "Поле isEnabled должно быть true или false"
    );
  }

  return value;
}


export const SupplierService = {

  async createSupplier(data) {

    if (!data.name || !data.name.trim()) {
      throw new Error(
        "Название поставщика обязательно"
      );
    }


    const supplierName =
      data.name.trim();


    try {

      return await SupplierRepository.create({
        ...data,

        name:
          supplierName,

        type:
          normalizeSupplierType(
            data.type
          ),

        warehousePriorityEnabled:
          data.warehousePriorityEnabled ===
          undefined
            ? false
            : normalizeWarehousePriorityEnabled(
                data.warehousePriorityEnabled
              ),
      });

    } catch (error) {

      if (
        error.code === "23505"
      ) {
        throw new Error(
          "Поставщик с таким названием уже существует"
        );
      }

      throw error;
    }
  },


  async getSuppliers(options = {}) {

    return await SupplierRepository.findAll(
      options
    );
  },


  async getSupplier(id) {

    const supplier =
      await SupplierRepository.findById(id);


    if (!supplier) {
      throw new Error(
        "Поставщик не найден"
      );
    }


    return supplier;
  },

  async getSupplierDetails(id) {

  const supplier =
    await SupplierRepository.findById(id);


  if (!supplier) {
    throw new Error(
      "Поставщик не найден"
    );
  }


  const warehouses =
    await SupplierRepository.findWarehouses(id);


  return {
    ...supplier,
    warehouses,
  };
},


  async updateSupplier(id, data) {

    if (
      data.name !== undefined &&
      !String(data.name).trim()
    ) {
      throw new Error(
        "Название поставщика не может быть пустым"
      );
    }


    if (
      data.deliveryDays !== undefined &&
      data.deliveryDays < 0
    ) {
      throw new Error(
        "Срок доставки не может быть отрицательным"
      );
    }


    const normalizedType =
      data.type === undefined
        ? undefined
        : normalizeSupplierType(
            data.type
          );


    return transaction(async (db) => {
      const supplier =
        await SupplierRepository.update(
          id,
          {
            ...data,

            name:
              data.name === undefined
                ? undefined
                : String(data.name).trim(),

            type:
              normalizedType,

            warehousePriorityEnabled:
              normalizeWarehousePriorityEnabled(
                data.warehousePriorityEnabled
              ),
          },
          db
        );


      if (!supplier) {
        throw new Error(
          "Поставщик не найден"
        );
      }


      if (normalizedType !== undefined) {
        await SupplierRepository
          .syncLinkedWarehouseTypes(
            Number(supplier.id),
            normalizedType,
            db
          );
      }


      return supplier;
    });
  },


  async setSupplierActive(
    id,
    isActive
  ) {

    return await SupplierRepository.setActive(
      id,
      isActive
    );
  },

  async getArticleSearchRules(
    supplierId
  ) {
    const normalizedSupplierId =
      normalizeRuleSupplierId(
        supplierId
      );

    const supplier =
      await SupplierRepository.findById(
        normalizedSupplierId
      );

    if (!supplier) {
      throw new Error(
        "Источник товара не найден"
      );
    }

    const storedRules =
      await SupplierRepository
        .findArticleSearchRules(
          normalizedSupplierId
        );

    const storedByCode =
      new Map(
        storedRules.map(
          (rule) => [
            rule.rule_code,
            rule,
          ]
        )
      );

    return ARTICLE_SEARCH_RULES.map(
      (ruleCode) => {
        const storedRule =
          storedByCode.get(
            ruleCode
          );

        return {
          ruleCode,

          isEnabled:
            storedRule
              ?.is_enabled === true,

          createdAt:
            storedRule
              ?.created_at ?? null,

          updatedAt:
            storedRule
              ?.updated_at ?? null,
        };
      }
    );
  },


  async setArticleSearchRule(
    supplierId,
    ruleCode,
    isEnabled
  ) {
    const normalizedSupplierId =
      normalizeRuleSupplierId(
        supplierId
      );

    const normalizedRuleCode =
      normalizeArticleSearchRuleCode(
        ruleCode
      );

    const normalizedEnabled =
      normalizeRuleEnabled(
        isEnabled
      );

    const supplier =
      await SupplierRepository.findById(
        normalizedSupplierId
      );

    if (!supplier) {
      throw new Error(
        "Источник товара не найден"
      );
    }

    const rule =
      await SupplierRepository
        .upsertArticleSearchRule(
          normalizedSupplierId,
          normalizedRuleCode,
          normalizedEnabled
        );

    return {
      ruleCode:
        rule.rule_code,

      isEnabled:
        rule.is_enabled === true,

      createdAt:
        rule.created_at,

      updatedAt:
        rule.updated_at,
    };
  },


};
