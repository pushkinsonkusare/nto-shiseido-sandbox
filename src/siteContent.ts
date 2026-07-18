export type PrimaryNavItem = {
  label: string;
  emphasized?: boolean;
  /**
   * Optional category token used to filter the product listing page.
   * Matched case-insensitively as a substring against `CatalogProduct.category`,
   * so e.g. "Drones" matches both "Drones" and "4K drones".
   */
  category?: string;
};

export const SITE_BRAND = "DJI";
export const SITE_ANNOUNCEMENT = "Free shipping on select DJI gear and creator bundles";
export const SITE_FOOTER_COPY = "© DJI demo storefront experience";
export const SITE_ADDRESS = "415 Mission Street, San Francisco, CA 94105";

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { label: "Camera Drones", category: "Drones" },
  { label: "Action Cameras", category: "Action cameras" },
  { label: "Handheld", category: "Gimbals" },
  { label: "Accessories", category: "Accessories" },
  { label: "Sale" },
];
