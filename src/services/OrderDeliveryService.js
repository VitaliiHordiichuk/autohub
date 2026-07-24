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
      `Значение не должно быть длиннее ${maxLength} символов`
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
      "Некорректный email получателя"
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
      `${fieldName} должно быть положительным числом`
    );
  }

  return number;
}

export function normalizeOrderDelivery(input) {
  if (!input || typeof input !== "object") {
    throw createError(
      "Данные получения заказа обязательны"
    );
  }

  const deliveryMethod =
    String(input.deliveryMethod ?? "")
      .trim()
      .toUpperCase();

  if (!DELIVERY_METHODS.has(deliveryMethod)) {
    throw createError(
      "Некорректный способ получения"
    );
  }

  const delivery = {
    recipientFirstName: requiredText(
      input.recipientFirstName,
      "Имя получателя",
      100
    ),
    recipientLastName: optionalText(
      input.recipientLastName,
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
      "Идентификатор города Новой почты",
      100
    );

  delivery.novaPoshtaCityName =
    requiredText(
      novaPoshta.cityName,
      "Город Новой почты",
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
        "Нужно выбрать отделение или почтомат"
      );
    }

    delivery.novaPoshtaPointType =
      pointType;

    delivery.novaPoshtaPointRef =
      requiredText(
        novaPoshta.pointRef,
        "Идентификатор отделения или почтомата",
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
        "Название отделения или почтомата",
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
      "Улица",
      200
    );

  delivery.novaPoshtaBuilding =
    requiredText(
      novaPoshta.building,
      "Дом",
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
