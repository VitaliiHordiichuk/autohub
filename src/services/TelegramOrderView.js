import { escapeTelegramHtml, telegramProductUrl } from "./TelegramCatalogFormatter.js";

export function telegramOrderLocale(locale) { return locale === "en" ? "en" : "uk"; }
const TXT = {
  uk: {
    header: "🔎 <b>Результати пошуку</b>", count:"Доступно",selected:"Обрано",
    none:"Не знайдено", unavailable:"Немає в наявності", total:"Разом",pcs:"шт.",
    add:"➕ Ще артикул", next:"🛒 Додати вибране до кошика",
    cartTitle:"🛒 <b>Ваш кошик</b>",cartAdd:"➕ Додати запчастини",checkout:"✅ Оформити замовлення",
    openProduct:"🔗 Переглянути на MAKA",
    alternative:"Інший номер",pickAlternative:"Обрати",
    clearCart:"🗑 Очистити кошик",clearQuestion:"<b>Видалити всі товари з кошика?</b>",
    clearYes:"🗑 Так, очистити",clearNo:"Ні, залишити",
    cartSaved:"✅ Вибрані товари додано до кошика.",cartEmpty:"Кошик порожній.",
    searchPrompt:"🔎 Надішліть артикул або список артикулів для пошуку.",
    cartWarning:"⚠️ Ціни або залишки змінилися. Перевірте оновлений кошик перед оформленням.",
    sourceOwn:"Склад MAKA", sourceSupplier:"Постачальник", more:"Змінити пропозицію",
    pickup:"🏬 Самовивіз", shipping:"🚚 Нова пошта", back:"⬅️ До списку",
    delivery:"<b>Оберіть спосіб отримання</b>", city:"Введіть місто Нової пошти повідомленням.",
    cities:"<b>Оберіть місто</b>", point:"Введіть номер або назву відділення / поштомата повідомленням.",
    points:"<b>Оберіть відділення або поштомат</b>",
    contact:"Надішліть ім’я, прізвище та телефон одним повідомленням: <b>Ім’я Прізвище +380XXXXXXXXX</b>",
    contactConfirm:"<b>Перевірте контактні дані з вашого профілю MAKA</b>",
    contactAccept:"✅ Дані правильні",contactEdit:"✏️ Змінити дані",
    commentPrompt:"💬 <b>Коментарій до замовлення (необов’язково)</b>\nМожете додати побажання для менеджера.",
    commentInput:"💬 Надішліть коментарій одним повідомленням (до 500 символів).",
    commentAdd:"✏️ Додати коментарій",commentSkip:"➡️ Пропустити",
    freshSearch:"🔍 Новий пошук",
    commentLabel:"Коментарій",
    review:"<b>Перевірте замовлення перед оформленням</b>", customer:"Отримувач",
    deliveryLabel:"Доставка", submit:"✅ Оформити замовлення", newSearch:"🔍 Новий пошук",
    empty:"У списку немає вибраних товарів.", onlyOne:"Кількість не може перевищувати залишок.",
    done:"✅ <b>Дякуємо за замовлення!</b>\nМенеджер зв’яжеться з вами.", order:"Номер", orders:"Замовлення",
    processing:"⏳ Перевіряємо залишки та створюємо замовлення…",
    split:"Товари зі складу MAKA та від постачальників оформлюються окремими замовленнями.",
  },
  en: {
    header:"🔎 <b>Search results</b>",count:"Available",selected:"Selected",
    none:"Not found",unavailable:"Out of stock",total:"Total",pcs:"pcs",
    add:"➕ More articles",next:"🛒 Add selected to cart",
    cartTitle:"🛒 <b>Your cart</b>",cartAdd:"➕ Add parts",checkout:"✅ Checkout",
    openProduct:"🔗 View on MAKA",
    alternative:"Alternative",pickAlternative:"Select",
    clearCart:"🗑 Clear cart",clearQuestion:"<b>Remove every item from your cart?</b>",
    clearYes:"🗑 Yes, clear",clearNo:"No, keep items",
    cartSaved:"✅ Selected items were added to your cart.",cartEmpty:"Your cart is empty.",
    searchPrompt:"🔎 Send a part number or list of part numbers.",
    cartWarning:"⚠️ Prices or stock changed. Review your updated cart before checkout.",
    sourceOwn:"MAKA warehouse",sourceSupplier:"Supplier",more:"Switch offer",
    pickup:"🏬 Collection",shipping:"🚚 Nova Poshta",back:"⬅️ Back to parts",
    delivery:"<b>Select delivery method</b>",city:"Send your Nova Poshta city as a message.",
    cities:"<b>Select city</b>",point:"Send a branch or parcel locker number/name.",
    points:"<b>Select branch or locker</b>",
    contact:"Send your first name, last name and phone in one message: <b>First Last +380XXXXXXXXX</b>",
    contactConfirm:"<b>Check the contact information from your MAKA account</b>",
    contactAccept:"✅ Details are correct",contactEdit:"✏️ Change details",
    commentPrompt:"💬 <b>Order comment (optional)</b>\nYou can add a note for the manager.",
    commentInput:"💬 Send your comment in one message (up to 500 characters).",
    commentAdd:"✏️ Add a comment",commentSkip:"➡️ Skip",
    freshSearch:"🔍 New search",
    commentLabel:"Comment",
    review:"<b>Review your order before placing it</b>",customer:"Recipient",
    deliveryLabel:"Delivery",submit:"✅ Place order",newSearch:"🔍 New search",
    empty:"No items selected.",onlyOne:"Quantity cannot exceed available stock.",
    done:"✅ <b>Thank you for your order!</b>\nOur manager will contact you.",order:"Number",orders:"Orders",
    processing:"⏳ Checking stock and creating your order…",
    split:"MAKA warehouse and supplier items are placed as separate orders.",
  },
};
export function orderText(locale) { return TXT[telegramOrderLocale(locale)]; }
export function telegramMainKeyboard(locale="uk") {
  return {keyboard:[[
    {text:locale==="en"?"🔎 Search":"🔎 Пошук"},
    {text:locale==="en"?"🛒 Cart":"🛒 Кошик"},
  ]],resize_keyboard:true,is_persistent:true,one_time_keyboard:false};
}
export function telegramMenuIntent(text){
  const input=String(text||"").trim();
  if(["🔎 Пошук","🔎 Search"].includes(input))return "search";
  if(["🛒 Кошик","🛒 Cart"].includes(input))return "cart";
  return null;
}

export function money(value,locale="uk") {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "uk-UA",{maximumFractionDigits:2}).format(Number(value || 0))
    + (locale === "en" ? " UAH" : " грн");
}
function cb(key, action, index = null) {return "mo:" + key + ":" + action + (index === null ? "" : ":" + Number(index).toString(36));}
export function orderKeyboard(key,stage,draft,locale="uk") {
  const t = orderText(locale);
  if (stage === "EDIT" || stage === "CART") {
    const rows = [];
    const items = draft.items || [];
    // Position numbers only help when the current list has multiple entries.
    const singleItem=items.length===1;
    // One compact row per part, referenced by its number in the quote above.
    // Paginate at 10 parts so keyboards stay within Telegram API limits.
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(pageCount - 1, Math.max(0, Number(draft.page) || 0));
    for (let i = page * pageSize; i < Math.min(items.length, (page + 1) * pageSize); i++) {
      const item = items[i];
      if (!item.offers?.length) {
        if(stage==="CART")rows.push([
          ...(!singleItem?[{text:"№"+(i+1),callback_data:cb(key,"a",i)}]:[]),
          {text:"🗑",callback_data:cb(key,"x",i)},
        ]);
        // The site may list other colour/fitment variants. The customer must
        // explicitly choose one; never auto-sell it as the unavailable base.
        if(stage==="EDIT"&&item.alternatives?.length)rows.push([{
          text:"🔁 "+(singleItem?"":("№"+(i+1)+" · "))+t.pickAlternative+" "+
            String(item.alternatives[0].article).slice(0,28),
          callback_data:cb(key,"v",i),
        }]);
        continue;
      }
      // One result needs no №1 in search or in the saved cart.
      // Two or more results keep numbered article references.
      rows.push([
        ...(!singleItem?[{
          text:"№"+(i+1),
          callback_data:cb(key,item.offers.length>1?"s":"a",i),
        }]:[]),
        {text: String(item.quantity || 0) + " " + t.pcs, callback_data: cb(key, "q", i)},
        {text: "−", callback_data: cb(key, "m", i)},
        {text: "+", callback_data: cb(key, "p", i)},
        {text: "🗑", callback_data: cb(key, "x", i)},
      ]);
      if(stage==="EDIT"&&item.alternatives?.length) {
        // One short switch button directly under its position, not a second
        // cart item or a fake quantity/price row.
        rows.push([{
          text:"🔁 "+(singleItem?"":("№"+(i+1)+" · "))+t.pickAlternative+" "+String(item.alternatives[0].article).slice(0,28),
          callback_data:cb(key,"v",i),
        }]);
      }
    }
    // Telegram link buttons open the product card without affecting the cart.
    // Show a dedicated button for one part; multi-part lists use linked articles
    // inside the message to avoid a long row of extra buttons.
    if(items.length===1 && items[0]?.offers?.length) {
      const url=telegramProductUrl(items[0].article,locale);
      if(url)rows.push([{text:t.openProduct,url}]);
    }
    if (pageCount > 1) {
      const navigation = [];
      if (page > 0) navigation.push({text: "◀", callback_data: cb(key, "pgprev")});
      navigation.push({text: (page + 1) + "/" + pageCount, callback_data: cb(key, "pginfo")});
      if (page < pageCount - 1) navigation.push({text: "▶", callback_data: cb(key, "pgnext")});
      rows.push(navigation);
    }
    if(stage==="EDIT") {
      rows.push([{text:t.next,callback_data:cb(key,"next")}]);
      rows.push([{text:t.add,callback_data:cb(key,"add")}]);
    } else {
      rows.push([{text:t.cartAdd,callback_data:cb(key,"more")}]);
      rows.push([{text:t.checkout,callback_data:cb(key,"checkout")}]);
      rows.push([{text:t.clearCart,callback_data:cb(key,"clear")}]);
    }
    // iOS may collapse reply keyboards despite is_persistent. These inline
    // shortcuts stay with the current result/cart even when hidden below.
    rows.push([
      {text:locale==="en"?"🔎 Search":"🔎 Пошук",callback_data:cb(key,"gosearch")},
      {text:locale==="en"?"🛒 Cart":"🛒 Кошик",callback_data:cb(key,"gocart")},
    ]);
    return {inline_keyboard: rows};
  }
  if(stage==="CART_CLEAR_CONFIRM")return {inline_keyboard:[
    [{text:t.clearYes,callback_data:cb(key,"clearok")}],
    [{text:t.clearNo,callback_data:cb(key,"clearcancel")}],
  ]};
  // Historic draft data must never render internal warehouse names or addresses.
  if (stage === "PICKUP") return {inline_keyboard:[
    [{text:t.back,callback_data:cb(key,"back")}],
  ]};
  if (stage === "CITY_CHOICE" || stage === "POINT_CHOICE") return {inline_keyboard:[
    ...(draft.options || []).slice(0,8).map((o,i) => [{text:String(o.displayName||o.name).slice(0,55),callback_data:cb(key,stage==="CITY_CHOICE"?"city":"point",i)}]),
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
  if (stage === "CONTACT_CONFIRM") return {inline_keyboard:[
    [{text:t.contactAccept,callback_data:cb(key,"contactok")}],
    [{text:t.contactEdit,callback_data:cb(key,"contactedit")}],
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
  if (stage === "COMMENT_CHOICE") return {inline_keyboard:[
    [{text:t.commentAdd,callback_data:cb(key,"commentadd")}],
    [{text:t.commentSkip,callback_data:cb(key,"commentskip")}],
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
  if (stage === "COMMENT_INPUT") return {inline_keyboard:[
    [{text:t.commentSkip,callback_data:cb(key,"commentskip")}],
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
  if (stage === "REVIEW") return {inline_keyboard:[
    [{text:t.submit,callback_data:cb(key,"submit")}],
    [{text:t.contactEdit,callback_data:cb(key,"contactedit")}],
    [{text:t.commentAdd,callback_data:cb(key,"commentadd")}],
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
  if (stage === "DONE") return {inline_keyboard:[[{
    text:t.newSearch,callback_data:cb(key,"reset"),
  }]]};
  if (stage === "PROCESSING") return {inline_keyboard:[[{text:locale==="en"?"🔄 Check order status":"🔄 Перевірити стан замовлення",callback_data:cb(key,"retry")}]]};
  return {inline_keyboard:[
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
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
  } else if (stage==="CART_CLEAR_CONFIRM") {
    lines.push(t.clearQuestion);
  } else if (stage==="SEARCH_INPUT") {
    lines.push(t.searchPrompt);
  } else if (stage==="EDIT"||stage==="CART"||stage==="REVIEW") {
    lines.push(stage==="REVIEW"?t.review:stage==="CART"?t.cartTitle:t.header);
    const compact=items.length>=12;
    const singleItem=items.length===1;
    items.forEach((i,n)=>{
      if(n>0) lines.push(""); // Visually separate individual positions.
      const name=esc(String(i.name||"").slice(0,compact?25:64));
      const article=esc(String(i.article||"").slice(0,55));
      const prefix=singleItem?"":(n+1)+". ";
      if (!i.offers?.length) {
        lines.push(prefix+"<code>"+article+"</code> — "+t.none);
        if(stage==="EDIT"&&i.alternatives?.length){
          const alternative=i.alternatives[0];
          const offer=alternative.offers?.[alternative.selectedOffer||0];
          if(offer){
            lines.push("   ↳ "+t.alternative+": <code>"+
              esc(String(alternative.article||"").slice(0,55))+"</code>"+
              " · "+Math.max(0,Number(offer.quantity))+" "+t.pcs+
              " · "+money(offer.price,locale)+"/"+t.pcs);
          }
        }
        return;
      }
      const productUrl=(stage==="EDIT"||stage==="CART")
        ?telegramProductUrl(i.article,locale):null;
      const articleLabel=productUrl
        ?'<a href="'+esc(productUrl)+'">'+article+'</a>'
        :"<b>"+article+"</b>";
      // One searched number stays one result, even if stock was found on a
      // compatible Mercedes extension. The link always opens the real item.
      const requested=i.requestedArticle&&stage==="EDIT"
        ?esc(String(i.requestedArticle).slice(0,55))+" → "
        :"";
      const articleLine=requested+articleLabel;
      const offer=i.offers[i.selectedOffer||0];
      // MAKA is the default selling warehouse; label only supplier offers.
      const source=offer.sourceType==="OWN_STOCK"?"":"🚚 "+t.sourceSupplier+" · ";
      if(compact) {
        // 20 parts must fit in one complete HTML message, without truncating tags.
        lines.push(prefix+articleLine+(name?" · "+name:"")+
          "\n   "+source+t.count+": "+Math.max(0,Number(offer.quantity))+
          " · "+t.selected+": <b>"+Number(i.quantity||0)+"</b> · "+money(offer.price,locale)+"/"+t.pcs);
      } else {
        lines.push(prefix+articleLine+(name?" · "+name:""));
        lines.push("   "+source+t.count+": "+Math.max(0,Number(offer.quantity))+" "+t.pcs+
          " · "+money(offer.price,locale)+"/"+t.pcs);
        lines.push("   "+t.selected+": <b>"+Number(i.quantity||0)+"</b> · "+money(Number(i.quantity||0)*Number(offer.price),locale));
      }
      if(stage==="EDIT"&&i.alternatives?.length) {
        const alternative=i.alternatives[0],altOffer=alternative.offers?.[alternative.selectedOffer||0];
        if(altOffer) {
          const altArticle=esc(String(alternative.article||"").slice(0,55));
          const altUrl=telegramProductUrl(alternative.article,locale);
          // In 12-20 line searches a second URL for every row can exceed
          // Telegram's 4096-char limit. Display its number plainly there;
          // choosing it makes it the primary clickable article.
          const altLink=!compact&&altUrl?'<a href="'+esc(altUrl)+'">'+altArticle+'</a>':altArticle;
          lines.push("   ↳ "+(compact?"":t.alternative+": ")+altLink+
            " · "+Math.max(0,Number(altOffer.quantity))+" "+t.pcs+
            " · "+money(altOffer.price,locale)+(compact?"":"/"+t.pcs));
        }
      }
    });
    lines.push("");
    lines.push("<b>"+t.total+": "+money(total,locale)+"</b>");
    if(stage==="CART"&&!items.length)lines.push(t.cartEmpty);
    if(stage==="CART"&&draft.notice)lines.push(escapeTelegramHtml(draft.notice));
    if(stage==="REVIEW") {
      const d=draft.delivery||{}, contact=draft.contact||{};
      lines.push(t.customer+": "+esc([contact.firstName,contact.lastName,contact.phone].filter(Boolean).join(" ")));
      lines.push(t.deliveryLabel+": "+esc(d.label||""));
      if(draft.comment) lines.push("💬 "+t.commentLabel+": "+esc(draft.comment));
      if(new Set(selected.map(i=>i.offers[i.selectedOffer||0].sourceType)).size>1)lines.push("ℹ️ "+t.split);
    }
  } else if(stage==="CONTACT_CONFIRM") {
    const contact=draft.contact||{};
    lines.push(t.contactConfirm);
    lines.push("");
    lines.push("👤 "+esc([contact.firstName,contact.lastName].filter(Boolean).join(" ")));
    lines.push("📱 "+esc(contact.phone||""));
  } else if(stage==="COMMENT_CHOICE") {
    lines.push(t.commentPrompt);
    if(draft.comment)lines.push("\n💬 "+t.commentLabel+": "+esc(draft.comment));
  } else if(stage==="COMMENT_INPUT") {
    lines.push(t.commentInput);
    if(draft.comment)lines.push("\n💬 "+t.commentLabel+": "+esc(draft.comment));
  } else if(stage==="PICKUP"||stage==="CITY_CHOICE"||stage==="POINT_CHOICE") {
    lines.push(stage==="PICKUP"?t.delivery:stage==="CITY_CHOICE"?t.cities:t.points);

  } else if(stage==="CITY_INPUT") lines.push("🚚 "+t.city);
  else if(stage==="POINT_INPUT")lines.push("🚚 "+t.point);
  else if(stage==="CONTACT_INPUT")lines.push("👤 "+t.contact);
  else lines.push(t.delivery);
  const keyboard = stage==="EDIT"||stage==="CART"||stage==="CART_CLEAR_CONFIRM"||stage==="PICKUP"||stage==="CITY_CHOICE"||stage==="POINT_CHOICE"||stage==="CONTACT_CONFIRM"||stage==="COMMENT_CHOICE"||stage==="COMMENT_INPUT"||stage==="REVIEW"||stage==="DONE"||stage==="PROCESSING"
    ?orderKeyboard(sessionKey,stage,draft,locale)
    :{inline_keyboard:[
      [{text:t.back,callback_data:cb(sessionKey,"back")}],
      [{text:t.freshSearch,callback_data:cb(sessionKey,"newsearch")}],
    ]};
  // In multi-part searches Telegram otherwise expands the first product
  // link into a large card, obscuring the remaining search results.
  // Explicitly set this on both new messages and edits (publish forwards it).
  const link_preview_options=(stage==="EDIT"||stage==="CART")
    ? {
        is_disabled:items.length!==1,
        // Put the product photo/link card before the price and availability
        // only for a single-part search; leave cart presentation unchanged.
        ...(stage==="EDIT"&&items.length===1?{show_above_text:true}:{}),
      }
    : {is_disabled:true};
  return {text:lines.join("\n"),parse_mode:"HTML",
    link_preview_options,reply_markup:keyboard};
}
export function deliveryKeyboard(key,locale="uk",{pickupAvailable=true}={}) {
  const t=orderText(locale);
  return {inline_keyboard:[
    ...(pickupAvailable?[ [{text:t.pickup,callback_data:cb(key,"pickup")}] ]:[]),
    [{text:t.shipping,callback_data:cb(key,"nova")}],
    [{text:t.back,callback_data:cb(key,"back")}],
    [{text:t.freshSearch,callback_data:cb(key,"newsearch")}],
  ]};
}
