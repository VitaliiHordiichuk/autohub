import { SearchService } from "./SearchService.js";
import { ProductCardService } from "./ProductCardService.js";
import { MercedesFamilyOfferService } from "./MercedesFamilyOfferService.js";
import { PublicSearchPresenterService } from "./PublicSearchPresenterService.js";
import { ArticleNumberRepository } from "../repositories/ArticleNumberRepository.js";
import { CustomerPricingService } from "./CustomerPricingService.js";

// SINGLE SOURCE OF TRUTH for website article search and both MAKAtron modes.
// The site and the internal Telegram bridge call this same function.
// Product/offer eligibility and Mercedes-family rules stay in existing site services.
export async function readWebsiteArticleSearch({
  article, requestedLocale="uk", userId=null,
  includeSourceDetails=false, availabilityContext=null,
}, deps={}) {
  const search=deps.search || (value=>SearchService.searchByArticle(value));
  const pricing=deps.pricing || (id=>CustomerPricingService.getContext(id));
  const buildCard=deps.buildCard || ((...args)=>ProductCardService.build(...args));
  const buildFamily=deps.buildFamily || (args=>MercedesFamilyOfferService.build(args));
  const findSource=deps.findSource || (args=>ArticleNumberRepository.findSearchProductByBrandAndArticle(args));
  const present=deps.present || (args=>PublicSearchPresenterService.present(args));
  const searchResult=await search(article);
  if(!searchResult?.found) return {
    found:false,searchResult,
    response:{success:false,query:article,normalized:searchResult?.normalized||"",
      message:"Товар не знайдено"},
  };
  const pricingContext=await pricing(userId);
  const productCard=searchResult.exactProduct
    ?await buildCard(searchResult.exactProduct,pricingContext,availabilityContext):null;
  const replacementLinks=(searchResult.replacementPath||[])
    .filter(link=>link.linkType==="REPLACEMENT");
  const replacementLink=replacementLinks[0]||null;
  const finalReplacementLink=replacementLinks.at(-1);
  const replacementSourceProduct=replacementLink
    ?await findSource({brandId:replacementLink.sourceBrandId,
      articleNormalized:replacementLink.sourceArticleNormalized})
    :null;
  const replacementSourceCard=replacementSourceProduct&&
    Number(replacementSourceProduct.id)!==Number(searchResult.exactProduct?.id)
    ?await buildCard(replacementSourceProduct,pricingContext,availabilityContext):null;
  const familyCards=searchResult.family?.length>1
    ?await buildFamily({
      family:searchResult.family,exactProductId:searchResult.exactProduct?.id??null,
      requireEnabledSupplierRule:searchResult.rule==="MERCEDES"&&
        searchResult.numberResolution!=="PREFIX",
      pricingContext,availabilityContext,
    }):[];
  const publicResult=await present({requestedLocale,family:familyCards,
    productCard,replacementSourceCard,includeSourceDetails});
  return {
    found:true,searchResult,productCard,familyCards,publicResult,
    response:{
      success:true,locale:publicResult.locale,query:searchResult.query,
      normalized:searchResult.normalized,
      searchedArticle:searchResult.searchedArticle??searchResult.normalized,
      rule:searchResult.rule,parsed:searchResult.parsed??null,
      family:publicResult.family,productCard:publicResult.productCard,
      replacement:replacementLink?{
        sourceBrand:replacementLink.sourceBrandName,
        sourceArticle:replacementLink.sourceArticle,
        targetBrand:finalReplacementLink?.targetBrandName,
        targetArticle:finalReplacementLink?.targetArticle,
        sourceProductCard:publicResult.replacementSourceCard
      }:null,
    }
  };
}
