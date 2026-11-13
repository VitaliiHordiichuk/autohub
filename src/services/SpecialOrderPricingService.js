/**
 * Price rules for TXT-only special-order search offers.
 * Ordinary warehouse and partner price rules remain unchanged.
 * The TXT price is retail UAH EXCLUDING 20% VAT.
 * Read the SECOND discount-group field; never extract numbers from text codes.
 */
const PREMIUM_5 = ["03", "05", "08", "081", "082", "083", "08s", "081s", "082s", "083s", "09"];
const PREMIUM_25 = [
  "10", "13", "13s", "16", "16s", "17", "18", "20", "20s", "23",
  "26", "28", "30", "30s", "32", "35", "38", "38s", "40", "40s",
  "43", "46", "50", "52", "54",
];
const PREMIUM_7 = Array.from({ length: 18 }, (_, i) => String(i + 55));

const discounts = new Map([
  ["00", { premium: 0, standard: 0 }],
  ...PREMIUM_5.map(group => [group, { premium: 5, standard: 1 }]),
  ...PREMIUM_25.map(group => [group, { premium: 25, standard: 6 }]),
  ...PREMIUM_7.map(group => [group, { premium: 7, standard: 2 }]),
]);

function normalizeGroup(value) {
  if (typeof value !== "string") return null;
  const group = value.trim().toLowerCase();
  // STRICT full-token matching. No prefix stripping or digit extraction.
  return /^[0-9]{2,3}s?$/.test(group) ? group : null;
}

export function specialOrderDiscountGroup(value) {
  const group = normalizeGroup(value);
  if (!group || !discounts.has(group)) return null;
  return group;
}

export function specialOrderAllowedGroups() {
  return [...discounts.keys()];
}

function toPriceUnits(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().replace(",", ".");
  // At most four decimal places; reject grouping separators and negative prices.
  const match = /^(?:0|[1-9][0-9]{0,10})(?:\.([0-9]{1,4}))?$/.exec(raw);
  if (!match) return null;
  const [integer] = raw.split(".");
  const fractional = (match[1] || "").padEnd(4, "0");
  const units = BigInt(integer) * 10000n + BigInt(fractional);
  return units > 0n ? units : null;
}

/**
 * @returns {null | {articlePriceUah:number, discountGroup:string,
 *   discountPercent:number, customerTier:'premium'|'standard',currency:'UAH'}}
 * Unknown group or invalid price => null, never an incorrect public price.
 */
export function calculateSpecialOrderPrice({
  retailPriceExVatUah,
  secondDiscountGroup,
  priceGroupName,
}) {
  const discountGroup = specialOrderDiscountGroup(secondDiscountGroup);
  const amount = toPriceUnits(retailPriceExVatUah);
  if (!discountGroup || amount === null) return null;

  const tierName = String(priceGroupName || "").trim().toUpperCase();
  const customerTier = tierName === "GOLD" || tierName === "VIP"
    ? "premium" : "standard";
  const discountPercent = discounts.get(discountGroup)[customerTier];

  // Source has up to 4 fractional digits. Add 20% VAT, apply group discount,
  // and round half-up ONCE at the end using integer arithmetic.
  const numerator = amount * 120n * BigInt(100 - discountPercent);
  const cents = (numerator + 500000n) / 1000000n;
  const articlePriceUah = Number(cents) / 100;
  if (!Number.isSafeInteger(Number(cents)) || articlePriceUah <= 0) return null;
  return { articlePriceUah, discountGroup, discountPercent, customerTier, currency: "UAH" };
}
