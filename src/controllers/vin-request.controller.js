import { VinRequestService } from "../services/VinRequestService.js";
function fail(res,error){return res.status(400).json({success:false,error:error.message});}
export async function createVinRequest(req,res){try{return res.status(201).json({success:true,request:await VinRequestService.create({userId:req.auth.userId,...req.body})});}catch(e){return fail(res,e);}}
export async function listClientVinRequests(req,res){try{return res.json({success:true,requests:await VinRequestService.listForUser(req.auth.userId)});}catch(e){return fail(res,e);}}
export async function getClientVinRequest(req,res){try{return res.json({success:true,request:await VinRequestService.getForUser(req.params.requestId,req.auth.userId)});}catch(e){return fail(res,e);}}
export async function listManagerVinRequests(req,res){try{return res.json({success:true,requests:await VinRequestService.listForStaff({status:req.query.status})});}catch(e){return fail(res,e);}}
export async function getVinSummary(req,res){try{return res.json({success:true,counts:await VinRequestService.summary()});}catch(e){return fail(res,e);}}
export async function updateVinRequest(req,res){try{return res.json({success:true,request:await VinRequestService.update({requestId:req.params.requestId,status:req.body.status,response:req.body.response,changedBy:req.auth.userId})});}catch(e){return fail(res,e);}}
