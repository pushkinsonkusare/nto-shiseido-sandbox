import { createContext, useContext, useMemo, type ReactNode } from "react";
import { catalogStore, type CatalogStore } from "./catalog";

const CatalogContext = createContext<CatalogStore | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => catalogStore, []);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = useContext(CatalogContext);

  if (!context) {
    throw new Error("useCatalog must be used within CatalogProvider");
  }

  return context;
}
