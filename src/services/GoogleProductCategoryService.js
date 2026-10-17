export const GOOGLE_PRODUCT_CATEGORY = Object.freeze({
  vehiclePartsAndAccessories: "5613",
  shirtsAndTops: "212",
});


const AUTOMOTIVE_CATEGORY_SLUGS = new Set([
  "engine",
  "fuel-system",
  "cooling",
  "brakes",
  "suspension",
  "steering",
  "electrical",
  "filters",
  "body",
  "transmission",
  "drivetrain",
  "wheels",
  "climate",
  "exhaust",
  "interior",
  "controls",
  "fasteners",
]);


// The approved customer taxonomy is a second, independent source of evidence.
// 'accessories' is intentionally excluded: it also contains clothing/merchandise.
const CUSTOMER_AUTOMOTIVE_ROOT_SLUGS = new Set([
  "engine",
  "fuel-system",
  "cooling",
  "brakes",
  "suspension",
  "steering",
  "electrical-electronics-lighting",
  "filters-maintenance",
  "body-glass",
  "transmission-drivetrain",
  "wheels",
  "climate",
  "exhaust",
  "interior-safety",
  "fasteners-seals-standard-parts",
]);

const AUTOMOTIVE_ACCESSORY_SLUGS = new Set([
  "mb-accessories-floor-mats",
  "mb-accessories-luggage",
  "mb-accessories-children",
  "mb-accessories-wheels",
  "mb-accessories-interior",
  "mb-accessories-exterior",
  "mb-accessories-multimedia",
  "mb-accessories-safety",
  "mb-accessories-care",
]);


const SHIRT_PATTERN =
  /(?:^|[\s/(),.-])(тен[іи]ска|футболка|t[\s-]?shirt|shirt)(?=$|[\s/(),.-])/iu;


function text(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}


function categories(product) {
  return Array.isArray(product?.merchant_categories)
    ? product.merchant_categories
    : [];
}


function categorySlug(category) {
  return text(category?.slug).toLowerCase();
}


function parentSlug(category) {
  return text(category?.parent_slug).toLowerCase();
}


function isMercedesCollection(category) {
  return categorySlug(category) === "mb-accessories-collection";
}

function approvedCustomerCategory(product) {
  const category = product?.merchant_customer_category;
  if (!category || !["AUTO_APPROVED", "MANUAL_APPROVED"].includes(category.approval_status)) {
    return null;
  }
  return category;
}

function isCustomerCollection(product) {
  const category = approvedCustomerCategory(product);
  return categorySlug(category) === "accessories-collection"
    && text(category?.root_slug).toLowerCase() === "accessories";
}

function isCustomerAutomotiveCategory(product) {
  const category = approvedCustomerCategory(product);
  return CUSTOMER_AUTOMOTIVE_ROOT_SLUGS.has(text(category?.root_slug).toLowerCase());
}


function isAutomotiveCategory(category) {
  const slug = categorySlug(category);
  const parent = parentSlug(category);

  return slug.startsWith("mb-group-")
    || AUTOMOTIVE_CATEGORY_SLUGS.has(slug)
    || AUTOMOTIVE_CATEGORY_SLUGS.has(parent)
    || AUTOMOTIVE_ACCESSORY_SLUGS.has(slug);
}


function isShirt(product) {
  const hasCollectionCategory =
    categories(product).some(isMercedesCollection)
    || isCustomerCollection(product);
  if (!hasCollectionCategory) return false;

  return SHIRT_PATTERN.test([
    product?.merchant_name,
    product?.merchant_product_type,
  ].map(text).join(" "));
}


export function googleProductCategoryFor(product) {
  if (isShirt(product)) {
    return GOOGLE_PRODUCT_CATEGORY.shirtsAndTops;
  }

  if (categories(product).some(isAutomotiveCategory)
      || isCustomerAutomotiveCategory(product)) {
    return GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories;
  }

  return null;
}


export const GoogleProductCategoryService = {
  categoryFor: googleProductCategoryFor,
};
