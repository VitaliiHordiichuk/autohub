import { VinRequestRepository } from "../repositories/VinRequestRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";
import { VinDecoderService } from "./VinDecoderService.js";
import { CustomerPricingService } from "./CustomerPricingService.js";

const statuses=new Set(['NEW','IN_PROGRESS','ANSWERED','CLOSED']);
function id(value){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error('Некорректный номер VIN-запроса');return n;}
function normalizeVin(value){const vin=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN должен содержать 17 символов без I, O и Q');return vin;}
function text(value){const v=String(value||'').trim();if(v.length<5)throw new Error('Опишите, какая деталь вам нужна');if(v.length>3000)throw new Error('Описание слишком длинное');return v;}
function normalizePhone(value){const raw=String(value||'').trim();if(!raw)return null;const digits=raw.replace(/\D/g,'');let normalized=digits;if(/^0\d{9}$/.test(digits))normalized=`38${digits}`;else if(/^\d{9}$/.test(digits))normalized=`380${digits}`;if(!/^380\d{9}$/.test(normalized))throw new Error('Укажите украинский номер в формате +380 XX XXX XX XX');return `+${normalized}`;}
async function present(rows,userId){const list=Array.isArray(rows)?rows:[rows];const context=await CustomerPricingService.getContext(userId);const mapped=list.map(row=>({...row,recommendations:(row.recommendations||[]).map(rec=>{const pricing=CustomerPricingService.price({retailPrice:rec.retail_price,minimumSalePrice:rec.minimum_sale_price},context);return{id:Number(rec.id),createdAt:rec.created_at,product:{id:Number(rec.product_id),article:rec.article,name:rec.name,imageUrl:rec.image_url||null},offer:{id:Number(rec.product_offer_id),sourceLabel:rec.source_label,quantity:Number(rec.quantity),deliveryDays:Number(rec.delivery_days||0),isAvailable:Boolean(rec.is_available),retailPrice:pricing?Number(pricing.customerPrice):null}};})}));return Array.isArray(rows)?mapped:mapped[0];}

export const VinRequestService={
  async create({userId,vehicleBrandId,vin,requestText,contactPhone}){
    const brandId=id(vehicleBrandId);const brand=await VinRequestRepository.supportedBrand(brandId);if(!brand)throw new Error('Извините, этой маркой мы пока не занимаемся');
    const row=await VinRequestRepository.create({userId,vehicleBrandId:brandId,vin:normalizeVin(vin),requestText:text(requestText),contactPhone:normalizePhone(contactPhone)});
    await NotificationRepository.createForStaff({eventKey:`vin:${row.id}:new`,type:'VIN_REQUEST_NEW',payload:{vinRequestId:Number(row.id),vin:row.vin}});
    return row;
  },
  async decode({vehicleBrandId,vin}){
    const brandId=id(vehicleBrandId);const brand=await VinRequestRepository.supportedBrand(brandId);if(!brand)throw new Error('Извините, этой маркой мы пока не занимаемся');
    const result=await VinDecoderService.decode(normalizeVin(vin));
    if(result.vehicle.make&&brand.name.toLowerCase().includes('mercedes')&&!result.vehicle.make.toLowerCase().includes('mercedes')){const error=new Error('VIN не соответствует выбранной марке');error.code='VIN_BRAND_MISMATCH';error.make=result.vehicle.make;throw error;}
    return {...result,selectedBrand:brand.name};
  },
  async listForUser(userId){return present(await VinRequestRepository.listForUser(userId),userId);},
  async getForUser(requestId,userId){const row=await VinRequestRepository.findForUser(id(requestId),userId);if(!row)throw new Error('VIN-запрос не найден');return present(row,userId);},
  async listForStaff({status,userId}){const normalized=status?String(status).toUpperCase():null;if(normalized&&!statuses.has(normalized))throw new Error('Неизвестный статус');return present(await VinRequestRepository.listForStaff({status:normalized}),userId);},
  summary(){return VinRequestRepository.summary();},
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
  supportedBrands(){return VinRequestRepository.supportedBrands();},
  allBrands(){return VinRequestRepository.allBrands();},
  async addBrand(name){const clean=String(name||'').trim();if(clean.length<2||clean.length>80)throw new Error('Укажите название марки');return VinRequestRepository.addBrand(clean);},
  async toggleBrand(brandId,enabled){if(typeof enabled!=='boolean')throw new Error('Поле enabled должно быть true или false');const row=await VinRequestRepository.toggleBrand(id(brandId),enabled);if(!row)throw new Error('Марка не найдена');return row;},
};
