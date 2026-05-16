import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { Logo } from "../components/Logo";

export default function Dashboard() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  function onLogout() {
    logout();
    navigate("/login");
  }

  const kyc = user?.kyc_status || "pending";
  const isApproved = kyc === "approved";
  const isRejected = kyc === "rejected";

  return (
    <div className="min-h-screen">
      <header className="bg-[#6C63FF] text-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <p className="font-semibold">Saarthi</p>
              <p className="text-xs text-white/70">AI loan assistant</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{user?.full_name}</p>
            <button onClick={onLogout} className="text-xs text-white/80 hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {/* Account summary */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-3">Your account</h2>
          <Row label="Email" value={user?.email} />
          <Row label="Phone" value={user?.phone || "—"} />
          <Row label="Verified" value={user?.is_verified ? "Yes" : "Not yet"} />
          <Row label="KYC status" value={kyc} pill />
        </section>

        {/* KYC action card */}
        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Verify your identity</h2>
          <p className="text-sm text-gray-500 mb-4">
            {isApproved
              ? "Your identity is verified. You can apply for a loan."
              : isRejected
                ? "Your last verification didn't pass. You can retry the video session."
                : "Record a short video and hold up your Aadhaar — we'll handle the rest."}
          </p>

          <button
            onClick={() => navigate("/kyc/session")}
            className="bg-[#6C63FF] hover:bg-[#5a52d6] text-white font-medium rounded-lg px-4 py-2.5 text-sm w-full md:w-auto"
          >
            {isApproved ? "Run KYC again" : isRejected ? "Retry video session" : "Enter video session"}
          </button>
        </section>

        <p className="text-xs text-gray-400 text-center pt-4">
          Phases done: 1 Auth · 2 Media · 3 KYC pipeline. Loan flow comes next.
        </p>
      </main>
    </div>
  );
}

function Row({ label, value, pill = false }: { label: string; value?: string | null; pill?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      {pill ? (
        <span className="text-xs font-medium bg-[#f0f0f8] text-[#6C63FF] px-2 py-0.5 rounded-full">
          {value || "—"}
        </span>
      ) : (
        <span className="text-sm font-medium text-gray-900 text-right max-w-[60%] break-words">{value || "—"}</span>
      )}
    </div>
  );
}
