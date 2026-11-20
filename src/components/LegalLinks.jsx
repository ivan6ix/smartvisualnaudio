import { Link } from "react-router-dom";
export default function LegalLinks() {
  return <nav className="legal-links" aria-label="Policies">{[["privacy", "Privacy Policy"], ["terms", "Terms of Use"], ["storage", "Cookies & Local Storage"]].map(([path, title]) => <Link key={path} to={`/${path}`}>{title}</Link>)}</nav>;
}
