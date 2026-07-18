import "./LoginPage.css";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { SITE_BRAND } from "../../siteContent";

function LoginPage() {
  const { navigate } = usePrototypeNavigation();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(ROUTES.account);
  };

  return (
    <main className="figma-login" data-node-id="25916:52684">
      <section className="figma-login__shell" aria-labelledby="login-page-title">
        <header className="figma-login__header">
          <h1 id="login-page-title" className="figma-login__title">
            Sign in to your {SITE_BRAND} account
          </h1>
          <p className="figma-login__subtitle">Access your gear, orders, and DJI creator support</p>
        </header>

        <form className="figma-login__card" onSubmit={handleSubmit}>
          <div className="figma-login__field-group">
            <label className="figma-login__label" htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              className="figma-login__input"
              type="email"
              name="email"
              placeholder="Enter your email"
              autoComplete="email"
            />
          </div>

          <div className="figma-login__field-group">
            <label className="figma-login__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="figma-login__input"
              type="password"
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          </div>

          <button className="figma-login__submit" type="submit">
            Sign In
          </button>
        </form>

        <p className="figma-login__legal">
          By clicking continue, you agree to our{" "}
          <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
        </p>
      </section>
    </main>
  );
}

export default LoginPage;
