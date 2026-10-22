import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AppShell from "../components/AppShell";
import TopNav from "../components/TopNav";
import { PageSkeleton } from "../components/ui";

const roleHome = {
  Dean: "/dean",
  Professor: "/professor",
  "Cluster Professor": "/cluster",
  Student: "/student",
};

export default function ProtectedRoute({ roles }) {
  const { user, loading, hasLoggedInThisSession } = useAuth();
  const { pathname } = useLocation();

  if (loading) return <PageSkeleton />;
  // Visitors arriving at the bare domain see the landing page first; deep links still go to sign in.
  if (!hasLoggedInThisSession || !user) return <Navigate to={pathname === "/" ? "/landing" : "/login"} replace />;
  if (roles?.length && !roles.includes(user.role)) return <Navigate to={roleHome[user.role] || "/login"} replace />;
  if (user.role === "Admin") return <AppShell role="Admin" />;

  return (
    <>
      <TopNav />
      <main className="app-shell">
        <Outlet />
      </main>
    </>
  );
}
