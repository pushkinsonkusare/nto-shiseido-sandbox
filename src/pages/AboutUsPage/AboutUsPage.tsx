import { useCatalog } from "../../catalog/CatalogContext";
import { ChevronRightIcon, FacebookIcon, InstagramIcon, SearchIcon, ShoppingCartIcon, UserIcon, YoutubeIcon } from "../../components/icons/StorefrontIcons";
import { OpenPersonalAssistantNavButton } from "../../components/OpenPersonalAssistantNavButton/OpenPersonalAssistantNavButton";
import PrototypeBrandLink from "../../components/PrototypeBrandLink";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_ADDRESS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import "./AboutUsPage.css";

const introParagraphs = [
  "Shiseido began in 1872 with a belief that beauty and science together can enrich lives. From first-time routines to devoted skincare rituals, our goal is to make advanced skincare feel intuitive, effective, and kind to every skin type.",
  "Every formula we create is designed around results you can see and feel: gentle actives, meticulous testing, and sensorial textures that make caring for your skin a moment worth looking forward to.",
  "We are building complete skincare rituals, not just single products. Cleansers, softeners, serums, moisturizers, and sun care work together so anyone can move from bare skin to radiant, protected skin with less guesswork.",
];

const values = [
  "Innovation with purpose - Every formula should deliver visible results, backed by science.",
  "Beauty that feels intuitive - Advanced skincare should fit effortlessly into daily life.",
  "Care for every skin type - Our products are developed and tested for real, diverse skin.",
  "Ritual-first support - Guidance, samples, and education matter as much as the product.",
];

function AboutUsPage() {
  const { featuredProducts, promoProducts } = useCatalog();
  const { navigate } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const editorialImageOne = featuredProducts[0]?.imageUrl ?? promoProducts[0]?.imageUrl ?? "";
  const editorialImageTwo = featuredProducts[1]?.imageUrl ?? promoProducts[1]?.imageUrl ?? editorialImageOne;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <div className="figma-about">
      <header className="figma-about__top-nav">
        <div className="figma-about__top-nav-inner">
          <PrototypeBrandLink className="figma-about__brand">{SITE_BRAND}</PrototypeBrandLink>
          <nav className="figma-about__main-nav" aria-label="Primary">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={ROUTES.productListing}
                className={item.emphasized ? "figma-about__sale-link" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(ROUTES.productListing, { category: item.category ?? null });
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="figma-about__top-actions">
            <button type="button" aria-label="Search" onClick={openSearchOverlay}>
              <SearchIcon width={16} height={16} />
            </button>
            <OpenPersonalAssistantNavButton />
            <button type="button" aria-label="Account" onClick={() => navigate(ROUTES.login)}>
              <UserIcon width={16} height={16} />
            </button>
            <button type="button" aria-label="Cart" onClick={() => navigate(ROUTES.cart)}>
              <ShoppingCartIcon width={16} height={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="figma-about__page">
        <div className="figma-about__page-title">
          <nav className="figma-about__breadcrumbs" aria-label="Breadcrumb">
            <span>Home</span>
            <ChevronRightIcon width={14} height={14} />
            <span>...</span>
            <ChevronRightIcon width={14} height={14} />
            <span>About us</span>
          </nav>
          <h1>About us</h1>
        </div>

        <section className="figma-about__intro">
          <h2>Crafted for skin. Perfected by science.</h2>
          <div className="figma-about__intro-copy">
            {introParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section className="figma-about__story-grid">
          <article className="figma-about__story-card">
            <img src={editorialImageOne} alt="Shiseido featured product" />
            <div className="figma-about__story-copy">
              <h3>Our Vision</h3>
              <p>We envision a future where skincare adapts to the person, not the other way around. That means gentler actives, smarter formulations, and rituals that fit seamlessly into everyday life.</p>
            </div>
          </article>

          <article className="figma-about__story-card">
            <img src={editorialImageTwo} alt="Shiseido skincare product" />
            <div className="figma-about__story-copy">
              <h3>Why We Exist</h3>
              <p>We exist to help everyone feel confident in their skin. Whether you&apos;re building your first routine or refining a devoted ritual, Shiseido products are made to deliver visible, lasting results.</p>
            </div>
          </article>
        </section>

        <section className="figma-about__feature-image">
          <img src={editorialImageTwo} alt="Shiseido close-up product shot" />
        </section>

        <section className="figma-about__contact-band">
          <div className="figma-about__contact-card">
            <div className="figma-about__contact-copy">
              <h3>We&apos;re Here to Help</h3>
              <p>Need help choosing the right serum, building a routine, or understanding your skin type? Our beauty concierge is here to help you get the most from your ritual.</p>
              <p>Have a question, feedback, or need support? Our team is ready to assist you.</p>
              <p className="figma-about__contact-phone">1-800-SHISEIDO</p>
              <p>Monday - Friday: 9am - 10pm EST</p>
              <p>Saturday &amp; Sunday: 10am - 7pm EST</p>
              <p>Visit us at {SITE_ADDRESS}, or send us a note using the form below.</p>
            </div>

            <form className="figma-about__contact-form" onSubmit={handleSubmit}>
              <label className="figma-about__field-group">
                <span>Label<span aria-hidden="true">*</span></span>
                <input type="text" placeholder="Full Name" />
              </label>
              <label className="figma-about__field-group">
                <span>Email<span aria-hidden="true">*</span></span>
                <input type="email" placeholder="you@email.com" />
              </label>
              <label className="figma-about__field-group">
                <span>Label<span aria-hidden="true">*</span></span>
                <input type="text" placeholder="General information" />
              </label>
              <label className="figma-about__field-group figma-about__field-group--message">
                <span>Message<span aria-hidden="true">*</span></span>
                <textarea placeholder="Leave us a message" />
              </label>
            </form>
          </div>
        </section>

        <section className="figma-about__values-head">
          <div>
            <h3>What We Stand For</h3>
            <div className="figma-about__values-copy">
              {values.map((value) => (
                <p key={value}>{value}</p>
              ))}
            </div>
          </div>
          <button type="button" className="figma-about__primary-button figma-about__primary-button--compact">Beauty Concierge</button>
        </section>

        <section className="figma-about__closing-card">
          <img src={editorialImageOne} alt="Shiseido product hero" />
          <div className="figma-about__closing-copy">
            <h3>Global Heritage, Skin-Level Focus</h3>
            <p>Shiseido products are loved around the world, but every formula is shaped by real skin: a gentler active for sensitive skin, lasting hydration in changing climates, or reliable protection every day.</p>
            <p>Our guiding principle is simple: make advanced skincare feel more accessible. The right formula should make you feel more confident, not overwhelmed.</p>
            <button type="button" className="figma-about__primary-button" onClick={() => navigate(ROUTES.home)}>Explore Shiseido Skincare</button>
          </div>
        </section>
      </main>

      <footer className="figma-about__footer">
        <div className="figma-about__footer-top">
          <div className="figma-about__footer-left">
            <strong>{SITE_BRAND}</strong>
            <div className="figma-about__footer-links">
              <a href="#">Loyalty & Rewards</a>
              <a href="#">Privacy Policy</a>
              <a href="#">Support</a>
            </div>
          </div>
          <div className="figma-about__footer-social" aria-hidden="true">
            <InstagramIcon width={16} height={16} />
            <YoutubeIcon width={16} height={16} />
            <FacebookIcon width={16} height={16} />
          </div>
        </div>

        <div className="figma-about__footer-bottom">
          <p>{SITE_FOOTER_COPY}</p>
          <div className="figma-about__footer-links">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Use</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default AboutUsPage;
