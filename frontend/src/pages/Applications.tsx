import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type { ApplicationSummary, LoanApplication } from "../api/types";
import { AppHeader } from "../components/AppHeader";

/**
 * Applications list — every loan the current user has ever started, plus a
 * progress timeline of where each one is in the lifecycle.
 */
export default function Applications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: apps } = await api.get<LoanApplication[]>("/applications");
        // Fetch summaries in parallel for the timeline view.
        const summaries = await Promise.all(
          apps.map(async (a) => {
            const { data } = await api.get<ApplicationSummary>(`/applications/${a.id}/summary`);
            return data;
          }),
        );
        if (!cancelled) setItems(summaries);
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader subtitle="Your loan applications" />
      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Applications</h1>
          <button
            onClick={() => navigate("/loan")}
            className="bg-[#6C63FF] hover:bg-[#5a52d6] text-white font-medium rounded-lg px-3 py-1.5 text-sm"
          >
            + New application
          </button>
        </div>

        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500">
            Loading…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500">
            You haven't started any applications yet.
          </div>
        )}

        {items.map((s) => (
          <ApplicationCard
            key={s.application.id}
            summary={s}
            onOpen={() => navigate(`/loan/${s.application.id}`)}
          />
        ))}
      </main>
    </div>
  );
}

function ApplicationCard({
  summary, onOpen,
}: { summary: ApplicationSummary; onOpen: () => void }) {
  const a = summary.application;
  return (
    <section
      onClick={onOpen}
      className="bg-white rounded-2xl border border-gray-200 p-5 cursor-pointer hover:border-[#6C63FF] transition-colors"
    >
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-900">
          ₹ {(a.loan_amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}{" "}
          <span className="text-sm font-normal text-gray-500">· {a.loan_purpose || "—"}</span>
        </h2>
        <StatusPill status={a.status} />
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Application #{a.id} · started {new Date(a.created_at).toLocaleDateString()}
      </p>
      <Timeline summary={summary} />
      <p className="text-xs text-[#6C63FF] mt-3 font-medium">Open →</p>
    </section>
  );
}

function Timeline({ summary }: { summary: ApplicationSummary }) {
  const steps: { label: string; done: boolean }[] = [
    { label: "KYC",          done: summary.kyc_done },
    { label: "Underwriting", done: summary.underwriting_done },
    { label: "Offers",       done: summary.offers_generated },
    { label: "Accepted",     done: summary.offer_accepted },
    { label: "Sanction",     done: summary.sanction_issued },
    { label: "Admin OK",     done: summary.admin_approved },
  ];
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.label} className="flex-1 flex flex-col items-center">
          <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
            s.done ? "bg-[#6C63FF] text-white" : "bg-gray-100 text-gray-400"
          }`}>
            {s.done ? "✓" : i + 1}
          </div>
          <span className={`text-[10px] mt-1 ${s.done ? "text-gray-900" : "text-gray-400"}`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const variant = (() => {
    if (status === "rejected") return "bg-red-100 text-red-700";
    if (status === "sanctioned" || status === "disbursed") return "bg-emerald-100 text-emerald-700";
    if (status === "accepted") return "bg-blue-100 text-blue-700";
    if (status === "offer_pending" || status === "negotiating") return "bg-amber-100 text-amber-700";
    return "bg-gray-100 text-gray-600";
  })();
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${variant}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
