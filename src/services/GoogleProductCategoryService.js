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
    categories(product).some(isMercedesCollection);
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

  if (categories(product).some(isAutomotiveCategory)) {
    return GOOGLE_PRODUCT_CATEGORY.vehiclePartsAndAccessories;
  }

  return null;
}


export const GoogleProductCategoryService = {
  categoryFor: googleProductCategoryFor,
};
