import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import TopNav from "../components/TopNav";
import { PageSkeleton } from "../components/ui";

const roleHome = {
  Dean: "/dean",
  Professor: "/professor",
  "Cluster Professor": "/cluster",
  Student: "/student",
};

export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();

  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles?.length && !roles.includes(user.role)) return <Navigate to={roleHome[user.role] || "/login"} replace />;

  return (
    <>
      <TopNav />
      <main className="app-shell">
        <Outlet />
      </main>
    </>
  );
}
