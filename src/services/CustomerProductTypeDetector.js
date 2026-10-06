import { CUSTOMER_TAXONOMY_PHASE2E_REVIEW } from "../data/CustomerTaxonomyPhase2EReview.js";
import { CUSTOMER_TAXONOMY_PHASE2F_REVIEW } from "../data/CustomerTaxonomyPhase2FReview.js";
import { CUSTOMER_TAXONOMY_PHASE2G1_REVIEW } from "../data/CustomerTaxonomyPhase2G1Review.js";
import { CUSTOMER_TAXONOMY_PHASE2G2_REVIEW } from "../data/CustomerTaxonomyPhase2G2Review.js";
import { CUSTOMER_TAXONOMY_PHASE2G3_REVIEW } from "../data/CustomerTaxonomyPhase2G3Review.js";

export const CUSTOMER_PRODUCT_TYPE_DETECTOR_VERSION = 9;

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
  "EXHAUST_EGR_PIPE",
  "WHEEL_RIM",
  "WHEEL_CAP",
  "WHEEL_CENTER_CAP",
  "WHEEL_VALVE_CAP",
  "WHEEL_SPARE_COVER",
  "WHEEL_BOLT_NUT",
  "TPMS_SENSOR",
  "CLUTCH_ASSEMBLY",
  "CLUTCH_RELEASE_BEARING",
  "TRANSMISSION_SELECTOR_LINKAGE",
  "TRANSMISSION_OIL_FILTER",
  "TRANSMISSION_OIL_PAN",
  "TRANSMISSION_FLUID_LINE",
  "TRANSMISSION_COOLER_LINE",
  "TRANSMISSION_VALVE_BODY",
  "TRANSMISSION_SEAL_GASKET",
  "TRANSMISSION_INTERNAL_COMPONENT",
  "TRANSMISSION_TEMPERATURE_CONTROL",
  "TRANSFER_CASE_COMPONENT",
  "DRIVETRAIN_CV_BOOT",
  "DRIVETRAIN_PROPELLER_SHAFT",
  "DRIVETRAIN_COUPLING_DAMPER",
  "FUEL_INJECTOR",
  "FUEL_PUMP",
  "FUEL_LINE_HOSE",
  "FUEL_RAIL",
  "FUEL_PRESSURE_VALVE",
  "FUEL_TANK_MODULE",
  "ADBLUE_SCR_COMPONENT",
  "COOLING_WATER_PUMP",
  "COOLING_THERMOSTAT",
  "COOLING_RADIATOR",
  "COOLING_HOSE_PIPE",
  "COOLING_EXPANSION_TANK",
  "COOLING_CONTROL_VALVE",
  "COOLING_RADIATOR_AIR_GUIDE",
  "ENGINE_BELT_DRIVE_COMPONENT",
  "HVAC_AIR_DUCT_VENT",
  "HVAC_BLOWER_MOTOR",
  "HVAC_CONTROL_VALVE",
  "HVAC_HOSE_PIPE",
  "HVAC_DRAIN_LINE",
  "HVAC_TEMPERATURE_SENSOR",
  "AC_RECEIVER_DRIER",
  "AC_REFRIGERANT_LINE",
  "FILTER_CABIN_KIT",
  "ENGINE_GASKET_SEAL",
  "ENGINE_MOUNT",
  "ENGINE_BELT_TENSIONER",
  "ENGINE_COVER_CRANKCASE",
  "ENGINE_VALVETRAIN_COMPONENT",
  "ENGINE_TIMING_COMPONENT",
  "ENGINE_OIL_SYSTEM_COMPONENT",
  "ENGINE_INTAKE_MANIFOLD_THROTTLE",
  "ENGINE_INTAKE_AIR_DUCT",
  "ENGINE_BLOCK_CRANKSHAFT_PISTON",
  "ENGINE_CRANKCASE_VENTILATION",
  "ENGINE_BELT_ROLLER_IDLER",
  "ENGINE_CYLINDER_HEAD_COMPONENT",
  "ENGINE_TURBO_CHARGE_AIR",
  "ENGINE_VACUUM_COMPONENT",
  "ENGINE_OIL_LINE_COOLER",
  "ENGINE_OIL_PUMP",
  "ENGINE_AIR_FILTER_HOUSING",
  "ENGINE_DRIVE_PULLEY",
  "ENGINE_SENSOR",
  "SUSPENSION_SHOCK_ABSORBER",
  "SUSPENSION_CONTROL_ARM",
  "SUSPENSION_STABILIZER_LINK",
  "SUSPENSION_BUSHING_MOUNT",
  "SUSPENSION_SPRING",
  "SUSPENSION_STRUT_MOUNT_PROTECTION",
  "SUSPENSION_LINK_ROD",
  "SUSPENSION_AIR_COMPONENT",
  "SUSPENSION_WHEEL_HUB_BEARING",
  "SUSPENSION_BALL_JOINT",
  "SUSPENSION_STABILIZER_BUSHING",
  "SUSPENSION_KNUCKLE_CARRIER",
  "SUSPENSION_HYDRAULIC_COMPONENT",
  "SUSPENSION_LEVEL_CONTROL",
  "SUSPENSION_SUBFRAME_MOUNT",
  "BODY_BUMPER",
  "BODY_EXTERIOR_TRIM",
  "BODY_GRILLE",
  "BODY_LOCK_LATCH",
  "BODY_DOOR_HANDLE",
  "BODY_FENDER",
  "BODY_HOOD",
  "BODY_BUMPER_MOUNT",
  "BODY_MIRROR_PART",
  "GLASS_SIDE_WINDOW",
  "BODY_EMBLEM",
  "BODY_TAILGATE_TRUNK_LID",
  "BODY_WHEEL_ARCH_LINER",
  "BODY_EXTERIOR_MIRROR",
  "BODY_DOOR_HINGE",
  "BODY_ROOF_PART",
  "BODY_EXTERIOR_PANEL",
  "BODY_UNDERBODY_SHIELD",
  "INTERIOR_SEAT",
  "SAFETY_AIRBAG",
  "INTERIOR_TRIM_PANEL",
  "INTERIOR_PEDAL",
  "INTERIOR_SEAT_MECHANISM",
  "SAFETY_RESTRAINT_COMPONENT",
  "ELECTRICAL_CONTROL_UNIT",
  "ELECTRICAL_WIRING_HARNESS",
  "LIGHTING_HEADLIGHT",
  "ELECTRICAL_CONNECTOR",
  "ELECTRICAL_SENSOR",
  "ELECTRICAL_FUSE_BOX",
  "ELECTRICAL_SWITCH",
  "ELECTRICAL_BATTERY",
  "ELECTRICAL_CAMERA",
  "ELECTRICAL_PARKING_SENSOR",
  "ELECTRICAL_RELAY",
  "ELECTRICAL_ALTERNATOR",
  "ELECTRICAL_ANTENNA",
  "ELECTRICAL_FUSE",
  "LIGHTING_FOG_LIGHT",
  "ELECTRICAL_DRIVER_ASSISTANCE",
  "ELECTRICAL_STARTER",
  "ELECTRICAL_INFOTAINMENT",
  "LIGHTING_BULB",
  "FASTENER_SCREW",
  "FASTENER_NUT",
  "FASTENER_CLAMP",
  "FASTENER_CLIP_RIVET",
  "STANDARD_PLUG_CAP",
  "FASTENER_WASHER",
  "STANDARD_GROMMET",
  "STANDARD_SEALING_RING",
  "FASTENER_PIN_CIRCLIP",
  "FASTENER_STUD",
  "STANDARD_SEAL_GASKET",
]);

const knownTypeCodes = new Set(CUSTOMER_PRODUCT_TYPE_CODES);
const phase2eReviewedTypeByArticleAndEpc = new Map(
  CUSTOMER_TAXONOMY_PHASE2E_REVIEW
    .filter((row) => row.finalBucket === "HIGH" && row.typeCode)
    .map((row) => [`${row.article}:${row.epc}`, row.typeCode]),
);
const phase2eReviewedArticleAndEpc = new Set(
  CUSTOMER_TAXONOMY_PHASE2E_REVIEW.map((row) => `${row.article}:${row.epc}`),
);
const phase2fReviewByArticleAndEpc = new Map(
  CUSTOMER_TAXONOMY_PHASE2F_REVIEW.map((row) => [`${row.article}:${row.epc}`, row]),
);
const phase2g1ReviewByArticleAndEpc = new Map(
  CUSTOMER_TAXONOMY_PHASE2G1_REVIEW.map((row) => [`${row.article}:${row.epc}`, row]),
);
const phase2g2ReviewByArticleAndEpc = new Map(
  CUSTOMER_TAXONOMY_PHASE2G2_REVIEW.map((row) => [`${row.article}:${row.epc}`, row]),
);
const phase2g3ReviewByArticleAndEpc = new Map(
  CUSTOMER_TAXONOMY_PHASE2G3_REVIEW.map((row) => [`${row.article}:${row.epc}`, row]),
);
const phase2g3FastenerTypeCodes = new Set(
  CUSTOMER_TAXONOMY_PHASE2G3_REVIEW
    .filter((row) => row.finalBucket === "HIGH" && row.typeCode)
    .map((row) => row.typeCode),
);
const phase2fExactFilterEpc = new Map([
  ["FILTER_AIR_ENGINE", new Set(["18", "32"])],
  ["FILTER_CABIN", new Set(["32"])],
  ["FILTER_FUEL", new Set(["09"])],
  ["FILTER_OIL", new Set(["01", "32"])],
]);

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

function normalizedArticle(product = {}) {
  return String(
    product.articleNormalized ?? product.article_normalized ?? product.article ?? "",
  )
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function reviewedPhase2ETypes(product, epcGroups) {
  const article = normalizedArticle(product);
  const result = [];
  for (const epc of epcGroups) {
    const typeCode = phase2eReviewedTypeByArticleAndEpc.get(`${article}:${epc}`);
    if (typeCode) result.push(typeCode);
  }
  return result;
}

function hasReviewedPhase2EDisposition(product, epcGroups) {
  const article = normalizedArticle(product);
  return [...epcGroups].some((epc) => (
    phase2eReviewedArticleAndEpc.has(`${article}:${epc}`)
  ));
}

function reviewedPhase2FDisposition(product, epcGroups) {
  const article = normalizedArticle(product);
  for (const epc of epcGroups) {
    const row = phase2fReviewByArticleAndEpc.get(`${article}:${epc}`);
    if (row) return row;
  }
  return null;
}

function reviewedPhase2G1Disposition(product, epcGroups) {
  const article = normalizedArticle(product);
  for (const epc of epcGroups) {
    const row = phase2g1ReviewByArticleAndEpc.get(`${article}:${epc}`);
    if (row) return row;
  }
  return null;
}

function reviewedPhase2G2Disposition(product, epcGroups) {
  const article = normalizedArticle(product);
  for (const epc of epcGroups) {
    const row = phase2g2ReviewByArticleAndEpc.get(`${article}:${epc}`);
    if (row) return row;
  }
  return null;
}

function reviewedPhase2G3Disposition(product, epcGroups) {
  const article = normalizedArticle(product);
  const groups = epcGroups.size ? epcGroups : new Set([""]);
  for (const epc of groups) {
    const row = phase2g3ReviewByArticleAndEpc.get(`${article}:${epc}`);
    if (row) return row;
  }
  return null;
}

export function reviewedPhase2G3DispositionForProduct(product = {}) {
  return reviewedPhase2G3Disposition(product, technicalEpcGroups(product));
}

function detectFilterType(text, epcGroups) {
  const fuelVapor = /(?:charcoal\s+canister|carbon\s+canister|kraftstoffverdunst|fuel\s+vapou?r|\bevap\b|адсорбер|испарени\w*\s+топлив|паров\w*\s+топлив|випаров\w*\s+палив|пар[іи]в\w*\s+палив)/iu.test(text);
  const activatedCharcoalAtFuelEpc = epcGroups.has("47")
    && /(?:activated\s+(?:charcoal|carbon)(?:\s+filter)?|aktivkohlefilter|aktkohlefilter|актив[^\s]*(?:\s+[зс])?\s+(?:вугілл[^\s]*|угл[^\s]*)|вугіль|угольн[^\s]*\s+ф[іи]льтр|charcoal|carbon)/iu.test(text);
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
  const exhaustContext = /(?:вихлоп|выпуск|випуск|відпрацьован|отработан|exhaust|глуш|сажов|dpf|катал[іи]зат|ad.?blue|адблю)/iu.test(text);
  const sensor = /(?:датчик|sensor)/iu.test(text) && exhaustContext;
  if (sensor) types.push("EXHAUST_SENSOR");

  const catalyst = /(?:катал[іи]затор|catalytic\s+converter|catalyst)/iu.test(text)
    && !/(?:датчик|sensor|температур|temperature|тиск|давлен)/iu.test(text);
  if (catalyst) types.push("EXHAUST_CATALYST");

  const mount = /(?:кронштейн|хомут|подушк|опор[аи]|тримач|держател|гумк|резинк|hanger|bracket|clamp|mount|rubber)/iu.test(text)
    && (exhaustContext || epcGroups.has("49"));
  if (mount) types.push("EXHAUST_MOUNT");

  const pipeSubject = /(?:^|[\s(])(?:труб[аик]|патрубок|трубопров[іи]д|pipe|tube)(?:[\s),.-]|$)/iu.test(text);
  const exhaustGasContext = /(?:вихлоп|выпуск|випуск|відпрацьован|отработан|exhaust|глуш)/iu.test(text);
  const egrContext = /(?:\begr\b|рециркуляц\w*.*(?:вихлоп|випуск|выпуск|відпрацьован|отработан|газ)|(?:вихлоп|випуск|выпуск|відпрацьован|отработан).*рециркуляц)/iu.test(text);
  const egrPipe = pipeSubject && egrContext;
  if (egrPipe) types.push("EXHAUST_EGR_PIPE");

  const pipe = pipeSubject
    && (exhaustGasContext || epcGroups.has("49"))
    && !egrPipe
    && !/(?:накладк|кільц|кольц|прокладк|ущільн|уплотн|тримач|держател|кронштейн|хомут|подушк)/iu.test(text);
  if (pipe) types.push("EXHAUST_PIPE");

  const muffler = /(?:^|[\s(])(?:глушник|глушител[ьья]?|muffler|silencer)(?:[\s),.-]|$)/iu.test(text)
    && !/(?:труб|патруб|прокладк|ущільн|уплотн|кронштейн|хомут|болт|гайк|кільц|кольц|подушк|гумк|резинк|rubber|hanger|mount|накладк|рем.?комплект)/iu.test(text);
  if (muffler) types.push("EXHAUST_MUFFLER");

  const adblueInjector = /(?:форсунк|інжектор|инжектор|injector).*(?:ad.?blue|адблю)|(?:ad.?blue|адблю).*(?:форсунк|інжектор|инжектор|injector)/iu.test(text);
  if (adblueInjector) types.push("EXHAUST_ADBLUE_INJECTOR");
  return types;
}

function detectWheelTypes(text, epcGroups) {
  const types = [];
  const wheelContext = /(?:колес|коліс|wheel|шин|tire|tyre)/iu.test(text);
  const wheelEpc = epcGroups.has("40");

  const capSubject = /(?:ковпак|колпак|ковпачок|колпачок|заглушк|кришк|крышк|cap|cover)/iu.test(text);
  const spareWheel = /(?:(?:запасн|spare).*(?:колес|коліс|wheel)|(?:колес|коліс|wheel).*(?:запасн|spare))/iu.test(text);
  const valve = /(?:ніпел|ниппел|вентил|valve)/iu.test(text);
  const rimCenter = /(?:диск|обод|ступиц|маточин|hub|rim|center|centre|колес|коліс|wheel)/iu.test(text);

  const spareCover = capSubject && spareWheel;
  if (spareCover) types.push("WHEEL_SPARE_COVER");

  const valveCap = capSubject && valve && !spareCover && (wheelContext || wheelEpc);
  if (valveCap) types.push("WHEEL_VALVE_CAP");

  const centerCap = capSubject && rimCenter && !spareCover && !valveCap
    && (wheelContext || wheelEpc);
  if (centerCap) types.push("WHEEL_CENTER_CAP");

  const brakeOrOtherDisc = /(?:гальм|тормоз|brake|dvd|cd|програм|кардан|коробк|фрикц)/iu.test(text);
  const rim = /(?:диск\w*.*(?:колес|коліс|wheel)|(?:колес|коліс|wheel).*диск|wheel\s+rim|alloy\s+wheel)/iu.test(text)
    && !capSubject
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

function detectTransmissionTypes(text, epcGroups) {
  const types = [];
  if (epcGroups.has("25")) {
    if (/(?:корзин\w*\s+зчеп|зчеплен|сцеплен|clutch)/iu.test(text)) {
      types.push("CLUTCH_ASSEMBLY");
    }
    if (/(?:вижим|выжим|release\s+bearing)/iu.test(text)) {
      types.push("CLUTCH_RELEASE_BEARING");
    }
  }
  if (epcGroups.has("26") && /(?:селектор|перемикан\w*\s+(?:кпп|передач)|переключен\w*\s+(?:кпп|передач)|трос\w*\s+(?:кпп|селектор)|тяг\w*\s+кпп|shift\s+(?:cable|linkage))/iu.test(text)) {
    types.push("TRANSMISSION_SELECTOR_LINKAGE");
  }
  const transmissionEpc = epcGroups.has("27") || epcGroups.has("37");
  if (transmissionEpc) {
    if (/(?:ф[іи]льтр|filter).*(?:кпп|акпп|трансм|масл|мастил|олив)|(?:кпп|акпп|трансм).*(?:ф[іи]льтр|filter)/iu.test(text)) {
      types.push("TRANSMISSION_OIL_FILTER");
    }
    if (/(?:п[іи]ддон|поддон|oil\s+pan).*(?:кпп|акпп|трансм|масл|мастил|олив)|(?:кпп|акпп|трансм).*(?:п[іи]ддон|поддон|oil\s+pan)/iu.test(text)) {
      types.push("TRANSMISSION_OIL_PAN");
    }
    if (/(?:г[іи]дроблок|valve\s+body)/iu.test(text)) {
      types.push("TRANSMISSION_VALVE_BODY");
    }
    if (/(?:(?:прокладк|ущ[іи]льн|уплотн|сальник|seal|gasket|к[іи]льц|кольц).*(?:кпп|акпп|трансм|г[іи]дроблок)|(?:кпп|акпп|трансм|г[іи]дроблок).*(?:прокладк|ущ[іи]льн|уплотн|сальник|seal|gasket|к[іи]льц|кольц))/iu.test(text)) {
      types.push("TRANSMISSION_SEAL_GASKET");
    }
    if (/(?:(?:шланг|труб|патруб|оливопров|маслопров|oil\s+line).*(?:кпп|акпп|трансм|масл|мастил|олив)|(?:кпп|акпп|трансм).*(?:шланг|труб|патруб|оливопров|маслопров|oil\s+line))/iu.test(text)) {
      types.push("TRANSMISSION_FLUID_LINE");
    }
  }
  if (epcGroups.has("28") && /(?:роздав|раздат|transfer\s+case|маслозалив|оливи|сальник)/iu.test(text)) {
    types.push("TRANSFER_CASE_COMPONENT");
  }
  if (epcGroups.has("36") && /(?:пиловик|пыльник|чохол|boot).*(?:шрус|шркш|п[іи]вос|полуос)|^(?:пиловик|пыльник)$/iu.test(text.trim())) {
    types.push("DRIVETRAIN_CV_BOOT");
  }
  if (epcGroups.has("41")) {
    if (/(?:карданн?\w*\s+(?:вал|вала)|вал\w*\s+кардан|propeller\s+shaft|^кардан$)/iu.test(text)) {
      types.push("DRIVETRAIN_PROPELLER_SHAFT");
    }
    if (/(?:демпфер|муфт|диск\s+привод).*(?:кардан|вал)|(?:кардан|вал).*(?:демпфер|муфт)/iu.test(text)) {
      types.push("DRIVETRAIN_COUPLING_DAMPER");
    }
  }
  if (epcGroups.has("50") && /(?:труб|шланг).*(?:охолодж|охлажд).*(?:трансм|кпп|акпп)|(?:трансм|кпп|акпп).*(?:охолодж|охлажд).*(?:труб|шланг)/iu.test(text)) {
    types.push("TRANSMISSION_COOLER_LINE");
  }
  return types;
}

function detectFuelTypes(text, epcGroups) {
  const types = [];
  const fuelEpc = epcGroups.has("07") || epcGroups.has("47");
  if (!fuelEpc) return types;
  const fuelContext = /(?:палив|топлив|fuel)/iu.test(text);
  if (/(?:ad.?blue|адблю|едблю|scr)/iu.test(text)) {
    types.push("ADBLUE_SCR_COMPONENT");
  }
  if (fuelContext && /(?:форсунк|інжектор|инжектор|injector)/iu.test(text)) {
    types.push("FUEL_INJECTOR");
  }
  if (fuelContext && /(?:насос|pump)/iu.test(text)) types.push("FUEL_PUMP");
  if (fuelContext && /(?:шланг|труб|трубопров|hose|pipe|line)/iu.test(text)) {
    types.push("FUEL_LINE_HOSE");
  }
  if (fuelContext && /(?:рейк|рамп|розпод[іи]лювач|распределител|rail)/iu.test(text)) {
    types.push("FUEL_RAIL");
  }
  if (fuelContext && /(?:клапан|регулятор|valve|regulator)/iu.test(text)) {
    types.push("FUEL_PRESSURE_VALVE");
  }
  if (fuelContext && /(?:бак|модул|tank|module)/iu.test(text)) {
    types.push("FUEL_TANK_MODULE");
  }
  return types;
}

function detectCoolingTypes(text, epcGroups) {
  const types = [];
  const coolingEpc = epcGroups.has("20") || epcGroups.has("50");
  if (!coolingEpc) return types;
  const coolingContext = /(?:охолодж|охлажд|водян|водяной|coolant|cooling|радіатор|радиатор)/iu.test(text);
  if (/(?:насос|помпа|pump)/iu.test(text) && coolingContext) {
    types.push("COOLING_WATER_PUMP");
  }
  if (/(?:термостат|термоклапан|thermostat)/iu.test(text)) {
    types.push("COOLING_THERMOSTAT");
  }
  const acContext = /(?:кондиц|a\/?c|хладоген|refrigerant)/iu.test(text);
  if (epcGroups.has("50") && /(?:конденсатор|конденсор|радіатор|радиатор|condenser)/iu.test(text) && acContext) {
    types.push("AC_CONDENSER");
  } else if (epcGroups.has("50") && /(?:радіатор|радиатор|kuehler|radiator)/iu.test(text) && coolingContext) {
    types.push("COOLING_RADIATOR");
  }
  if (/(?:шланг|труб|патруб|з.?єднувач|соединител|hose|pipe)/iu.test(text) && coolingContext) {
    types.push("COOLING_HOSE_PIPE");
  }
  if (epcGroups.has("50") && /(?:бачок|бак|expansion\s+tank)/iu.test(text) && /(?:розшир|расшир|компенсац|охолодж|охлажд)/iu.test(text)) {
    types.push("COOLING_EXPANSION_TANK");
  }
  if (epcGroups.has("50") && /(?:клапан|valve)/iu.test(text) && coolingContext) {
    types.push("COOLING_CONTROL_VALVE");
  }
  if (epcGroups.has("50") && /(?:пов[іи]тро?в[іи]д|повітропров|воздуховод|канал\s+пов[іи]тр|air\s+guide|кронштейн|опор|накладк|реш[іе]тк).*(?:радіатор|радиатор)|(?:радіатор|радиатор).*(?:пов[іи]тро?в[іи]д|повітропров|воздуховод|кронштейн|опор|накладк|реш[іе]тк)/iu.test(text)) {
    types.push("COOLING_RADIATOR_AIR_GUIDE");
  }
  if (epcGroups.has("20") && /(?:ролик|натягувач|натяжник|натяжител|tensioner|pulley)/iu.test(text)) {
    types.push("ENGINE_BELT_DRIVE_COMPONENT");
  }
  if (epcGroups.has("50") && acContext && /(?:шланг|труб|маг[іи]страл|line|hose|pipe)/iu.test(text)) {
    types.push("AC_REFRIGERANT_LINE");
  }
  return types;
}

function detectClimateTypes(text, epcGroups) {
  const types = [];
  if (!epcGroups.has("83")) return types;
  const climateContext = /(?:кондиц|клімат|климат|опален|обігр|вентиляц|салон|хладоген|refrigerant|hvac|heater|a\/?c)/iu.test(text);
  if (/(?:дефлектор|реш[іе]тк\w*\s+обдув|пов[іи]тро?в[іи]д|повітропров|канал\s+пов[іи]тр|air\s+duct|vent)/iu.test(text)) {
    types.push("HVAC_AIR_DUCT_VENT");
  }
  if (climateContext && /(?:вентилятор|blower)/iu.test(text)) {
    types.push("HVAC_BLOWER_MOTOR");
  }
  if (climateContext && /(?:клапан|valve)/iu.test(text)) {
    types.push("HVAC_CONTROL_VALVE");
  }
  if (climateContext && /(?:шланг|трубопров|патруб|hose|pipe)/iu.test(text)) {
    types.push("HVAC_HOSE_PIPE");
  }
  if (/(?:дренаж|водов[іи]дв|drain)/iu.test(text)) {
    types.push("HVAC_DRAIN_LINE");
  }
  if (climateContext && /(?:датчик\s+температур|temperature\s+sensor)/iu.test(text)) {
    types.push("HVAC_TEMPERATURE_SENSOR");
  }
  if (climateContext && /(?:осушувач|осушител|receiver.?drier|dryer)/iu.test(text)) {
    types.push("AC_RECEIVER_DRIER");
  }
  if (/(?:комплект\s+ф[іи]льтр|filter\s+(?:kit|set))/iu.test(text)
      && /(?:салон|cabin)/iu.test(text)) {
    types.push("FILTER_CABIN_KIT");
  }
  return types;
}

export function isKnownCustomerProductTypeCode(value) {
  return knownTypeCodes.has(String(value || "").trim().toUpperCase());
}

export function detectCustomerProductTypes(product = {}) {
  const text = searchableText(product);
  if (!text) return [];
  const epcGroups = technicalEpcGroups(product);
  const phase2g3Disposition = reviewedPhase2G3Disposition(product, epcGroups);
  if (phase2g3Disposition?.finalBucket === "HIGH") {
    return phase2g3Disposition.typeCode ? [phase2g3Disposition.typeCode] : [];
  }
  const blocksPhase2G3FastenerTypes = ["SAFE_TOPLEVEL", "REAL_REVIEW"]
    .includes(phase2g3Disposition?.finalBucket);
  const phase2g2Disposition = reviewedPhase2G2Disposition(product, epcGroups);
  if (phase2g2Disposition?.finalBucket === "HIGH") {
    return phase2g2Disposition.typeCode ? [phase2g2Disposition.typeCode] : [];
  }
  if (["SAFE_TOPLEVEL", "REAL_REVIEW"].includes(phase2g2Disposition?.finalBucket)) {
    return [];
  }
  const phase2g1Disposition = reviewedPhase2G1Disposition(product, epcGroups);
  if (phase2g1Disposition?.finalBucket === "HIGH") {
    return phase2g1Disposition.typeCode ? [phase2g1Disposition.typeCode] : [];
  }
  if (["SAFE_TOPLEVEL", "REAL_REVIEW"].includes(phase2g1Disposition?.finalBucket)) {
    return [];
  }
  const phase2fDisposition = reviewedPhase2FDisposition(product, epcGroups);
  if (phase2fDisposition?.finalBucket === "HIGH") {
    return phase2fDisposition.typeCode ? [phase2fDisposition.typeCode] : [];
  }
  if (["SAFE_TOPLEVEL", "REAL_REVIEW"].includes(phase2fDisposition?.finalBucket)) {
    return [];
  }
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
  const reviewedPhase2E = hasReviewedPhase2EDisposition(product, epcGroups);
  detected.push(...reviewedPhase2ETypes(product, epcGroups));
  const filterType = detectFilterType(text, epcGroups);
  const phase2fExactOnlyEpc = phase2fExactFilterEpc.get(filterType);
  const exactOnlyCombination = phase2fExactOnlyEpc
    && [...epcGroups].some((epc) => phase2fExactOnlyEpc.has(epc));
  if (filterType && !exactOnlyCombination) detected.unshift(filterType);

  detected.push(...detectSteeringTypes(text, epcGroups));
  detected.push(...detectExhaustTypes(text, epcGroups));
  detected.push(...detectWheelTypes(text, epcGroups));
  if (!reviewedPhase2E) {
    detected.push(...detectTransmissionTypes(text, epcGroups));
    detected.push(...detectFuelTypes(text, epcGroups));
    detected.push(...detectCoolingTypes(text, epcGroups));
    detected.push(...detectClimateTypes(text, epcGroups));
  }

  const serviceBelt = /(?:рем[іе]нь|пасок|belt)/iu.test(text);
  const tensioner = detected.includes("BELT_TENSIONER");
  if (serviceBelt && !tensioner) detected.push("SERVICE_BELT");
  return [...new Set(detected)].filter((typeCode) => (
    !blocksPhase2G3FastenerTypes || !phase2g3FastenerTypeCodes.has(typeCode)
  ));
}
