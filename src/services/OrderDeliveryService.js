import { parsePhoneNumberFromString } from "libphonenumber-js/max";

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
  const normalized =
    String(value ?? "").trim();

  if (
    maxLength !== null &&
    normalized.length > maxLength
  ) {
    throw createError(
      `Значення не повинно бути довшим за ${maxLength} символів`
    );
  }

  return normalized || null;
}

function requiredText(
  value,
  fieldName,
  maxLength = null
) {
  const normalized =
    optionalText(value, maxLength);

  if (!normalized) {
    throw createError(`${fieldName} є обов’язковим`);
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
      "Введіть коректний номер телефону"
    );
  }

  return phoneNumber.number;
}

function normalizeEmail(value) {
  const normalized =
    optionalText(value, 150);

  if (!normalized) {
    return null;
  }

  const email = normalized.toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw createError(
      "Некоректний email отримувача"
    );
  }

  return email;
}

function normalizePositiveId(
  value,
  fieldName
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw createError(
      `${fieldName} має бути додатним числом`
    );
  }

  return number;
}

export function normalizeOrderDelivery(input) {
  if (!input || typeof input !== "object") {
    throw createError(
      "Дані отримання замовлення є обов’язковими"
    );
  }

  const deliveryMethod =
    String(input.deliveryMethod ?? "")
      .trim()
      .toUpperCase();

  if (!DELIVERY_METHODS.has(deliveryMethod)) {
    throw createError(
      "Некоректний спосіб отримання"
    );
  }

  const delivery = {
    recipientFirstName: requiredText(
      input.recipientFirstName,
      "Ім’я отримувача",
      100
    ),
    recipientLastName: requiredText(
      input.recipientLastName,
      "Прізвище отримувача",
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
    delivery.pickupWarehouseId =
      normalizePositiveId(
        input.pickupWarehouseId,
        "pickupWarehouseId"
      );

    return delivery;
  }

  const novaPoshta = input.novaPoshta ?? {};

  delivery.novaPoshtaCityRef =
    requiredText(
      novaPoshta.cityRef,
      "Ідентифікатор міста Нової пошти",
      100
    );

  delivery.novaPoshtaCityName =
    requiredText(
      novaPoshta.cityName,
      "Місто Нової пошти",
      200
    );

  if (
    deliveryMethod === "NOVA_POSHTA_POINT"
  ) {
    const pointType =
      String(novaPoshta.pointType ?? "")
        .trim()
        .toUpperCase();

    if (!POINT_TYPES.has(pointType)) {
      throw createError(
        "Потрібно вибрати відділення або поштомат"
      );
    }

    delivery.novaPoshtaPointType =
      pointType;

    delivery.novaPoshtaPointRef =
      requiredText(
        novaPoshta.pointRef,
        "Ідентифікатор відділення або поштомата",
        100
      );

    delivery.novaPoshtaPointNumber =
      optionalText(
        novaPoshta.pointNumber,
        50
      );

    delivery.novaPoshtaPointName =
      requiredText(
        novaPoshta.pointName,
        "Назва відділення або поштомата",
        255
      );

    delivery.novaPoshtaPointAddress =
      optionalText(
        novaPoshta.pointAddress
      );

    return delivery;
  }

  delivery.novaPoshtaStreetRef =
    optionalText(
      novaPoshta.streetRef,
      100
    );

  delivery.novaPoshtaStreetName =
    requiredText(
      novaPoshta.streetName,
      "Вулиця",
      200
    );

  delivery.novaPoshtaBuilding =
    requiredText(
      novaPoshta.building,
      "Будинок",
      50
    );

  delivery.novaPoshtaApartment =
    optionalText(
      novaPoshta.apartment,
      50
    );

  delivery.courierComment =
    optionalText(
      novaPoshta.courierComment
    );

  return delivery;
}

export function deliveryInputFromProfileRow(
  row
) {
  if (!row) {
    return null;
  }

  return {
    recipientFirstName:
      row.recipient_first_name,
    recipientLastName:
      row.recipient_last_name,
    recipientMiddleName:
      row.recipient_middle_name,
    recipientPhone:
      row.recipient_phone,
    recipientEmail:
      row.recipient_email,
    deliveryMethod:
      row.delivery_method,
    pickupWarehouseId:
      row.pickup_warehouse_id,
    novaPoshta: {
      cityRef:
        row.nova_poshta_city_ref,
      cityName:
        row.nova_poshta_city_name,
      pointType:
        row.nova_poshta_point_type,
      pointRef:
        row.nova_poshta_point_ref,
      pointNumber:
        row.nova_poshta_point_number,
      pointName:
        row.nova_poshta_point_name,
      pointAddress:
        row.nova_poshta_point_address,
      streetRef:
        row.nova_poshta_street_ref,
      streetName:
        row.nova_poshta_street_name,
      building:
        row.nova_poshta_building,
      apartment:
        row.nova_poshta_apartment,
      courierComment:
        row.courier_comment,
    },
  };
}
