import { useRef } from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import { formatPrice } from "../../catalog/catalog";
import {
  BadgeHelpIcon,
  ChevronRightIcon,
  GlobeIcon,
  StoreIcon,
  UserIcon,
} from "../../components/icons/StorefrontIcons";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { SITE_ADDRESS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import "./OrderConfirmationPage.css";

const helpLinks = ["FAQ", "Contact Us", "Return Policy"];
const footerLinks = ["DJI Care Refresh", "Privacy Policy", "Support"];

export default function OrderConfirmationPage() {
  const { cartLines, getProductBySlug, orderHistory, recommendedProducts } = useCatalog();
  const { navigate } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const recommendationsTrackRef = useRef<HTMLDivElement | null>(null);
  const orderedItems = cartLines
    .map((line) => {
      const product = getProductBySlug(line.productSlug);
      if (!product) {
        return null;
      }

      return {
        id: line.id,
        name: product.title,
        imageUrl: product.imageUrl,
        color: product.category,
        size: line.label,
        quantity: line.quantity,
        priceValue: product.price ?? 0,
        price: product.priceFormatted,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const subtotal = orderedItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);
  const promotions = subtotal * 0.05;
  const tax = subtotal * 0.07;
  const total = subtotal - promotions + tax;
  const latestOrder = orderHistory[0];

  const scrollRecommendationsByCard = (direction: "prev" | "next") => {
    const track = recommendationsTrackRef.current;
    if (!track) return;

    const firstCard = track.querySelector<HTMLElement>(".figma-order-confirmation__recommendation-card");
    const cardWidth = firstCard?.offsetWidth ?? 160;
    const trackStyles = window.getComputedStyle(track);
    const gap = Number.parseFloat(trackStyles.columnGap || trackStyles.gap || "0") || 0;
    const step = cardWidth + gap;
    const left = direction === "next" ? step : -step;

    track.scrollBy({ left, behavior: "smooth" });
  };

  return (
    <div className="figma-order-confirmation">
      <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />

      <main className="figma-order-confirmation__main">
        <div className="figma-order-confirmation__content">
          <section className="figma-order-confirmation__card figma-order-confirmation__hero-card">
            <div className="figma-order-confirmation__hero-top">
              <div className="figma-order-confirmation__hero-copy">
                <h1>Thank you, Creator!</h1>
                <p>Your DJI order is confirmed.</p>
              </div>
              <p className="figma-order-confirmation__order-id">Order #: {latestOrder?.id ?? "DJI-41021"}</p>
            </div>

            <p className="figma-order-confirmation__email-copy">
              We&apos;ve sent a confirmation email to creator@dji-demo.com.
            </p>

            <div className="figma-order-confirmation__help-row">
              <p>Need help?</p>
              <div className="figma-order-confirmation__help-actions">
                {helpLinks.map((label) => (
                  <a key={label} href="#" className="figma-order-confirmation__secondary-button">
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </section>

          <section className="figma-order-confirmation__card figma-order-confirmation__fulfillment-card">
            <div className="figma-order-confirmation__fulfillment-column">
              <h2>Arriving by next week</h2>
            </div>
            <div className="figma-order-confirmation__fulfillment-column">
              <h2>Shipping Address</h2>
              <p>DJI Creator</p>
              <p>{SITE_ADDRESS}</p>
              <p>United States</p>
            </div>
            <div className="figma-order-confirmation__fulfillment-column">
              <h2>Shipping Method</h2>
              <p>Free | Priority Shipping</p>
            </div>
          </section>

          <section className="figma-order-confirmation__card figma-order-confirmation__summary-card">
            <h2 className="figma-order-confirmation__section-title">Summary</h2>

            <div className="figma-order-confirmation__summary-list">
              {orderedItems.map((item) => (
                <article key={item.id} className="figma-order-confirmation__summary-item">
                  <div className="figma-order-confirmation__summary-thumb">
                    <img src={item.imageUrl} alt={item.name} />
                  </div>
                  <div className="figma-order-confirmation__summary-item-body">
                    <h3>{item.name}</h3>
                    <div className="figma-order-confirmation__summary-meta">
                      <p>Category: {item.color}</p>
                      <p>Kit: {item.size}</p>
                    </div>
                    <div className="figma-order-confirmation__summary-pricing">
                      <span className="figma-order-confirmation__summary-price">{item.price}</span>
                    </div>
                    <p className="figma-order-confirmation__summary-qty">Qty: {item.quantity}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="figma-order-confirmation__totals">
              {[
                { label: "Subtotal", value: formatPrice(subtotal) },
                { label: "Promotions", value: `-${formatPrice(promotions)}` },
                { label: "Shipping", value: "$0.00" },
                { label: "Tax", value: formatPrice(tax) },
                { label: "Total", value: formatPrice(total), emphasized: true },
              ].map((line) => (
                <div
                  key={line.label}
                  className={line.emphasized ? "figma-order-confirmation__total-line figma-order-confirmation__total-line--emphasized" : "figma-order-confirmation__total-line"}
                >
                  <span>{line.label}</span>
                  <span>{line.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="figma-order-confirmation__card figma-order-confirmation__payment-card" aria-label="Payment summary">
            <div className="figma-order-confirmation__payment-copy">
              <span className="figma-order-confirmation__payment-logo">VISA</span>
              <span>Ending in 1234</span>
            </div>
            <span className="figma-order-confirmation__payment-total">{formatPrice(total)}</span>
          </section>

          <section className="figma-order-confirmation__card figma-order-confirmation__signup-card">
            <div className="figma-order-confirmation__signup-copy">
              <p>Get launch alerts, creator stories, and 10% off your next DJI accessory order.</p>
              <label className="figma-order-confirmation__signup-field">
                <span className="figma-order-confirmation__sr-only">Email address</span>
                <input type="email" placeholder="Email address" />
              </label>
            </div>
            <button type="button" className="figma-order-confirmation__primary-button">
              Join
            </button>
          </section>

          <section className="figma-order-confirmation__card figma-order-confirmation__recommendations-card">
            <h2 className="figma-order-confirmation__recommendations-title">You May Also Like</h2>
            <div className="figma-order-confirmation__recommendations-carousel">
              <button
                type="button"
                className="figma-order-confirmation__carousel-arrow figma-order-confirmation__carousel-arrow--left"
                aria-label="Previous recommendations"
                onClick={() => scrollRecommendationsByCard("prev")}
              >
                <ChevronRightIcon width={16} height={16} />
              </button>
              <div className="figma-order-confirmation__recommendations-track" ref={recommendationsTrackRef}>
                {recommendedProducts.map((product) => (
                  <div key={product.slug} className="figma-order-confirmation__recommendation-card">
                    <img src={product.imageUrl} alt={product.imageAlt} />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="figma-order-confirmation__carousel-arrow figma-order-confirmation__carousel-arrow--right"
                aria-label="Next recommendations"
                onClick={() => scrollRecommendationsByCard("next")}
              >
                <ChevronRightIcon width={16} height={16} />
              </button>
            </div>
          </section>

          <section className="figma-order-confirmation__card figma-order-confirmation__share-card">
            <p>Show us what you create next! #ShotOnDJI</p>
          </section>
        </div>
      </main>

      <footer className="figma-order-confirmation__footer">
        <div className="figma-order-confirmation__footer-inner">
          <div className="figma-order-confirmation__footer-row">
            <div className="figma-order-confirmation__footer-left">
              <a href="#" className="figma-order-confirmation__footer-brand" aria-label="DJI home">
                <span className="figma-order-confirmation__footer-logo">{SITE_BRAND}</span>
              </a>
              <div className="figma-order-confirmation__footer-links">
                {footerLinks.map((label) => (
                  <a key={label} href="#">
                    {label}
                  </a>
                ))}
              </div>
            </div>
            <div className="figma-order-confirmation__footer-social" aria-hidden="true">
              <span><StoreIcon width={16} height={16} /></span>
              <span><UserIcon width={16} height={16} /></span>
              <span><BadgeHelpIcon width={16} height={16} /></span>
            </div>
          </div>

          <div className="figma-order-confirmation__footer-row">
            <p className="figma-order-confirmation__copyright">
              {SITE_FOOTER_COPY} · {SITE_ADDRESS}
            </p>
            <div className="figma-order-confirmation__footer-meta">
              <a href="#">
                <GlobeIcon width={16} height={16} />
                <span>Privacy Policy</span>
              </a>
              <a href="#">
                <BadgeHelpIcon width={16} height={16} />
                <span>Terms of Use</span>
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
