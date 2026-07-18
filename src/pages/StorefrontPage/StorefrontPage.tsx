import { useAgentMode } from "../../components/AgentModeBar/AgentModeContext";
import { useCatalog } from "../../catalog/CatalogContext";
import { toProductCardProps } from "../../catalog/catalog";
import { ImmersiveHeader } from "../../components/ImmersiveHeader/ImmersiveHeader";
import ProductCard from "../../components/ProductCard/ProductCard";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import {
  ArrowRightIcon,
  ChevronRightIcon,
} from "../../components/icons/StorefrontIcons";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import coverImg from "../../assets/storefront-cover.webp";
import "./StorefrontPage.css";

export default function StorefrontPage() {
  const { featuredProducts, heroProduct, promoProducts, spotlightProducts } = useCatalog();
  const { navigate, navigateToProduct } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const { mode } = useAgentMode();

  return (
    <div className="figma-storefront">
      {mode === "immersive" ? (
        <ImmersiveHeader />
      ) : (
        <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />
      )}

      <main className="figma-storefront__page-inner">
        <section className="figma-storefront__hero">
          <button type="button" className="figma-storefront__hero-arrow figma-storefront__hero-arrow--left" aria-label="Previous slide">
            <ChevronRightIcon width={16} height={16} />
          </button>
          <button type="button" className="figma-storefront__hero-arrow figma-storefront__hero-arrow--right" aria-label="Next slide">
            <ChevronRightIcon width={16} height={16} />
          </button>
          <div className="figma-storefront__hero-overlay">
            <div className="figma-storefront__hero-content">
              <div className="figma-storefront__hero-copy">
                <h1>DJI LITO SERIES</h1>
                <p>beginner friendly drones</p>
              </div>
              <button type="button" onClick={() => navigateToProduct(heroProduct.slug)}>Explore now</button>
            </div>
          </div>
          <img src={coverImg} alt={heroProduct.imageAlt} className="figma-storefront__hero-image" />
        </section>

        <section className="figma-storefront__section">
          <h2>Featured DJI Gear</h2>
          <div className="figma-storefront__featured-grid">
            {featuredProducts.map((product) => (
              <ProductCard key={product.slug} {...toProductCardProps(product)} onSelect={() => navigateToProduct(product.slug)} />
            ))}
          </div>
        </section>

        <section className="figma-storefront__promo-grid" aria-label="DJI category highlights">
          {promoProducts.map((product) => (
            <article key={product.slug} className="figma-storefront__promo-card">
              <div className="figma-storefront__promo-card-image-shell">
                <img src={product.imageUrl} alt={product.imageAlt} />
              </div>
              <div className="figma-storefront__promo-card-body">
                <h3>{product.title}</h3>
                <p>{product.shortDescription}</p>
                <button type="button" onClick={() => navigateToProduct(product.slug)}>VIEW PRODUCT</button>
              </div>
            </article>
          ))}
        </section>

        <section className="figma-storefront__section">
          <h2>Creator Essentials</h2>
          <p className="figma-storefront__subtitle">Explore DJI favorites for aerial, action, and handheld capture.</p>
          <div className="figma-storefront__steps-grid">
            {spotlightProducts.map((product) => (
              <article key={product.slug} className="figma-storefront__step-card">
                <div className="figma-storefront__step-card-image-shell">
                  <img src={product.imageUrl} alt={product.imageAlt} />
                </div>
                <button type="button" className="figma-storefront__step-card-link" onClick={() => navigateToProduct(product.slug)}>
                  <span>{product.title}</span>
                  <ArrowRightIcon width={16} height={16} />
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="figma-storefront__promo-grid" aria-label="More DJI recommendations">
          {featuredProducts.slice(0, 2).map((product) => (
            <article key={`bottom-${product.slug}`} className="figma-storefront__promo-card">
              <div className="figma-storefront__promo-card-image-shell">
                <img src={product.imageUrl} alt={product.imageAlt} />
              </div>
              <div className="figma-storefront__promo-card-body">
                <h3>{product.category}</h3>
                <p>{product.shortDescription}</p>
                <button type="button" onClick={() => navigateToProduct(product.slug)}>DISCOVER MORE</button>
              </div>
            </article>
          ))}
        </section>
      </main>

      <section className="figma-storefront__newsletter">
        <h3>Stay Updated</h3>
        <p>Be first to hear about DJI launches, creator tips, and limited-time bundles.</p>
        <form>
          <input type="email" value="creator@dji-demo.com" readOnly aria-label="Email address" />
          <button type="button">Join</button>
        </form>
      </section>

      <footer className="figma-storefront__footer">
        <div>
          <strong>{SITE_BRAND}</strong>
          <div className="figma-storefront__footer-links">
            <a href={ROUTES.about} onClick={(event) => { event.preventDefault(); navigate(ROUTES.about); }}>About Us</a>
            <a href="#">DJI Care Refresh</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Support</a>
          </div>
          <p>{SITE_FOOTER_COPY}</p>
        </div>
        <div className="figma-storefront__footer-right">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Use</a>
        </div>
      </footer>
    </div>
  );
}
