import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  SearchIcon,
  SparkleIcon,
  StoreIcon,
  UserIcon,
} from "../icons/StorefrontIcons";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { useSearchOverlay } from "../SearchOverlay/SearchOverlayContext";
import { PRIMARY_NAV_ITEMS } from "../../siteContent";
import "./ImmersiveHeaderMobileSheet.css";

/**
 * Slide-in mobile drawer surfaced by `ImmersiveHeader` when the
 * viewport is narrow enough that the inline nav, Wingman pill, and
 * non-cart action icons are CSS-hidden. Renders via portal so its
 * fixed positioning isn't trapped by any ancestor stacking context
 * (the sticky header itself sits in its own layer).
 *
 * Mirrors the desktop chrome semantically — same primary nav links,
 * same Wingman entry point, same secondary actions (search / store /
 * account) — just stacked vertically and full-height.
 */

type ImmersiveHeaderMobileSheetProps = {
  open: boolean;
  onClose: () => void;
};

export function ImmersiveHeaderMobileSheet({
  open,
  onClose,
}: ImmersiveHeaderMobileSheetProps) {
  const { navigate } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();

  /* Close on Escape and lock background scroll while the sheet is
   * visible — same pattern as KitDetailsPanel. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const handleNav = (category: string | null) => {
    onClose();
    navigate(ROUTES.productListing, { category });
  };

  const handleWingman = () => {
    onClose();
    navigate(ROUTES.wingman);
  };

  const handleSearch = () => {
    onClose();
    openSearchOverlay();
  };

  const handleAbout = () => {
    onClose();
    navigate(ROUTES.about);
  };

  const handleAccount = () => {
    onClose();
    navigate(ROUTES.login);
  };

  return createPortal(
    <div className="immersive-header-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        className="immersive-header-sheet__overlay"
        aria-label="Close menu"
        onClick={onClose}
      />
      <aside className="immersive-header-sheet__panel">
        <header className="immersive-header-sheet__header">
          <span className="immersive-header-sheet__title">Menu</span>
          <button
            type="button"
            className="immersive-header-sheet__close"
            aria-label="Close menu"
            onClick={onClose}
          >
            <X width={18} height={18} />
          </button>
        </header>

        <button
          type="button"
          className="immersive-header-sheet__wingman"
          onClick={handleWingman}
        >
          <SparkleIcon width={14} height={14} />
          <span>Wingman</span>
        </button>

        <nav className="immersive-header-sheet__nav" aria-label="Primary">
          {PRIMARY_NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={
                "immersive-header-sheet__nav-link" +
                (item.emphasized ? " immersive-header-sheet__nav-link--emphasized" : "")
              }
              onClick={() => handleNav(item.category ?? null)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div
          className="immersive-header-sheet__divider"
          role="separator"
          aria-hidden="true"
        />

        <ul className="immersive-header-sheet__actions" aria-label="Account & shortcuts">
          <li>
            <button
              type="button"
              className="immersive-header-sheet__action"
              onClick={handleSearch}
            >
              <SearchIcon width={18} height={18} />
              <span>Search</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="immersive-header-sheet__action"
              onClick={handleAbout}
            >
              <StoreIcon width={18} height={18} />
              <span>About DJI</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="immersive-header-sheet__action"
              onClick={handleAccount}
            >
              <UserIcon width={18} height={18} />
              <span>Account</span>
            </button>
          </li>
        </ul>
      </aside>
    </div>,
    document.body,
  );
}

export default ImmersiveHeaderMobileSheet;
