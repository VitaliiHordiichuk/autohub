import { transaction } from "../../db/transaction.js";
import { CartRepository } from "../../repositories/CartRepository.js";
import { CartAccessRepository } from "../../repositories/CartAccessRepository.js";
import { CheckoutRepository } from "../../repositories/CheckoutRepository.js";
import { CustomerRepository } from "../../repositories/CustomerRepository.js";
import { NotificationRepository } from "../../repositories/NotificationRepository.js";
import { OrderDeliveryRepository } from "../../repositories/OrderDeliveryRepository.js";
import { OrderRepository } from "../../repositories/OrderRepository.js";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { ReservationRepository } from "../../repositories/ReservationRepository.js";
import { StockMovementRepository } from "../../repositories/StockMovementRepository.js";
import { UserDeliveryProfileRepository } from "../../repositories/UserDeliveryProfileRepository.js";
import { CartAccessService } from "../../services/CartAccessService.js";
import { CustomerPricingService } from "../../services/CustomerPricingService.js";
import {
  deliveryInputFromProfileRow,
  normalizeOrderDelivery,
} from "../../services/OrderDeliveryService.js";
import {
  FULFILLMENT_TYPE,
  resolveFulfillmentType,
} from "../../services/InventoryClassificationService.js";
import { ReturnPolicyService } from "../../services/ReturnPolicyService.js";
import { TelegramNotificationService } from "../../services/TelegramNotificationService.js";

function conflict(code, issues, message = "Умови оформлення змінилися") {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  error.details = { issues, atomicRollback: true };
  return error;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    const error = new Error("Некоректний ключ оформлення");
    error.statusCode = 400;
    error.code = "INVALID_IDEMPOTENCY_KEY";
    throw error;
  }
  return key;
}

function acceptedPriceMap(value) {
  const result = new Map();
  if (!Array.isArray(value)) return result;
  for (const row of value) {
    const offerId = Number(row?.productOfferId);
    const price = Number(row?.price);
    if (Number.isInteger(offerId) && offerId > 0 && Number.isFinite(price)) {
      result.set(offerId, Number(price.toFixed(2)));
    }
  }
  return result;
}

function sameMoney(left, right) {
  return Number(Number(left).toFixed(2)) === Number(Number(right).toFixed(2));
}

function calculateTotal(items) {
  return Number(items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.currentPrice),
    0
  ).toFixed(2));
}

function buildOrderComment({ comment, vinCheckRequested, vin }) {
  const customerComment = String(comment || "").trim();
  if (!vinCheckRequested) return customerComment || null;
  const normalizedVin = String(vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin)) {
    throw new Error("VIN має містити 17 символів без I, O та Q");
  }
  const notice = [
    "⚠️ ПЕРЕВІРИТИ ЗА VIN ДО ПІДТВЕРДЖЕННЯ",
    `VIN: ${normalizedVin}`,
    "Клієнт просить перевірити сумісність усіх позицій замовлення.",
  ].join("\n");
  return customerComment ? `${notice}\n\n${customerComment}` : notice;
}

async function resolveDelivery({ delivery, userId, db }) {
  if (delivery) return normalizeOrderDelivery(delivery);
  if (!userId) throw new Error("Гостю потрібно вказати дані отримання");
  const profile = await UserDeliveryProfileRepository.findByUserId(userId, db);
  if (!profile) throw new Error("Профіль доставки не знайдено");
  return normalizeOrderDelivery(deliveryInputFromProfileRow(profile));
}

async function replayResult(checkout, db) {
  const orders = await CheckoutRepository.findLinkedOrders(checkout.id, db);
  const orderItems = [];
  for (const order of orders) {
    const items = await OrderRepository.findItemsByOrderId(order.id, db);
    orderItems.push(...items);
  }
  const deliveries = await OrderDeliveryRepository.findByOrderIds(
    orders.map((order) => Number(order.id)), db
  );
  const remainingItems = await CartRepository.getItems(checkout.cart_id, db);
  return {
    order: orders[0] ?? null,
    orders,
    orderItems,
    delivery: deliveries[0] ?? null,
    deliveries,
    remainingItemsCount: remainingItems.length,
    idempotentReplay: true,
  };
}

export const CommitOnSubmitOrder = {
  async execute({
    checkoutId,
    idempotencyKey,
    acceptedPrices = [],
    userId = null,
    guestToken = null,
    comment = null,
    vinCheckRequested = false,
    vin = null,
    delivery = null,
    saveDeliveryProfile = false,
    trustedTelegramCustomerUserId = null, // Server-side verified Telegram identity only.
  }) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const accepted = acceptedPriceMap(acceptedPrices);
    const orderComment = buildOrderComment({ comment, vinCheckRequested, vin });
    const normalizedVin = vinCheckRequested
      ? String(vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      : null;

    const result = await transaction(async (db) => {
      const checkout = await CheckoutRepository.findByIdForUpdate(checkoutId, db);
      if (!checkout || checkout.inventory_model !== "COMMIT_ON_SUBMIT") {
        const error = new Error("Сесію оформлення не знайдено");
        error.statusCode = 404;
        throw error;
      }

      await CartAccessService.assertAnyStatusAccess({
        cartId: checkout.cart_id,
        userId,
        guestToken,
        db,
      });

      if (checkout.status === "COMPLETED") {
        if (checkout.idempotency_key !== key) {
          throw conflict("CHECKOUT_ALREADY_SUBMITTED", [], "Оформлення вже завершено");
        }
        return replayResult(checkout, db);
      }
      if (checkout.status !== "ACTIVE") {
        throw conflict("CHECKOUT_CHANGED", [], "Оформлення більше не активне");
      }

      const bound = await CheckoutRepository.bindIdempotencyKey(checkout.id, key, db);
      if (!bound) {
        throw conflict("IDEMPOTENCY_CONFLICT", [], "Оформлення вже виконується");
      }

      const lockedCart = await CartAccessRepository.lockActiveByIdForUpdate(
        checkout.cart_id, db
      );
      if (!lockedCart) {
        throw conflict("CHECKOUT_CHANGED", [], "Кошик більше не активний");
      }

      const sessionItems = await CheckoutRepository.findSessionItemsForUpdate(
        checkout.id, db
      );
      if (!sessionItems.length) throw new Error("В оформленні немає вибраних товарів");

      const cartItems = await CartRepository.getItems(checkout.cart_id, db);
      const cartById = new Map(cartItems.map((item) => [Number(item.id), item]));
      for (const item of sessionItems) {
        const cartItem = cartById.get(Number(item.cart_item_id));
        if (!cartItem ||
            Number(cartItem.product_offer_id) !== Number(item.product_offer_id) ||
            Number(cartItem.quantity) !== Number(item.quantity)) {
          throw conflict("CHECKOUT_CHANGED", [], "Склад кошика змінився");
        }
      }

      const pricingContext = await CustomerPricingService.getContext(trustedTelegramCustomerUserId ?? userId, db);
      const validated = [];
      const issues = [];

      for (const item of [...sessionItems].sort(
        (a, b) => Number(a.product_offer_id) - Number(b.product_offer_id)
      )) {
        const offer = await ProductRepository.findOfferForCheckoutForUpdate(
          item.product_offer_id, db
        );
        const base = {
          cartItemId: Number(item.cart_item_id),
          productOfferId: Number(item.product_offer_id),
          productName: item.product_name_snapshot,
          article: item.article_snapshot,
          requestedQuantity: Number(item.quantity),
        };

        if (!offer) {
          issues.push({ ...base, code: "STOCK_CHANGED", availableQuantity: 0 });
          continue;
        }

        const currentFulfillment = resolveFulfillmentType(offer);
        if (currentFulfillment !== item.fulfillment_type) {
          issues.push({ ...base, code: "FULFILLMENT_CHANGED" });
          continue;
        }

        const pricing = CustomerPricingService.price({
          retailPrice: offer.effective_retail_price,
          minimumSalePrice: offer.minimum_sale_price,
        }, pricingContext);
        const currentPrice = Number(pricing?.customerPrice);
        const oldPrice = Number(item.price_snapshot);
        const acceptedPrice = accepted.get(Number(item.product_offer_id));
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
          issues.push({ ...base, code: "PRICE_UNAVAILABLE" });
          continue;
        }
        if (!sameMoney(currentPrice, oldPrice) && !sameMoney(currentPrice, acceptedPrice)) {
          issues.push({ ...base, code: "PRICE_CHANGED", oldPrice, newPrice: currentPrice });
          continue;
        }

        const generallyAvailable = offer.is_available === true &&
          offer.is_hidden !== true && offer.warehouse_active !== false &&
          offer.supplier_active !== false;
        // Existing order-linked rows still protect historical orders. Supplier
        // orders committed since the latest price import use the same ledger.
        const committedQuantity = await ReservationRepository.getReservedQuantity(
          item.product_offer_id, null, db
        );
        const availableQuantity = Math.max(0, Number(offer.quantity) - committedQuantity);
        if (!generallyAvailable || Number(item.quantity) > availableQuantity) {
          issues.push({
            ...base,
            code: currentFulfillment === FULFILLMENT_TYPE.STOCK
              ? "STOCK_CHANGED" : "SUPPLIER_UNAVAILABLE",
            availableQuantity,
          });
          continue;
        }

        validated.push({
          ...base,
          quantity: Number(item.quantity),
          currentPrice,
          fulfillmentType: currentFulfillment,
          offer,
        });
      }

      if (issues.length) {
        const fulfillmentCount = new Set(
          sessionItems.map((item) => item.fulfillment_type)
        ).size;
        const code = fulfillmentCount > 1
          ? "MIXED_CHECKOUT_FAILED"
          : issues[0].code;
        throw conflict(code, issues);
      }

      let customer = null;
      const effectiveCustomerUserId = trustedTelegramCustomerUserId ?? userId;
      if (effectiveCustomerUserId) customer = await CustomerRepository.findActiveByUserId(effectiveCustomerUserId, db);
      const customerUserId = customer ? effectiveCustomerUserId : null;
      const normalizedDelivery = await resolveDelivery({ delivery, userId, db });

      const groups = new Map();
      for (const item of validated) {
        const rows = groups.get(item.fulfillmentType) || [];
        rows.push(item);
        groups.set(item.fulfillmentType, rows);
      }

      const orders = [];
      const orderItems = [];
      const deliveries = [];
      for (const fulfillmentType of [
        FULFILLMENT_TYPE.STOCK,
        FULFILLMENT_TYPE.SUPPLIER_ORDER,
      ]) {
        const items = groups.get(fulfillmentType);
        if (!items?.length) continue;
        const totalAmount = calculateTotal(items);
        const order = await OrderRepository.createOrder({
          customerId: customer?.id ?? null,
          createdBy: customerUserId,
          comment: orderComment,
          totalAmount,
          inventoryModel: "COMMIT_ON_SUBMIT",
          fulfillmentType,
          checkoutSessionId: checkout.id,
        }, db);

        for (const item of items) {
          let orderItem = await OrderRepository.addOrderItem({
            orderId: order.id,
            productId: item.offer.product_id,
            productOfferId: item.productOfferId,
            quantity: item.quantity,
            priceAtPurchase: item.currentPrice,
            isReturnable: ReturnPolicyService.isReturnable(
              ReturnPolicyService.resolveRow(item.offer)
            ),
            fulfillmentType,
            inventoryCommittedQuantity: 0,
          }, db);

          if (fulfillmentType === FULFILLMENT_TYPE.STOCK) {
            const updatedOffer = await ProductRepository.decreaseQuantityForSale(
              item.productOfferId, item.quantity, db
            );
            if (!updatedOffer) {
              throw conflict("STOCK_CHANGED", [{
                cartItemId: item.cartItemId,
                productOfferId: item.productOfferId,
                productName: item.productName,
                article: item.article,
                requestedQuantity: item.quantity,
                code: "STOCK_CHANGED",
                availableQuantity: 0,
              }]);
            }
            await StockMovementRepository.createInventoryMovement({
              productId: item.offer.product_id,
              productOfferId: item.productOfferId,
              orderId: order.id,
              orderItemId: orderItem.id,
              quantity: item.quantity,
              type: "ORDER_COMMIT",
              oldQuantity: Number(updatedOffer.old_quantity),
              newQuantity: Number(updatedOffer.new_quantity),
              operationKey: `order-item:${orderItem.id}:commit`,
              comment: `Списання під час оформлення замовлення №${order.id}`,
            }, db);
            orderItem = await OrderRepository.updateCommittedQuantity(
              orderItem.id, item.quantity, db
            );
          } else {
            // A supplier offer is an external snapshot. Keep this order-linked
            // deduction across imports until completion or cancellation, without
            // changing the supplier's reported physical quantity.
            await ReservationRepository.createOrderReservation({
              orderId: order.id,
              productId: item.offer.product_id,
              productOfferId: item.productOfferId,
              quantity: item.quantity,
            }, db);
          }
          orderItems.push(orderItem);
        }

        const orderDelivery = await OrderDeliveryRepository.create({
          orderId: order.id,
          delivery: normalizedDelivery,
        }, db);
        deliveries.push(orderDelivery);
        await CheckoutRepository.linkOrder(checkout.id, order.id, fulfillmentType, db);
        await OrderRepository.addStatusHistory({
          orderId: order.id,
          oldStatus: null,
          newStatus: "NEW",
          changedBy: customerUserId,
          comment: fulfillmentType === FULFILLMENT_TYPE.STOCK
            ? "Клієнт оформив замовлення зі складу"
            : "Клієнт оформив окреме замовлення постачальнику",
        }, db);
        await NotificationRepository.createForStaff({
          eventKey: `order:${order.id}:new`,
          type: "NEW_ORDER",
          orderId: order.id,
          payload: {
            orderId: Number(order.id),
            totalAmount,
            fulfillmentType,
            vinCheckRequested: Boolean(vinCheckRequested),
            vin: normalizedVin,
          },
        }, db);
        orders.push(order);
      }

      if (customerUserId && saveDeliveryProfile && delivery) {
        await UserDeliveryProfileRepository.upsert({
          userId: customerUserId,
          ...normalizedDelivery,
        }, db);
      }

      const selectedIds = sessionItems.map((item) => Number(item.cart_item_id));
      await CartRepository.deleteItems(checkout.cart_id, selectedIds, db);
      const completed = await CheckoutRepository.markCommitCompleted(checkout.id, db);
      if (!completed) throw new Error("Не вдалося завершити оформлення");
      if (cartItems.length === selectedIds.length) {
        await CartRepository.closeCart(checkout.cart_id, db);
      }

      return {
        order: orders[0],
        orders,
        orderItems,
        delivery: deliveries[0],
        deliveries,
        remainingItemsCount: cartItems.length - selectedIds.length,
        idempotentReplay: false,
      };
    });

    if (!result.idempotentReplay) {
      for (const order of result.orders) {
        const deliveryRow = result.deliveries.find(
          (entry) => Number(entry.orderId) === Number(order.id)
        );
        const itemsCount = result.orderItems.filter(
          (item) => Number(item.order_id) === Number(order.id)
        ).length;
        void TelegramNotificationService.sendNewOrder({
          orderId: order.id,
          customerName: deliveryRow
            ? [deliveryRow.recipientFirstName, deliveryRow.recipientMiddleName,
              deliveryRow.recipientLastName].filter(Boolean).join(" ")
            : "",
          totalAmount: order.total_amount,
          itemsCount,
          vinCheckRequested: Boolean(vinCheckRequested),
          vin: normalizedVin,
        }).catch((error) => {
          console.error("Ошибка отправки нового заказа в Telegram:", error.message);
        });
      }
    }
    return result;
  },
};
