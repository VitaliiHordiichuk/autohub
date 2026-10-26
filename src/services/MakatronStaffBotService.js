import { resolveMakatronStaff,connectMakatronStaff,staffBotEnabled,
  staffOrderKeyboard,formatStaffNewOrder } from "./MakatronStaffService.js";
import { searchMakatronStaffPrices,buildMakatronClientQuote } from "./MakatronStaffPricingService.js";
import { OrderRepository } from "../repositories/OrderRepository.js";
import { GetManagerOrder } from "../use-cases/manager/GetManagerOrder.js";
import { OrderConfirmationService } from "./OrderConfirmationService.js";
import { OrderCancellationService } from "./OrderCancellationService.js";

const markup=()=>({keyboard:[[{text:"🛒 Замовлення"},{text:"💰 Процінка"}]],resize_keyboard:true});
const privateStaffChat=(chat,user)=>chat?.type==="private" &&
  chat.id!=null && user?.id!=null && String(chat.id)===String(user.id);
const reply=async(api,id,text,more={})=>api("sendMessage",{chat_id:id,text,...more});

export async function handleMakatronStaffMessage(message,api,deps={}) {
  if(!privateStaffChat(message?.chat,message?.from))return false;
  const text=String(message?.text||"").trim();
  if(!text)return false;
  const chatId=message.chat.id,telegramUserId=message.from.id;
  const pairing=text.match(/^\/start\s+staff_([a-f0-9]{48})$/i);
  if(pairing){
    const connect=deps.connect||connectMakatronStaff;
    const result=await connect({token:pairing[1],chatId,telegramUserId});
    await reply(api,chatId,result
      ?"✅ MAKAtron підключено як "+result.role+".\nДоступні лише замовлення та процінка."
      :"❌ Посилання недійсне або закінчився термін дії.",
      result?{reply_markup:markup()}:{});
    return true;
  }
  if(!staffBotEnabled())return false;
  const resolve=deps.resolve||resolveMakatronStaff;
  const staff=await resolve({chatId,telegramUserId});
  if(!staff){
    if(/^\/staff(?:\s|$)/i.test(text)){
      await reply(api,chatId,"🔒 Службовий режим доступний лише після окремої прив'язки облікового запису адміністратора або менеджера MAKA.");
      return true;
    }
    return false;
  }
  if(/^(\/staff|\/start|\/help)(?:@\w+)?$/i.test(text)){
    await reply(api,chatId,"🤖 <b>MAKAtron · робочий режим</b>\n"+
      "🛒 Замовлення — нові заявки, підтвердження, скасування.\n"+
      "💰 Процінка — артикули, залишки, роздрібна, вхідна та VIP-ціна.\n"+
      "Надішліть артикул, щоб отримати процінку.",{
        parse_mode:"HTML",reply_markup:markup()});
    return true;
  }
  if(/^(?:🛒\s*Замовлення|\/orders)(?:@\w+)?$/i.test(text)){
    const getOrders=deps.getOrders||OrderRepository.findAllForManager;
    const getOrder=deps.getOrder||GetManagerOrder.execute;
    const orders=await getOrders({status:"NEW",limit:5,offset:0});
    if(!orders.length){await reply(api,chatId,"✅ Нових замовлень немає.",{reply_markup:markup()});return true;}
    for(const item of orders.slice(0,5)){
      const order=await getOrder(item.id);
      if(!order||order.status!=="NEW")continue;
      await reply(api,chatId,formatStaffNewOrder(order),{
        parse_mode:"HTML",reply_markup:staffOrderKeyboard(order.id)});
    }
    return true;
  }
  if(/^(?:💰\s*Процінка|\/price(?:@\w+)?|\/quote(?:@\w+)?|\/prices(?:@\w+)?)$/i.test(text)){
    await reply(api,chatId,
      "🔎 Надішліть артикул або список артикулів, по одному в рядку.\n"+
      "Покажу залишки, роздрібну, реальну вхідну та VIP-ціну.",{
        reply_markup:markup()});
    return true;
  }
  if(/^\/(?!price(?:s)?(?:@|\s)|quote(?:@|\s))/i.test(text))return false;
  const search=deps.search||searchMakatronStaffPrices;
  const results=await search({text,staffUserId:staff.userId});
  for(const item of results){
    await reply(api,chatId,item.text,{parse_mode:"HTML",...(item.reply_markup?{reply_markup:item.reply_markup}:{})});
  }
  return true;
}

export async function handleMakatronStaffCallback(callback,api,deps={}) {
  if(!String(callback?.data||"").startsWith("st:"))return false;
  const chatId=callback?.message?.chat?.id;
  if(!privateStaffChat(callback?.message?.chat,callback?.from)){
    await api("answerCallbackQuery",{callback_query_id:callback.id,text:"Доступ заборонено",show_alert:true});
    return true;
  }
  const resolve=deps.resolve||resolveMakatronStaff;
  const staff=await resolve({chatId,telegramUserId:callback.from.id});
  if(!staff){
    await api("answerCallbackQuery",{callback_query_id:callback.id,text:"Потрібна прив'язка співробітника MAKA",show_alert:true});
    return true;
  }
  const parts=callback.data.split(":");
  const action=parts[1],id=Number(parts[2]);
  const ack=async(text)=>api("answerCallbackQuery",{callback_query_id:callback.id,text:text.slice(0,180)});
  if(!Number.isSafeInteger(id)||id<=0){await ack("Невірний номер");return true;}
  try{
    if(action==="g"){
      const groupId=Number(parts[3]);
      const quote=deps.buildQuote||buildMakatronClientQuote;
      const response=await quote({offerId:id,priceGroupId:groupId,staffUserId:staff.userId});
      await ack("Пропозиція без закупівельної ціни");
      await reply(api,chatId,response.text,{parse_mode:"HTML"});
      return true;
    }
    if(action==="c"||action==="x"){
      const order=await (deps.getOrder||GetManagerOrder.execute)(id);
      if(!order){await ack("Замовлення не знайдено");return true;}
      const canCancel=["NEW","CONFIRMED","PROCESSING","READY"].includes(order.status);
      if(action==="c"&&order.status!=="NEW"){await ack("Замовлення вже не нове");return true;}
      if(action==="x"&&!canCancel){await ack("Скасування недоступне для цього статусу");return true;}
      await ack("Підтвердіть дію");
      await reply(api,chatId,action==="c"
        ?"Підтвердити замовлення №"+id+"?"
        :"⚠️ Скасувати замовлення №"+id+"? Це вплине на залишки.",{
          reply_markup:{inline_keyboard:[
            [{text:action==="c"?"✅ Так, підтвердити":"❌ Так, скасувати",
              callback_data:"st:"+ (action==="c"?"cc":"xx")+":"+id}],
            [{text:"↩️ Не виконувати",callback_data:"st:no:"+id}]
          ]}
        });
      return true;
    }
    if(action==="no"){await ack("Дію не виконано");return true;}
    if(action==="cc"||action==="xx"){
      if(action==="cc"){
        await (deps.confirm||OrderConfirmationService.confirmOrder)({orderId:id,changedBy:staff.userId});
      }else{
        await (deps.cancel||OrderCancellationService.cancelOrder)({
          orderId:id,changedBy:staff.userId,comment:"Скасовано менеджером через MAKAtron"
        });
      }
      await ack("Статус замовлення оновлено");
      await reply(api,chatId,(action==="cc"?"✅ Підтверджено":"❌ Скасовано")+" замовлення №"+id,{
        reply_markup:{inline_keyboard:[[
          {text:"📋 Відкрити в адмінці",url:"https://maka.com.ua/uk/admin/orders/"+id}
        ]]}
      });
      return true;
    }
    await ack("Невідома дія");
    return true;
  }catch(error){
    await api("answerCallbackQuery",{callback_query_id:callback.id,
      text:"Не вдалося виконати: "+String(error?.message||"Помилка").slice(0,130),show_alert:true}).catch(()=>{});
    return true;
  }
}
