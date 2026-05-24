import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { Logo } from "./Logo";

/**
 * Dark sidebar — primary navigation for the authenticated app.
 *
 * Order mirrors the v0 reference design: brand block, primary nav, then the
 * user card pinned to the bottom.
 */
export function Sidebar() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const kycRequired = user?.kyc_status !== "approved";

  function onLogout() {
    logout();
    navigate("/login");
  }

  const initials =
    (user?.full_name || user?.email || "U")
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <aside className="hidden md:flex flex-col w-64 bg-[#0F172A] text-white min-h-screen sticky top-0">
      {/* Brand */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-white/5">
        <Logo size={42} />
        <div>
          <p className="text-base font-semibold leading-tight">Saarthi</p>
          <p className="text-[11px] text-white/50 leading-tight">Loan Assistant</p>
        </div>
      </div>

      {/* Primary CTA — always visible. Gated on KYC. */}
      <div className="px-3 pt-4">
        <button
          onClick={() => navigate(kycRequired ? "/kyc/session" : "/loan")}
          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg px-3 py-2.5 text-sm flex items-center justify-center gap-2 shadow-sm transition-colors"
          title={kycRequired ? "Complete KYC first" : "Start a new loan application"}
        >
          <PlusIcon />
          {kycRequired ? "Complete KYC to Apply" : "Apply for Loan"}
        </button>
        {kycRequired && (
          <p className="text-[10px] text-amber-300/80 mt-1.5 px-1 leading-tight">
            KYC required before applying.
          </p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <NavItem to="/assistant" icon={<ChatIcon />} label="AI Assistant" />
        <NavItem
          to="/kyc/session"
          icon={<VideoIcon />}
          label="Video KYC"
          badge={kycRequired ? "Required" : undefined}
        />
        <NavItem to="/applications" icon={<DocIcon />} label="Applications" />
        <NavItem to="/history" icon={<HistoryIcon />} label="History" />
      </nav>

      {/* Settings + user */}
      <div className="px-3 py-3 border-t border-white/5">
        <NavItem to="/settings" icon={<GearIcon />} label="Settings" />
      </div>

      <div className="px-3 pb-4">
        <div className="flex items-center gap-3 bg-white/5 rounded-xl px-3 py-2.5">
          <div className="w-9 h-9 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.full_name || "—"}</p>
            <p className="text-[11px] text-white/50 truncate">{user?.email}</p>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="text-white/50 hover:text-white p-1"
          >
            <LogoutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  to, icon, label, badge,
}: { to: string; icon: React.ReactNode; label: string; badge?: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
          isActive
            ? "bg-emerald-500 text-white font-medium shadow-sm"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`
      }
    >
      <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="text-[10px] font-semibold bg-white/15 px-1.5 py-0.5 rounded">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
