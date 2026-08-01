import { OrderReturnService } from "../services/OrderReturnService.js";

export async function createOrderReturn(req,res){
  try{return res.status(201).json({success:true,...await OrderReturnService.create({orderId:req.params.orderId,items:req.body.items,reason:req.body.reason,createdBy:req.auth.userId})});}
  catch(error){return res.status(400).json({success:false,error:error.message});}
}

export async function confirmOrderReturn(req,res){
  try{return res.json({success:true,...await OrderReturnService.confirm({orderId:req.params.orderId,returnId:req.params.returnId,confirmedBy:req.auth.userId})});}
  catch(error){return res.status(400).json({success:false,error:error.message});}
}
