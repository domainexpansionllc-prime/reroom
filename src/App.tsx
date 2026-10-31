import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import { PageLoader } from "./components/ui";
import AuthPage from "./pages/AuthPage";
import NewMakeover from "./pages/NewMakeover";
import MakeoverPage from "./pages/MakeoverPage";
import Gallery from "./pages/Gallery";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  return user ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/new" element={<NewMakeover />} />
        <Route path="/makeover/:id" element={<MakeoverPage />} />
        <Route path="/gallery" element={<Gallery />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
