import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homeForRole } from "../lib/roleHome";

// Pages only for signed-out visitors (landing, sign in). A signed-in user who reaches one, for example with the
// browser's Back button after signing in, goes straight back to their dashboard instead.
export default function SignedOutRoute({ children }) {
  const { user, loading, hasLoggedInThisSession } = useAuth();
  if (!loading && hasLoggedInThisSession && user) return <Navigate to={homeForRole(user.role)} replace />;
  return children;
}
