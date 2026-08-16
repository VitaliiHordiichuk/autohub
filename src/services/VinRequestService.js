import { VinRequestRepository } from "../repositories/VinRequestRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { VinDecoderService } from "./VinDecoderService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { TelegramNotificationService } from "./TelegramNotificationService.js";
import { transaction } from "../db/transaction.js";

const statuses=new Set(['NEW','IN_PROGRESS','ANSWERED','CLOSED']);
const modes=new Set(['CHAT','DAILY_REQUEST','DISABLED']);
function id(value){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error('Некоректний номер VIN-запиту');return n;}
function normalizeVin(value){const vin=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN має містити 17 символів без I, O та Q');return vin;}
function text(value){const v=String(value||'').trim();if(v.length<5)throw new Error('Опишіть, яка деталь вам потрібна');if(v.length>3000)throw new Error('Опис надто довгий');return v;}
function normalizePhone(value){const raw=String(value||'').trim();if(!raw)return null;const digits=raw.replace(/\D/g,'');let normalized=digits;if(/^0\d{9}$/.test(digits))normalized=`38${digits}`;else if(/^\d{9}$/.test(digits))normalized=`380${digits}`;if(!/^380\d{9}$/.test(normalized))throw new Error('Вкажіть український номер у форматі +380 XX XXX XX XX');return `+${normalized}`;}
function safePhone(value){try{return normalizePhone(value);}catch{return null;}}
function serviceError(message,statusCode=400,code='VIN_REQUEST_ERROR'){const error=new Error(message);error.statusCode=statusCode;error.code=code;return error;}
function chatText(value){const clean=String(value||'').trim();if(!clean)throw serviceError('Напишіть повідомлення',400,'MESSAGE_REQUIRED');if(clean.length>1500)throw serviceError('Повідомлення надто довге',400,'MESSAGE_TOO_LONG');return clean;}
function maskedPhone(value){const normalized=safePhone(value);return normalized?`${normalized.slice(0,7)}•••${normalized.slice(-2)}`:null;}
async function present(rows,userId){const list=Array.isArray(rows)?rows:[rows];const context=await CustomerPricingService.getContext(userId);const mapped=list.map(row=>({...row,recommendations:(row.recommendations||[]).map(rec=>{const pricing=CustomerPricingService.price({retailPrice:rec.retail_price,minimumSalePrice:rec.minimum_sale_price},context);return{id:Number(rec.id),createdAt:rec.created_at,dismissedAt:rec.dismissed_at||null,product:{id:Number(rec.product_id),article:rec.article,name:rec.name,imageUrl:rec.image_url||null},offer:{id:Number(rec.product_offer_id),sourceLabel:rec.source_label,quantity:Number(rec.quantity),deliveryDays:Number(rec.delivery_days||0),isAvailable:Boolean(rec.is_available),isReturnable:rec.is_returnable!==false,retailPrice:pricing?Number(pricing.customerPrice):null}};})}));return Array.isArray(rows)?mapped:mapped[0];}

export const VinRequestService={
  async create({userId,vehicleBrandId,vin,requestText,contactPhone}){
    const brandId=id(vehicleBrandId),cleanVin=normalizeVin(vin),cleanText=text(requestText),cleanPhone=normalizePhone(contactPhone);
    const created=await transaction(async(db)=>{
      await db.query('SELECT pg_advisory_xact_lock($1,$2)',[Number(userId),55101]);
      const verification=await VinRequestRepository.phoneVerificationStatus(userId,db);
      const settings=await VinRequestRepository.settings(db);
      if(settings.mode==='DISABLED')throw serviceError('VIN-запити тимчасово вимкнені. Спробуйте пізніше або зв’яжіться з нами телефоном.',503,'VIN_REQUESTS_DISABLED');
      const isClient=verification?.role_name==='CLIENT';
      if(verification?.vin_chat_blocked)throw serviceError('Доступ до VIN-чату тимчасово обмежено. Зв’яжіться з нами телефоном, і ми обов’язково допоможемо.',403,'VIN_CLIENT_BLOCKED');
      const verifiedPhone=safePhone(verification?.phone);
      if(isClient&&!verifiedPhone)throw serviceError('Вкажіть коректний номер телефону в профілі',403,'PROFILE_PHONE_REQUIRED');
      if(isClient&&cleanPhone&&cleanPhone!==verifiedPhone)throw serviceError('Використовуйте номер телефону з акаунта',403,'PHONE_MISMATCH');
      const brand=await VinRequestRepository.supportedBrand(brandId,db);if(!brand)throw serviceError('Перепрошуємо, цією маркою ми поки не займаємося');
      const stats=await VinRequestRepository.createStats({userId,vin:cleanVin,requestText:cleanText},db);
      if(Number(stats.duplicate_count)>0)throw serviceError('Такий запит уже надіслано. Менеджер незабаром його побачить 😊',429,'DUPLICATE_REQUEST');
      if(settings.mode==='DAILY_REQUEST'&&Number(stats.day_count)>=1)throw serviceError('Один VIN-запит на сьогодні вже прийнято 😊 Наступний можна надіслати через 24 години.',429,'DAILY_REQUEST_LIMIT');
      if(settings.mode==='CHAT'&&isClient&&!verification?.verified&&Number(stats.day_count)>=1)throw serviceError('Підтвердьте номер телефону перед повторним VIN-запитом',403,'PHONE_VERIFICATION_REQUIRED');
      if(settings.mode==='CHAT'&&(Number(stats.hour_count)>=3||Number(stats.day_count)>=10))throw serviceError('Зробімо невелику паузу 😊 Надто багато VIN-запитів за короткий час.',429,'REQUEST_RATE_LIMIT');
      const row=await VinRequestRepository.create({userId,vehicleBrandId:brandId,vin:cleanVin,requestText:cleanText,contactPhone:verifiedPhone||cleanPhone},db);
      await NotificationRepository.createForStaff({eventKey:`vin:${row.id}:new`,type:'VIN_REQUEST_NEW',payload:{vinRequestId:Number(row.id),vin:row.vin}},db);
      return row;
    });
    void TelegramNotificationService.sendVinActivityToStaff({
      requestId:created.id,event:'NEW_REQUEST',message:cleanText,
    }).catch((error)=>console.error('Не вдалося надіслати Telegram-сповіщення про VIN-запит:',error.message));
    return created;
  },
  async decode({vehicleBrandId,vin}){
    const settings=await VinRequestRepository.settings();
    if(settings.mode==='DISABLED')throw serviceError('VIN-запити тимчасово вимкнені. Спробуйте пізніше або зв’яжіться з нами телефоном.',503,'VIN_REQUESTS_DISABLED');
    const brandId=id(vehicleBrandId);const brand=await VinRequestRepository.supportedBrand(brandId);if(!brand)throw new Error('Перепрошуємо, цією маркою ми поки не займаємося');
    const result=await VinDecoderService.decode(normalizeVin(vin));
    if(result.vehicle.make&&brand.name.toLowerCase().includes('mercedes')&&!result.vehicle.make.toLowerCase().includes('mercedes')){const error=new Error('VIN не відповідає вибраній марці');error.code='VIN_BRAND_MISMATCH';error.make=result.vehicle.make;throw error;}
    return {...result,selectedBrand:brand.name};
  },
  async listForUser(userId){return present(await VinRequestRepository.listForUser(userId),userId);},
  async getForUser(requestId,userId){const row=await VinRequestRepository.findForUser(id(requestId),userId);if(!row)throw new Error('VIN-запит не знайдено');return present(row,userId);},
  async phoneVerificationStatus(userId){
    const [row,settings]=await Promise.all([VinRequestRepository.phoneVerificationStatus(userId),VinRequestRepository.settings()]);
    if(!row)throw serviceError('Користувача не знайдено',404,'USER_NOT_FOUND');
    const isClient=row.role_name==='CLIENT',blocked=Boolean(row.vin_chat_blocked),verified=!isClient||Boolean(row.verified),hasValidPhone=Boolean(safePhone(row.phone));
    const requestEnabled=settings.mode!=='DISABLED',chatEnabled=settings.mode==='CHAT';
    const dailyLimitReached=settings.mode==='DAILY_REQUEST'&&Number(row.recent_request_count)>0;
    const required=chatEnabled&&isClient&&!verified&&Number(row.recent_request_count)>0;
    return{verified,required,blocked,mode:settings.mode,requestEnabled,chatEnabled,dailyLimitReached,
      canCreate:!blocked&&requestEnabled&&!dailyLimitReached&&(!isClient||(hasValidPhone&&!required)),
      phone:maskedPhone(row.phone),contactPhone:safePhone(row.phone),telegramConnected:Boolean(row.telegram_connected)};
  },
  async addClientMessage({requestId,userId,message}){
    const numericId=id(requestId),cleanMessage=chatText(message);
    await transaction(async(db)=>{
      await db.query('SELECT pg_advisory_xact_lock($1,$2)',[Number(userId),numericId]);
      const verification=await VinRequestRepository.phoneVerificationStatus(userId,db);
      const settings=await VinRequestRepository.settings(db);
      if(!verification)throw serviceError('Користувача не знайдено',404,'USER_NOT_FOUND');
      if(verification.vin_chat_blocked)throw serviceError('Доступ до VIN-чату тимчасово обмежено. Зв’яжіться з нами телефоном, і ми обов’язково допоможемо.',403,'VIN_CLIENT_BLOCKED');
      if(settings.mode!=='CHAT')throw serviceError('Листування у VIN-запитах зараз вимкнене. Менеджер усе одно побачить ваш запит і надасть відповідь.',403,'VIN_CHAT_DISABLED');
      const current=await VinRequestRepository.findForUser(numericId,userId,db);
      if(!current)throw serviceError('VIN-запит не знайдено',404,'VIN_REQUEST_NOT_FOUND');
      if(current.status==='CLOSED')throw serviceError('Цей запит уже закрито. Створіть новий VIN-запит, і ми знову допоможемо 😊',409,'VIN_REQUEST_CLOSED');
      const stats=await VinRequestRepository.clientMessageStats({requestId:numericId,userId,message:cleanMessage},db);
      const lastAt=stats.last_created_at?new Date(stats.last_created_at).getTime():0;
      if(lastAt&&Date.now()-lastAt<8000)throw serviceError('Повідомлення надходять надто швидко 😊 Зачекайте кілька секунд.',429,'MESSAGE_COOLDOWN');
      if(Number(stats.duplicate_count)>0)throw serviceError('Схоже, таке повідомлення вже надіслано 😊',429,'DUPLICATE_MESSAGE');
      if(Number(stats.hour_count)>=12||Number(stats.day_count)>=40)throw serviceError('Трохи перепочиньмо 😊 Ліміт повідомлень тимчасово вичерпано.',429,'MESSAGE_RATE_LIMIT');
      const added=await VinRequestRepository.addMessage({requestId:numericId,senderUserId:userId,message:cleanMessage},db);
      await VinRequestRepository.touchAfterClientMessage(numericId,db);
      await NotificationRepository.createForStaff({eventKey:`vin:${numericId}:client-message:${added.id}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:'IN_PROGRESS'}},db);
    });
    void TelegramNotificationService.sendVinActivityToStaff({
      requestId:numericId,event:'CLIENT_MESSAGE',message:cleanMessage,
    }).catch((error)=>console.error('Не вдалося надіслати Telegram-сповіщення про VIN-повідомлення:',error.message));
    return present(await VinRequestRepository.findForUser(numericId,userId),userId);
  },
  async listForStaff({status,userId}){const normalized=status?String(status).toUpperCase():null;if(normalized&&!statuses.has(normalized))throw new Error('Невідомий статус');return present(await VinRequestRepository.listForStaff({status:normalized}),userId);},
  summary(){return VinRequestRepository.summary();},
  async setClientBlock({userId,blocked,changedBy,reason}){
    const numericUserId=id(userId);
    if(typeof blocked!=='boolean')throw serviceError('Вкажіть дію блокування',400,'BLOCK_VALUE_REQUIRED');
    return transaction(async(db)=>{
      const client=await VinRequestRepository.setClientBlock({userId:numericUserId,blocked,changedBy,reason},db);
      if(!client)throw serviceError('Клієнта не знайдено',404,'CLIENT_NOT_FOUND');
      if(blocked)await VinRequestRepository.closeOpenForUser(numericUserId,db);
      return client;
    });
  },
  async update({requestId,status,message,response,changedBy}){
    const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запит не знайдено');
    const normalized=String(status||current.status).toUpperCase();if(!statuses.has(normalized))throw new Error('Невідомий статус');
    const cleanMessage=String(message===undefined?response||'':message||'').trim();if(cleanMessage.length>3000)throw new Error('Повідомлення надто довге');
    if(cleanMessage)await VinRequestRepository.addMessage({requestId:numericId,senderUserId:changedBy,message:cleanMessage});
    const cleanResponse=cleanMessage||current.manager_response;
    const updated=await VinRequestRepository.update({id:numericId,status:normalized,response:cleanResponse,answeredBy:changedBy,messageAdded:Boolean(cleanMessage)});
    if(normalized!==current.status||Boolean(cleanMessage)){
      await NotificationRepository.createForUser({userId:Number(current.user_id),eventKey:`vin:${numericId}:update:${updated.updated_at}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:normalized}});
    }
    return present(await VinRequestRepository.findById(numericId),changedBy);
  },
  async addRecommendation({requestId,productId,productOfferId,changedBy}){const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запит не знайдено');const added=await VinRequestRepository.addRecommendation({requestId:numericId,productId:id(productId),productOfferId:id(productOfferId),addedBy:changedBy});if(!added)throw new Error('Товар уже прикріплено або пропозицію не знайдено');await NotificationRepository.createForUser({userId:Number(current.user_id),eventKey:`vin:${numericId}:recommendation:${added.id}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:current.status}});return present(await VinRequestRepository.findById(numericId),changedBy);},
  async removeRecommendation({requestId,recommendationId,changedBy}){const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запит не знайдено');const removed=await VinRequestRepository.removeRecommendation({requestId:numericId,recommendationId:id(recommendationId)});if(!removed)throw new Error('Прикріплений товар не знайдено');return present(await VinRequestRepository.findById(numericId),changedBy);},
  async dismissRecommendation({requestId,recommendationId,userId}){const numericId=id(requestId);const current=await VinRequestRepository.findForUser(numericId,userId);if(!current)throw serviceError('VIN-запит не знайдено',404,'VIN_REQUEST_NOT_FOUND');const dismissed=await VinRequestRepository.dismissRecommendationForUser({requestId:numericId,recommendationId:id(recommendationId),userId});if(!dismissed)throw serviceError('Запропоновану деталь не знайдено',404,'VIN_RECOMMENDATION_NOT_FOUND');return present(await VinRequestRepository.findForUser(numericId,userId),userId);},
  settings(){return VinRequestRepository.settings();},
  async updateSettings({mode,changedBy}){const normalized=String(mode||'').toUpperCase();if(!modes.has(normalized))throw serviceError('Невідомий режим VIN-запитів',400,'VIN_MODE_INVALID');return VinRequestRepository.updateSettings({mode:normalized,updatedBy:changedBy});},
  supportedBrands(){return VinRequestRepository.supportedBrands();},
  allBrands(){return VinRequestRepository.allBrands();},
  async addBrand(name){const clean=String(name||'').trim();if(clean.length<2||clean.length>80)throw new Error('Вкажіть назву марки');return VinRequestRepository.addBrand(clean);},
  async toggleBrand(brandId,enabled){if(typeof enabled!=='boolean')throw new Error('Поле enabled має бути true або false');const row=await VinRequestRepository.toggleBrand(id(brandId),enabled);if(!row)throw new Error('Марку не знайдено');return row;},
};
