import { useAuth } from "../store/auth";
import { Sidebar } from "./Sidebar";

/**
 * Authenticated layout: dark Sidebar on the left, sticky top bar with title +
 * KYC status + notification bell + profile, then the page body.
 */
export function PageShell({
  title,
  subtitle,
  children,
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  const user = useAuth((s) => s.user);
  const kyc = (user?.kyc_status || "pending").toLowerCase();

  const kycVariant =
    kyc === "approved"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : kyc === "rejected"
        ? "bg-red-100 text-red-700 border-red-200"
        : "bg-amber-100 text-amber-700 border-amber-200";

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900 truncate">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-500 truncate">{subtitle}</p>
            )}
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {rightSlot}

            <div className={`hidden sm:flex items-center gap-2 border rounded-lg px-3 py-1.5 ${kycVariant}`}>
              <ShieldIcon />
              <span className="text-xs">
                <b className="font-semibold">KYC Status:</b>{" "}
                <span className="capitalize">{kyc}</span>
              </span>
            </div>

            <button
              className="relative w-9 h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-600"
              aria-label="Notifications"
            >
              <BellIcon />
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                3
              </span>
            </button>

            <button
              className="w-9 h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-600"
              aria-label="Profile"
            >
              <UserIcon />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
