import { OrderReturnService } from "../services/OrderReturnService.js";
import { OrderReturnRepository } from "../repositories/OrderReturnRepository.js";

export async function getOrderReturns(req,res){
  try{
    const status=req.query.status?String(req.query.status).toUpperCase():null;
    if(status&&!['PENDING','COMPLETED','CANCELLED'].includes(status)) return res.status(400).json({success:false,error:"Некорректный статус возврата"});
    const limit=Math.min(Math.max(Number(req.query.limit)||100,1),200);
    const offset=Math.max(Number(req.query.offset)||0,0);
    const [returns,rawCounts]=await Promise.all([
      OrderReturnRepository.listForManager({status,limit,offset}),
      OrderReturnRepository.managerCounts(),
    ]);
    return res.json({success:true,returns,counts:{all:Number(rawCounts.all_count||0),pending:Number(rawCounts.pending_count||0),completed:Number(rawCounts.completed_count||0)}});
  }catch(error){console.error("Ошибка списка возвратов:",error);return res.status(500).json({success:false,error:"Не удалось загрузить возвраты"});}
}

export async function createOrderReturn(req,res){
  try{return res.status(201).json({success:true,...await OrderReturnService.create({orderId:req.params.orderId,items:req.body.items,reason:req.body.reason,createdBy:req.auth.userId})});}
  catch(error){return res.status(400).json({success:false,error:error.message});}
}

export async function confirmOrderReturn(req,res){
  try{return res.json({success:true,...await OrderReturnService.confirm({orderId:req.params.orderId,returnId:req.params.returnId,confirmedBy:req.auth.userId})});}
  catch(error){return res.status(400).json({success:false,error:error.message});}
}
