import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { Logo } from "./Logo";

/**
 * Shared header — used on every authenticated page so the top nav stays in one place.
 */
export function AppHeader({ subtitle }: { subtitle?: string }) {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  function onLogout() {
    logout();
    navigate("/login");
  }

  return (
    <header className="bg-[#6C63FF] text-white">
      <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-3 hover:opacity-90">
          <Logo size={36} />
          <div>
            <p className="font-semibold leading-tight">Saarthi</p>
            <p className="text-xs text-white/70 leading-tight">
              {subtitle || "AI loan assistant"}
            </p>
          </div>
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <NavItem to="/dashboard">Dashboard</NavItem>
          <NavItem to="/applications">Applications</NavItem>
          <div className="hidden md:block text-right ml-2">
            <p className="font-medium leading-tight">{user?.full_name}</p>
            <button onClick={onLogout} className="text-xs text-white/80 hover:underline">
              Sign out
            </button>
          </div>
          <button onClick={onLogout} className="md:hidden text-xs text-white/80 hover:underline">
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `text-sm hover:text-white ${isActive ? "text-white font-medium" : "text-white/75"}`
      }
    >
      {children}
    </NavLink>
  );
}
