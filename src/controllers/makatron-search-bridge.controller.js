import { timingSafeEqual } from "node:crypto";
import { pool } from "../config/db.js";
import { readWebsiteArticleSearch } from "../services/WebsiteArticleSearchService.js";
import { websiteStaffPrices,websiteStaffClientQuote } from "../services/WebsiteStaffPricingService.js";

function validSecret(expected,provided) {
  const a=Buffer.from(String(expected||""),"utf8");
  const b=Buffer.from(String(provided||""),"utf8");
  return a.length>=32 && a.length===b.length && timingSafeEqual(a,b);
}

async function authorized(req,res,{mode,userId},deps={}) {
  res.set("Cache-Control","private, no-store");
  const secret=process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
  if(!secret||Buffer.byteLength(secret)<32){
    res.status(503).json({success:false,error:"Search bridge not configured"});
    return false;
  }
  if(!validSecret(secret,req.get("X-Makatron-Search-Key"))){
    res.status(403).json({success:false,error:"Forbidden"});
    return false;
  }
  const uid=Number(userId);
  if(mode==="guest"&&userId===null)return true;
  if(!["staff","client"].includes(mode)||!Number.isSafeInteger(uid)||uid<=0){
    res.status(403).json({success:false,error:"Account required"});
    return false;
  }
  const db=deps.db||pool;
  const role=(await db.query(
    "SELECT r.name FROM users u JOIN roles r ON r.id=u.role_id "+
    "WHERE u.id=$1 AND u.is_active=TRUE LIMIT 1",[uid]
  )).rows[0]?.name;
  if(mode==="client"&&role==="CLIENT"||
     mode==="staff"&&["ADMIN","MANAGER"].includes(role))return true;
  res.status(403).json({success:false,error:"Role not allowed"});
  return false;
}

// No public route accepts claimed staff IDs without a private worker secret.
// The protected endpoint is not a substitute for Telegram's chat+sender
// checks: they remain mandatory on the MAKAtron worker for every request.
export async function searchForMakatron(req,res,deps={}) {
  const {article,locale="uk",mode="guest",userId=null}=req.body||{};
  if(typeof article!=="string"||!article.trim()||article.length>255||
     !["uk","ru","en"].includes(locale)||!["guest","client","staff"].includes(mode))
    return res.status(400).json({success:false,error:"Invalid search request"});
  try {
    if(!await authorized(req,res,{mode,userId},deps))return;
    // Staff receives no private price matrix from search API. Incoming cost
    // is never exposed by this endpoint; staff bot reads it after role checks.
    const read=deps.read||readWebsiteArticleSearch;
    const result=await read({
      article,requestedLocale:locale,
      userId:mode==="client"?id:null,
      includeSourceDetails:mode==="staff",
    });
    if(result.found&&mode==="staff"){
      const privatePricing=deps.staffPrices||websiteStaffPrices;
      result.response.staffPrices=await privatePricing(result.response);
    }
    return res.status(result.found?200:404).json(result.response);
  }catch(error){
    console.error("MAKAtron shared search error:",error.message);
    return res.status(500).json({success:false,error:"Search unavailable"});
  }
}

// Only an authorized staff Telegram identity can request a client-ready price.
export async function quoteForMakatron(req,res,deps={}) {
  try {
    const {offerId,group,userId}=req.body||{};
    if(!await authorized(req,res,{mode:"staff",userId},deps))return;
    const quote=deps.quote||websiteStaffClientQuote;
    return res.json(await quote({offerId,group,userId}));
  }catch(error){
    console.error("MAKAtron shared quote error:",error.message);
    return res.status(400).json({success:false,error:"Quote unavailable"});
  }
}
