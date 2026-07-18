import { useEffect, useRef, useState } from "react";
import {
  CloseIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  RefreshCcwIcon,
  SparkleIcon,
} from "../../icons/StorefrontIcons";

type Props = {
  title?: string;
  onCloseClick?: () => void;
  onClearChat?: () => void;
  onSaveChat?: () => void;
};

export function AssistantHeader({
  title = "Personal Assistant",
  onCloseClick,
  onClearChat,
  onSaveChat,
}: Props) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuWrapperRef = useRef<HTMLDivElement>(null);

  /* Close the menu on outside-click + Escape so the dropdown behaves like a
   * standard menu without us pulling in a popover dependency. */
  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const wrapper = menuWrapperRef.current;
      if (!wrapper) return;
      if (event.target instanceof Node && wrapper.contains(event.target)) {
        return;
      }
      setIsMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleClearChat = () => {
    setIsMenuOpen(false);
    onClearChat?.();
  };

  const handleSaveChat = () => {
    setIsMenuOpen(false);
    onSaveChat?.();
  };

  return (
    <header className="sxs-assistant__header">
      <div className="sxs-assistant__header-title">
        <span className="sxs-assistant__header-icon" aria-hidden="true">
          <SparkleIcon width={20} height={20} />
        </span>
        <span className="sxs-assistant__header-label">{title}</span>
      </div>
      <div className="sxs-assistant__header-actions">
        <div className="sxs-assistant__menu-wrap" ref={menuWrapperRef}>
          <button
            type="button"
            className="sxs-assistant__header-btn"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <EllipsisVerticalIcon width={20} height={20} />
          </button>
          {isMenuOpen ? (
            <div className="sxs-assistant__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="sxs-assistant__menu-item"
                onClick={handleClearChat}
              >
                <span className="sxs-assistant__menu-item-icon" aria-hidden="true">
                  <RefreshCcwIcon width={16} height={16} />
                </span>
                <span className="sxs-assistant__menu-item-label">
                  Clear chat
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="sxs-assistant__menu-item"
                onClick={handleSaveChat}
              >
                <span className="sxs-assistant__menu-item-icon" aria-hidden="true">
                  <PlusIcon width={16} height={16} />
                </span>
                <span className="sxs-assistant__menu-item-label">
                  Save chat
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="sxs-assistant__header-btn"
          aria-label="Close assistant"
          onClick={onCloseClick}
        >
          <CloseIcon width={20} height={20} />
        </button>
      </div>
    </header>
  );
}

export default AssistantHeader;
