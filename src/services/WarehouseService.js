import { WarehouseRepository } from "../repositories/WarehouseRepository.js";
import { SupplierRepository } from "../repositories/SupplierRepository.js";

const WAREHOUSE_TYPES = new Set([
  "OWN",
  "SUPPLIER",
]);
const PRICING_MODELS = new Set(["OWN_DUAL_PRICE", "SUPPLIER_MARKUP"]);

function normalizePricingModel(value) {
  const model = String(value ?? "").trim().toUpperCase();
  if (!PRICING_MODELS.has(model)) throw new Error("Неизвестная модель ценообразования");
  return model;
}

function normalizeMarkup(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} должна быть не меньше 0%`);
  return number;
}

function validateId(value, errorMessage) {
  const numericValue = Number(value);

  if (
    !Number.isInteger(numericValue) ||
    numericValue <= 0
  ) {
    throw new Error(errorMessage);
  }

  return numericValue;
}

function normalizeName(name) {
  const normalizedName = String(name ?? "").trim();

  if (!normalizedName) {
    throw new Error("Название склада обязательно");
  }

  if (normalizedName.length > 150) {
    throw new Error(
      "Название склада не может быть длиннее 150 символов"
    );
  }

  return normalizedName;
}

function normalizeCity(city) {
  if (city === undefined) {
    return undefined;
  }

  if (city === null) {
    return null;
  }

  const normalizedCity = String(city).trim();

  if (!normalizedCity) {
    return null;
  }

  if (normalizedCity.length > 100) {
    throw new Error(
      "Название города не может быть длиннее 100 символов"
    );
  }

  return normalizedCity;
}

function normalizeType(type) {
  const normalizedType = String(
    type ?? ""
  ).trim().toUpperCase();

  if (!WAREHOUSE_TYPES.has(normalizedType)) {
    throw new Error(
      "Тип склада должен быть OWN или SUPPLIER"
    );
  }

  return normalizedType;
}

function normalizeDeliveryDays(value) {
  const numericValue = Number(value ?? 0);

  if (
    !Number.isInteger(numericValue) ||
    numericValue < 0
  ) {
    throw new Error(
      "Срок доставки должен быть целым числом от нуля"
    );
  }

  return numericValue;
}

function normalizePriority(value) {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const numericValue = Number(value);

  if (
    !Number.isInteger(numericValue) ||
    numericValue <= 0
  ) {
    throw new Error(
      "Приоритет склада должен быть целым числом больше нуля или пустым"
    );
  }

  return numericValue;
}


async function resolveWarehouseSource(
  type,
  supplierId
) {
  const requestedType =
    type === undefined ||
    type === null ||
    String(type).trim() === ""
      ? "OWN"
      : normalizeType(type);

  if (
    supplierId === null ||
    supplierId === undefined ||
    String(supplierId).trim() === ""
  ) {
    if (requestedType === "SUPPLIER") {
      throw new Error(
        "Для склада партнёра необходимо выбрать источник товара"
      );
    }

    return {
      supplierId: null,
      type: "OWN",
    };
  }

  const numericSupplierId = validateId(
    supplierId,
    "Некорректный номер источника товара"
  );

  const supplier =
    await SupplierRepository.findById(
      numericSupplierId
    );

  if (!supplier) {
    throw new Error(
      "Источник товара не найден"
    );
  }

  if (!supplier.is_active) {
    throw new Error(
      "Нельзя привязать склад к отключённому источнику товара"
    );
  }

  const supplierType =
    String(
      supplier.type || "PARTNER"
    )
      .trim()
      .toUpperCase();

  return {
    supplierId: numericSupplierId,

    type:
      supplierType === "OWN"
        ? "OWN"
        : "SUPPLIER",
  };
}

export const WarehouseService = {
  async createWarehouse({
    organizationId = null,
    supplierId = null,
    name,
    city = null,
    type = "OWN",
    deliveryDays = 0,
    pickupAvailable = false,
    shippingAvailable = true,
    priority = null,
  }) {
    const source =
      await resolveWarehouseSource(
        type,
        supplierId
      );

    let normalizedOrganizationId = null;

    if (
      organizationId !== null &&
      organizationId !== undefined
    ) {
      normalizedOrganizationId = validateId(
        organizationId,
        "Некорректный номер организации"
      );
    }

    return WarehouseRepository.create({
      organizationId: normalizedOrganizationId,
      supplierId:
        source.supplierId,

      name:
        normalizeName(name),

      city:
        normalizeCity(city),

      type:
        source.type,

      deliveryDays:
        normalizeDeliveryDays(
          deliveryDays
        ),

      pickupAvailable:
        Boolean(pickupAvailable),

      shippingAvailable:
        Boolean(shippingAvailable),

      priority:
        normalizePriority(priority),
    });
  },

  async getWarehouses({
    type = null,
    supplierId = null,
    includeInactive = false,
  } = {}) {
    let normalizedType = null;
    let normalizedSupplierId = null;

    if (type !== null && type !== undefined) {
      normalizedType = normalizeType(type);
    }

    if (
      supplierId !== null &&
      supplierId !== undefined
    ) {
      normalizedSupplierId = validateId(
        supplierId,
        "Некорректный номер поставщика"
      );
    }

    return WarehouseRepository.findAll({
      type: normalizedType,
      supplierId: normalizedSupplierId,
      includeInactive:
        includeInactive === true ||
        includeInactive === "true",
    });
  },

  async getWarehouse(warehouseId) {
    const numericWarehouseId = validateId(
      warehouseId,
      "Некорректный номер склада"
    );

    const warehouse =
      await WarehouseRepository.findById(
        numericWarehouseId
      );

    if (!warehouse) {
      throw new Error("Склад не найден");
    }

    return warehouse;
  },

  async updateWarehouse(
    warehouseId,
    {
      organizationId,
      supplierId,
      name,
      city,
      type,
      deliveryDays,
      pickupAvailable,
      shippingAvailable,
      priority,
      pricingModel,
      retailMarkupPercent,
      minimumMarkupPercent,
    }
  ) {
    const numericWarehouseId = validateId(
      warehouseId,
      "Некорректный номер склада"
    );

    const currentWarehouse =
      await WarehouseRepository.findById(
        numericWarehouseId
      );

    if (!currentWarehouse) {
      throw new Error("Склад не найден");
    }

    const nextType =
      type === undefined
        ? currentWarehouse.type
        : type;

    const nextSupplierId =
      supplierId === undefined
        ? currentWarehouse.supplier_id
        : supplierId;

    const source =
      await resolveWarehouseSource(
        nextType,
        nextSupplierId
      );

    const nextPricingModel = pricingModel === undefined
      ? currentWarehouse.pricing_model : normalizePricingModel(pricingModel);
    const nextRetailMarkup = retailMarkupPercent === undefined
      ? Number(currentWarehouse.retail_markup_percent) : normalizeMarkup(retailMarkupPercent, "Розничная наценка");
    const nextMinimumMarkup = minimumMarkupPercent === undefined
      ? Number(currentWarehouse.minimum_markup_percent) : normalizeMarkup(minimumMarkupPercent, "Минимальная наценка");
    if (nextRetailMarkup < nextMinimumMarkup && nextPricingModel === "SUPPLIER_MARKUP") {
      throw new Error("Розничная наценка не может быть меньше минимальной");
    }

    let normalizedOrganizationId;

    if (organizationId !== undefined) {
      normalizedOrganizationId =
        organizationId === null
          ? null
          : validateId(
              organizationId,
              "Некорректный номер организации"
            );
    }

    const updatedWarehouse =
      await WarehouseRepository.update(
        numericWarehouseId,
        {
          organizationId:
            normalizedOrganizationId,
          supplierId:
            source.supplierId,

          name:
            name === undefined
              ? undefined
              : normalizeName(name),

          city:
            normalizeCity(city),

          type:
            source.type,
          deliveryDays:
            deliveryDays === undefined
              ? undefined
              : normalizeDeliveryDays(
                  deliveryDays
                ),
          pickupAvailable:
            pickupAvailable === undefined
              ? undefined
              : Boolean(pickupAvailable),
          shippingAvailable:
            shippingAvailable === undefined
              ? undefined
              : Boolean(shippingAvailable),

          priority:
            normalizePriority(priority),
          pricingModel: nextPricingModel,
          retailMarkupPercent: nextRetailMarkup,
          minimumMarkupPercent: nextMinimumMarkup,
        }
      );

    return updatedWarehouse;
  },

  async setWarehouseActive(
    warehouseId,
    isActive
  ) {
    const numericWarehouseId = validateId(
      warehouseId,
      "Некорректный номер склада"
    );

    const warehouse =
      await WarehouseRepository.findById(
        numericWarehouseId
      );

    if (!warehouse) {
      throw new Error("Склад не найден");
    }

    return WarehouseRepository.setActive(
      numericWarehouseId,
      Boolean(isActive)
    );
  },
};
