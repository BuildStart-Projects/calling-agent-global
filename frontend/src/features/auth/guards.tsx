import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { FullPageSpinner } from "@/components/common/FullPageSpinner";

export function RequireAuth() {
  const { ready, session } = useAuth();
  const location = useLocation();
  if (!ready) return <FullPageSpinner />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const { ready, session } = useAuth();
  if (!ready) return <FullPageSpinner />;
  if (session) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { ready, session, isPlatformAdmin } = useAuth();
  if (!ready) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login?next=/admin" replace />;
  if (!isPlatformAdmin) return <Navigate to="/app" replace />;
  return <Outlet />;
}
