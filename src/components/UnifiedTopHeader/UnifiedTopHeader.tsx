import { useEffect, useState } from "react";
import { OpenPersonalAssistantNavButton } from "../OpenPersonalAssistantNavButton/OpenPersonalAssistantNavButton";
import PrototypeBrandLink from "../PrototypeBrandLink";
import {
  CloseIcon,
  SearchIcon,
  ShoppingCartIcon,
  TableOfContentsIcon,
  UserIcon,
} from "../icons/StorefrontIcons";
import { ROUTES, type NavigateOptions } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_BRAND } from "../../siteContent";
import "./UnifiedTopHeader.css";

type NavigateFn = (
  route: string,
  options?: NavigateOptions,
) => void;

type UnifiedTopHeaderProps = {
  navigate: NavigateFn;
  openSearchOverlay: () => void;
};

export function UnifiedTopHeader({
  navigate,
  openSearchOverlay,
}: UnifiedTopHeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileMenuOpen]);

  return (
    <div className="unified-top-header">
      <header className="unified-top-header__top-nav">
        <div className="unified-top-header__brand-row">
          <button
            type="button"
            className="unified-top-header__mobile-menu-trigger"
            aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={isMobileMenuOpen}
            aria-controls="unified-top-header-mobile-menu"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
          >
            {isMobileMenuOpen ? <CloseIcon width={18} height={18} /> : <TableOfContentsIcon width={18} height={18} />}
          </button>
          <PrototypeBrandLink className="unified-top-header__brand-mark">{SITE_BRAND}</PrototypeBrandLink>
          <nav className="unified-top-header__quick-links" aria-label="Top navigation">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href={ROUTES.productListing}
                className={item.emphasized ? "unified-top-header__sale-link" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(ROUTES.productListing, { category: item.category ?? null });
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="unified-top-header__top-actions">
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
      <button
        type="button"
        className={"unified-top-header__mobile-drawer-backdrop" + (isMobileMenuOpen ? " unified-top-header__mobile-drawer-backdrop--open" : "")}
        aria-label="Close navigation menu"
        onClick={() => setIsMobileMenuOpen(false)}
      />
      <aside
        id="unified-top-header-mobile-menu"
        className={"unified-top-header__mobile-drawer" + (isMobileMenuOpen ? " unified-top-header__mobile-drawer--open" : "")}
        aria-label="Mobile navigation menu"
      >
        <div className="unified-top-header__mobile-drawer-body">
          <div className="unified-top-header__mobile-drawer-heading">
            <h2>Browse categories</h2>
            <button
              type="button"
              className="unified-top-header__mobile-drawer-close"
              aria-label="Close navigation menu"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <CloseIcon width={16} height={16} />
            </button>
          </div>
          <nav aria-label="Store categories" className="unified-top-header__mobile-drawer-nav">
            {PRIMARY_NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                className={item.emphasized ? "unified-top-header__mobile-drawer-link unified-top-header__mobile-drawer-link--emphasized" : "unified-top-header__mobile-drawer-link"}
                onClick={() => {
                  navigate(ROUTES.productListing, { category: item.category ?? null });
                  setIsMobileMenuOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="unified-top-header__mobile-drawer-footer">
          <a href="mailto:support@marketstreet.example">Contact</a>
          <a
            href={ROUTES.about}
            onClick={(event) => {
              event.preventDefault();
              navigate(ROUTES.about);
              setIsMobileMenuOpen(false);
            }}
          >
            About Us
          </a>
          <a href="#">Support</a>
          <a href="#">Privacy Policy</a>
        </div>
      </aside>
    </div>
  );
}
