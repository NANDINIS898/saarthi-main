import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type { ApplicationSummary, LoanApplication } from "../api/types";
import { PageShell } from "../components/PageShell";

type Range = "all" | "2023" | "2022";

export default function History() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: apps } = await api.get<LoanApplication[]>("/applications");
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

  const filtered = useMemo(() => {
    if (range === "all") return items;
    return items.filter((s) => new Date(s.application.created_at).getFullYear() === Number(range));
  }, [items, range]);

  const stats = useMemo(() => {
    const total = items.length;
    const disbursed = items
      .filter((s) => s.sanction_issued)
      .reduce((sum, s) => sum + (s.accepted_offer?.amount || 0), 0);
    const active = items.filter((s) => s.offer_accepted && !s.admin_approved).length;
    const outstanding = Math.round(disbursed * 0.32);
    return { total, disbursed, active, outstanding };
  }, [items]);

  return (
    <PageShell title="History" subtitle="Past applications">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Loans Taken" value={stats.total} icon={<HistoryIcon />} tone="blue" />
          <StatCard label="Total Disbursed" value={`₹${stats.disbursed.toLocaleString("en-IN")}`} icon={<RupeeIcon />} tone="emerald" />
          <StatCard label="Active Loans" value={stats.active} icon={<ClockIcon />} tone="blue" />
          <StatCard
            label="Outstanding"
            value={`₹${stats.outstanding.toLocaleString("en-IN")}`}
            icon={<TrendDownIcon />}
            tone="amber"
          />
        </div>

        {/* Range tabs */}
        <div className="flex items-center gap-2">
          <RangeBtn active={range === "all"} onClick={() => setRange("all")}>All Time</RangeBtn>
          <RangeBtn active={range === "2023"} onClick={() => setRange("2023")}>2023</RangeBtn>
          <RangeBtn active={range === "2022"} onClick={() => setRange("2022")}>2022</RangeBtn>
        </div>

        {/* History list */}
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <HistoryIcon />
            <h2 className="text-base font-semibold text-gray-900">Loan History</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Complete history of all your loan applications and their outcomes
          </p>

          {loading && <p className="text-sm text-gray-500 py-4">Loading…</p>}
          {error && <p className="text-sm text-red-700 py-4">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-gray-500 py-4">No history for this range.</p>
          )}

          <div className="space-y-3">
            {filtered.map((s) => (
              <HistoryRow
                key={s.application.id}
                summary={s}
                onOpen={() => navigate(`/loan/${s.application.id}`)}
              />
            ))}
          </div>
        </section>

        {/* Credit score panel */}
        <CreditPanel
          score={748}
          activeCount={stats.active}
          completedCount={items.filter((s) => s.sanction_issued).length}
        />
      </div>
    </PageShell>
  );
}

function StatCard({
  label, value, tone, icon,
}: { label: string; value: number | string; tone: "blue" | "emerald" | "amber"; icon: React.ReactNode }) {
  const bg =
    tone === "emerald" ? "bg-emerald-50 text-emerald-600"
      : tone === "amber" ? "bg-amber-50 text-amber-600"
        : "bg-blue-50 text-blue-600";
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-start justify-between">
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
    </div>
  );
}

function RangeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

function HistoryRow({
  summary, onOpen,
}: { summary: ApplicationSummary; onOpen: () => void }) {
  const a = summary.application;
  const offer = summary.accepted_offer || summary.offers[0];
  const isActive = summary.offer_accepted && !summary.admin_approved;
  const isClosed = summary.admin_approved || a.status === "rejected";

  const statusLabel = a.status === "rejected"
    ? "Rejected"
    : isClosed ? "Closed"
      : isActive ? "Active"
        : a.status.replaceAll("_", " ");
  const dot = a.status === "rejected"
    ? "bg-red-500"
    : isClosed ? "bg-gray-400"
      : isActive ? "bg-emerald-500"
        : "bg-amber-500";
  const pillCls = a.status === "rejected"
    ? "bg-red-50 text-red-700 border-red-200"
    : isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-gray-50 text-gray-600 border-gray-200";

  return (
    <button
      onClick={onOpen}
      className="w-full text-left flex items-center gap-4 border border-gray-200 hover:border-emerald-300 hover:bg-gray-50 rounded-xl p-4 transition-colors"
    >
      <span className={`w-2.5 h-2.5 rounded-full ${dot} flex-shrink-0`} />
      <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
        <BankIcon />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">
            {a.loan_purpose || "Loan"}
          </span>
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${pillCls}`}>
            {isActive && <span className="text-emerald-500">✓</span>}
            {statusLabel}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Personal Loan <span className="mx-1.5">·</span> LA-{String(a.id).padStart(4, "0")}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="font-semibold text-gray-900 text-sm">
          ₹{(offer?.amount ?? a.loan_amount ?? 0).toLocaleString("en-IN")}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {new Date(a.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
    </button>
  );
}

function CreditPanel({
  score, activeCount, completedCount,
}: { score: number; activeCount: number; completedCount: number }) {
  return (
    <section className="bg-emerald-50/40 border border-emerald-100 rounded-2xl p-5 flex flex-col md:flex-row gap-5 items-start md:items-center">
      <div className="flex-shrink-0">
        <p className="text-xs text-gray-500">Your Credit Score</p>
        <p className="text-5xl font-bold text-emerald-700 mt-1">{score}</p>
        <span className="inline-block mt-1 text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
          Excellent
        </span>
      </div>
      <div className="flex-1">
        <h3 className="text-base font-semibold text-gray-900">
          Your loan repayment history looks great!
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          With {completedCount} loans successfully closed and {activeCount} active loans in good standing,
          you're eligible for pre-approved offers with better interest rates.
        </p>
        <button className="mt-3 inline-flex items-center gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg px-4 py-2">
          View Pre-approved Offers <span>›</span>
        </button>
      </div>
    </section>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function RupeeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M6 3h12M6 8h12M6 13l9 8M6 13c0 0 9 0 9-5" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function TrendDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  );
}
function BankIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M3 21h18" />
      <path d="M5 21V10l7-5 7 5v11" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}
