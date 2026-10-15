// Customer-facing navigation only. These slugs refer to existing customer taxonomy roots;
// no category or assignment is created or changed by a direction.
export const CATALOG_DIRECTIONS = Object.freeze([
  { slug: "maintenance", roots: ["filters-maintenance"], names: { uk: "ТО та фільтри", ru: "ТО и фильтры", en: "Maintenance and filters" } },
  { slug: "engine-systems", roots: ["engine", "cooling", "fuel-system", "exhaust"], names: { uk: "Двигун та його системи", ru: "Двигатель и его системы", en: "Engine and its systems" } },
  { slug: "transmission", roots: ["transmission-drivetrain"], names: { uk: "Коробка передач і привід", ru: "Коробка передач и привод", en: "Transmission and drivetrain" } },
  { slug: "chassis", roots: ["suspension", "steering", "wheels"], names: { uk: "Ходова частина", ru: "Ходовая часть", en: "Chassis" } },
  { slug: "brakes", roots: ["brakes"], names: { uk: "Гальма", ru: "Тормоза", en: "Brakes" } },
  { slug: "electrical", roots: ["electrical-electronics-lighting"], names: { uk: "Електрика та освітлення", ru: "Электрика и освещение", en: "Electrical and lighting" } },
  { slug: "body-interior-climate", roots: ["body-glass", "interior-safety", "climate"], names: { uk: "Кузов, салон і клімат", ru: "Кузов, салон и климат", en: "Body, interior and climate" } },
  { slug: "fasteners", roots: ["fasteners-seals-standard-parts"], names: { uk: "Кріплення та ущільнення", ru: "Крепёж и уплотнения", en: "Fasteners and seals" } },
  { slug: "accessories", roots: ["accessories"], names: { uk: "Аксесуари", ru: "Аксессуары", en: "Accessories" } },
]);

export function catalogDirection(slug) {
  return CATALOG_DIRECTIONS.find((direction) => direction.slug === slug) || null;
}
