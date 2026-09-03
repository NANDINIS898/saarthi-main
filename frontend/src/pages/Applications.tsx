import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type { ApplicationSummary, LoanApplication, LoanOffer } from "../api/types";
import { PageShell } from "../components/PageShell";

type Tab = "all" | "active" | "completed";

export default function Applications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
 

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

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((s) => !s.sanction_issued && s.application.status !== "rejected").length;
    const approved = items.filter((s) => s.offer_accepted || s.sanction_issued).length;
    const disbursed = items
      .filter((s) => s.sanction_issued)
      .reduce((sum, s) => sum + (s.accepted_offer?.amount || 0), 0);
    return { total, active, approved, disbursed };
  }, [items]);

  const filtered = items.filter((s) => {
    const a = s.application;
    if (tab === "active" && (s.sanction_issued || a.status === "rejected")) return false;
    if (tab === "completed" && !s.sanction_issued) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      const hay = [
        `LA-${a.id}`,
        a.loan_purpose || "",
        a.status,
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <PageShell
      title="Applications"
      subtitle="View loan applications"
      rightSlot={
        <button
          onClick={() => navigate("/loan")}
          className="hidden sm:inline-flex bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg px-3 py-1.5 text-sm"
        >
          + New application
        </button>
      }
    >
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Applications" value={stats.total} tone="blue" icon={<DocIcon />} />
          <StatCard label="Active" value={stats.active} tone="blue" icon={<ClockIcon />} />
          <StatCard label="Approved" value={stats.approved} tone="emerald" icon={<CheckIcon />} />
          <StatCard label="Total Disbursed" value={`₹${stats.disbursed.toLocaleString("en-IN")}`} tone="emerald" icon={<RupeeIcon />} />
        </div>

        {/* Search row */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <SearchIcon />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by ID, lender, or loan type…"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400"
            />
          </div>
          <button className="inline-flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
            <FilterIcon /> All Status
          </button>
          <button className="inline-flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
            <CalendarIcon /> Date Range
          </button>
        </section>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          <TabBtn active={tab === "all"} onClick={() => setTab("all")}>All Applications</TabBtn>
          <TabBtn active={tab === "active"} onClick={() => setTab("active")}>Active</TabBtn>
          <TabBtn active={tab === "completed"} onClick={() => setTab("completed")}>Completed</TabBtn>
        </div>

        {/* List */}
        {loading && <Empty text="Loading…" />}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <Empty text="No applications match this view yet." />
        )}

        <div className="space-y-4">
          {filtered.map((s) => (
            <ApplicationCard
              key={s.application.id}
              summary={s}
              onOpen={() => navigate(`/loan/${s.application.id}`)}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

function StatCard({
  label, value, tone, icon,
}: { label: string; value: number | string; tone: "blue" | "emerald"; icon: React.ReactNode }) {
  const bg = tone === "emerald" ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600";
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-start justify-between">
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      </div>
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
        {icon}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-emerald-500 text-emerald-600"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function ApplicationCard({
  summary, onOpen,
}: { summary: ApplicationSummary; onOpen: () => void }) {
  const a = summary.application;
  const offer = summary.accepted_offer || summary.offers[0];
  const progress = derivedProgress(summary);
  const next = nextLabel(summary);

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
          <BankIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">
              {lenderLabel(summary)}
            </h3>
            <StatusPill status={a.status} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {(a.loan_purpose || "Loan")} <span className="mx-1.5">·</span> LA-{String(a.id).padStart(4, "0")}
          </p>
        </div>

        <button
          onClick={onOpen}
          className="text-gray-400 hover:text-emerald-600 p-1"
          aria-label="Open"
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <KvStack label="Amount" value={`₹${(a.loan_amount || 0).toLocaleString("en-IN")}`} />
        <KvStack
          label="Interest"
          value={offer ? `${offer.interest_rate.toFixed(1)}%` : "—"}
          accent
        />
        <KvStack
          label="Tenure"
          value={offer ? `${offer.tenure_months} mo` : `${a.tenure_preference_months || "—"} mo`}
        />
        <KvStack
          label="EMI"
          value={offer ? `₹${Math.round(offer.emi).toLocaleString("en-IN")}` : "—"}
          accent
        />
      </div>

      {/* Progress */}
      <div className="mt-5">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-gray-500">Progress</span>
          <span className="font-semibold text-gray-900">{progress}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {next && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-amber-500">⚠</span>
          <span className="text-gray-500">Next:</span>
          <span className="text-gray-800 font-medium">{next}</span>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <CalendarIcon /> Applied: {new Date(a.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
        <button onClick={onOpen} className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium">
          Open <span>→</span>
        </button>
      </div>
    </section>
  );
}

function KvStack({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`text-base font-semibold mt-0.5 ${accent ? "text-emerald-600" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls = (() => {
    if (status === "rejected") return "bg-red-100 text-red-700 border-red-200";
    if (status === "sanctioned" || status === "disbursed") return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (status === "accepted") return "bg-blue-100 text-blue-700 border-blue-200";
    if (status === "offer_pending" || status === "negotiating") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-gray-100 text-gray-600 border-gray-200";
  })();
  const label = status === "offer_pending" ? "Under Review"
    : status === "sanctioned" ? "Approved"
    : status === "disbursed" ? "Disbursed"
    : status.replaceAll("_", " ");
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border capitalize ${cls}`}>
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-sm text-gray-500">
      {text}
    </div>
  );
}

function derivedProgress(s: ApplicationSummary): number {
  const flags = [
    s.kyc_done, s.underwriting_done, s.offers_generated,
    s.offer_accepted, s.sanction_issued, s.admin_approved,
  ];
  const done = flags.filter(Boolean).length;
  return Math.round((done / flags.length) * 100);
}

function nextLabel(s: ApplicationSummary): string | null {
  if (s.admin_approved) return null;
  if (!s.kyc_done) return "Complete Video KYC";
  if (!s.underwriting_done) return "Underwriting in progress";
  if (!s.offers_generated) return "Generating offers";
  if (!s.offer_accepted) return "Review and accept an offer";
  if (!s.sanction_issued) return "Sanction letter being prepared";
  if (!s.admin_approved) return "E-sign documents to proceed";
  return null;
}

function lenderLabel(s: ApplicationSummary): string {
  const o: LoanOffer | undefined = s.accepted_offer || s.offers[0];
  if (o && (o as LoanOffer & { lender?: string }).lender) {
    return (o as LoanOffer & { lender?: string }).lender!;
  }
  return s.application.loan_purpose || "Loan application";
}

// ─── Icons ─────────────────────────────────────────────────────────────────
function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
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
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="20 6 9 17 4 12" />
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
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}
function BankIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M3 21h18" />
      <path d="M5 21V10l7-5 7 5v11" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
