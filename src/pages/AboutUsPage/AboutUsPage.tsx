import { useCatalog } from "../../catalog/CatalogContext";
import { ChevronRightIcon, FacebookIcon, InstagramIcon, SearchIcon, ShoppingCartIcon, UserIcon, YoutubeIcon } from "../../components/icons/StorefrontIcons";
import { OpenPersonalAssistantNavButton } from "../../components/OpenPersonalAssistantNavButton/OpenPersonalAssistantNavButton";
import PrototypeBrandLink from "../../components/PrototypeBrandLink";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_ADDRESS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import "./AboutUsPage.css";

const introParagraphs = [
  "DJI began with a belief that better creative tools unlock entirely new ways to see the world. From first-time flyers to working filmmakers, our goal is to make advanced imaging feel intuitive, portable, and dependable.",
  "Every product we build is designed around movement: faster setup, smarter stabilization, safer flight, and more confident capture in the moments that matter. Innovation only counts if it makes the next shot easier to create.",
  "We are building a creative ecosystem, not just devices. Cameras, drones, gimbals, audio, and software all work together so storytellers can go from inspiration to finished footage with less friction.",
];

const values = [
  "Innovation with purpose - Every feature should help creators move faster and capture more confidently.",
  "Technology that feels intuitive - Advanced tools should disappear behind a simple experience.",
  "Reliability in the field - Our products are built for travel, action, and repeatable performance.",
  "Creator-first support - Setup, care, and learning resources matter as much as the hardware.",
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
          <h2>Built for creators. Engineered for movement.</h2>
          <div className="figma-about__intro-copy">
            {introParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section className="figma-about__story-grid">
          <article className="figma-about__story-card">
            <img src={editorialImageOne} alt="DJI featured product" />
            <div className="figma-about__story-copy">
              <h3>Our Vision</h3>
              <p>We envision a future where the tools for storytelling are as nimble as the people using them. That means more portable gear, smarter automation, and systems that adapt to creators instead of forcing creators to adapt to the gear.</p>
            </div>
          </article>

          <article className="figma-about__story-card">
            <img src={editorialImageTwo} alt="DJI creator product" />
            <div className="figma-about__story-copy">
              <h3>Why We Exist</h3>
              <p>We exist to remove friction between imagination and execution. Whether you&apos;re capturing travel, action, documentary work, or social content, DJI products are meant to help you move from setup to finished shot with confidence.</p>
            </div>
          </article>
        </section>

        <section className="figma-about__feature-image">
          <img src={editorialImageTwo} alt="DJI close-up product shot" />
        </section>

        <section className="figma-about__contact-band">
          <div className="figma-about__contact-card">
            <div className="figma-about__contact-copy">
              <h3>We&apos;re Here to Help</h3>
              <p>Need help choosing the right drone, setting up a gimbal, or understanding DJI Care options? Our team is here to help creators, hobbyists, and production teams get the most from their gear.</p>
              <p>Have a question, feedback, or need support? Our team is ready to assist you.</p>
              <p className="figma-about__contact-phone">1-800-DJI-DEMO</p>
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
          <button type="button" className="figma-about__primary-button figma-about__primary-button--compact">Creator Support</button>
        </section>

        <section className="figma-about__closing-card">
          <img src={editorialImageOne} alt="DJI product hero" />
          <div className="figma-about__closing-copy">
            <h3>Global Innovation, Creator-Level Focus</h3>
            <p>DJI products are used around the world, but every release is shaped by real moments in the field: a faster setup on location, a safer flight in changing conditions, or cleaner audio in unpredictable environments.</p>
            <p>Our guiding principle is simple: make advanced capture feel more accessible. The right technology should make creators feel more capable, not more overwhelmed.</p>
            <button type="button" className="figma-about__primary-button" onClick={() => navigate(ROUTES.home)}>Explore DJI Gear</button>
          </div>
        </section>
      </main>

      <footer className="figma-about__footer">
        <div className="figma-about__footer-top">
          <div className="figma-about__footer-left">
            <strong>{SITE_BRAND}</strong>
            <div className="figma-about__footer-links">
              <a href="#">DJI Care Refresh</a>
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
