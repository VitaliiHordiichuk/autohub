import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../config/db.js';
import { SubmitOrder } from '../use-cases/checkout/SubmitOrder.js';
import { CartRepository } from '../repositories/CartRepository.js';
import { CartAccessRepository } from '../repositories/CartAccessRepository.js';
import { CheckoutRepository } from '../repositories/CheckoutRepository.js';
import { CustomerRepository } from '../repositories/CustomerRepository.js';
import { OrderRepository } from '../repositories/OrderRepository.js';
import { OrderDeliveryRepository } from '../repositories/OrderDeliveryRepository.js';
import { ReservationRepository } from '../repositories/ReservationRepository.js';
import { ProductRepository } from '../repositories/ProductRepository.js';
import { StockMovementRepository } from '../repositories/StockMovementRepository.js';
import { NotificationRepository } from '../repositories/NotificationRepository.js';
import { CartAccessService } from './CartAccessService.js';
import { CustomerPricingService } from './CustomerPricingService.js';
import { TelegramNotificationService } from './TelegramNotificationService.js';
import { OrderEmailNotificationService } from './OrderEmailNotificationService.js';

const key='test-created-order-00000001';
const delivery={recipientFirstName:'Тест',recipientLastName:'Клієнт',recipientPhone:'+380501234567',recipientEmail:'order@example.invalid',deliveryMethod:'PICKUP',pickupWarehouseId:null};
function fixture(t,{legacy=false,mixed=false,failCommit=false,stock=10,mailFailure=false}={}){
 const events=[],sent=[],telegrams=[],orders=[],items=[],deliveries=[];
 const checkout={id:50,cart_id:60,status:'ACTIVE',inventory_model:legacy?'LEGACY_RESERVATION':'COMMIT_ON_SUBMIT',idempotency_key:null};
 let cartItems=[{id:1,product_offer_id:11,product_id:101,quantity:1,retail_price:100,name:'Test one',article:'TEST1'}];
 if(mixed)cartItems.push({id:2,product_offer_id:12,product_id:102,quantity:1,retail_price:100,name:'Test two',article:'TEST2'});
 const sessionItems=cartItems.map((i,n)=>({cart_item_id:i.id,product_offer_id:i.product_offer_id,quantity:1,price_snapshot:100,fulfillment_type:n?'SUPPLIER_ORDER':'STOCK',product_name_snapshot:i.name,article_snapshot:i.article}));
 const mock=(object,name,fn=async()=>({}))=>t.mock.method(object,name,fn);
 mock(pool,'connect',async()=>({query:async sql=>{events.push(sql);if(sql==='COMMIT'&&failCommit)throw Error('Commit failed');return {rows:[]}},release(){events.push('RELEASE')}}));
 mock(CheckoutRepository,'findById',async()=>checkout);
 mock(CheckoutRepository,'findByIdForUpdate',async()=>checkout);
 mock(CheckoutRepository,'findActiveById',async()=>checkout.status==='ACTIVE'?checkout:null);
 mock(CheckoutRepository,'bindIdempotencyKey',async(id,value)=>{checkout.idempotency_key=value;return checkout});
 mock(CheckoutRepository,'findSessionItemsForUpdate',async()=>sessionItems);
 mock(CheckoutRepository,'markCommitCompleted',async()=>{checkout.status='COMPLETED';return checkout});
 mock(CheckoutRepository,'markCompleted',async()=>{checkout.status='COMPLETED';return checkout});
 mock(CheckoutRepository,'linkOrder');mock(CheckoutRepository,'findLinkedOrders',async()=>orders);
 mock(CartAccessService,'assertAnyStatusAccess',async()=>({id:60}));mock(CartAccessService,'assertAccess',async()=>({id:60}));
 mock(CartAccessRepository,'lockActiveByIdForUpdate',async()=>({id:60}));mock(CartRepository,'getItems',async()=>cartItems);
 mock(CartRepository,'deleteItems',async(id,ids)=>{cartItems=cartItems.filter(i=>!ids.includes(i.id))});mock(CartRepository,'closeCart');
 mock(CustomerPricingService,'getContext',async()=>({}));mock(CustomerPricingService,'price',({retailPrice})=>({customerPrice:Number(retailPrice)}));
 mock(CustomerRepository,'findActiveByUserId',async()=>({id:42}));
 mock(ProductRepository,'findOfferForCheckoutForUpdate',async id=>({product_id:id+90,quantity:stock,effective_retail_price:100,minimum_sale_price:0,is_available:true,source_type:id===12?'SUPPLIER':'OWN_STOCK'}));
 mock(ProductRepository,'decreaseQuantityForSale',async()=>({old_quantity:stock,new_quantity:stock-1}));
 mock(ReservationRepository,'getReservedQuantity',async()=>0);mock(ReservationRepository,'createOrderReservation');
 mock(ReservationRepository,'findActiveByCheckoutSessionId',async()=>sessionItems.map(i=>({cart_item_id:i.cart_item_id,cart_id:60,product_offer_id:i.product_offer_id,quantity:1})));
 mock(ReservationRepository,'attachToOrder');mock(ReservationRepository,'detachCartItems');mock(StockMovementRepository,'createInventoryMovement');
 mock(OrderRepository,'createOrder',async values=>{const order={id:900010+orders.length,status:'NEW',total_amount:values.totalAmount};orders.push(order);return order});
 mock(OrderRepository,'addOrderItem',async values=>{const item={id:1000+items.length,order_id:values.orderId,...values};items.push(item);return item});
 mock(OrderRepository,'updateCommittedQuantity',async id=>items.find(i=>i.id===id));mock(OrderRepository,'addStatusHistory');
 mock(OrderRepository,'findItemsByOrderId',async id=>items.filter(i=>i.order_id===id));
 mock(OrderDeliveryRepository,'create',async({orderId,delivery})=>{const value={orderId,...delivery};deliveries.push(value);return value});
 mock(OrderDeliveryRepository,'findByOrderIds',async()=>deliveries);mock(NotificationRepository,'createForStaff');
 mock(TelegramNotificationService,'sendNewOrder',async input=>telegrams.push(input));
 mock(OrderEmailNotificationService,'send',async input=>{assert.ok(events.includes('COMMIT'));assert.equal(events.at(-1),'RELEASE');sent.push(input);if(mailFailure)throw Error('Mail unavailable');return {sent:true}});
 t.mock.method(console,'error',()=>{});
 const execute=extra=>SubmitOrder.execute({checkoutId:50,idempotencyKey:key,guestToken:'test-only-token',delivery,...extra});
 return {execute,events,sent,telegrams,orders,checkout};
}
for(const userId of [null,42])test('new checkout sends created email after commit for '+(userId?'account':'guest'),async t=>{
 const f=fixture(t);const result=await f.execute({userId});assert.equal(result.order.id,900010);assert.deepEqual(f.sent,[{orderId:900010,type:'created'}]);assert.equal(f.telegrams.length,1);
});
test('split stock/supplier checkout sends one creation event per actual order and replay sends none',async t=>{
 const f=fixture(t,{mixed:true});const first=await f.execute();assert.equal(first.orders.length,2);assert.deepEqual(f.sent.map(x=>x.orderId),first.orders.map(x=>x.id));assert.ok(f.sent.every(x=>x.type==='created'));
 const again=await f.execute();assert.equal(again.idempotentReplay,true);assert.equal(f.sent.length,2);assert.equal(f.telegrams.length,2);
});
test('a replay with another key cannot trigger mail',async t=>{
 const f=fixture(t);await f.execute();await assert.rejects(f.execute({idempotencyKey:'different-valid-key-00001'}),{code:'CHECKOUT_ALREADY_SUBMITTED'});assert.equal(f.sent.length,1);
});
for(const legacy of [false,true])test('rollback never sends a created email: '+(legacy?'legacy':'current'),async t=>{
 const f=fixture(t,{legacy,failCommit:true});await assert.rejects(f.execute(),/Commit failed/);assert.ok(f.events.includes('ROLLBACK'));assert.equal(f.sent.length,0);assert.equal(f.telegrams.length,0);
});
test('stock conflict produces no creation notification',async t=>{
 const f=fixture(t,{stock:0});await assert.rejects(f.execute(),{code:'STOCK_CHANGED'});assert.equal(f.sent.length,0);assert.equal(f.orders.length,0);
});
test('mail failure does not fail checkout or suppress existing Telegram notification',async t=>{
 const f=fixture(t,{mailFailure:true});const result=await f.execute();await new Promise(setImmediate);assert.equal(result.order.status,'NEW');assert.equal(f.sent.length,1);assert.equal(f.telegrams.length,1);assert.ok(!f.events.includes('ROLLBACK'));
});
test('pre-release checkout also sends once after commit; second submit cannot send again',async t=>{
 const f=fixture(t,{legacy:true});await f.execute();assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0],{orderId:900010,type:'created'});await assert.rejects(f.execute());assert.equal(f.sent.length,1);
});
