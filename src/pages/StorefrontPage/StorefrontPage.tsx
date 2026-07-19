import { useEffect, useState } from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import { toProductCardProps } from "../../catalog/catalog";
import ProductCard from "../../components/ProductCard/ProductCard";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  PlayIcon,
  PauseIcon,
} from "../../components/icons/StorefrontIcons";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import bannerUltimune from "../../assets/banner-ultimune.webp";
import bannerMineralSunscreen from "../../assets/banner-mineral-sunscreen.webp";
import bannerVitalPerfection from "../../assets/banner-vital-perfection.png";
import shiseidoLogo from "../../assets/shiseido-logo.png";
import "./StorefrontPage.css";

export default function StorefrontPage() {
  const { featuredProducts, promoProducts, spotlightProducts } = useCatalog();
  const { navigate, navigateToProduct } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);

  const heroSlides = [
    {
      id: "ultimune",
      image: bannerUltimune,
      imageAlt: "Shiseido Ultimune Power Infusing Serum",
      eyebrow: "ULTIMUNE POWER INFUSING SERUM",
      title: "Slow the Skin Aging Cycle*",
      description: "95% saw improved radiance and texture with less visible wrinkles in 1 week.**",
      footnotes: [
        "*Cycle that leads to skin aging such as fine lines & wrinkles, started from dryness.",
        "** Consumer tested by 107 women.",
      ],
      onShop: () => navigate(ROUTES.productListing, { series: ["ultimune"] }),
    },
    {
      id: "mineral-clear",
      image: bannerMineralSunscreen,
      imageAlt: "Shiseido Urban Environment Mineral Clear Sunscreen SPF 50",
      eyebrow: "URBAN ENVIRONMENT",
      title: "Urban Environment Mineral Clear Sunscreen SPF 50",
      description:
        "Experience lightweight, 100% mineral actives sunscreen that goes from sheer to clear upon application. New size available.",
      footnotes: [] as string[],
      onShop: () => navigateToProduct("urban-environment-mineral-clear-sunscreen-spf-50"),
    },
  ];

  const goToSlide = (next: number) =>
    setCurrentSlide((prev) => (next + heroSlides.length) % heroSlides.length);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroSlides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isPlaying, heroSlides.length]);

  const activeSlide = heroSlides[currentSlide];

  return (
    <div className="figma-storefront">
      <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />

      <main className="figma-storefront__page-inner">
        <section className="figma-storefront__hero">
          <button
            type="button"
            className="figma-storefront__hero-arrow figma-storefront__hero-arrow--play"
            aria-label={isPlaying ? "Pause slideshow" : "Play slideshow"}
            aria-pressed={isPlaying}
            onClick={() => setIsPlaying((prev) => !prev)}
          >
            {isPlaying ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />}
          </button>
          <button
            type="button"
            className="figma-storefront__hero-arrow figma-storefront__hero-arrow--left"
            aria-label="Previous slide"
            onClick={() => goToSlide(currentSlide - 1)}
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
          <button
            type="button"
            className="figma-storefront__hero-arrow figma-storefront__hero-arrow--right"
            aria-label="Next slide"
            onClick={() => goToSlide(currentSlide + 1)}
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
          <div className="figma-storefront__hero-overlay">
            <div className="figma-storefront__hero-content">
              <div className="figma-storefront__hero-copy">
                <span className="figma-storefront__hero-eyebrow">{activeSlide.eyebrow}</span>
                <h1>{activeSlide.title}</h1>
                <p>{activeSlide.description}</p>
              </div>
              <button type="button" onClick={activeSlide.onShop}>SHOP NOW</button>
              {activeSlide.footnotes.length > 0 && (
                <div className="figma-storefront__hero-footnotes">
                  {activeSlide.footnotes.map((footnote) => (
                    <p key={footnote}>{footnote}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <img src={activeSlide.image} alt={activeSlide.imageAlt} className="figma-storefront__hero-image" />
        </section>

        <section className="figma-storefront__tagline-banner" aria-label="Brand promise">
          <p className="figma-storefront__tagline-banner-text">
            Modern Tradition. Thoughtful Technology. Timeless Beauty.
          </p>
        </section>

        <section className="figma-storefront__section">
          <h2>Featured Skincare</h2>
          <div className="figma-storefront__featured-grid">
            {featuredProducts.map((product) => (
              <ProductCard key={product.slug} {...toProductCardProps(product)} onSelect={() => navigateToProduct(product.slug)} />
            ))}
          </div>
          <div className="figma-storefront__featured-banner">
            <img
              src={bannerVitalPerfection}
              alt="Shiseido Vital Perfection"
              className="figma-storefront__featured-banner-image"
            />
            <div className="figma-storefront__featured-banner-overlay">
              <div className="figma-storefront__featured-banner-content">
                <span className="figma-storefront__featured-banner-eyebrow">
                  POTENTIAL HAS NO AGE
                </span>
                <h2 className="figma-storefront__featured-banner-title">
                  VITAL
                  <br />
                  PERFECTION
                </h2>
                <p className="figma-storefront__featured-banner-subtitle">
                  Uplifting and Firming Advanced Cream
                </p>
                <p className="figma-storefront__featured-banner-description">
                  100% clinically proven. A firmer, brighter, and more lifted look in just 1 week*
                </p>
                <button
                  type="button"
                  className="figma-storefront__featured-banner-cta"
                  onClick={() => navigate(ROUTES.productListing, { series: ["vital-perfection"] })}
                >
                  LEARN MORE
                </button>
                <p className="figma-storefront__featured-banner-footnote">
                  *Clinically tested on 33 women.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="figma-storefront__promo-grid" aria-label="Shiseido category highlights">
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
          <h2>Bestselling Rituals</h2>
          <p className="figma-storefront__subtitle">Explore Shiseido favorites for cleansing, treating, and protecting your skin.</p>
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

        <section className="figma-storefront__promo-grid" aria-label="More Shiseido recommendations">
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
        <p>Be first to hear about Shiseido launches, skincare tips, and limited-time sets.</p>
        <form>
          <input type="email" value="hello@shiseido-demo.com" readOnly aria-label="Email address" />
          <button type="button">Join</button>
        </form>
      </section>

      <footer className="figma-storefront__footer">
        <div>
          <img src={shiseidoLogo} alt={SITE_BRAND} className="figma-storefront__footer-logo" />
          <div className="figma-storefront__footer-links">
            <a href={ROUTES.about} onClick={(event) => { event.preventDefault(); navigate(ROUTES.about); }}>About Us</a>
            <a href="#">Loyalty & Rewards</a>
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
