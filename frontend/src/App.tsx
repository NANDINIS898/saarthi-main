import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import KycSession from "./pages/KycSession";
import LoanFlow from "./pages/LoanFlow";
import Applications from "./pages/Applications";
import { SaarthiAssistant } from "./components/SaarthiAssistant";
import { useAuth } from "./store/auth";

export default function App() {
  const init = useAuth((s) => s.init);
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const loading = useAuth((s) => s.loading);

  // On boot: if a token is in localStorage, fetch the matching user.
  useEffect(() => {
    init();
  }, [init]);

  const authenticated = !!token && !!user;

  return (
    <BrowserRouter>
      {/* Floating Saarthi assistant — global, only when authenticated. */}
      {authenticated && <SaarthiAssistant />}
      <Routes>
        <Route
          path="/login"
          element={authenticated ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route
          path="/signup"
          element={authenticated ? <Navigate to="/dashboard" replace /> : <Signup />}
        />
        <Route
          path="/dashboard"
          element={
            loading ? (
              <FullScreenLoading />
            ) : authenticated ? (
              <Dashboard />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/kyc/session"
          element={
            loading ? (
              <FullScreenLoading />
            ) : authenticated ? (
              <KycSession />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/loan"
          element={
            loading ? (
              <FullScreenLoading />
            ) : authenticated ? (
              <LoanFlow />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/loan/:id"
          element={
            loading ? (
              <FullScreenLoading />
            ) : authenticated ? (
              <LoanFlow />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/applications"
          element={
            loading ? (
              <FullScreenLoading />
            ) : authenticated ? (
              <Applications />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="*"
          element={<Navigate to={authenticated ? "/dashboard" : "/login"} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

function FullScreenLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
      Loading…
    </div>
  );
}
