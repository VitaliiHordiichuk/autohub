import { VinRequestRepository } from "../repositories/VinRequestRepository.js";
import { NotificationRepository } from "../repositories/NotificationRepository.js";

const statuses=new Set(['NEW','IN_PROGRESS','ANSWERED','CLOSED']);
function id(value){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new Error('Некорректный номер VIN-запроса');return n;}
function normalizeVin(value){const vin=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new Error('VIN должен содержать 17 символов без I, O и Q');return vin;}
function text(value){const v=String(value||'').trim();if(v.length<5)throw new Error('Опишите, какая деталь вам нужна');if(v.length>3000)throw new Error('Описание слишком длинное');return v;}

export const VinRequestService={
  async create({userId,vehicleBrandId,vin,requestText,contactPhone}){
    const brandId=id(vehicleBrandId);const brand=await VinRequestRepository.supportedBrand(brandId);if(!brand)throw new Error('Извините, этой маркой мы пока не занимаемся');
    const row=await VinRequestRepository.create({userId,vehicleBrandId:brandId,vin:normalizeVin(vin),requestText:text(requestText),contactPhone:String(contactPhone||'').trim()||null});
    await NotificationRepository.createForStaff({eventKey:`vin:${row.id}:new`,type:'VIN_REQUEST_NEW',payload:{vinRequestId:Number(row.id),vin:row.vin}});
    return row;
  },
  listForUser(userId){return VinRequestRepository.listForUser(userId);},
  async getForUser(requestId,userId){const row=await VinRequestRepository.findForUser(id(requestId),userId);if(!row)throw new Error('VIN-запрос не найден');return row;},
  listForStaff({status}){const normalized=status?String(status).toUpperCase():null;if(normalized&&!statuses.has(normalized))throw new Error('Неизвестный статус');return VinRequestRepository.listForStaff({status:normalized});},
  summary(){return VinRequestRepository.summary();},
  async update({requestId,status,response,changedBy}){
    const numericId=id(requestId);const current=await VinRequestRepository.findById(numericId);if(!current)throw new Error('VIN-запрос не найден');
    const normalized=String(status||current.status).toUpperCase();if(!statuses.has(normalized))throw new Error('Неизвестный статус');
    const cleanResponse=response===undefined?current.manager_response:String(response||'').trim()||null;
    const updated=await VinRequestRepository.update({id:numericId,status:normalized,response:cleanResponse,answeredBy:changedBy});
    if(normalized!==current.status||cleanResponse!==current.manager_response){
      await NotificationRepository.createForUser({userId:Number(current.user_id),eventKey:`vin:${numericId}:update:${updated.updated_at}`,type:'VIN_REQUEST_UPDATED',payload:{vinRequestId:numericId,vin:current.vin,status:normalized}});
    }
    return VinRequestRepository.findById(numericId);
  },
  supportedBrands(){return VinRequestRepository.supportedBrands();},
  allBrands(){return VinRequestRepository.allBrands();},
  async addBrand(name){const clean=String(name||'').trim();if(clean.length<2||clean.length>80)throw new Error('Укажите название марки');return VinRequestRepository.addBrand(clean);},
  async toggleBrand(brandId,enabled){if(typeof enabled!=='boolean')throw new Error('Поле enabled должно быть true или false');const row=await VinRequestRepository.toggleBrand(id(brandId),enabled);if(!row)throw new Error('Марка не найдена');return row;},
};
