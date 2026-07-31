import { ProductImageService } from "../services/ProductImageService.js";

function fail(res, error) { console.error("Ошибка фото товара:", error); return res.status(400).json({ success:false,error:error.message }); }
export async function searchImageProducts(req,res) { try { return res.json({success:true,products:await ProductImageService.searchProducts(req.query.search)}); } catch(error){ return fail(res,error); } }
export async function getProductImages(req,res) { try { return res.json({success:true,images:await ProductImageService.list(req.params.productId)}); } catch(error){ return fail(res,error); } }
export async function uploadProductImages(req,res) { try { return res.status(201).json({success:true,images:await ProductImageService.upload(req.params.productId,req.files)}); } catch(error){ return fail(res,error); } }
export async function makePrimaryProductImage(req,res) { try { return res.json({success:true,images:await ProductImageService.makePrimary(req.params.productId,req.params.imageId)}); } catch(error){ return fail(res,error); } }
export async function deleteProductImage(req,res) { try { await ProductImageService.remove(req.params.productId,req.params.imageId); return res.json({success:true}); } catch(error){ return fail(res,error); } }
