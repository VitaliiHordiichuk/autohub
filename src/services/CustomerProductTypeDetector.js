export const CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION = 3;

export const CUSTOMER_PRODUCT_TYPE_CODES = Object.freeze([
  "FILTER_OIL",
  "FILTER_AIR_ENGINE",
  "FILTER_CABIN",
  "FILTER_FUEL",
  "FUEL_VAPOR_CANISTER",
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
  "STEERING_RACK",
  "STEERING_TIE_ROD",
  "STEERING_TIE_ROD_END",
  "STEERING_PUMP",
  "STEERING_SHAFT",
  "STEERING_RESERVOIR",
  "STEERING_HOSE_PIPE",
  "EXHAUST_CATALYST",
  "EXHAUST_MUFFLER",
  "EXHAUST_PIPE",
  "EXHAUST_SENSOR",
  "EXHAUST_MOUNT",
  "EXHAUST_ADBLUE_INJECTOR",
  "WHEEL_RIM",
  "WHEEL_CAP",
  "WHEEL_BOLT_NUT",
  "TPMS_SENSOR",
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
  const fuelVapor = /(?:charcoal\s+canister|carbon\s+canister|kraftstoffverdunst|fuel\s+vapou?r|\bevap\b|адсорбер|испарени\w*\s+топлив|паров\w*\s+топлив|випаров\w*\s+палив|пар[іи]в\w*\s+палив)/iu.test(text);
  const activatedCharcoalAtFuelEpc = epcGroups.has("47")
    && /(?:activated\s+charcoal\s+filter|aktivkohlefilter|aktkohlefilter|вугіль|уголь|charcoal|carbon)/iu.test(text);
  if (fuelVapor || activatedCharcoalAtFuelEpc) {
    return "FUEL_VAPOR_CANISTER";
  }

  if (!/(?:ф[іи]льтр|filter)/iu.test(text)) return null;
  if (/(?:кришк|крышк|корпус|пробк|патруб|кронштейн|рамк|кожух|рем.?комплект|housing|cover|frame|bracket|holder|adapter)/iu.test(text)) {
    return null;
  }
  if (/(?:комплект\s+ф[іи]льтр|ф[іи]льтр(?:и|ы)\s+комплект|filter\s+(?:kit|set))/iu.test(text)) {
    return null;
  }

  if (/(?:палив|топлив|fuel)/iu.test(text)) {
    return "FILTER_FUEL";
  }
  if (/(?:масл|мастил|олив|oil)/iu.test(text)) {
    return "FILTER_OIL";
  }
  if (/(?:(?:пов[іи]тр|воздуш|air|luft).*(?:двигун|двигател|engine|motor)|(?:двигун|двигател|engine|motor).*(?:пов[іи]тр|воздуш|air|luft))/iu.test(text)) {
    return "FILTER_AIR_ENGINE";
  }
  if (/(?:салон|пилов|пильов|пыль|pollen|cabin|кондиц|staub)/iu.test(text)) {
    return "FILTER_CABIN";
  }

  if (epcGroups.has("83")) return "FILTER_CABIN";
  if (epcGroups.has("47")) return "FILTER_FUEL";
  if (epcGroups.has("18")) return "FILTER_OIL";
  if (epcGroups.has("09")) return "FILTER_AIR_ENGINE";
  return null;
}

function isBrakeDiscComponent(text) {
  return /(?:захист|щиток|dust\s+shield|backing\s+plate|brake\s+shield)/iu.test(text);
}

function isBrakeCaliperComponent(text) {
  return /(?:клапан|корпус|направля|пильовик|рем.?комплект|скоба|г[іи]льз|втул|valve|housing|guide|boot|repair\s+kit|bracket|sleeve)/iu.test(text);
}

function detectSteeringTypes(text, epcGroups) {
  const types = [];
  const steeringEpc = ["33", "35", "46"].some((group) => epcGroups.has(group));
  const steeringContext = /(?:руль|рул[её]в|керм|steering|power\s+steering|\bгур\b|\bгпк\b)/iu.test(text);
  if (!steeringEpc && !steeringContext) return types;

  const tieRodEnd = /(?:наконечник|кінцевик|tie[\s-]*rod\s+end)/iu.test(text)
    && (steeringContext || epcGroups.has("33") || epcGroups.has("46"));
  if (tieRodEnd) types.push("STEERING_TIE_ROD_END");

  const tieRod = /(?:тяг\w*.*(?:руль|рул[её]в|керм|steering)|(?:руль|рул[её]в|керм|steering).*тяг|tie[\s-]*rod)/iu.test(text);
  if (tieRod && !tieRodEnd) types.push("STEERING_TIE_ROD");

  const rack = /(?:рейк\w*.*(?:руль|рул[её]в|керм|steering)|(?:руль|рул[её]в|керм|steering).*рейк|steering\s+rack)/iu.test(text)
    && !/(?:рем.?комплект|repair\s+kit|пильовик|пыльник|чохол|кожух|накладк|втул|кронштейн)/iu.test(text);
  if (rack) types.push("STEERING_RACK");

  const pump = /(?:г[іи]дронасос|насос\s+(?:гур|гпк)|(?:гур|гпк).*насос|power\s+steering\s+pump)/iu.test(text)
    || (epcGroups.has("46") && /(?:насос\s+г[іи]дравл|г[іи]дравл\w*\s+насос)/iu.test(text));
  if (pump) types.push("STEERING_PUMP");

  const shaft = /(?:вал\w*.*(?:руль|рул[её]в|керм|steering)|(?:руль|рул[её]в|керм|steering).*вал|steering\s+shaft)/iu.test(text)
    && !/(?:накладк|кришк|крышк|чохол|кожух|пильовик|пыльник|втул)/iu.test(text);
  if (shaft) types.push("STEERING_SHAFT");

  const reservoir = /(?:бачок|резервуар|reservoir).*(?:гур|гпк|руль|рул[её]в|керм|steering)|(?:гур|гпк|руль|рул[её]в|керм|steering).*(?:бачок|резервуар|reservoir)/iu.test(text);
  if (reservoir) types.push("STEERING_RESERVOIR");

  const hosePipe = /(?:(?:шланг|трубопров[іи]д|трубк|hose|pipe).*(?:гур|гпк|руль|рул[её]в|керм|steering)|(?:гур|гпк|руль|рул[её]в|керм|steering).*(?:шланг|трубопров[іи]д|трубк|hose|pipe))/iu.test(text)
    || (epcGroups.has("46") && /(?:трубопров[іи]д\s+високого\s+тиску|high[\s-]*pressure\s+(?:hose|pipe))/iu.test(text));
  if (hosePipe) types.push("STEERING_HOSE_PIPE");
  return types;
}

function detectExhaustTypes(text, epcGroups) {
  const types = [];
  const exhaustContext = /(?:вихлоп|выпуск|випуск|відпрацьован|отработан|exhaust|сажов|dpf|катал[іи]зат|ad.?blue|адблю)/iu.test(text);
  const sensor = /(?:датчик|sensor)/iu.test(text) && exhaustContext;
  if (sensor) types.push("EXHAUST_SENSOR");

  const catalyst = /(?:катал[іи]затор|catalytic\s+converter|catalyst)/iu.test(text)
    && !/(?:датчик|sensor|температур|temperature|тиск|давлен)/iu.test(text);
  if (catalyst) types.push("EXHAUST_CATALYST");

  const mount = /(?:кронштейн|хомут|подушк|опор[аи]|тримач|держател|hanger|bracket|clamp|mount)/iu.test(text)
    && (exhaustContext || epcGroups.has("49"));
  if (mount) types.push("EXHAUST_MOUNT");

  const pipeSubject = /(?:^|[\s(])(?:труб[аик]|патрубок|трубопров[іи]д|pipe|tube)(?:[\s),.-]|$)/iu.test(text);
  const exhaustGasContext = /(?:вихлоп|выпуск|випуск|відпрацьован|отработан|exhaust|глуш)/iu.test(text);
  const pipe = pipeSubject
    && (exhaustGasContext || epcGroups.has("49"))
    && !/(?:накладк|кільц|кольц|прокладк|ущільн|уплотн|тримач|держател|кронштейн|хомут|подушк)/iu.test(text);
  if (pipe) types.push("EXHAUST_PIPE");

  const muffler = /(?:^|[\s(])(?:глушник|глушител[ьья]?|muffler|silencer)(?:[\s),.-]|$)/iu.test(text)
    && !/(?:труб|патруб|прокладк|ущільн|уплотн|кронштейн|хомут|болт|гайк|кільц|кольц|подушк|накладк|рем.?комплект)/iu.test(text);
  if (muffler) types.push("EXHAUST_MUFFLER");

  const adblueInjector = /(?:форсунк|інжектор|инжектор|injector).*(?:ad.?blue|адблю)|(?:ad.?blue|адблю).*(?:форсунк|інжектор|инжектор|injector)/iu.test(text);
  if (adblueInjector) types.push("EXHAUST_ADBLUE_INJECTOR");
  return types;
}

function detectWheelTypes(text, epcGroups) {
  const types = [];
  const wheelContext = /(?:колес|коліс|wheel|шин|tire|tyre)/iu.test(text);
  const wheelEpc = epcGroups.has("40");

  const cap = /(?:ковпак|колпак|ковпачок|колпачок|заглушк|кришк|крышк|cap|cover)/iu.test(text)
    && (wheelContext || (wheelEpc && /(?:диск|ніпел|ниппел|ступиц|маточин)/iu.test(text)));
  if (cap) types.push("WHEEL_CAP");

  const brakeOrOtherDisc = /(?:гальм|тормоз|brake|dvd|cd|програм|кардан|коробк|фрикц)/iu.test(text);
  const rim = /(?:диск\w*.*(?:колес|коліс|wheel)|(?:колес|коліс|wheel).*диск|wheel\s+rim|alloy\s+wheel)/iu.test(text)
    && !cap
    && !brakeOrOtherDisc;
  if (rim) types.push("WHEEL_RIM");

  const fastener = /(?:болт|гайк|bolt|nut)/iu.test(text)
    && wheelContext;
  if (fastener) types.push("WHEEL_BOLT_NUT");

  const pressure = /(?:тиск|давлен|pressure|tpms)/iu.test(text);
  const tireContext = /(?:колес|коліс|шин|tire|tyre|tpms)/iu.test(text);
  const tpms = /(?:датчик|sensor|tpms)/iu.test(text) && pressure && tireContext;
  if (tpms) types.push("TPMS_SENSOR");
  return types;
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
  if (isBrakeDiscComponent(text)) {
    const index = detected.indexOf("BRAKE_DISC");
    if (index >= 0) detected.splice(index, 1);
  }
  if (isBrakeCaliperComponent(text)) {
    const index = detected.indexOf("BRAKE_CALIPER");
    if (index >= 0) detected.splice(index, 1);
  }
  const epcGroups = technicalEpcGroups(product);
  const filterType = detectFilterType(text, epcGroups);
  if (filterType) detected.unshift(filterType);

  detected.push(...detectSteeringTypes(text, epcGroups));
  detected.push(...detectExhaustTypes(text, epcGroups));
  detected.push(...detectWheelTypes(text, epcGroups));

  const serviceBelt = /(?:рем[іе]нь|пасок|belt)/iu.test(text);
  const tensioner = detected.includes("BELT_TENSIONER");
  if (serviceBelt && !tensioner) detected.push("SERVICE_BELT");
  return [...new Set(detected)];
}
