import type { ReactNode } from "react";
import { ROUTES, usePrototypeNavigation } from "../prototypeRoutes";

type PrototypeBrandLinkProps = {
  className?: string;
  children: ReactNode;
};

export default function PrototypeBrandLink({ className, children }: PrototypeBrandLinkProps) {
  const { navigate } = usePrototypeNavigation();

  return (
    <a
      href={ROUTES.home}
      className={className ? `prototype-brand-link ${className}` : "prototype-brand-link"}
      onClick={(event) => {
        event.preventDefault();
        navigate(ROUTES.home);
      }}
    >
      {children}
    </a>
  );
}
