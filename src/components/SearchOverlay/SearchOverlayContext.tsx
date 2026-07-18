import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Global open/close state for the search-suggestions overlay.
 *
 * Mirrors the shape of `SideBySidePanelContext` so the codebase has one
 * consistent overlay pattern: a tiny provider mounted at the App root,
 * a single rendered overlay component subscribed to it, and any header
 * SearchIcon click invokes `openSearchOverlay()`.
 */
export type SearchOverlayContextValue = {
  isOpen: boolean;
  openSearchOverlay: () => void;
  closeSearchOverlay: () => void;
};

const SearchOverlayContext = createContext<SearchOverlayContextValue | null>(
  null,
);

export function SearchOverlayProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openSearchOverlay = useCallback(() => setIsOpen(true), []);
  const closeSearchOverlay = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, openSearchOverlay, closeSearchOverlay }),
    [isOpen, openSearchOverlay, closeSearchOverlay],
  );

  return (
    <SearchOverlayContext.Provider value={value}>
      {children}
    </SearchOverlayContext.Provider>
  );
}

export function useSearchOverlay(): SearchOverlayContextValue {
  const ctx = useContext(SearchOverlayContext);
  if (!ctx) {
    throw new Error(
      "useSearchOverlay must be used within SearchOverlayProvider",
    );
  }
  return ctx;
}
