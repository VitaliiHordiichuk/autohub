import { transaction } from "../db/transaction.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { OrderReturnRepository } from "../repositories/OrderReturnRepository.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { StockMovementRepository } from "../repositories/StockMovementRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";

function positiveQuantity(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error("Количество возврата должно быть целым числом больше нуля");
  return number;
}

export const OrderReturnService = {
  async create({orderId,items,reason,createdBy}) {
    const numericOrderId = Number(orderId);
    const cleanReason = String(reason || "").trim();
    if (!cleanReason) throw new Error("Укажите причину возврата");
    if (!Array.isArray(items) || !items.length) throw new Error("Выберите хотя бы одну позицию");
    return transaction(async (db)=>{
      const order = await OrderRepository.findByIdForUpdate(numericOrderId,db);
      if (!order) throw new Error("Заказ не найден");
      if (order.status !== "COMPLETED") throw new Error("Возврат можно создать только для завершённого заказа");
      const orderItems = await OrderRepository.findItemsByOrderId(numericOrderId,db);
      const byId = new Map(orderItems.map((item)=>[Number(item.id),item]));
      const normalized = [];
      for (const input of items) {
        const orderItemId = Number(input.orderItemId);
        const quantity = positiveQuantity(input.quantity);
        const item = byId.get(orderItemId);
        if (!item) throw new Error("Позиция не принадлежит этому заказу");
        if (item.is_returnable === false) {
          throw new Error(`${item.article}: эта позиция возврату не подлежит`);
        }
        const alreadyReturned = await OrderReturnRepository.returnedQuantity(orderItemId,db);
        if (quantity + alreadyReturned > Number(item.quantity)) {
          throw new Error(`Для ${item.article} можно вернуть не больше ${Number(item.quantity)-alreadyReturned}`);
        }
        normalized.push({orderItemId,quantity,unitPrice:Number(item.price_at_purchase)});
      }
      const created = await OrderReturnRepository.create({orderId:numericOrderId,reason:cleanReason,createdBy,items:normalized},db);
      return {return:created,returns:await OrderReturnRepository.listByOrder(numericOrderId,db)};
    });
  },

  async confirm({orderId,returnId,confirmedBy}) {
    const numericOrderId=Number(orderId);
    const numericReturnId=Number(returnId);
    let customerUserId=null;
    const result=await transaction(async(db)=>{
      const order=await OrderRepository.findByIdForUpdate(numericOrderId,db);
      if(!order||order.status!=="COMPLETED") throw new Error("Завершённый заказ не найден");
      const record=await OrderReturnRepository.findForUpdate(numericReturnId,db);
      if(!record||Number(record.order_id)!==numericOrderId) throw new Error("Возврат не найден");
      if(record.status!=="PENDING") throw new Error("Возврат уже обработан");
      const items=await OrderReturnRepository.items(numericReturnId,db);
      for(const item of items){
        const offer=await ProductRepository.increaseQuantityForReturn(item.product_offer_id,Number(item.quantity),db);
        if(!offer) throw new Error(`Не удалось вернуть ${item.article} на склад`);
        await StockMovementRepository.createReturnMovement({productId:item.product_id,productOfferId:item.product_offer_id,
          orderId:numericOrderId,orderItemId:item.order_item_id,quantity:Number(item.quantity),oldQuantity:Number(offer.old_quantity),
          newQuantity:Number(offer.new_quantity),changedBy:confirmedBy,comment:`Возврат по заказу №${numericOrderId}: ${record.reason}`},db);
      }
      const completed=await OrderReturnRepository.complete(numericReturnId,confirmedBy,db);
      customerUserId=Number(order.created_by||0)||null;
      if(customerUserId) await NotificationRepository.createForUser({userId:customerUserId,eventKey:`order:${numericOrderId}:return:${numericReturnId}:completed`,
        type:"ORDER_RETURN_COMPLETED",orderId:numericOrderId,payload:{orderId:numericOrderId,returnId:numericReturnId}},db);
      return {return:completed,items,returns:await OrderReturnRepository.listByOrder(numericOrderId,db)};
    });
    if(customerUserId) void TelegramNotificationService.sendReturnCompletedToUser({userId:customerUserId,orderId:numericOrderId,items:result.items})
      .catch((error)=>console.error("Ошибка Telegram-уведомления о возврате:",error.message));
    return result;
  },
};
