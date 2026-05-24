import { useAuth } from "../store/auth";
import { PageShell } from "../components/PageShell";

export default function Settings() {
  const user = useAuth((s) => s.user);

  return (
    <PageShell title="Settings" subtitle="Manage your account">
      <div className="max-w-3xl mx-auto space-y-4">
        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Your account</h2>
          <Row label="Full name" value={user?.full_name} />
          <Row label="Email" value={user?.email} />
          <Row label="Phone" value={user?.phone || "—"} />
          <Row label="Verified" value={user?.is_verified ? "Yes" : "Not yet"} />
          <Row label="KYC status" value={user?.kyc_status || "pending"} pill />
        </section>

        <section className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Preferences</h2>
          <p className="text-sm text-gray-500">Notification preferences, language, and theme controls will live here.</p>
        </section>
      </div>
    </PageShell>
  );
}

function Row({ label, value, pill = false }: { label: string; value?: string | null; pill?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      {pill ? (
        <span className="text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full capitalize">
          {value || "—"}
        </span>
      ) : (
        <span className="text-sm font-medium text-gray-900 text-right max-w-[60%] break-words">{value || "—"}</span>
      )}
    </div>
  );
}
