import { randomBytes, randomUUID, createHash } from "node:crypto";
import { pool } from "../config/db.js";
import { SearchService } from "./SearchService.js";
import { ProductCardService } from "./ProductCardService.js";
import { PublicSearchPresenterService } from "./PublicSearchPresenterService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { resolveTelegramPricingIdentity } from "./TelegramCatalogService.js";
import { TelegramLanguageService } from "./TelegramLanguageService.js";
import { NovaPoshtaService } from "./NovaPoshtaService.js";
import { WarehouseRepository } from "../repositories/WarehouseRepository.js";
import { CartAccessRepository } from "../repositories/CartAccessRepository.js";
import { CartRepository } from "../repositories/CartRepository.js";
import { CartService } from "./CartService.js";
import { ProductRepository } from "../repositories/ProductRepository.js";
import { ReservationRepository } from "../repositories/ReservationRepository.js";
import { StartCheckout } from "../use-cases/checkout/StartCheckout.js";
import { SubmitOrder } from "../use-cases/checkout/SubmitOrder.js";
import { normalizeOrderDelivery } from "./OrderDeliveryService.js";
import { parseTelegramArticles, formatTelegramInputError } from "./TelegramCatalogFormatter.js";
import { renderTelegramOrder, deliveryKeyboard, orderText, money } from "./TelegramOrderView.js";

const SESSION_MAX_AGE_DAYS = 7;
const MAX_ITEMS = 20;
const MAX_OFFERS = 5;
const bool = (v) => /^(true|1|yes|on)$/i.test(String(v || "").trim());
export function telegramInlineCheckoutEnabled(chatId = null) {
  if (!bool(process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED)) return false;
  const onlyChat = String(process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID || "").trim();
  return !onlyChat || (chatId !== null && String(chatId) === onlyChat);
}
export function selectTelegramOffers(offers) {
  return (offers || []).filter((o) =>
    Number.isSafeInteger(Number(o.id)) && Number(o.id) > 0 &&
    o.isAvailable === true && Number(o.quantity) > 0 &&
    Number.isFinite(Number(o.retailPrice)) && Number(o.retailPrice) > 0)
    .sort((a,b) => (a.sourceType === "OWN_STOCK" ? 0 : 1) -
      (b.sourceType === "OWN_STOCK" ? 0 : 1) ||
      Number(a.retailPrice) - Number(b.retailPrice))
    .slice(0,MAX_OFFERS).map(o => ({
      offerId:Number(o.id),sourceType:o.sourceType==="OWN_STOCK"?"OWN_STOCK":"SUPPLIER",
      quantity:Math.floor(Number(o.quantity)),price:Number(o.retailPrice),
      deliveryDays:Number(o.deliveryDays)||0,
    }));
}
export function editTelegramItem(item, action) {
  const next={...item},offers=item.offers||[];
  if(!offers.length)return next;
  if(action==="s") {
    next.selectedOffer=((Number(item.selectedOffer)||0)+1)%offers.length;
    next.quantity=Math.min(Number(item.quantity)||0,offers[next.selectedOffer].quantity);
    return next;
  }
  const max=offers[item.selectedOffer||0].quantity;
  if(action==="p")next.quantity=Math.min(max,Number(item.quantity||0)+1);
  if(action==="m")next.quantity=Math.max(0,Number(item.quantity||0)-1);
  if(action==="x")next.quantity=0;
  return next;
}
export function parseTelegramRecipient(text) {
  const pieces=String(text||"").split(";").map(s=>s.trim());
  if(pieces.length!==3||pieces.some(s=>!s)||
      pieces[0].length>100||pieces[1].length>100)return null;
  return {firstName:pieces[0],lastName:pieces[1],phone:pieces[2]};
}
function sameAmount(a,b) { return Math.round(Number(a)*100) === Math.round(Number(b)*100); }
function key() {return randomBytes(5).toString("hex");}
function sanitizedError(locale) {
  return locale==="en"?"⚠️ Could not complete this step. Check your details or try again.":
    "⚠️ Не вдалося виконати дію. Перевірте дані та спробуйте ще раз.";
}
function recoverableError(locale, message) {
  const prefix=locale==="en"?"⚠️ Please review your order: ":"⚠️ Перевірте замовлення: ";
  return prefix+(locale==="en"?"Check the details and try again.":String(message||"").slice(0,160));
}
function normalizeDraftRow(row) {
  if(!row)return null;
  return {...row,draft:row.draft||{},message_id:row.message_id===null?null:Number(row.message_id)};
}
async function load(chatId,userId) {
  const {rows}=await pool.query(
    "SELECT * FROM telegram_order_drafts WHERE chat_id=$1 AND telegram_user_id=$2",
    [chatId,userId]);
  const row=normalizeDraftRow(rows[0]);
  if(!row)return null;
  const age=Date.now()-new Date(row.updated_at).getTime();
  return age>SESSION_MAX_AGE_DAYS*86400000 ? null:row;
}
async function save(row) {
  const {rows}=await pool.query(
    "UPDATE telegram_order_drafts SET stage=$3, draft=$4::jsonb, message_id=$5, updated_at=CURRENT_TIMESTAMP "+
    "WHERE chat_id=$1 AND telegram_user_id=$2 AND session_key=$6 RETURNING *",
    [row.chat_id,row.telegram_user_id,row.stage,JSON.stringify(row.draft),row.message_id,row.session_key]);
  if(!rows.length)throw Error("Order draft session changed");
  return normalizeDraftRow(rows[0]);
}
async function create(chatId,userId,draft) {
  // Retain order contact information for no more than a week after its last use.
  await pool.query("DELETE FROM telegram_order_drafts WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '7 days'");
  const sessionKey=key();
  const {rows}=await pool.query(
    "INSERT INTO telegram_order_drafts(chat_id,telegram_user_id,session_key,stage,draft,message_id) "+
    "VALUES($1,$2,$3,'EDIT',$4::jsonb,NULL) ON CONFLICT(chat_id) DO UPDATE SET "+
    "telegram_user_id=EXCLUDED.telegram_user_id,session_key=EXCLUDED.session_key,"+
    "stage='EDIT',draft=EXCLUDED.draft,message_id=NULL,updated_at=CURRENT_TIMESTAMP RETURNING *",
    [chatId,userId,sessionKey,JSON.stringify(draft)]);
  return normalizeDraftRow(rows[0]);
}
async function locateArticle(article,locale,pricingContext,viewerId) {
  try {
    const found=await SearchService.searchByArticle(article);
    const product=found?.exactProduct||found?.family?.[0]||null;
    if(!found?.found||!product)return {article,name:"",quantity:0,selectedOffer:0,offers:[]};
    const raw=await ProductCardService.build(product,pricingContext,{userId:viewerId,cartId:null});
    const localized=await PublicSearchPresenterService.present({
      requestedLocale:locale,productCard:raw,includeSourceDetails:false,
    });
    return {
      article:String(localized.productCard.product.article||article).slice(0,60),
      name:String(localized.productCard.product.name||"").slice(0,90),
      quantity:0,selectedOffer:0,offers:selectTelegramOffers(localized.productCard.offers),
    };
  } catch(error) {
    console.error("MAKAtron order lookup:",error.message);
    return {article,name:"",quantity:0,selectedOffer:0,offers:[]};
  }
}
async function lookupList(articles,chatId,userId,locale) {
  const viewer=await resolveTelegramPricingIdentity({chatId,telegramUserId:userId});
  const viewerId=viewer?.userId??null;
  const pricing=await CustomerPricingService.getContext(viewerId);
  const items=[];
  for(const article of articles) {
    const result=await locateArticle(article,locale,pricing,viewerId);
    if(result.offers.length)result.quantity=1;
    items.push(result);
  }
  return {items,viewerId};
}
async function publish(row,api,locale,{forceNew=false}={}) {
  const body=row.stage==="DELIVERY"
    ? {text:orderText(locale).delivery,parse_mode:"HTML",
        reply_markup:deliveryKeyboard(row.session_key,locale)}
    : renderTelegramOrder({stage:row.stage,draft:row.draft,locale,sessionKey:row.session_key});
  if(row.message_id && !forceNew) {
    try {
      await api("editMessageText",{chat_id:row.chat_id,message_id:row.message_id,...body});
      return row;
    } catch(error) {
      if(String(error.message).includes("message is not modified"))return row;
      console.error("MAKAtron order message edit:",error.message);
    }
  }
  const sent=await api("sendMessage",{chat_id:row.chat_id,...body});
  row.message_id=Number(sent.message_id);
  return save(row);
}
async function say(chatId,api,text) {
  return api("sendMessage",{chat_id:chatId,text,parse_mode:"HTML"});
}
async function handleInput(row,text,api,locale) {
  const chatId=row.chat_id;
  if(row.stage==="CITY_INPUT"||row.stage==="CITY_CHOICE") {
    const options=await NovaPoshtaService.searchCities(text,{locale:"uk"});
    if(!options.length) {
      await say(chatId,api,locale==="en"?"No cities found. Try another query.":"Місто не знайдено. Спробуйте інший запит.");
      return true;
    }
    row.draft.options=options.slice(0,8);
    row.stage="CITY_CHOICE";
    await publish(await save(row),api,locale);
    return true;
  }
  if(row.stage==="POINT_INPUT"||row.stage==="POINT_CHOICE") {
    const city=row.draft.delivery?.city;
    if(!city?.ref)return false;
    const options=await NovaPoshtaService.searchPoints(city.ref,text,{locale:"uk"});
    if(!options.length) {
      await say(chatId,api,locale==="en"?"No branches found. Try another number.":"Відділення не знайдено. Введіть інший номер.");
      return true;
    }
    row.draft.options=options.slice(0,8);
    row.stage="POINT_CHOICE";
    await publish(await save(row),api,locale);
    return true;
  }
  if(row.stage==="CONTACT_INPUT") {
    const person=parseTelegramRecipient(text);
    if(!person) {
      await say(chatId,api,orderText(locale).contact);
      return true;
    }
    const delivery=row.draft.delivery||{};
    const payload={recipientFirstName:person.firstName,recipientLastName:person.lastName,
      recipientPhone:person.phone,deliveryMethod:delivery.method,
      ...(delivery.method==="PICKUP"?{pickupWarehouseId:delivery.warehouseId}:{
        novaPoshta:{cityRef:delivery.city.ref,cityName:delivery.city.name,
          pointType:delivery.point.type,pointRef:delivery.point.ref,
          pointNumber:delivery.point.number,pointName:delivery.point.name,
          pointAddress:delivery.point.address},
      })};
    try {
      row.draft.deliveryInput=normalizeOrderDelivery(payload);
    } catch(error) {
      await say(chatId,api,recoverableError(locale,error.message)+"\n"+orderText(locale).contact);
      return true;
    }
    row.draft.contact=person;
    row.stage="REVIEW";
    await publish(await save(row),api,locale);
    return true;
  }
  const wantsAdd=row.stage==="EDIT" && row.draft.awaitingAdd===true;
  const parsed=parseTelegramArticles(text);
  if(parsed.error) {
    await api("sendMessage",{chat_id:chatId,
      ...formatTelegramInputError(parsed.error,locale)});
    return true;
  }
  if(wantsAdd) {
    const unique=new Set(row.draft.items.map(i=>i.article.replace(/[^A-Z0-9]/gi,"").toUpperCase()));
    const extra=parsed.articles.filter(i=>!unique.has(i.replace(/[^A-Z0-9]/gi,"").toUpperCase()));
    if(row.draft.items.length+extra.length>MAX_ITEMS) {
      await say(chatId,api,locale==="en"?"Maximum 20 parts per order.":"Не більше 20 позицій в одному замовленні.");
      return true;
    }
    const found=await lookupList(extra,chatId,row.telegram_user_id,locale);
    if(found.viewerId!==row.draft.viewerId) {
      await say(chatId,api,locale==="en"?"Account changed; please send a new list.":"Акаунт змінився. Надішліть новий список.");
      return true;
    }
    row.draft.items.push(...found.items);
    row.draft.awaitingAdd=false;
    await publish(await save(row),api,locale);
    return true;
  }
  const found=await lookupList(parsed.articles,chatId,row.telegram_user_id,locale);
  const fresh=await create(chatId,row.telegram_user_id,
    {items:found.items,viewerId:found.viewerId,awaitingAdd:false});
  await publish(fresh,api,locale);
  return true;
}
export async function handleTelegramOrderMessage({text,chatId,telegramUserId},api) {
  if(!telegramInlineCheckoutEnabled(chatId))return false;
  if(!chatId||!telegramUserId||String(chatId)!==String(telegramUserId))return false;
  if(String(text||"").trim().startsWith("/"))return false;
  const locale=await TelegramLanguageService.get(chatId);
  const row=await load(chatId,telegramUserId);
  if(!row)return handleInput({chat_id:chatId,telegram_user_id:telegramUserId,
    stage:"EDIT",draft:{items:[],awaitingAdd:false}},text,api,locale);
  if(row.stage==="PROCESSING"||row.stage==="DONE") {
    const parsed=parseTelegramArticles(text);
    if(parsed.error)return false;
    const found=await lookupList(parsed.articles,chatId,telegramUserId,locale);
    return publish(await create(chatId,telegramUserId,
      {items:found.items,viewerId:found.viewerId,awaitingAdd:false}),api,locale).then(()=>true);
  }
  return handleInput(row,text,api,locale);
}
async function markChanged(row,api,locale) {
  row.stage="EDIT";
  row.draft.checkoutId=null;
  row.draft.cartId=null;
  row.draft.guestToken=null;
  row.draft.addedOffers=[];
  row.draft.idempotencyKey=null;
  await publish(await save(row),api,locale);
  await say(row.chat_id,api,locale==="en"
    ?"⚠️ Stock or price changed. Review the quantities and confirm again."
    :"⚠️ Ціна або залишок змінилися. Перевірте кількість і підтвердьте ще раз.");
}
async function commitOrder(row,api,locale) {
  const chatId=row.chat_id;
  const items=(row.draft.items||[]).filter(i=>i.quantity>0&&i.offers?.length);
  if(!items.length)throw Error(orderText(locale).empty);
  if(!row.draft.deliveryInput)throw Error("Delivery details missing");
  const viewer=await resolveTelegramPricingIdentity({
    chatId,telegramUserId:row.telegram_user_id,
  });
  if((viewer?.userId??null)!==(row.draft.viewerId??null)) {
    await markChanged(row,api,locale);
    return;
  }
  const userId=viewer?.userId??null;
  const pricing=await CustomerPricingService.getContext(userId);
  let changed=false;
  for(const item of items) {
    const selected=item.offers[item.selectedOffer||0];
    const offer=await ProductRepository.findOfferForCheckoutForUpdate(selected.offerId);
    if(!offer||offer.is_available!==true||offer.is_hidden===true||
        offer.warehouse_active===false||offer.supplier_active===false) {
      selected.quantity=0;item.quantity=0;changed=true;continue;
    }
    const reserved=await ReservationRepository.getReservedQuantity(selected.offerId);
    const currentQty=Math.max(0,Number(offer.quantity)-Number(reserved));
    const current=CustomerPricingService.price({
      retailPrice:offer.effective_retail_price,minimumSalePrice:offer.minimum_sale_price,
    },pricing)?.customerPrice;
    if(!Number.isFinite(Number(current))||Number(current)<=0) {
      selected.quantity=0;item.quantity=0;changed=true;continue;
    }
    if(!sameAmount(selected.price,current)||Number(item.quantity)>currentQty) {
      selected.price=Number(current);
      selected.quantity=currentQty;
      item.quantity=Math.min(item.quantity,currentQty);
      changed=true;
    }
  }
  if(changed) {
    await markChanged(row,api,locale);
    return;
  }
  // The cart is created only after the final confirmation. A separate cart
  // prevents Telegram from changing the customer's current web cart.
  if(!row.draft.cartId) {
    // Always use a private guest-token cart. Telegram cannot replace a web cart.
    const token=randomBytes(32).toString("hex");
    const cart=await CartAccessRepository.createForGuest(
      createHash("sha256").update(token).digest("hex"));
    row.draft.cartId=Number(cart.id);
    row.draft.guestToken=token;
    row.draft.addedOffers=[];
    await save(row);
  }
  for(const item of items) {
    const offer=item.offers[item.selectedOffer||0];
    if(row.draft.addedOffers.includes(offer.offerId))continue;
    // A restart after the DB insert but before persisting addedOffers must
    // never add the same quantity a second time.
    const existing=await CartRepository.findItem(row.draft.cartId,offer.offerId);
    if(existing) {
      if(Number(existing.quantity)!==Number(item.quantity)) {
        await CartService.updateItemQuantity({
          cartId:row.draft.cartId,itemId:existing.id,
          userId:null,guestToken:row.draft.guestToken||null,
          quantity:item.quantity,
        });
      }
    } else {
      await CartService.addProduct({
        cartId:row.draft.cartId,userId:null,guestToken:row.draft.guestToken||null,
        productOfferId:offer.offerId,quantity:item.quantity,
      });
    }
    row.draft.addedOffers.push(offer.offerId);
    await save(row);
  }
  if(!row.draft.checkoutId) {
    const result=await StartCheckout.execute({
      cartId:row.draft.cartId,userId:null,guestToken:row.draft.guestToken||null,
      pricingUserId:userId,
    });
    row.draft.checkoutId=result.checkoutId;
    await save(row);
    const prices=result.items||[];
    let changedAtCheckout=false;
    for(const item of items) {
      const offer=item.offers[item.selectedOffer||0];
      const snapshot=prices.find(i=>Number(i.product_offer_id)===offer.offerId);
      if(!snapshot||!sameAmount(snapshot.price_snapshot,offer.price)) {
        if(snapshot)offer.price=Number(snapshot.price_snapshot);
        changedAtCheckout=true;
      }
    }
    if(changedAtCheckout) {
      // Never place an order silently if the accepted preview is stale.
      await markChanged(row,api,locale);
      return;
    }
  }
  const placed=await SubmitOrder.execute({
    checkoutId:row.draft.checkoutId,idempotencyKey:row.draft.idempotencyKey,
    userId:null,guestToken:row.draft.guestToken||null,
    trustedTelegramCustomerUserId:userId,
    delivery:row.draft.deliveryInput,saveDeliveryProfile:false,
    comment:"Замовлення оформлено через Telegram MAKAtron",
  });
  row.draft.orderIds=(placed.orders||[placed.order]).filter(Boolean).map(o=>Number(o.id));
  row.stage="DONE";
  await publish(await save(row),api,locale);
}
export async function handleTelegramOrderCallback(callback,api) {
  if(!telegramInlineCheckoutEnabled(callback?.message?.chat?.id))return false;
  const data=String(callback?.data||"");
  const match=/^mo:([a-f0-9]{10}):([a-z]+)(?::([0-9a-z]+))?$/.exec(data);
  if(!match)return false;
  const chatId=callback.message?.chat?.id;
  const telegramUserId=callback.from?.id;
  if(!chatId||String(chatId)!==String(telegramUserId)||callback.message?.chat?.type!=="private") {
    await api("answerCallbackQuery",{callback_query_id:callback.id});
    return true;
  }
  const locale=await TelegramLanguageService.get(chatId);
  const row=await load(chatId,telegramUserId);
  const stale=locale==="en"?"This is an old order message.":"Це повідомлення зі старим замовленням.";
  if(!row||row.session_key!==match[1]||Number(row.message_id)!==Number(callback.message.message_id)) {
    await api("answerCallbackQuery",{callback_query_id:callback.id,text:stale});
    return true;
  }
  const action=match[2],idx=match[3]===undefined?-1:parseInt(match[3],36);
  await api("answerCallbackQuery",{callback_query_id:callback.id});
  if(row.stage==="DONE"&&action!=="reset")return true;
  if(row.stage==="PROCESSING") {
    // Safe retry after a worker crash: reuse the persisted checkout and key.
    if(action!=="retry")return true;
    if(Date.now()-new Date(row.updated_at).getTime()<120_000)return true;
    try { await commitOrder(row,api,locale); }
    catch(error) { console.error("MAKAtron checkout recovery:",error.message); }
    return true;
  }
  const items=row.draft.items||[];
  if(row.stage==="EDIT"&&["p","m","x","s"].includes(action)&&items[idx]) {
    items[idx]=editTelegramItem(items[idx],action);
  } else if(action==="q") {
    return true;
  } else if(row.stage==="EDIT"&&action==="add") {
    row.draft.awaitingAdd=true;
    await save(row);
    await say(chatId,api,locale==="en"?"➕ Send a part number or list.":"➕ Надішліть артикул або список артикулів.");
    return true;
  } else if(row.stage==="EDIT"&&action==="next") {
    if(!items.some(i=>i.quantity>0&&i.offers?.length)) {
      await say(chatId,api,orderText(locale).empty);
      return true;
    }
    row.stage="DELIVERY";
  } else if(row.stage==="DELIVERY"&&action==="pickup") {
    const warehouses=await WarehouseRepository.findPickupAvailable();
    row.draft.options=warehouses.slice(0,10).map(w=>({id:Number(w.id),name:w.name,city:w.city||""}));
    row.stage="PICKUP";
  } else if(row.stage==="DELIVERY"&&action==="nova") {
    row.stage="CITY_INPUT";
  } else if(row.stage==="PICKUP"&&action==="warehouse") {
    const w=row.draft.options?.[idx];
    if(!w)return true;
    row.draft.delivery={method:"PICKUP",warehouseId:w.id,label:[w.city,w.name].filter(Boolean).join(", ")};
    row.stage="CONTACT_INPUT";
  } else if(row.stage==="CITY_CHOICE"&&action==="city") {
    const city=row.draft.options?.[idx];
    if(!city)return true;
    row.draft.delivery={method:"NOVA_POSHTA_POINT",city,
      label:"Нова пошта · "+city.name};
    row.stage="POINT_INPUT";
  } else if(row.stage==="POINT_CHOICE"&&action==="point") {
    const point=row.draft.options?.[idx];
    if(!point)return true;
    row.draft.delivery.point=point;
    row.draft.delivery.label="Нова пошта · "+row.draft.delivery.city.name+" · "+point.name;
    row.stage="CONTACT_INPUT";
  } else if(row.stage==="REVIEW"&&action==="submit") {
    row.stage="PROCESSING";
    row.draft.idempotencyKey=row.draft.idempotencyKey||randomUUID();
    await publish(await save(row),api,locale);
    try {
      await commitOrder(row,api,locale);
    } catch(error) {
      console.error("MAKAtron checkout:",error.message);
      const durable=await load(chatId,telegramUserId);
      if(durable?.stage==="DONE") {
        // The order committed even if Telegram failed to deliver its receipt.
        await publish(durable,api,locale,{forceNew:true}).catch(()=>{});
        return true;
      }
      if(durable?.stage==="EDIT")return true;
      row.stage="REVIEW";
      await publish(await save(row),api,locale);
      await say(chatId,api,recoverableError(locale,
        error.statusCode===409
          ?(locale==="en"?"Stock or price changed. Send the part list again.":"Залишок або ціна змінилися. Надішліть список повторно.")
          :sanitizedError(locale)));
    }
    return true;
  } else if(action==="back") {
    row.stage="EDIT";
    row.draft.awaitingAdd=false;
  } else if(row.stage==="DONE"&&action==="reset") {
    row.stage="EDIT";row.draft={items:[],viewerId:null,awaitingAdd:true};
    await save(row);
    await say(chatId,api,locale==="en"?"Send the next part number or list.":"Надішліть наступний артикул або список.");
    return true;
  } else {
    return true;
  }
  await publish(await save(row),api,locale);
  return true;
}
