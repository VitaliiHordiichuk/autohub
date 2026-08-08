import { VinRequestRepository } from "../repositories/VinRequestRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { VinDecoderService } from "./VinDecoderService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";
import { transaction } from "../db/transaction.js";

const statuses=new Set(['NEW','IN_PROGRESS','ANSWERED','CLOSED']);
const modes=new Set(['CHAT','DAILY_REQUEST','DISABLED']);
function id(value){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error('Некорректный номер VIN-запроса');return n;}
function normalizeVin(value){const vin=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN должен содержать 17 символов без I, O и Q');return vin;}
function text(value){const v=String(value||'').trim();if(v.length<5)throw new Error('Опишите, какая деталь вам нужна');if(v.length>3000)throw new Error('Описание слишком длинное');return v;}
function normalizePhone(value){const raw=String(value||'').trim();if(!raw)return null;const digits=raw.replace(/\D/g,'');let normalized=digits;if(/^0\d{9}$/.test(digits))normalized=`38${digits}`;else if(/^\d{9}$/.test(digits))normalized=`380${digits}`;if(!/^380\d{9}$/.test(normalized))throw new Error('Укажите украинский номер в формате +380 XX XXX XX XX');return `+${normalized}`;}
function safePhone(value){try{return normalizePhone(value);}catch{return null;}}
function serviceError(message,statusCode=400,code='VIN_REQUEST_ERROR'){const error=new Error(message);error.statusCode=statusCode;error.code=code;return error;}
function chatText(value){const clean=String(value||'').trim();if(!clean)throw serviceError('Напишите сообщение',400,'MESSAGE_REQUIRED');if(clean.length>1500)throw serviceError('Сообщение слишком длинное',400,'MESSAGE_TOO_LONG');return clean;}
function maskedPhone(value){const normalized=safePhone(value);return normalized?`${normalized.slice(0,7)}•••${normalized.slice(-2)}`:null;}
async function present(rows,userId){const list=Array.isArray(rows)?rows:[rows];const context=await CustomerPricingService.getContext(userId);const mapped=list.map(row=>({...row,recommendations:(row.recommendations||[]).map(rec=>{const pricing=CustomerPricingService.price({retailPrice:rec.retail_price,minimumSalePrice:rec.minimum_sale_price},context);return{id:Number(rec.id),createdAt:rec.created_at,dismissedAt:rec.dismissed_at||null,product:{id:Number(rec.product_id),article:rec.article,name:rec.name,imageUrl:rec.image_url||null},offer:{id:Number(rec.product_offer_id),sourceLabel:rec.source_label,quantity:Number(rec.quantity),deliveryDays:Number(rec.delivery_days||0),isAvailable:Boolean(rec.is_available),retailPrice:pricing?Number(pricing.customerPrice):null}};})}));return Array.isArray(rows)?mapped:mapped[0];}

export const VinRequestService={
  async create({userId,vehicleBrandId,vin,requestText,contactPhone}){
    const brandId=id(vehicleBrandId),cleanVin=normalizeVin(vin),cleanText=text(requestText),cleanPhone=normalizePhone(contactPhone);
    return transaction(async(db)=>{
      await db.query('SELECT pg_advisory_xact_lock($1,$2)',[Number(userId),55101]);
      const verification=await VinRequestRepository.phoneVerificationStatus(userId,db);
      const settings=await VinRequestRepository.settings(db);
      if(settings.mode==='DISABLED')throw serviceError('VIN-запросы временно отключены. Попробуйте позже или свяжитесь с нами по телефону.',503,'VIN_REQUESTS_DISABLED');
      const isClient=verification?.role_name==='CLIENT';
      if(verification?.vin_chat_blocked)throw serviceError('Доступ к VIN-чату временно ограничен. Свяжитесь с нами по телефону, и мы обязательно поможем.',403,'VIN_CLIENT_BLOCKED');
      const verifiedPhone=safePhone(verification?.phone);
      if(isClient&&!verifiedPhone)throw serviceError('Укажите корректный номер телефона в профиле',403,'PROFILE_PHONE_REQUIRED');
      if(isClient&&cleanPhone&&cleanPhone!==verifiedPhone)throw serviceError('Используйте номер телефона из аккаунта',403,'PHONE_MISMATCH');
      const brand=await VinRequestRepository.supportedBrand(brandId,db);if(!brand)throw serviceError('Извините, этой маркой мы пока не занимаемся');
      const stats=await VinRequestRepository.createStats({userId,vin:cleanVin,requestText:cleanText},db);
      if(Number(stats.duplicate_count)>0)throw serviceError('Такой запрос уже отправлен. Менеджер скоро его увидит 😊',429,'DUPLICATE_REQUEST');
      if(settings.mode==='DAILY_REQUEST'&&Number(stats.day_count)>=1)throw serviceError('Один VIN-запрос на сегодня уже принят 😊 Следующий можно отправить через 24 часа.',429,'DAILY_REQUEST_LIMIT');
      if(settings.mode==='CHAT'&&isClient&&!verification?.verified&&Number(stats.day_count)>=1)throw serviceError('Подтвердите номер телефона перед повторным VIN-запросом',403,'PHONE_VERIFICATION_REQUIRED');
      if(settings.mode==='CHAT'&&(Number(stats.hour_count)>=3||Number(stats.day_count)>=10))throw serviceError('Давайте сделаем небольшую паузу 😊 Слишком много VIN-запросов за короткое время.',429,'REQUEST_RATE_LIMIT');
      const row=await VinRequestRepository.create({userId,vehicleBrandId:brandId,vin:cleanVin,requestText:cleanText,contactPhone:verifiedPhone||cleanPhone},db);
      await NotificationRepository.createForStaff({eventKey:`vin:${row.id}:new`,type:'VIN_REQUEST_NEW',payload:{vinRequestId:Number(row.id),vin:row.vin}},db);
      return row;
    });
  },
  async decode({vehicleBrandId,vin}){
    const settings=await VinRequestRepository.settings();
    if(settings.mode==='DISABLED')throw serviceError('VIN-запросы временно отключены. Попробуйте позже или свяжитесь с нами по телефону.',503,'VIN_REQUESTS_DISABLED');
    const brandId=id(vehicleBrandId);const brand=await VinRequestRepository.supportedBrand(brandId);if(!brand)throw new Error('Извините, этой маркой мы пока не занимаемся');
    const result=await VinDecoderService.decode(normalizeVin(vin));
    if(result.vehicle.make&&brand.name.toLowerCase().includes('mercedes')&&!result.vehicle.make.toLowerCase().includes('mercedes')){const error=new Error('VIN не соответствует выбранной марке');error.code='VIN_BRAND_MISMATCH';error.make=result.vehicle.make;throw error;}
    return {...result,selectedBrand:brand.name};
  },
  async listForUser(userId){return present(await VinRequestRepository.listForUser(userId),userId);},
  async getForUser(requestId,userId){const row=await VinRequestRepository.findForUser(id(requestId),userId);if(!row)throw new Error('VIN-запрос не найден');return present(row,userId);},
  async phoneVerificationStatus(userId){
    const [row,settings]=await Promise.all([VinRequestRepository.phoneVerificationStatus(userId),VinRequestRepository.settings()]);
    if(!row)throw serviceError('Пользователь не найден',404,'USER_NOT_FOUND');
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
      if(!verification)throw serviceError('Пользователь не найден',404,'USER_NOT_FOUND');
      if(verification.vin_chat_blocked)throw serviceError('Доступ к VIN-чату временно ограничен. Свяжитесь с нами по телефону, и мы обязательно поможем.',403,'VIN_CLIENT_BLOCKED');
      if(settings.mode!=='CHAT')throw serviceError('Переписка в VIN-запросах сейчас отключена. Менеджер всё равно увидит ваш запрос и даст ответ.',403,'VIN_CHAT_DISABLED');
      const current=await VinRequestRepository.findForUser(numericId,userId,db);
      if(!current)throw serviceError('VIN-запрос не найден',404,'VIN_REQUEST_NOT_FOUND');
      if(current.status==='CLOSED')throw serviceError('Этот запрос уже закрыт. Создайте новый VIN-запрос, и мы снова поможем 😊',409,'VIN_REQUEST_CLOSED');
      const stats=await VinRequestRepository.clientMessageStats({requestId:numericId,userId,message:cleanMessage},db);
      const lastAt=stats.last_created_at?new Date(stats.last_created_at).getTime():0;
      if(lastAt&&Date.now()-lastAt<8000)throw serviceError('Сообщения летят слишком быстро 😊 Подождите несколько секунд.',429,'MESSAGE_COOLDOWN');
      if(Number(stats.duplicate_count)>0)throw serviceError('Похоже, такое сообщение уже отправлено 😊',429,'DUPLICATE_MESSAGE');
      if(Number(stats.hour_count)>=12||Number(stats.day_count)>=40)throw serviceError('Давайте немного передохнём 😊 Лимит сообщений временно исчерпан.',429,'MESSAGE_RATE_LIMIT');
      const added=await VinRequestRepository.addMessage({requestId:numericId,senderUserId:userId,message:cleanMessage},db);
      await VinRequestRepository.touchAfterClientMessage(numericId,db);
      await NotificationRepository.createForStaff({eventKey:`vin:${numericId}:client-message:${added.id}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:'IN_PROGRESS'}},db);
    });
    return present(await VinRequestRepository.findForUser(numericId,userId),userId);
  },
  async listForStaff({status,userId}){const normalized=status?String(status).toUpperCase():null;if(normalized&&!statuses.has(normalized))throw new Error('Неизвестный статус');return present(await VinRequestRepository.listForStaff({status:normalized}),userId);},
  summary(){return VinRequestRepository.summary();},
  async setClientBlock({userId,blocked,changedBy,reason}){
    const numericUserId=id(userId);
    if(typeof blocked!=='boolean')throw serviceError('Укажите действие блокировки',400,'BLOCK_VALUE_REQUIRED');
    return transaction(async(db)=>{
      const client=await VinRequestRepository.setClientBlock({userId:numericUserId,blocked,changedBy,reason},db);
      if(!client)throw serviceError('Клиент не найден',404,'CLIENT_NOT_FOUND');
      if(blocked)await VinRequestRepository.closeOpenForUser(numericUserId,db);
      return client;
    });
  },
  async update({requestId,status,message,response,changedBy}){
    const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запрос не найден');
    const normalized=String(status||current.status).toUpperCase();if(!statuses.has(normalized))throw new Error('Неизвестный статус');
    const cleanMessage=String(message===undefined?response||'':message||'').trim();if(cleanMessage.length>3000)throw new Error('Сообщение слишком длинное');
    if(cleanMessage)await VinRequestRepository.addMessage({requestId:numericId,senderUserId:changedBy,message:cleanMessage});
    const cleanResponse=cleanMessage||current.manager_response;
    const updated=await VinRequestRepository.update({id:numericId,status:normalized,response:cleanResponse,answeredBy:changedBy,messageAdded:Boolean(cleanMessage)});
    if(normalized!==current.status||Boolean(cleanMessage)){
      await NotificationRepository.createForUser({userId:Number(current.user_id),eventKey:`vin:${numericId}:update:${updated.updated_at}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:normalized}});
    }
    return present(await VinRequestRepository.findById(numericId),changedBy);
  },
  async addRecommendation({requestId,productId,productOfferId,changedBy}){const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запрос не найден');const added=await VinRequestRepository.addRecommendation({requestId:numericId,productId:id(productId),productOfferId:id(productOfferId),addedBy:changedBy});if(!added)throw new Error('Товар уже прикреплён или предложение не найдено');await NotificationRepository.createForUser({userId:Number(current.user_id),eventKey:`vin:${numericId}:recommendation:${added.id}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:current.status}});return present(await VinRequestRepository.findById(numericId),changedBy);},
  async removeRecommendation({requestId,recommendationId,changedBy}){const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запрос не найден');const removed=await VinRequestRepository.removeRecommendation({requestId:numericId,recommendationId:id(recommendationId)});if(!removed)throw new Error('Прикреплённый товар не найден');return present(await VinRequestRepository.findById(numericId),changedBy);},
  async dismissRecommendation({requestId,recommendationId,userId}){const numericId=id(requestId);const current=await VinRequestRepository.findForUser(numericId,userId);if(!current)throw serviceError('VIN-запрос не найден',404,'VIN_REQUEST_NOT_FOUND');const dismissed=await VinRequestRepository.dismissRecommendationForUser({requestId:numericId,recommendationId:id(recommendationId),userId});if(!dismissed)throw serviceError('Предложенная деталь не найдена',404,'VIN_RECOMMENDATION_NOT_FOUND');return present(await VinRequestRepository.findForUser(numericId,userId),userId);},
  settings(){return VinRequestRepository.settings();},
  async updateSettings({mode,changedBy}){const normalized=String(mode||'').toUpperCase();if(!modes.has(normalized))throw serviceError('Неизвестный режим VIN-запросов',400,'VIN_MODE_INVALID');return VinRequestRepository.updateSettings({mode:normalized,updatedBy:changedBy});},
  supportedBrands(){return VinRequestRepository.supportedBrands();},
  allBrands(){return VinRequestRepository.allBrands();},
  async addBrand(name){const clean=String(name||'').trim();if(clean.length<2||clean.length>80)throw new Error('Укажите название марки');return VinRequestRepository.addBrand(clean);},
  async toggleBrand(brandId,enabled){if(typeof enabled!=='boolean')throw new Error('Поле enabled должно быть true или false');const row=await VinRequestRepository.toggleBrand(id(brandId),enabled);if(!row)throw new Error('Марка не найдена');return row;},
};
