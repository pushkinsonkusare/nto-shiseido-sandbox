import AboutUsPage from "./pages/AboutUsPage/AboutUsPage";
import { AgentModeBar } from "./components/AgentModeBar/AgentModeBar";
import { AgentModeProvider, useAgentMode } from "./components/AgentModeBar/AgentModeContext";
import { CatalogProvider } from "./catalog/CatalogContext";
import CheckoutPage from "./pages/CheckoutPage/CheckoutPage";
import LoginPage from "./pages/LoginPage/LoginPage";
import OrderConfirmationPage from "./pages/OrderConfirmationPage/OrderConfirmationPage";
import OverviewPage from "./pages/OverviewPage/OverviewPage";
import ProductDetailPage from "./pages/ProductDetailPage/ProductDetailPage";
import ProductListingPage from "./pages/ProductListingPage/ProductListingPage";
import { SearchOverlay } from "./components/SearchOverlay/SearchOverlay";
import { SearchOverlayProvider } from "./components/SearchOverlay/SearchOverlayContext";
import ShoppingCartPage from "./pages/ShoppingCartPage/ShoppingCartPage";
import { SideBySideLayout } from "./components/SideBySideAssistant/SideBySideLayout";
import { SidecarAssistant } from "./components/SidecarAssistant/SidecarAssistant";
import StorefrontPage from "./pages/StorefrontPage/StorefrontPage";
import WingmanPage from "./pages/WingmanPage/WingmanPage";
import WingmanPlanPage from "./pages/WingmanPlanPage/WingmanPlanPage";
import { PrototypeNavigationProvider, ROUTES, usePrototypeNavigation } from "./prototypeRoutes";

function RoutedApp() {
  const { currentRoute } = usePrototypeNavigation();
  const { mode } = useAgentMode();

  switch (currentRoute) {
    case ROUTES.productListing:
      return <ProductListingPage />;
    case ROUTES.productDetail:
      return <ProductDetailPage />;
    case ROUTES.cart:
      return <ShoppingCartPage />;
    case ROUTES.checkout:
      return <CheckoutPage />;
    case ROUTES.orderConfirmation:
      return <OrderConfirmationPage />;
    case ROUTES.login:
      return <LoginPage />;
    case ROUTES.account:
      return <OverviewPage />;
    case ROUTES.about:
      return <AboutUsPage />;
    case ROUTES.wingman:
      // Wingman is an immersive-only landing page. Defensively fall back
      // to the storefront in any other mode so a stray deep-link doesn't
      // surface immersive UI in Native / Sidecar / Side-by-side.
      return mode === "immersive" ? <WingmanPage /> : <StorefrontPage />;
    case ROUTES.wingmanPlan:
      // Same immersive-only treatment as `/wingman`. The plan page
      // reads `?q=<query>` from the navigation context and renders a
      // curated results view; the storefront fallback keeps any stray
      // deep-link safe in Native / Sidecar / Side-by-side modes.
      return mode === "immersive" ? <WingmanPlanPage /> : <StorefrontPage />;
    case ROUTES.home:
    default:
      return <StorefrontPage />;
  }
}

function ModeAwareSurfaces() {
  const { mode } = useAgentMode();

  if (mode === "assistant-only") {
    return <SidecarAssistant />;
  }

  return null;
}

function ModeAwareRoot() {
  const { mode } = useAgentMode();

  if (mode === "side-by-side") {
    return (
      <SideBySideLayout>
        <RoutedApp />
      </SideBySideLayout>
    );
  }

  return (
    <>
      <RoutedApp />
      <ModeAwareSurfaces />
    </>
  );
}

function App() {
  return (
    <AgentModeProvider>
      <PrototypeNavigationProvider>
        <CatalogProvider>
          <SearchOverlayProvider>
            <AgentModeBar />
            <ModeAwareRoot />
            <SearchOverlay />
          </SearchOverlayProvider>
        </CatalogProvider>
      </PrototypeNavigationProvider>
    </AgentModeProvider>
  );
}

export default App;
