import { useCatalog } from "../../catalog/CatalogContext";
import { formatPrice } from "../../catalog/catalog";
import {
  BadgeHelpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GlobeIcon,
  TruckIcon,
} from "../../components/icons/StorefrontIcons";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { SITE_ADDRESS, SITE_FOOTER_COPY } from "../../siteContent";
import "./CheckoutPage.css";

function ExpressCheckout() {
  return (
    <section className="figma-checkout__panel figma-checkout__express" aria-labelledby="express-checkout-title">
      <p id="express-checkout-title" className="figma-checkout__express-title">
        Express Checkout
      </p>
      <div className="figma-checkout__express-grid">
        <button type="button" className="figma-checkout__pay-btn figma-checkout__pay-btn--google" aria-label="Google Pay">
          <span className="figma-checkout__gpay-lockup" aria-hidden="true">G Pay</span>
        </button>
        <button type="button" className="figma-checkout__pay-btn figma-checkout__pay-btn--apple" aria-label="Apple Pay">
          <span className="figma-checkout__apple-pay" aria-hidden="true">
            {"\uF8FF"}Pay
          </span>
        </button>
        <button type="button" className="figma-checkout__pay-btn figma-checkout__pay-btn--paypal" aria-label="PayPal">
          <span className="figma-checkout__paypal-logo" aria-hidden="true">PayPal</span>
        </button>
        <button type="button" className="figma-checkout__pay-btn figma-checkout__pay-btn--venmo" aria-label="Venmo">
          <span className="figma-checkout__venmo-logo" aria-hidden="true">Venmo</span>
        </button>
        <button type="button" className="figma-checkout__pay-btn figma-checkout__pay-btn--amazon" aria-label="Amazon Pay">
          <span className="figma-checkout__amazon-logo" aria-hidden="true">Amazon Pay</span>
        </button>
      </div>
    </section>
  );
}

function Divider() {
  return (
    <div className="figma-checkout__divider" aria-hidden="true">
      <span />
      <p>or continue below</p>
      <span />
    </div>
  );
}

function UpcomingSection({ title }: { title: string }) {
  return (
    <section className="figma-checkout__panel figma-checkout__section">
      <header className="figma-checkout__section-header">
        <h2>{title}</h2>
      </header>
      <div className="figma-checkout__section-body">
        <p>Complete previous steps to continue</p>
      </div>
    </section>
  );
}

function ContactInformationSection() {
  return (
    <section className="figma-checkout__panel figma-checkout__section">
      <header className="figma-checkout__section-header">
        <h2>Contact Information</h2>
      </header>
      <div className="figma-checkout__contact-fields">
        <label className="figma-checkout__field">
          <span className="figma-checkout__label">Email Address*</span>
          <input type="email" placeholder="creator@dji-demo.com" aria-label="Email Address" />
        </label>
        <div className="figma-checkout__phone-row">
          <label className="figma-checkout__field figma-checkout__field--code">
            <span className="figma-checkout__label">Code</span>
            <button type="button" className="figma-checkout__select" aria-label="Country code">
              <ChevronDownIcon width={16} height={16} />
              <span>+1</span>
            </button>
          </label>
          <label className="figma-checkout__field figma-checkout__field--phone">
            <span className="figma-checkout__label">Phone Number*</span>
            <input type="tel" placeholder="(000) 000-0000" aria-label="Phone Number" />
          </label>
        </div>
      </div>
      <div className="figma-checkout__section-action">
        <button type="button" className="figma-checkout__primary-btn">
          Continue to Shipping Address
        </button>
      </div>
    </section>
  );
}

function OrderSummary() {
  const { cartLines, getProductBySlug } = useCatalog();
  const { navigate } = usePrototypeNavigation();
  const orderItems = cartLines
    .map((line) => {
      const product = getProductBySlug(line.productSlug);
      if (!product) {
        return null;
      }

      const unitSavings = line.fulfillment === "pickup" ? (product.price ?? 0) * 0.08 : 0;

      return {
        id: line.id,
        name: product.title,
        imageUrl: product.imageUrl,
        color: product.category,
        size: line.label,
        quantity: line.quantity,
        priceValue: product.price ?? 0,
        price: product.priceFormatted,
        oldPrice: unitSavings > 0 && product.price != null ? formatPrice(product.price + unitSavings) : undefined,
        savings: unitSavings > 0 ? `Saved ${formatPrice(unitSavings * line.quantity)}` : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const subtotal = orderItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);
  const promotions = orderItems.reduce((sum, item) => {
    if (!item.oldPrice) {
      return sum;
    }
    return sum + (Number.parseFloat(item.oldPrice.replace(/[^0-9.]/g, "")) - item.priceValue) * item.quantity;
  }, 0);
  const total = subtotal - promotions;

  return (
    <aside className="figma-checkout__panel figma-checkout__summary">
      <div className="figma-checkout__summary-group">
        <header className="figma-checkout__summary-header">
          <h2>Order Summary</h2>
        </header>
        <div className="figma-checkout__summary-lines">
          <div className="figma-checkout__summary-line">
            <span>Subtotal</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="figma-checkout__summary-line">
            <span>Promotions</span>
            <span>-{formatPrice(promotions)}</span>
          </div>
          <div className="figma-checkout__summary-line">
            <span>Shipping</span>
            <span>{subtotal >= 150 ? "$0.00" : "Calculated later"}</span>
          </div>
          <div className="figma-checkout__summary-line">
            <span>Tax</span>
            <span>Calculated later</span>
          </div>
          <div className="figma-checkout__summary-line figma-checkout__summary-line--total">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>
        <div className="figma-checkout__promo-block">
          <button type="button" className="figma-checkout__promo-toggle">
            <span>Do you have a promo code?</span>
            <ChevronUpIcon width={24} height={24} />
          </button>
          <div className="figma-checkout__promo-entry">
            <input type="text" placeholder="Promo Code..." aria-label="Promo code" />
            <button type="button" className="figma-checkout__secondary-btn">
              Apply
            </button>
          </div>
          <div className="figma-checkout__promo-applied">
            <span className="figma-checkout__badge">Creator Bundle Savings</span>
            <span>-{formatPrice(promotions)}</span>
          </div>
        </div>
      </div>
      <div className="figma-checkout__section-action">
        <button type="button" className="figma-checkout__primary-btn" onClick={() => navigate(ROUTES.orderConfirmation)}>
          Place Order
        </button>
      </div>
      <div className="figma-checkout__summary-items">
        {orderItems.map((item) => (
          <article key={item.id} className="figma-checkout__summary-item">
            <div className="figma-checkout__summary-thumb">
              <img src={item.imageUrl} alt={item.name} className="figma-checkout__summary-image" />
            </div>
            <div className="figma-checkout__summary-details">
              <div className="figma-checkout__summary-main">
                <h3>{item.name}</h3>
                <div className="figma-checkout__summary-meta">
                  <p>Category: {item.color}</p>
                  <p>Kit: {item.size}</p>
                </div>
                <div className="figma-checkout__summary-pricing">
                  {item.oldPrice ? <span className="figma-checkout__summary-price-old">{item.oldPrice}</span> : null}
                  <span className="figma-checkout__summary-price-current">{item.price}</span>
                </div>
                <p className="figma-checkout__summary-qty">Qty: {item.quantity}</p>
              </div>
              <div className="figma-checkout__summary-badges">
                <span className="figma-checkout__badge">
                  <TruckIcon width={12} height={12} />
                  <span>Delivery</span>
                </span>
                {item.savings ? <span className="figma-checkout__badge">{item.savings}</span> : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

export default function CheckoutPage() {
  const { navigate } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();

  return (
    <div className="figma-checkout">
      <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />

      <main className="figma-checkout__main">
        <section className="figma-checkout__title-wrap">
          <h1>Checkout</h1>
        </section>

        <section className="figma-checkout__content">
          <div className="figma-checkout__left">
            <ExpressCheckout />
            <Divider />
            <ContactInformationSection />
            <UpcomingSection title="Shipping Address" />
            <UpcomingSection title="Shipping Method" />
            <UpcomingSection title="Payment" />
          </div>
          <OrderSummary />
        </section>
      </main>

      <footer className="figma-checkout__footer">
        <p className="figma-checkout__copyright">{SITE_FOOTER_COPY} · {SITE_ADDRESS}</p>
        <div className="figma-checkout__footer-links">
          <a href="#" className="figma-checkout__footer-link">
            <GlobeIcon width={16} height={16} />
            <span>Privacy Policy</span>
          </a>
          <a href="#" className="figma-checkout__footer-link">
            <BadgeHelpIcon width={16} height={16} />
            <span>Terms of Use</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
