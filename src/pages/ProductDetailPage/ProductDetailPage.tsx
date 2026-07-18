import { useEffect, useState } from "react";
import { useAgentMode } from "../../components/AgentModeBar/AgentModeContext";
import { useCatalog } from "../../catalog/CatalogContext";
import { toProductCardProps } from "../../catalog/catalog";
import ProductCard from "../../components/ProductCard/ProductCard";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
} from "../../components/icons/StorefrontIcons";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import PdpNbaPanel from "./PdpNbaPanel";
import "./ProductDetailPage.css";

export default function ProductDetailPage() {
  const { featuredProducts, getProductBySlug, getRelatedProducts, products } = useCatalog();
  const { currentProductSlug, navigate, navigateToProduct } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const { mode: agentMode } = useAgentMode();
  // The "Ask Assistant" contextual FAQ pill rail is an AI-only affordance: it
  // surfaces shopper prompts that get dispatched into the Sidecar / SxS
  // assistants. We only render it when one of those assistant surfaces is
  // actually mounted, otherwise the pills lead nowhere on the native PDP.
  const showNbaPanel = agentMode === "assistant-only" || agentMode === "side-by-side";
  const product = getProductBySlug(currentProductSlug) ?? featuredProducts[0] ?? products[0];
  const gallery = product.gallery.length > 0 ? product.gallery : [product.imageUrl];
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [product.slug]);

  const activeImage = gallery[activeImageIndex] ?? gallery[0];
  const relatedProducts = getRelatedProducts(product.slug, 15);
  const detailBenefits = (product.specs.length > 0 ? product.specs : product.featureBlocks.map((block, index) => ({
    label: `Feature ${index + 1}`,
    value: block,
  }))).slice(0, 3);

  return (
    <div className="figma-pdp">
      <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />

      <div className="figma-pdp__page-inner">
        <div className="figma-pdp__breadcrumbs">
          <span>Home</span>
          <ChevronRightIcon width={14} height={14} />
          <span>Products</span>
          <ChevronRightIcon width={14} height={14} />
          <span>{product.title}</span>
        </div>

        <section className="figma-pdp__hero">
          <div className="figma-pdp__gallery">
            <div className="figma-pdp__hero-image-wrap">
              <img src={activeImage} alt={product.imageAlt} className="figma-pdp__hero-image" />
              {gallery.length > 1 && (
                <>
                  <button
                    className="figma-pdp__gallery-arrow figma-pdp__gallery-arrow--prev"
                    aria-label="Previous image"
                    onClick={() => setActiveImageIndex((activeImageIndex - 1 + gallery.length) % gallery.length)}
                  >
                    <ArrowLeftIcon width={16} height={16} />
                  </button>
                  <button
                    className="figma-pdp__gallery-arrow figma-pdp__gallery-arrow--next"
                    aria-label="Next image"
                    onClick={() => setActiveImageIndex((activeImageIndex + 1) % gallery.length)}
                  >
                    <ArrowRightIcon width={16} height={16} />
                  </button>
                </>
              )}
            </div>
            <div className="figma-pdp__thumbs">
              {gallery.map((image, index) => (
                <img
                  key={image}
                  src={image}
                  alt={`${product.title} thumbnail`}
                  className={`figma-pdp__thumb${index === activeImageIndex ? " is-active" : ""}`}
                  onClick={() => setActiveImageIndex(index)}
                />
              ))}
            </div>
          </div>

          <aside className="figma-pdp__info">
            <p className="figma-pdp__brand">{product.brand}</p>
            <h1>{product.title}</h1>
            <p className="figma-pdp__sku">SKU: {product.sku ?? product.model ?? "DJI-CATALOG"}</p>
            <p className="figma-pdp__stars">
              {product.rating ? `${product.rating.toFixed(1)} / 5` : "New release"}
              {product.reviewCount ? ` (${product.reviewCount} reviews)` : ""}
            </p>
            <p className="figma-pdp__price">{product.priceFormatted}</p>

            <div className="figma-pdp__field">
              <label>Key Specs:</label>
              <div className="figma-pdp__chips">
                {detailBenefits.slice(0, 3).map((benefit, index) => (
                  <button key={benefit.label} className={index === 0 ? "is-active" : undefined}>{benefit.label}</button>
                ))}
              </div>
            </div>

            <div className="figma-pdp__field">
              <label>Quantity</label>
              <input type="number" value={1} readOnly />
            </div>

            <div className="figma-pdp__shipping-row">
              <div>
                <p>Deliver to 94123</p>
                <small>Fast shipping in 2-4 business days</small>
              </div>
              <div>
                <p>Creator support included</p>
                <small>DJI Care, setup resources, and support available.</small>
              </div>
            </div>

            <button className="figma-pdp__cta" type="button" onClick={() => navigate(ROUTES.cart)}>Add to Cart</button>
            <p className="figma-pdp__or">or buy with</p>
            <button className="figma-pdp__apple-pay">Apple Pay</button>
            <button className="figma-pdp__paypal">PayPal</button>
            <p className="figma-pdp__pay-note">Pay in 4 interest-free payments of $12.25 with PayPal. Learn more</p>

            {showNbaPanel ? <PdpNbaPanel product={product} catalog={products} /> : null}

            <p className="figma-pdp__desc">{product.shortDescription}</p>

            <div className="figma-pdp__benefits">
              {detailBenefits.map((benefit) => (
                <article key={benefit.label}>
                  <h3>{benefit.label}</h3>
                  <p>{benefit.value}</p>
                </article>
              ))}
            </div>
          </aside>
        </section>

        <section className="figma-pdp__rail">
          <h2>Complete the setup</h2>
          <div className="figma-pdp__cards">
            {relatedProducts.slice(0, 5).map((relatedProduct) => (
              <ProductCard
                key={`complete-${relatedProduct.slug}`}
                {...toProductCardProps(relatedProduct)}
                onSelect={() => navigateToProduct(relatedProduct.slug)}
              />
            ))}
          </div>
        </section>

        <section className="figma-pdp__rail">
          <h2>You may also like</h2>
          <div className="figma-pdp__cards">
            {relatedProducts.slice(5, 10).map((relatedProduct) => (
              <ProductCard
                key={`also-${relatedProduct.slug}`}
                {...toProductCardProps(relatedProduct)}
                onSelect={() => navigateToProduct(relatedProduct.slug)}
              />
            ))}
          </div>
        </section>

        <section className="figma-pdp__rail">
          <h2>Recently viewed</h2>
          <div className="figma-pdp__cards">
            {relatedProducts.slice(10, 15).map((relatedProduct) => (
              <ProductCard
                key={`recent-${relatedProduct.slug}`}
                {...toProductCardProps(relatedProduct)}
                onSelect={() => navigateToProduct(relatedProduct.slug)}
              />
            ))}
          </div>
        </section>

        <footer className="figma-pdp__footer">
          <div className="figma-pdp__footer-left">
            <strong>{SITE_BRAND}</strong>
            <div className="figma-pdp__footer-links">
              <a href="#">DJI Care Refresh</a>
              <a href="#">Privacy Policy</a>
              <a href="#">Support</a>
            </div>
            <p>{SITE_FOOTER_COPY}</p>
          </div>
          <div className="figma-pdp__footer-right">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Use</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
