import { useCatalog } from "../../catalog/CatalogContext";
import { toProductCardProps } from "../../catalog/catalog";
import ProductCard from "../../components/ProductCard/ProductCard";
import { OpenPersonalAssistantNavButton } from "../../components/OpenPersonalAssistantNavButton/OpenPersonalAssistantNavButton";
import PrototypeBrandLink from "../../components/PrototypeBrandLink";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import {
  ArrowRightIcon,
  BookOpenIcon,
  ChevronRightIcon,
  CreditCardIcon,
  FacebookIcon,
  HeartIcon,
  InstagramIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  LogOutIcon,
  MapPinIcon,
  SearchIcon,
  ShoppingCartIcon,
  SparkleIcon,
  StarIcon,
  TableOfContentsIcon,
  UserIcon,
  WalletCardsIcon,
  YoutubeIcon,
} from "../../components/icons/StorefrontIcons";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_ADDRESS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import "./OverviewPage.css";

const sidebarSections = [
  {
    label: "Platform",
    items: [
      { icon: TableOfContentsIcon, label: "Overview", active: true },
      { icon: UserIcon, label: "Account Details" },
      { icon: BookOpenIcon, label: "Order History" },
      { icon: HeartIcon, label: "Wishlist", count: "16" },
      { icon: StarIcon, label: "Loyalty Rewards" },
      { icon: MapPinIcon, label: "Addresses", count: "3" },
      { icon: WalletCardsIcon, label: "Payment Methods", count: "3" },
      { icon: KeyRoundIcon, label: "Passkey" },
    ],
  },
  {
    label: "Projects",
    items: [{ icon: LogOutIcon, label: "Log Out" }],
  },
];

const summaryCards = [
  { label: "Gift Cards", value: "$125.00", helper: "Manage gift cards" },
  { label: "Store Credit", value: "$125.00", helper: "View details" },
  { label: "Reward Points", value: "$125.00", helper: "View details" },
];

const quickLinks = [
  { icon: UserIcon, label: "Update Profile" },
  { icon: MapPinIcon, label: "Manage Addresses" },
  { icon: CreditCardIcon, label: "Payment Methods" },
  { icon: LockKeyholeIcon, label: "Security" },
];

function OverviewPage() {
  const { orderHistory, recommendedProducts, getProductBySlug } = useCatalog();
  const { navigate, navigateToProduct } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const orders = orderHistory.map((order) => ({
    ...order,
    images: order.productSlugs
      .map((slug) => getProductBySlug(slug)?.imageUrl)
      .filter((image): image is string => Boolean(image)),
  }));

  return (
    <div className="figma-overview">
      <header className="figma-overview__top-nav">
        <div className="figma-overview__top-nav-inner">
          <PrototypeBrandLink className="figma-overview__brand">{SITE_BRAND}</PrototypeBrandLink>
          <nav className="figma-overview__main-nav" aria-label="Primary">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={ROUTES.productListing}
                className={item.emphasized ? "figma-overview__sale-link" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(ROUTES.productListing, { category: item.category ?? null });
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="figma-overview__top-actions">
            <button type="button" aria-label="Search" onClick={openSearchOverlay}>
              <SearchIcon width={16} height={16} />
            </button>
            <OpenPersonalAssistantNavButton />
            <button type="button" aria-label="Account" onClick={() => navigate(ROUTES.account)}>
              <UserIcon width={16} height={16} />
            </button>
            <button type="button" aria-label="Cart" onClick={() => navigate(ROUTES.cart)}>
              <ShoppingCartIcon width={16} height={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="figma-overview__page">
        <div className="figma-overview__page-title">
          <nav className="figma-overview__breadcrumbs" aria-label="Breadcrumb">
            <span>Home</span>
            <ChevronRightIcon width={14} height={14} />
            <span>Account</span>
            <ChevronRightIcon width={14} height={14} />
            <span>Dashboard</span>
            <ChevronRightIcon width={14} height={14} />
            <span>Overview</span>
          </nav>
          <h1>My Account</h1>
        </div>

        <main className="figma-overview__layout">
          <aside className="figma-overview__sidebar" aria-label="Account sections">
            {sidebarSections.map((section) => (
              <section key={section.label} className="figma-overview__sidebar-group">
                <h2>{section.label}</h2>
                <div className="figma-overview__sidebar-items">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                    <a
                        key={item.label}
                        href={item.label === "Log Out" ? ROUTES.login : ROUTES.account}
                        className={`figma-overview__sidebar-item${item.active ? " is-active" : ""}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(item.label === "Log Out" ? ROUTES.login : ROUTES.account);
                        }}
                      >
                        <span className="figma-overview__sidebar-icon"><Icon width={16} height={16} /></span>
                        <span>{item.label}</span>
                        {item.count && <span className="figma-overview__sidebar-count">{item.count}</span>}
                      </a>
                    );
                  })}
                </div>
              </section>
            ))}
          </aside>

          <div className="figma-overview__content">
            <section className="figma-overview__panel figma-overview__welcome">
              <div>
                <h2>Welcome back, Creator!</h2>
                <p>Manage your DJI gear, track shipments, and discover creator-ready recommendations.</p>
              </div>
            </section>

            <section className="figma-overview__summary-grid" aria-label="Account summary">
              {summaryCards.map((card) => (
                <article key={card.label} className="figma-overview__panel figma-overview__summary-card">
                  <p className="figma-overview__eyebrow">{card.label}</p>
                  <strong>{card.value}</strong>
                  <a href="#">
                    {card.helper}
                    <ArrowRightIcon width={14} height={14} />
                  </a>
                </article>
              ))}
            </section>

            <section className="figma-overview__panel">
              <div className="figma-overview__section-head">
                <div>
                  <h2>Recent Orders</h2>
                  <p>Your latest DJI orders and shipment updates</p>
                </div>
                <button type="button" className="figma-overview__secondary-button">View All</button>
              </div>

              <div className="figma-overview__orders">
                {orders.map((order) => (
                  <article key={`${order.id}-${order.images.length}`} className="figma-overview__order">
                    <div className="figma-overview__order-head">
                      <div className="figma-overview__order-meta">
                        <span>{order.id}</span>
                        <span>{order.paymentMethod}</span>
                        <span>{order.total}</span>
                      </div>
                      <span className="figma-overview__order-status">{order.status}</span>
                    </div>

                    <div className="figma-overview__order-body">
                      <div className="figma-overview__order-images">
                        {order.images.map((image, index) => (
                          <img key={`${order.id}-${index}`} src={image} alt="" />
                        ))}
                      </div>

                      {order.detailTitle && (
                        <div className="figma-overview__order-detail">
                          <h3>{order.detailTitle}</h3>
                          <p className="figma-overview__order-detail-label">{order.detailLabel}</p>
                          <p>{order.detailValue}</p>
                          <p className="figma-overview__order-detail-label">Address</p>
                          <p>{order.detailAddress ?? SITE_ADDRESS}</p>
                          <p className="figma-overview__order-detail-label">Pickup Window</p>
                          <p>{order.detailWindow}</p>
                        </div>
                      )}

                      <a href="#" className="figma-overview__text-link">
                        View Order Details
                        <ArrowRightIcon width={14} height={14} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="figma-overview__panel">
              <div className="figma-overview__section-head">
                <div>
                  <h2>Curated for You</h2>
                  <p>Recommended DJI gear based on your latest creator setup</p>
                </div>
                <button type="button" className="figma-overview__secondary-button">View More</button>
              </div>

              <div className="figma-overview__recommendations">
                {recommendedProducts.map((product, index) => (
                  <div key={product.slug} className="figma-overview__recommendation">
                    <ProductCard
                      {...toProductCardProps(product)}
                      selectedSwatch={index === 1 ? 0 : 0}
                      onSelect={() => navigateToProduct(product.slug)}
                    />
                    {index === 1 && <button type="button" className="figma-overview__overlay-cta">Add to Cart</button>}
                  </div>
                ))}
              </div>
            </section>

            <section className="figma-overview__panel figma-overview__support">
              <div className="figma-overview__section-head figma-overview__section-head--stacked">
                <div>
                  <h2>Need Help?</h2>
                  <p>We&apos;re here to assist with setup, firmware, and product questions</p>
                </div>
              </div>

              <div className="figma-overview__support-actions">
                <button type="button" className="figma-overview__primary-button">
                  <SparkleIcon width={16} height={16} />
                  Ask a Question
                </button>
                <button type="button" className="figma-overview__secondary-button figma-overview__secondary-button--wide">Contact Info</button>
                <button type="button" className="figma-overview__secondary-button figma-overview__secondary-button--wide">Browse FAQs</button>
              </div>

              <div className="figma-overview__search-row">
                <SearchIcon width={16} height={16} />
                <input type="text" placeholder="Type your question here..." aria-label="Search help" />
              </div>
            </section>

            <section className="figma-overview__panel">
              <div className="figma-overview__section-head figma-overview__section-head--stacked">
                <div>
                  <h2>Quick Links</h2>
                </div>
              </div>

              <div className="figma-overview__quick-links">
                {quickLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <a href="#" key={link.label} className="figma-overview__quick-link">
                      <Icon width={16} height={16} />
                      <span>{link.label}</span>
                    </a>
                  );
                })}
              </div>
            </section>
          </div>
        </main>

        <footer className="figma-overview__footer">
          <div className="figma-overview__footer-top">
            <div className="figma-overview__footer-left">
              <strong>{SITE_BRAND}</strong>
              <div className="figma-overview__footer-links">
                <a href="#">DJI Care Refresh</a>
                <a href="#">Privacy Policy</a>
                <a href="#">Support</a>
              </div>
            </div>
            <div className="figma-overview__footer-social">
              <InstagramIcon width={16} height={16} />
              <YoutubeIcon width={16} height={16} />
              <FacebookIcon width={16} height={16} />
            </div>
          </div>

          <div className="figma-overview__footer-bottom">
            <p>{SITE_FOOTER_COPY}</p>
            <div className="figma-overview__footer-links">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Use</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default OverviewPage;
