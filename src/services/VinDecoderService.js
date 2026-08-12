const API_URL="https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

function clean(value){const result=String(value??"").trim();return result&&result!=="0"?result:null;}

export const VinDecoderService={
  async decode(vin){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(`${API_URL}/${encodeURIComponent(vin)}?format=json`,{signal:controller.signal,headers:{Accept:"application/json","User-Agent":"makahub/1.0"}});
      if(!response.ok)throw new Error("VIN-сервіс тимчасово недоступний");
      const data=await response.json();
      const item=data?.Results?.[0];
      if(!item)throw new Error("Не удалось получить данные автомобиля");
      const errorCode=String(item.ErrorCode??"").trim();
      const cleanDecode=errorCode===""||errorCode==="0";
      const vehicle={make:clean(item.Make),model:clean(item.Model),year:cleanDecode?clean(item.ModelYear):null,bodyClass:clean(item.BodyClass),engine:clean(item.EngineModel)||clean(item.DisplacementL),fuel:clean(item.FuelTypePrimary),plantCountry:clean(item.PlantCountry)};
      const recognized=Boolean(vehicle.model||vehicle.bodyClass||vehicle.engine);
      return {vin,recognized,partial:!cleanDecode||!recognized,vehicle,source:"NHTSA vPIC"};
    }catch(error){
      if(error?.name==="AbortError")throw new Error("VIN-сервіс відповідає надто довго. Спробуйте ще раз");
      throw error;
    }finally{clearTimeout(timer);}
  }
};
