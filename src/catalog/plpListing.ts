import type { CatalogProduct } from "./catalog";

/**
 * Same filter and order as ProductListingPage: optional category token matched
 * case-insensitively as a substring against `product.category`; otherwise full
 * catalog order.
 */
export function getProductsForProductListingPage(
  catalog: CatalogProduct[],
  categoryToken: string | null | undefined,
): CatalogProduct[] {
  const active = categoryToken?.trim() || null;
  if (!active) {
    return [...catalog];
  }
  const lower = active.toLowerCase();
  return catalog.filter((p) => p.category.toLowerCase().includes(lower));
}

/** Order a subset to match `catalog` iteration order (PLP order for that subset). */
export function orderProductsLikeCatalog(
  subset: CatalogProduct[],
  catalog: CatalogProduct[],
): CatalogProduct[] {
  const indexBySlug = new Map(catalog.map((p, i) => [p.slug, i]));
  return [...subset].sort(
    (a, b) => (indexBySlug.get(a.slug) ?? 0) - (indexBySlug.get(b.slug) ?? 0),
  );
}
