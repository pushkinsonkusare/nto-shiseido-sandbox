import type { ReactNode } from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import { formatPrice } from "../../catalog/catalog";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import {
  ChevronDownIcon,
  StoreIcon,
  TruckIcon,
} from "../../components/icons/StorefrontIcons";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { SITE_ADDRESS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import "./ShoppingCartPage.css";

type CartItem = {
  id: string;
  imageUrl: string;
  name: string;
  color: string;
  size: string;
  unitPrice: number;
  quantity: number;
  price: string;
  oldPrice?: string;
  savings?: string;
};

type FulfillmentCartItem = CartItem & {
  fulfillment: "pickup" | "delivery";
};

function CartItemRow({ item }: { item: CartItem }) {
  return (
    <article className="figma-cart__item">
      <div className="figma-cart__item-thumb">
        <img src={item.imageUrl} alt={item.name} className="figma-cart__item-image" />
      </div>
      <div className="figma-cart__item-details">
        <div className="figma-cart__item-content">
          <h3>{item.name}</h3>
          <div className="figma-cart__item-meta">
            <p>Color: {item.color}</p>
            <p>Size: {item.size}</p>
          </div>
          <div className="figma-cart__item-actions">
            <button type="button">Remove</button>
            <button type="button">Add to Wishlist</button>
          </div>
        </div>
        <div className="figma-cart__item-right">
          <div className="figma-cart__qty">
            <span className="figma-cart__qty-label">Quantity:</span>
            <div className="figma-cart__qty-field">
              <span>{item.quantity}</span>
              <ChevronDownIcon width={16} height={16} />
            </div>
          </div>
          <div className="figma-cart__badges-price">
            {item.savings ? (
              <div className="figma-cart__savings-badge">{item.savings}</div>
            ) : null}
            <div className="figma-cart__pricing">
              {item.oldPrice ? <span className="figma-cart__price-old">{item.oldPrice}</span> : null}
              <span className="figma-cart__price-current">{item.price}</span>
            </div>
            <button type="button" className="figma-cart__gift-btn">
              <span className="figma-cart__gift-box" aria-hidden="true" />
              <span className="figma-cart__gift-text">
                This is a gift. <span className="figma-cart__gift-learn">Learn more</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function CartSection({
  title,
  subtitle,
  icon,
  items,
  showChangeStore,
}: {
  title: ReactNode;
  subtitle: string;
  icon: ReactNode;
  items: CartItem[];
  showChangeStore?: boolean;
}) {
  return (
    <section className="figma-cart__section-card">
      <header className="figma-cart__section-head">
        <div className="figma-cart__section-head-main">
          <div className="figma-cart__section-icon">{icon}</div>
          <div>
            <h2 className="figma-cart__section-title">{title}</h2>
            <p className="figma-cart__section-sub">{subtitle}</p>
          </div>
        </div>
        {showChangeStore ? (
          <div className="figma-cart__change-store-wrap">
            <button type="button" className="figma-cart__change-store">Change Store</button>
          </div>
        ) : null}
      </header>
      <div className="figma-cart__items">
        {items.map((item) => (
          <CartItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export default function ShoppingCartPage() {
  const { cartLines, getProductBySlug } = useCatalog();
  const { navigate } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const cartItems: FulfillmentCartItem[] = cartLines.flatMap((line) => {
      const product = getProductBySlug(line.productSlug);
      if (!product) {
        return [];
      }

      const unitPrice = product.price ?? 0;
      const unitSavings = line.fulfillment === "pickup" ? unitPrice * 0.08 : 0;

      return [{
        id: line.id,
        imageUrl: product.imageUrl,
        name: product.title,
        color: product.category,
        size: line.label,
        unitPrice,
        quantity: line.quantity,
        oldPrice: unitSavings > 0 ? formatPrice(unitPrice + unitSavings) : undefined,
        price: formatPrice(unitPrice),
        savings: unitSavings > 0 ? `Saved ${formatPrice(unitSavings * line.quantity)}` : undefined,
        fulfillment: line.fulfillment,
      }];
    });

  const pickupItems = cartItems.filter((item) => item.fulfillment === "pickup");
  const deliveryItems = cartItems.filter((item) => item.fulfillment === "delivery");
  const subtotalValue = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const promotionValue = cartItems.reduce((sum, item) => {
    const oldPrice = item.oldPrice ? Number.parseFloat(item.oldPrice.replace(/[^0-9.]/g, "")) : item.unitPrice;
    return sum + (oldPrice - item.unitPrice) * item.quantity;
  }, 0);
  const totalValue = subtotalValue - promotionValue;

  return (
    <div className="figma-cart">
      <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />

      <div className="figma-cart__title-strip">
        <h1>Cart ({cartItems.length} items)</h1>
      </div>

      <div className="figma-cart__main-wrap">
        <div className="figma-cart__left">
          <section className="figma-cart__shipping-progress">
            <p>
              You are <strong>{formatPrice(Math.max(0, 150 - subtotalValue))}</strong> away from{" "}
              <strong className="figma-cart__shipping-strong">Priority Shipping</strong>
            </p>
            <div className="figma-cart__range">
              <span>{formatPrice(Math.max(0, subtotalValue / 2))}</span>
              <span>{formatPrice(150)}</span>
            </div>
            <div className="figma-cart__bar">
              <div className="figma-cart__bar-fill" />
            </div>
          </section>

          <CartSection
            icon={<StoreIcon width={20} height={20} />}
            title={(
              <>
                <span>Pickup at </span>
                <strong>DJI Mission Store</strong>
                <span> - {pickupItems.length} items</span>
              </>
            )}
            subtitle={SITE_ADDRESS}
            items={pickupItems}
            showChangeStore
          />
          <CartSection
            icon={<TruckIcon width={20} height={20} />}
            title={`Delivery - ${deliveryItems.length} items`}
            subtitle={SITE_ADDRESS}
            items={deliveryItems}
          />
        </div>

        <aside className="figma-cart__summary">
          <div className="figma-cart__summary-header">
            <h2>Order Summary</h2>
          </div>
          <div className="figma-cart__summary-lines">
            <div className="figma-cart__line"><span>Subtotal</span><span>{formatPrice(subtotalValue)}</span></div>
            <div className="figma-cart__line"><span>Promotions</span><span>-{formatPrice(promotionValue)}</span></div>
            <div className="figma-cart__line"><span>Shipping</span><span>{subtotalValue >= 150 ? "$0.00" : "Calculated at checkout"}</span></div>
            <div className="figma-cart__line"><span>Tax</span><span>Calculated at checkout</span></div>
            <div className="figma-cart__line figma-cart__line--total"><span>Total</span><span>{formatPrice(totalValue)}</span></div>
          </div>
          <div className="figma-cart__promo-block">
            <button type="button" className="figma-cart__promo">
              <span>Do you have a promo code?</span>
              <ChevronDownIcon width={24} height={24} className="figma-cart__promo-chevron" />
            </button>
            <div className="figma-cart__applied">
              <span className="figma-cart__promo-badge">Creator Bundle Savings</span>
              <span className="figma-cart__applied-amt">-{formatPrice(promotionValue)}</span>
            </div>
          </div>
          <div className="figma-cart__summary-footer">
            <button type="button" className="figma-cart__btn-checkout" onClick={() => navigate(ROUTES.checkout)}>Continue to Checkout</button>
            <div className="figma-cart__express">
              <button type="button" className="figma-cart__btn-gpay">
                <span className="figma-cart__brand-gpay">
                  <span className="figma-cart__brand-g">G</span>
                  <span>Pay</span>
                </span>
              </button>
              <button type="button" className="figma-cart__btn-apple">
                <span className="figma-cart__apple-pay">Apple Pay</span>
              </button>
              <button type="button" className="figma-cart__btn-paypal">
                <span className="figma-cart__brand-paypal">
                  <span className="figma-cart__brand-paypal-dark">Pay</span>
                  <span className="figma-cart__brand-paypal-light">Pal</span>
                </span>
              </button>
              <button type="button" className="figma-cart__btn-venmo">
                <span className="figma-cart__brand-venmo">venmo</span>
              </button>
              <button type="button" className="figma-cart__btn-amazon">
                <span className="figma-cart__brand-amazon">
                  <span>amazon</span>
                  <span className="figma-cart__brand-amazon-pay">pay</span>
                </span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      <footer className="figma-cart__footer-shell">
        <div className="figma-cart__footer-inner">
          <div className="figma-cart__footer-row1">
            <div className="figma-cart__footer-left">
              <strong className="figma-cart__footer-logo">{SITE_BRAND}</strong>
              <div className="figma-cart__footer-links">
                <a href="#">DJI Care Refresh</a>
                <a href="#">Privacy Policy</a>
                <a href="#">Support</a>
              </div>
            </div>
          </div>
          <div className="figma-cart__footer-row2">
            <p>{SITE_FOOTER_COPY}</p>
            <div className="figma-cart__footer-legal">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Use</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
