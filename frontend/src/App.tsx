import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Assistant from "./pages/Assistant";
import KycSession from "./pages/KycSession";
import LoanFlow from "./pages/LoanFlow";
import Applications from "./pages/Applications";
import History from "./pages/History";
import Settings from "./pages/Settings";
import { SaarthiAssistant } from "./components/SaarthiAssistant";
import { useAuth } from "./store/auth";

export default function App() {
  const init = useAuth((s) => s.init);
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);

  useEffect(() => {
    init();
  }, [init]);

  const authenticated = !!token && !!user;

  return (
    <BrowserRouter>
      {authenticated && <FloatingAssistantGated />}
      <Routes>
        <Route
          path="/login"
          element={authenticated ? <Navigate to="/assistant" replace /> : <Login />}
        />
        <Route
          path="/signup"
          element={authenticated ? <Navigate to="/assistant" replace /> : <Signup />}
        />
        <Route
          path="/assistant"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <Assistant />
              : <Navigate to="/login" replace />
          }
        />
        {/* Legacy /dashboard → /assistant for backwards compat */}
        <Route path="/dashboard" element={<Navigate to="/assistant" replace />} />
        <Route
          path="/kyc/session"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <KycSession />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/loan"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <LoanFlow />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/loan/:id"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <LoanFlow />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/applications"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <Applications />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/history"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <History />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/settings"
          element={
            loading ? <FullScreenLoading />
              : authenticated ? <Settings />
              : <Navigate to="/login" replace />
          }
        />
        <Route
          path="*"
          element={<Navigate to={authenticated ? "/assistant" : "/login"} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

/**
 * Hide the floating assistant on the dedicated /assistant page — there it
 * would be redundant with the inline chat.
 */
function FloatingAssistantGated() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/assistant")) return null;
  return <SaarthiAssistant />;
}

function FullScreenLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
      Loading…
    </div>
  );
}
