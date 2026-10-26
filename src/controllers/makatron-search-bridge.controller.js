import { timingSafeEqual } from "node:crypto";
import { pool } from "../config/db.js";
import { readWebsiteArticleSearch } from "../services/WebsiteArticleSearchService.js";

function validSecret(expected,provided) {
  const a=Buffer.from(String(expected||""),"utf8");
  const b=Buffer.from(String(provided||""),"utf8");
  return a.length>=32 && a.length===b.length && timingSafeEqual(a,b);
}

// No public route accepts claimed staff IDs without a private worker secret.
// The protected endpoint is not a substitute for Telegram's chat+sender
// checks: they remain mandatory on the MAKAtron worker for every request.
export async function searchForMakatron(req,res,deps={}) {
  res.set("Cache-Control","private, no-store");
  const secret=process.env.MAKATRON_SEARCH_BRIDGE_SECRET;
  if(!secret||Buffer.byteLength(secret)<32)
    return res.status(503).json({success:false,error:"Search bridge not configured"});
  if(!validSecret(secret,req.get("X-Makatron-Search-Key")))
    return res.status(403).json({success:false,error:"Forbidden"});
  const {article,locale="uk",mode="guest",userId=null}=req.body||{};
  if(typeof article!=="string"||!article.trim()||article.length>255||
     !["uk","ru","en"].includes(locale)||!["guest","client","staff"].includes(mode))
    return res.status(400).json({success:false,error:"Invalid search request"});
  const id=Number(userId);
  if(mode!=="guest"&&(!Number.isSafeInteger(id)||id<=0))
    return res.status(403).json({success:false,error:"Account required"});
  if(mode==="guest"&&userId!==null)
    return res.status(400).json({success:false,error:"Guest userId forbidden"});
  try {
    if(mode!=="guest"){
      const db=deps.db||pool;
      const role=(await db.query(
        "SELECT r.name FROM users u JOIN roles r ON r.id=u.role_id "+
        "WHERE u.id=$1 AND u.is_active=TRUE LIMIT 1",[id]
      )).rows[0]?.name;
      if(mode==="client"&&role!=="CLIENT"||
         mode==="staff"&&!["ADMIN","MANAGER"].includes(role))
        return res.status(403).json({success:false,error:"Role not allowed"});
    }
    // Staff receives no private price matrix from search API. Incoming cost
    // is never exposed by this endpoint; staff bot reads it after role checks.
    const read=deps.read||readWebsiteArticleSearch;
    const result=await read({
      article,requestedLocale:locale,
      userId:mode==="client"?id:null,
      includeSourceDetails:mode==="staff",
    });
    return res.status(result.found?200:404).json(result.response);
  }catch(error){
    console.error("MAKAtron shared search error:",error.message);
    return res.status(500).json({success:false,error:"Search unavailable"});
  }
}
