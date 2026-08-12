import { parsePhoneNumberFromString } from "libphonenumber-js/max";

import {
  UserDeliveryProfileRepository,
} from "../repositories/UserDeliveryProfileRepository.js";

const DELIVERY_METHODS = new Set([
  "PICKUP",
  "NOVA_POSHTA_POINT",
  "NOVA_POSHTA_COURIER",
]);

const POINT_TYPES = new Set([
  "BRANCH",
  "LOCKER",
]);

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function optionalText(value, maxLength = null) {
  const normalized = String(value ?? "").trim();

  if (maxLength && normalized.length > maxLength) {
    throw createError(
      `Значение не должно быть длиннее ${maxLength} символов`
    );
  }

  return normalized || null;
}

function requiredText(value, fieldName, maxLength = null) {
  const normalized = optionalText(value, maxLength);

  if (!normalized) {
    throw createError(`${fieldName} обязательно`);
  }

  return normalized;
}

function normalizePhone(value) {
  const raw =
    String(value ?? "").trim();

  const phoneNumber =
    parsePhoneNumberFromString(
      raw,
      "UA"
    );

  if (
    !phoneNumber ||
    !phoneNumber.isValid()
  ) {
    throw createError(
      "Введите корректный номер телефона"
    );
  }

  return phoneNumber.number;
}

function normalizeEmail(value) {
  const normalized = optionalText(value, 150);

  if (!normalized) {
    return null;
  }

  const email = normalized.toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError("Некорректный email получателя");
  }

  return email;
}

function normalizeId(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw createError(
      `${fieldName} должно быть положительным числом`
    );
  }

  return number;
}

function mapProfile(row) {
  return {
    userId: Number(row.user_id),
    recipientFirstName:
      row.recipient_first_name ??
      row.account_first_name ??
      "",
    recipientLastName:
      row.recipient_last_name ??
      row.account_last_name ??
      "",
    recipientMiddleName:
      row.recipient_middle_name ?? "",
    recipientPhone:
      row.recipient_phone ??
      row.account_phone ??
      "",
    recipientEmail:
      row.recipient_email ??
      row.account_email ??
      "",
    deliveryMethod:
      row.delivery_method ?? "PICKUP",
    pickupWarehouseId:
      row.pickup_warehouse_id === null ||
      row.pickup_warehouse_id === undefined
        ? null
        : Number(row.pickup_warehouse_id),
    novaPoshta: {
      cityRef: row.nova_poshta_city_ref ?? null,
      cityName: row.nova_poshta_city_name ?? null,
      pointType: row.nova_poshta_point_type ?? null,
      pointRef: row.nova_poshta_point_ref ?? null,
      pointNumber: row.nova_poshta_point_number ?? null,
      pointName: row.nova_poshta_point_name ?? null,
      pointAddress: row.nova_poshta_point_address ?? null,
      streetRef: row.nova_poshta_street_ref ?? null,
      streetName: row.nova_poshta_street_name ?? null,
      building: row.nova_poshta_building ?? null,
      apartment: row.nova_poshta_apartment ?? null,
      courierComment: row.courier_comment ?? null,
    },
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function normalizeInput(input) {
  const deliveryMethod = String(
    input.deliveryMethod ?? ""
  )
    .trim()
    .toUpperCase();

  if (!DELIVERY_METHODS.has(deliveryMethod)) {
    throw createError("Некорректный способ получения");
  }

  const normalized = {
    recipientFirstName: requiredText(
      input.recipientFirstName,
      "Имя получателя",
      100
    ),
    recipientLastName: requiredText(
      input.recipientLastName,
      "Фамилия получателя",
      100
    ),
    recipientMiddleName: optionalText(
      input.recipientMiddleName,
      100
    ),
    recipientPhone: normalizePhone(
      input.recipientPhone
    ),
    recipientEmail: normalizeEmail(
      input.recipientEmail
    ),
    deliveryMethod,
    pickupWarehouseId: null,
    novaPoshtaCityRef: null,
    novaPoshtaCityName: null,
    novaPoshtaPointType: null,
    novaPoshtaPointRef: null,
    novaPoshtaPointNumber: null,
    novaPoshtaPointName: null,
    novaPoshtaPointAddress: null,
    novaPoshtaStreetRef: null,
    novaPoshtaStreetName: null,
    novaPoshtaBuilding: null,
    novaPoshtaApartment: null,
    courierComment: null,
  };

  if (deliveryMethod === "PICKUP") {
    normalized.pickupWarehouseId = normalizeId(
      input.pickupWarehouseId,
      "pickupWarehouseId"
    );

    return normalized;
  }

  const novaPoshta = input.novaPoshta ?? {};

  normalized.novaPoshtaCityRef = requiredText(
    novaPoshta.cityRef,
    "Идентификатор города Новой почты",
    100
  );

  normalized.novaPoshtaCityName = requiredText(
    novaPoshta.cityName,
    "Город Новой почты",
    200
  );

  if (deliveryMethod === "NOVA_POSHTA_POINT") {
    const pointType = String(
      novaPoshta.pointType ?? ""
    )
      .trim()
      .toUpperCase();

    if (!POINT_TYPES.has(pointType)) {
      throw createError(
        "Нужно выбрать отделение или почтомат"
      );
    }

    normalized.novaPoshtaPointType = pointType;
    normalized.novaPoshtaPointRef = requiredText(
      novaPoshta.pointRef,
      "Идентификатор отделения или почтомата",
      100
    );
    normalized.novaPoshtaPointNumber = optionalText(
      novaPoshta.pointNumber,
      50
    );
    normalized.novaPoshtaPointName = requiredText(
      novaPoshta.pointName,
      "Название отделения или почтомата",
      255
    );
    normalized.novaPoshtaPointAddress = optionalText(
      novaPoshta.pointAddress
    );

    return normalized;
  }

  normalized.novaPoshtaStreetRef = optionalText(
    novaPoshta.streetRef,
    100
  );
  normalized.novaPoshtaStreetName = requiredText(
    novaPoshta.streetName,
    "Улица",
    200
  );
  normalized.novaPoshtaBuilding = requiredText(
    novaPoshta.building,
    "Дом",
    50
  );
  normalized.novaPoshtaApartment = optionalText(
    novaPoshta.apartment,
    50
  );
  normalized.courierComment = optionalText(
    novaPoshta.courierComment
  );

  return normalized;
}

export const DeliveryProfileService = {
  async getByUserId(userId) {
    const row =
      await UserDeliveryProfileRepository.findByUserId(
        userId
      );

    if (!row) {
      throw createError("Пользователь не найден", 404);
    }

    return mapProfile(row);
  },

  async save(userId, input) {
    const data = normalizeInput(input);

    try {
      await UserDeliveryProfileRepository.upsert({
        userId,
        ...data,
      });
    } catch (error) {
      if (error.code === "23503") {
        throw createError(
          "Указанная точка самовывоза не существует"
        );
      }

      throw error;
    }

    return this.getByUserId(userId);
  },
};
