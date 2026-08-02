import { VinRequestService } from "../services/VinRequestService.js";
function fail(res,error){return res.status(400).json({success:false,error:error.message});}
export async function createVinRequest(req,res){try{return res.status(201).json({success:true,request:await VinRequestService.create({userId:req.auth.userId,...req.body})});}catch(e){return fail(res,e);}}
export async function decodeVinRequest(req,res){try{return res.json({success:true,decode:await VinRequestService.decode(req.body)});}catch(e){return res.status(400).json({success:false,error:e.message,code:e.code||'VIN_DECODE_FAILED',make:e.make||null});}}
export async function listClientVinRequests(req,res){try{return res.json({success:true,requests:await VinRequestService.listForUser(req.auth.userId)});}catch(e){return fail(res,e);}}
export async function getClientVinRequest(req,res){try{return res.json({success:true,request:await VinRequestService.getForUser(req.params.requestId,req.auth.userId)});}catch(e){return fail(res,e);}}
export async function listManagerVinRequests(req,res){try{return res.json({success:true,requests:await VinRequestService.listForStaff({status:req.query.status,userId:req.auth.userId})});}catch(e){return fail(res,e);}}
export async function getVinSummary(req,res){try{return res.json({success:true,counts:await VinRequestService.summary()});}catch(e){return fail(res,e);}}
export async function updateVinRequest(req,res){try{return res.json({success:true,request:await VinRequestService.update({requestId:req.params.requestId,status:req.body.status,message:req.body.message,response:req.body.response,changedBy:req.auth.userId})});}catch(e){return fail(res,e);}}
export async function addVinRecommendation(req,res){try{return res.status(201).json({success:true,request:await VinRequestService.addRecommendation({requestId:req.params.requestId,productId:req.body.productId,productOfferId:req.body.productOfferId,changedBy:req.auth.userId})});}catch(e){return fail(res,e);}}
export async function removeVinRecommendation(req,res){try{return res.json({success:true,request:await VinRequestService.removeRecommendation({requestId:req.params.requestId,recommendationId:req.params.recommendationId,changedBy:req.auth.userId})});}catch(e){return fail(res,e);}}
export async function listSupportedVinBrands(req,res){try{return res.json({success:true,brands:await VinRequestService.supportedBrands()});}catch(e){return fail(res,e);}}
export async function listAdminVinBrands(req,res){try{return res.json({success:true,brands:await VinRequestService.allBrands()});}catch(e){return fail(res,e);}}
export async function addAdminVinBrand(req,res){try{return res.status(201).json({success:true,brand:await VinRequestService.addBrand(req.body.name)});}catch(e){return fail(res,e);}}
export async function toggleAdminVinBrand(req,res){try{return res.json({success:true,brand:await VinRequestService.toggleBrand(req.params.brandId,req.body.enabled)});}catch(e){return fail(res,e);}}
