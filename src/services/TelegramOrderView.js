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
    done:"✅ <b>Дякуємо за замовлення!</b>\nМенеджер зв’яжеться з вами.", order:"Номер", orders:"Замовлення",
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
    done:"✅ <b>Thank you for your order!</b>\nOur manager will contact you.",order:"Number",orders:"Orders",
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
    const items = draft.items || [];
    // One compact row per part, referenced by its number in the quote above.
    // Paginate at 10 parts so keyboards stay within Telegram API limits.
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(pageCount - 1, Math.max(0, Number(draft.page) || 0));
    for (let i = page * pageSize; i < Math.min(items.length, (page + 1) * pageSize); i++) {
      const item = items[i];
      if (!item.offers?.length) continue;
      // The full catalogue article is always printed in the numbered quote.
      // The short position marker leaves room for all five buttons on iPhone.
      rows.push([
        {text: "№" + (i + 1), callback_data: cb(key, item.offers.length > 1 ? "s" : "a", i)},
        {text: String(item.quantity || 0) + " " + t.pcs, callback_data: cb(key, "q", i)},
        {text: "−", callback_data: cb(key, "m", i)},
        {text: "+", callback_data: cb(key, "p", i)},
        {text: "🗑", callback_data: cb(key, "x", i)},
      ]);
    }
    if (pageCount > 1) {
      const navigation = [];
      if (page > 0) navigation.push({text: "◀", callback_data: cb(key, "pgprev")});
      navigation.push({text: (page + 1) + "/" + pageCount, callback_data: cb(key, "pginfo")});
      if (page < pageCount - 1) navigation.push({text: "▶", callback_data: cb(key, "pgnext")});
      rows.push(navigation);
    }
    rows.push([{text:t.add,callback_data:cb(key,"add")}]);
    rows.push([{text:t.next,callback_data:cb(key,"next")}]);
    return {inline_keyboard: rows};
  }
  // Historic draft data must never render internal warehouse names or addresses.
  if (stage === "PICKUP") return {inline_keyboard:[
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
  if (stage === "PROCESSING") return {inline_keyboard:[[{text:locale==="en"?"🔄 Check order status":"🔄 Перевірити стан замовлення",callback_data:cb(key,"retry")}]]};
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
    const compact=items.length>=12;
    items.forEach((i,n)=>{
      if(n>0) lines.push(""); // Visually separate individual positions.
      const name=esc(String(i.name||"").slice(0,compact?25:64));
      const article=esc(String(i.article||"").slice(0,55));
      if (!i.offers?.length) {lines.push((n+1)+". <code>"+article+"</code> — "+t.none);return;}
      const offer=i.offers[i.selectedOffer||0];
      // MAKA is the default selling warehouse; label only supplier offers.
      const source=offer.sourceType==="OWN_STOCK"?"":"🚚 "+t.sourceSupplier+" · ";
      if(compact) {
        // 20 parts must fit in one complete HTML message, without truncating tags.
        lines.push((n+1)+". <b>"+article+"</b>"+(name?" · "+name:"")+
          "\n   "+source+t.count+": "+Math.max(0,Number(offer.quantity))+
          " · "+t.selected+": <b>"+Number(i.quantity||0)+"</b> · "+money(offer.price,locale)+"/"+t.pcs);
      } else {
        lines.push((n+1)+". <b>"+article+"</b>"+(name?" · "+name:""));
        lines.push("   "+source+t.count+": "+Math.max(0,Number(offer.quantity))+" "+t.pcs+
          " · "+money(offer.price,locale)+"/"+t.pcs);
        lines.push("   "+t.selected+": <b>"+Number(i.quantity||0)+"</b> · "+money(Number(i.quantity||0)*Number(offer.price),locale));
      }
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
    lines.push(stage==="PICKUP"?t.delivery:stage==="CITY_CHOICE"?t.cities:t.points);

  } else if(stage==="CITY_INPUT") lines.push("🚚 "+t.city);
  else if(stage==="POINT_INPUT")lines.push("🚚 "+t.point);
  else if(stage==="CONTACT_INPUT")lines.push("👤 "+t.contact);
  else lines.push(t.delivery);
  const keyboard = stage==="EDIT"||stage==="PICKUP"||stage==="CITY_CHOICE"||stage==="POINT_CHOICE"||stage==="REVIEW"||stage==="DONE"||stage==="PROCESSING"
    ?orderKeyboard(sessionKey,stage,draft,locale)
    :{inline_keyboard:[[{text:t.back,callback_data:cb(sessionKey,"back")}]]};
  return {text:lines.join("\n"),parse_mode:"HTML",reply_markup:keyboard};
}
export function deliveryKeyboard(key,locale="uk",{pickupAvailable=true}={}) {
  const t=orderText(locale);
  return {inline_keyboard:[
    ...(pickupAvailable?[ [{text:t.pickup,callback_data:cb(key,"pickup")}] ]:[]),
    [{text:t.shipping,callback_data:cb(key,"nova")}],
    [{text:t.back,callback_data:cb(key,"back")}],
  ]};
}
