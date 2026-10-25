import { escapeTelegramHtml } from "./TelegramCatalogFormatter.js";

export function telegramOrderLocale(locale) { return locale === "en" ? "en" : "uk"; }
const TXT = {
  uk: {
    header: "🛒 <b>Ваш список запчастин</b>", count:"Доступно",selected:"Обрано",
    none:"Не знайдено", unavailable:"Немає в наявності", total:"Разом",pcs:"шт.",
    add:"➕ Додати запчастину", next:"✅ Підтвердити замовлення",
    sourceOwn:"Склад MAKA", sourceSupplier:"Постачальник", more:"Змінити пропозицію",
    pickup:"🏬 Самовивіз", shipping:"🚚 Нова пошта", back:"⬅️ До списку",
    delivery:"<b>Оберіть спосіб отримання</b>", city:"Введіть місто Нової пошти повідомленням.",
    cities:"<b>Оберіть місто</b>", point:"Введіть номер або назву відділення / поштомата повідомленням.",
    points:"<b>Оберіть відділення або поштомат</b>",
    contact:"Надішліть в одному повідомленні: <b>Ім’я; Прізвище; +380XXXXXXXXX</b>",
    review:"<b>Перевірте замовлення перед оформленням</b>", customer:"Отримувач",
    deliveryLabel:"Доставка", submit:"✅ Оформити замовлення", newSearch:"🔍 Новий пошук",
    empty:"У списку немає вибраних товарів.", onlyOne:"Кількість не може перевищувати залишок.",
    done:"✅ <b>Замовлення оформлено!</b>", order:"Номер", orders:"Замовлення",
    processing:"⏳ Перевіряємо залишки та створюємо замовлення…",
    split:"Товари зі складу MAKA та від постачальників оформлюються окремими замовленнями.",
  },
  en: {
    header:"🛒 <b>Your parts list</b>",count:"Available",selected:"Selected",
    none:"Not found",unavailable:"Out of stock",total:"Total",pcs:"pcs",
    add:"➕ Add part",next:"✅ Confirm items",
    sourceOwn:"MAKA warehouse",sourceSupplier:"Supplier",more:"Switch offer",
    pickup:"🏬 Collection",shipping:"🚚 Nova Poshta",back:"⬅️ Back to parts",
    delivery:"<b>Select delivery method</b>",city:"Send your Nova Poshta city as a message.",
    cities:"<b>Select city</b>",point:"Send a branch or parcel locker number/name.",
    points:"<b>Select branch or locker</b>",
    contact:"Send one message: <b>First name; Last name; +380XXXXXXXXX</b>",
    review:"<b>Review your order before placing it</b>",customer:"Recipient",
    deliveryLabel:"Delivery",submit:"✅ Place order",newSearch:"🔍 New search",
    empty:"No items selected.",onlyOne:"Quantity cannot exceed available stock.",
    done:"✅ <b>Order placed!</b>",order:"Number",orders:"Orders",
    processing:"⏳ Checking stock and creating your order…",
    split:"MAKA warehouse and supplier items are placed as separate orders.",
  },
};
export function orderText(locale) { return TXT[telegramOrderLocale(locale)]; }
export function money(value,locale="uk") {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "uk-UA",{maximumFractionDigits:2}).format(Number(value || 0))
    + (locale === "en" ? " UAH" : " грн");
}
function cb(key, action, index = null) {return "mo:" + key + ":" + action + (index === null ? "" : ":" + Number(index).toString(36));}
export function orderKeyboard(key,stage,draft,locale="uk") {
  const t = orderText(locale);
  if (stage === "EDIT") {
    const rows = [];
    (draft.items || []).forEach((item,i) => {
      if (!item.offers?.length) return;
      const offer = item.offers[item.selectedOffer || 0];
      const buttons = [
        {text:(i+1)+" −",callback_data:cb(key,"m",i)},
        {text:(i+1)+": "+item.quantity+" "+t.pcs,callback_data:cb(key,"q",i)},
        {text:(i+1)+" +",callback_data:cb(key,"p",i)},
        {text:"🗑",callback_data:cb(key,"x",i)},
      ];
      if (item.offers.length > 1) {
        // Keep the complete keyboard below Telegram's 100-button limit.
        if ((draft.items || []).length >= 16) buttons[3]={text:"🔄",callback_data:cb(key,"s",i)};
        else buttons.push({text:"🔄",callback_data:cb(key,"s",i)});
      }
      rows.push(buttons);
    });
    rows.push([{text:t.add,callback_data:cb(key,"add")}]);
    rows.push([{text:t.next,callback_data:cb(key,"next")}]);
    return {inline_keyboard: rows};
  }
  if (stage === "PICKUP") return {inline_keyboard: [
    ...(draft.options || []).slice(0,10).map((w,i) => [{text:(w.city ? w.city+" · ":"")+w.name.slice(0,42),callback_data:cb(key,"warehouse",i)}]),
    [{text:t.back,callback_data:cb(key,"back")}],
  ]};
  if (stage === "CITY_CHOICE" || stage === "POINT_CHOICE") return {inline_keyboard:[
    ...(draft.options || []).slice(0,8).map((o,i) => [{text:String(o.displayName||o.name).slice(0,55),callback_data:cb(key,stage==="CITY_CHOICE"?"city":"point",i)}]),
    [{text:t.back,callback_data:cb(key,"back")}],
  ]};
  if (stage === "REVIEW") return {inline_keyboard:[
    [{text:t.submit,callback_data:cb(key,"submit")}],
    [{text:t.back,callback_data:cb(key,"back")}],
  ]};
  if (stage === "DONE") return {inline_keyboard:[[{
    text:t.newSearch,callback_data:cb(key,"reset"),
  }]]};
  if (stage === "PROCESSING") return {inline_keyboard:[]};
  return {inline_keyboard:[[{text:t.back,callback_data:cb(key,"back")}]]};
}
export function renderTelegramOrder({stage="EDIT",draft={},locale="uk",sessionKey}) {
  const t=orderText(locale), esc=escapeTelegramHtml,items=draft.items||[];
  const selected=items.filter(i=>i.quantity>0&&i.offers?.length);
  const total=selected.reduce((s,i)=>s+i.quantity*Number(i.offers[i.selectedOffer||0]?.price||0),0);
  const lines=[];
  if (stage==="DONE") {
    lines.push(t.done);
    for(const id of draft.orderIds||[]) lines.push("• "+t.order+" №<b>"+Number(id)+"</b>");
  } else if (stage==="PROCESSING") {
    lines.push(t.processing);
  } else if (stage==="EDIT"||stage==="REVIEW") {
    lines.push(stage==="REVIEW"?t.review:t.header);
    items.forEach((i,n)=>{
      const name=esc(String(i.name||"").slice(0,64)),article=esc(i.article);
      if (!i.offers?.length) {lines.push((n+1)+". <code>"+article+"</code> — "+t.none);return;}
      const offer=i.offers[i.selectedOffer||0];
      lines.push((n+1)+". <b>"+article+"</b>"+(name?" · "+name:""));
      lines.push("   "+(offer.sourceType==="OWN_STOCK"?"🏬 "+t.sourceOwn:"🚚 "+t.sourceSupplier)+
        " · "+t.count+": "+Math.max(0,Number(offer.quantity))+" "+t.pcs+
        " · "+money(offer.price,locale)+"/"+t.pcs);
      lines.push("   "+t.selected+": <b>"+Number(i.quantity||0)+"</b> · "+money(Number(i.quantity||0)*Number(offer.price),locale));
    });
    lines.push("");
    lines.push("<b>"+t.total+": "+money(total,locale)+"</b>");
    if(stage==="REVIEW") {
      const d=draft.delivery||{}, contact=draft.contact||{};
      lines.push(t.customer+": "+esc([contact.firstName,contact.lastName,contact.phone].filter(Boolean).join(" ")));
      lines.push(t.deliveryLabel+": "+esc(d.label||""));
      if(new Set(selected.map(i=>i.offers[i.selectedOffer||0].sourceType)).size>1)lines.push("ℹ️ "+t.split);
    }
  } else if(stage==="PICKUP"||stage==="CITY_CHOICE"||stage==="POINT_CHOICE") {
    lines.push(stage==="PICKUP"?t.pickup:stage==="CITY_CHOICE"?t.cities:t.points);
    if(stage==="PICKUP"&&!(draft.options||[]).length) lines.push(locale==="en"?"No collection points available.":"Пункти самовивозу недоступні.");
  } else if(stage==="CITY_INPUT") lines.push("🚚 "+t.city);
  else if(stage==="POINT_INPUT")lines.push("🚚 "+t.point);
  else if(stage==="CONTACT_INPUT")lines.push("👤 "+t.contact);
  else lines.push(t.delivery);
  const keyboard = stage==="EDIT"||stage==="PICKUP"||stage==="CITY_CHOICE"||stage==="POINT_CHOICE"||stage==="REVIEW"||stage==="DONE"||stage==="PROCESSING"
    ?orderKeyboard(sessionKey,stage,draft,locale)
    :{inline_keyboard:[[{text:t.back,callback_data:cb(sessionKey,"back")}]]};
  return {text:lines.join("\n").slice(0,3900),parse_mode:"HTML",reply_markup:keyboard};
}
export function deliveryKeyboard(key,locale="uk") {
  const t=orderText(locale);
  return {inline_keyboard:[
    [{text:t.pickup,callback_data:cb(key,"pickup")}],
    [{text:t.shipping,callback_data:cb(key,"nova")}],
    [{text:t.back,callback_data:cb(key,"back")}],
  ]};
}
