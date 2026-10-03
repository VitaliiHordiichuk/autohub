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
  ["IGNITION_SPARK_PLUG", /(?:(?:^|[\s(,/.-])св[іе]ч|(?:котушк|катушк).*?(?:запал|зажиг)|(?:запал|зажиг).*?(?:котушк|катушк)|spark\s+plug|glow\s+plug)/iu],
  ["BELT_TENSIONER", /(?:натягувач|натяжник|натяжител|ролик.*(?:ремен|паск)|belt.*tensioner|tensioner)/iu],
  ["WIPER_BLADE", /(?:(?:щ[іе]тк|гумк|резинк).*(?:склооч|стеклооч|двірник|дворник)|(?:склооч|стеклооч|двірник|дворник).*(?:щ[іе]тк|гумк|резинк))/iu],
  ["BRAKE_PAD", /(?:(?:гальм|тормоз|brake).*колодк|колодк.*(?:гальм|тормоз)|brake\s+pad)/iu],
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
  return names
    .filter(Boolean)
    .join(" \n ")
    .normalize("NFKC")
    .replace(/(?<=[\u0400-\u04ff])i|i(?=[\u0400-\u04ff])/giu, "і")
    .trim();
}

function technicalEpcGroups(product = {}) {
  const groups = product.technicalEpcGroups ?? product.technical_epc_groups ?? [];
  return new Set(
    (Array.isArray(groups) ? groups : [groups])
      .map((group) => String(group || "").trim().toUpperCase())
      .filter(Boolean),
  );
}

function detectFilterType(text, epcGroups) {
  if (!/(?:ф[іи]льтр|filter)/iu.test(text)) return null;
  if (/(?:кришк|крышк|корпус|пробк|патруб|кронштейн|рем.?комплект)/iu.test(text)) {
    return null;
  }
  if (/(?:салон|пил|пыль|pollen|cabin|вугіль|уголь)/iu.test(text)
    || epcGroups.has("83")) return "FILTER_CABIN";
  if (/(?:палив|топлив|fuel)/iu.test(text) || epcGroups.has("47")) {
    return "FILTER_FUEL";
  }
  if (/(?:масл|мастил|олив|oil)/iu.test(text) || epcGroups.has("18")) {
    return "FILTER_OIL";
  }
  if (/(?:пов[іи]тр|воздуш|air)/iu.test(text) || epcGroups.has("09")) {
    return "FILTER_AIR_ENGINE";
  }
  return null;
}

export function isKnownCustomerProductTypeCode(value) {
  return knownTypeCodes.has(String(value || "").trim().toUpperCase());
}

export function detectCustomerProductTypes(product = {}) {
  const text = searchableText(product);
  if (!text) return [];
  const detected = detectors
    .filter(([, pattern]) => pattern.test(text))
    .map(([typeCode]) => typeCode);
  const epcGroups = technicalEpcGroups(product);
  const filterType = detectFilterType(text, epcGroups);
  if (filterType) detected.unshift(filterType);

  const serviceBelt = /(?:рем[іе]нь|пасок|belt)/iu.test(text);
  const tensioner = detected.includes("BELT_TENSIONER");
  if (serviceBelt && !tensioner) detected.push("SERVICE_BELT");
  return [...new Set(detected)];
}
