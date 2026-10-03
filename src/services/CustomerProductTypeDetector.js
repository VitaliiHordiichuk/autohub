export const CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION = 1;

export const CUSTOMER_PRODUCT_TYPE_CODES = Object.freeze([
  "FILTER_OIL",
  "FILTER_AIR_ENGINE",
  "FILTER_CABIN",
  "FILTER_FUEL",
  "IGNITION_SPARK_PLUG",
  "SERVICE_BELT",
  "BELT_TENSIONER",
  "WIPER_BLADE",
  "BRAKE_PAD",
  "BRAKE_DISC",
  "BRAKE_CALIPER",
  "BRAKE_SENSOR",
  "BRAKE_HOSE_PIPE",
  "BRAKE_MASTER_CYLINDER",
  "AC_CONDENSER",
  "THERMOSTAT",
  "FASTENER_BOLT",
  "ACCESSORY_FLOOR_MAT",
  "ACCESSORY_LUGGAGE",
  "ACCESSORY_INTERIOR",
  "ACCESSORY_EXTERIOR",
  "ACCESSORY_WHEELS",
  "ACCESSORY_MULTIMEDIA",
  "ACCESSORY_COLLECTION",
]);

const knownTypeCodes = new Set(CUSTOMER_PRODUCT_TYPE_CODES);

const detectors = Object.freeze([
  ["FILTER_OIL", /(?:ф[іи]льтр.*(?:олив|мастил|масл)|(?:олив|масл).*ф[іи]льтр|oil\s+filter)/iu],
  ["FILTER_AIR_ENGINE", /(?:(?:пов[іи]тр|воздуш|air).*ф[іи]льтр|ф[іи]льтр.*(?:пов[іи]тр|воздуш|air))(?!.*(?:салон|кабін|кабин|cabin))/iu],
  ["FILTER_CABIN", /(?:(?:салон|кабін|кабин|cabin).*ф[іи]льтр|ф[іи]льтр.*(?:салон|кабін|кабин|cabin))/iu],
  ["FILTER_FUEL", /(?:(?:палив|топлив|fuel).*ф[іи]льтр|ф[іи]льтр.*(?:палив|топлив|fuel))/iu],
  ["IGNITION_SPARK_PLUG", /(?:св[іе]ч(?:ка|і|и)|spark\s+plug|glow\s+plug)/iu],
  ["SERVICE_BELT", /(?:рем[іе]нь|пасок|belt)/iu],
  ["BELT_TENSIONER", /(?:натягувач|натяжител|ролик.*(?:ремен|паск)|belt.*tensioner|tensioner)/iu],
  ["WIPER_BLADE", /(?:склоочисник|стеклоочистител|щ[іе]тк.*скл|щетк.*стекл|wiper)/iu],
  ["BRAKE_PAD", /(?:(?:гальм|тормоз|brake).*колод|колод.*(?:гальм|тормоз)|brake\s+pad)/iu],
  ["BRAKE_DISC", /(?:(?:гальм|тормоз|brake).*диск|диск.*(?:гальм|тормоз)|brake\s+disc)/iu],
  ["BRAKE_CALIPER", /(?:супорт|суппорт|caliper)/iu],
  ["BRAKE_SENSOR", /(?:(?:гальм|тормоз|brake).*(?:датчик|sensor)|(?:датчик|sensor).*(?:гальм|тормоз|brake))/iu],
  ["BRAKE_HOSE_PIPE", /(?:(?:гальм|тормоз|brake).*(?:шланг|труб|hose|pipe)|(?:шланг|труб).*(?:гальм|тормоз))/iu],
  ["BRAKE_MASTER_CYLINDER", /(?:(?:головн|главн|master).*(?:гальм|тормоз|brake).*(?:циліндр|цилиндр|cylinder)|master\s+brake\s+cylinder)/iu],
  ["AC_CONDENSER", /(?:(?:конденсатор|condenser).*(?:кондиц|a\/?c)|(?:кондиц|a\/?c).*(?:конденсатор|condenser))/iu],
  ["THERMOSTAT", /(?:термостат|thermostat)/iu],
  ["FASTENER_BOLT", /(?:^|\s)(?:болт|bolt)(?:\s|$)/iu],
  ["ACCESSORY_FLOOR_MAT", /(?:килим(?:ок|ки)?|коврик(?:и)?|floor\s+mat)/iu],
  ["ACCESSORY_LUGGAGE", /(?:багаж|luggage|roof\s+carrier)/iu],
  ["ACCESSORY_INTERIOR", /(?:інтер.?єр|интерьер|салон.*аксес|interior)/iu],
  ["ACCESSORY_EXTERIOR", /(?:екстер.?єр|экстерьер|exterior)/iu],
  ["ACCESSORY_WHEELS", /(?:колес.*аксес|wheel.*accessor)/iu],
  ["ACCESSORY_MULTIMEDIA", /(?:мультимед|multimedia)/iu],
  ["ACCESSORY_COLLECTION", /(?:mercedes[-\s]?benz\s+collection|колекц|коллекц)/iu],
]);

function searchableText(product = {}) {
  const names = [product.name];
  if (Array.isArray(product.translations)) {
    for (const translation of product.translations) names.push(translation?.name);
  }
  return names.filter(Boolean).join(" \n ").normalize("NFKC").trim();
}

export function isKnownCustomerProductTypeCode(value) {
  return knownTypeCodes.has(String(value || "").trim().toUpperCase());
}

export function detectCustomerProductTypes(product = {}) {
  const text = searchableText(product);
  if (!text) return [];
  return detectors
    .filter(([, pattern]) => pattern.test(text))
    .map(([typeCode]) => typeCode);
}
