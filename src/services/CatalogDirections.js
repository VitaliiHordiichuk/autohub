// Customer-facing navigation only. These slugs refer to existing customer taxonomy roots;
// no category or assignment is created or changed by a direction.
const ENGINE_NAVIGATION_GROUPS = Object.freeze([
  { slug: "engine-core", sources: ["engine-block-crankshaft-pistons", "engine-cylinder-head-components", "engine-covers-crankcase"], names: { uk: "Блок, головка та картер", ru: "Блок, головка и картер", en: "Block, cylinder head and crankcase" } },
  { slug: "engine-timing-valvetrain", sources: ["engine-timing-components", "engine-valvetrain-components"], names: { uk: "ГРМ та клапанний механізм", ru: "ГРМ и клапанный механизм", en: "Timing and valvetrain" } },
  { slug: "engine-belt-drive", sources: ["engine-belt-tensioners", "engine-belt-rollers-idlers", "engine-belt-pulleys"], names: { uk: "Ремінний привід", ru: "Ремённый привод", en: "Accessory belt drive" } },
  { slug: "engine-oil-system", sources: ["engine-oil-system-components", "engine-oil-lines-coolers", "engine-oil-pumps"], names: { uk: "Оливна система", ru: "Масляная система", en: "Oil system" } },
  { slug: "engine-intake-boost", sources: ["engine-intake-manifolds-throttle", "engine-intake-air-ducts", "engine-air-filter-housings", "engine-turbo-charge-air"], names: { uk: "Впуск та наддув", ru: "Впуск и наддув", en: "Intake and boost" } },
  { slug: "engine-ventilation-vacuum", sources: ["engine-crankcase-ventilation", "engine-vacuum-system"], names: { uk: "Вентиляція картера та вакуум", ru: "Вентиляция картера и вакуум", en: "Crankcase ventilation and vacuum" } },
  { slug: "engine-gaskets-seals", sources: ["engine-gaskets-seals"], names: { uk: "Прокладки та ущільнення", ru: "Прокладки и уплотнения", en: "Gaskets and seals" } },
  { slug: "engine-mounts", sources: ["engine-mounts"], names: { uk: "Опори двигуна", ru: "Опоры двигателя", en: "Engine mounts" } },
  { slug: "engine-sensors", sources: ["engine-sensors"], names: { uk: "Датчики двигуна", ru: "Датчики двигателя", en: "Engine sensors" } },
  { slug: "cooling", sources: ["cooling"], names: { uk: "Охолодження двигуна", ru: "Охлаждение двигателя", en: "Engine cooling" } },
  { slug: "fuel-system", sources: ["fuel-system"], names: { uk: "Паливна система", ru: "Топливная система", en: "Fuel system" } },
  { slug: "exhaust", sources: ["exhaust"], names: { uk: "Вихлоп та очищення газів", ru: "Выхлоп и очистка газов", en: "Exhaust and emissions" } },
]);

export const CATALOG_DIRECTIONS = Object.freeze([
  { slug: "maintenance", roots: ["filters-maintenance"], names: { uk: "ТО та фільтри", ru: "ТО и фильтры", en: "Maintenance and filters" } },
  { slug: "engine-systems", roots: ["engine", "cooling", "fuel-system", "exhaust"], names: { uk: "Двигун та його системи", ru: "Двигатель и его системы", en: "Engine and its systems" }, navigationGroups: ENGINE_NAVIGATION_GROUPS },
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

// Counts in the approved-primary tree are disjoint between sibling subtrees.
// Remove duplicate sources and descendants of another selected source before
// summing, so a root and one of its children can never count a product twice.
export function buildCatalogNavigationGroups(direction, roots, locale) {
  if (!direction.navigationGroups) return undefined;
  const categories = new Map();
  const index = (category, ancestors = []) => {
    categories.set(category.slug, { category, ancestors });
    (category.children || []).forEach((child) => index(child, [...ancestors, category.slug]));
  };
  roots.forEach((root) => index(root));

  return direction.navigationGroups.map((group) => {
    const requested = new Set(group.sources);
    const sources = [...new Map(group.sources
      .map((slug) => categories.get(slug))
      .filter((item) => item && !item.ancestors.some((slug) => requested.has(slug)))
      .map((item) => [item.category.id, item.category])).values()];
    const members = new Set();
    const collect = (category) => {
      members.add(category.slug);
      (category.children || []).forEach(collect);
    };
    sources.forEach(collect);
    return {
      slug: group.slug,
      name: group.names[locale] || group.names.uk,
      productCount: sources.reduce((count, category) => count + category.productCount, 0),
      categoryIds: sources.map((category) => category.id),
      categorySlugs: sources.map((category) => category.slug),
      memberSlugs: [...members],
    };
  }).filter((group) => group.productCount > 0);
}
