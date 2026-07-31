import { ClientSearchHistoryRepository } from "../repositories/ClientSearchHistoryRepository.js";

export async function getClientSearchHistory(req,res){
  try{
    const history=await ClientSearchHistoryRepository.list({
      userId:req.auth.userId,search:req.query.search,limit:req.query.limit,
    });
    return res.json({success:true,history});
  }catch(error){
    console.error("Ошибка истории поиска клиента:",error);
    return res.status(500).json({success:false,error:"Не удалось загрузить историю поиска"});
  }
}
