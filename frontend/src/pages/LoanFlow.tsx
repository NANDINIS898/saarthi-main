import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type {
  LoanApplication, LoanOffer, NegotiationResponse,
  RiskAssessment, SanctionLetter,
} from "../api/types";
import { useAuth } from "../store/auth";
import { Logo } from "../components/Logo";

/**
 * Single-page loan flow.
 *
 *   apply → underwrite → see risk + 3 offers → (negotiate)* → accept → sanction
 *
 * Each stage maps to one section of the page that becomes visible when the
 * previous stage produces data.
 */

type Stage = "apply" | "underwriting" | "offers" | "sanctioned";

export default function LoanFlow() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);

  const [stage, setStage] = useState<Stage>("apply");
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [offers, setOffers] = useState<LoanOffer[]>([]);
  const [sanction, setSanction] = useState<SanctionLetter | null>(null);
  const [chat, setChat] = useState<{ from: "user" | "agent"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kycOk = user?.kyc_status === "approved";

  // ─── Apply ───────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    loan_amount: "400000",
    loan_purpose: "Home renovation",
    monthly_income: "85000",
    tenure_preference_months: "36",
  });
  function fld<K extends keyof typeof form>(k: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function submitApplication() {
    setError(null);
    setBusy(true);
    try {
      const { data } = await api.post<LoanApplication>("/applications", {
        loan_amount: Number(form.loan_amount),
        loan_purpose: form.loan_purpose,
        monthly_income: Number(form.monthly_income),
        tenure_preference_months: Number(form.tenure_preference_months),
      });
      setApplication(data);
      setStage("underwriting");
      // immediately run underwriting + generate offers
      await runUnderwriting(data.id);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Underwriting ────────────────────────────────────────────────────────
  async function runUnderwriting(appId: number) {
    setBusy(true);
    setError(null);
    try {
      const { data: r } = await api.post<RiskAssessment>(`/applications/${appId}/underwrite`);
      setRisk(r);
      if (r.decision === "reject") {
        setStage("underwriting");
        return;
      }
      const { data: o } = await api.post<LoanOffer[]>(`/applications/${appId}/offers/generate`);
      setOffers(o);
      setStage("offers");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Negotiation ─────────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  async function sendNegotiation() {
    if (!application || !chatInput.trim()) return;
    const msg = chatInput.trim();
    setChat((c) => [...c, { from: "user", text: msg }]);
    setChatInput("");
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<NegotiationResponse>(
        `/applications/${application.id}/negotiate`,
        { message: msg },
      );
      setChat((c) => [...c, { from: "agent", text: data.agent_message }]);
      // Replace recommended offer with the new counter
      setOffers((prev) => [
        data.offer,
        ...prev.filter((p) => !p.is_recommended || p.is_negotiated),
      ]);
    } catch (err) {
      const msg = apiErrorMessage(err);
      setError(msg);
      setChat((c) => [...c, { from: "agent", text: `Sorry — ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  // ─── Accept + sanction ───────────────────────────────────────────────────
  async function accept(offer: LoanOffer) {
    if (!application) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<SanctionLetter>(
        `/applications/${application.id}/offers/${offer.id}/accept`,
      );
      setSanction(data);
      setStage("sanctioned");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <header className="bg-[#6C63FF] text-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <p className="font-semibold">Loan application</p>
              <p className="text-xs text-white/70">Saarthi · underwriting + negotiation</p>
            </div>
          </div>
          <button onClick={() => navigate("/dashboard")} className="text-xs text-white/80 hover:underline">
            Back to dashboard
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        {!kycOk && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
            You need to complete KYC verification before applying.{" "}
            <button onClick={() => navigate("/kyc/session")} className="font-medium underline">
              Start video session
            </button>
          </div>
        )}

        {/* 1. Apply */}
        {kycOk && stage === "apply" && (
          <form onSubmit={(e) => { e.preventDefault(); submitApplication(); }} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Tell us about your loan</h2>
            <Field label="Loan amount (₹)" id="amount">
              <input id="amount" type="number" min={20000} max={5000000} required
                value={form.loan_amount} onChange={fld("loan_amount")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF]" />
            </Field>
            <Field label="Purpose" id="purpose">
              <input id="purpose" required value={form.loan_purpose} onChange={fld("loan_purpose")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF]" />
            </Field>
            <Field label="Monthly income (₹)" id="income">
              <input id="income" type="number" min={8000} required
                value={form.monthly_income} onChange={fld("monthly_income")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF]" />
            </Field>
            <Field label="Tenure" id="tenure">
              <select id="tenure" required value={form.tenure_preference_months} onChange={fld("tenure_preference_months")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF]">
                {[12, 24, 36, 48, 60, 72, 84].map((m) => <option key={m} value={m}>{m} months</option>)}
              </select>
            </Field>
            {error && <ErrorPill text={error} />}
            <button type="submit" disabled={busy}
              className="w-full bg-[#6C63FF] hover:bg-[#5a52d6] disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm">
              {busy ? "Submitting…" : "Submit application"}
            </button>
          </form>
        )}

        {/* 2. Underwriting result */}
        {stage === "underwriting" && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            {!risk ? (
              <>
                <div className="inline-block w-10 h-10 border-4 border-[#6C63FF] border-t-transparent rounded-full animate-spin" />
                <p className="text-base font-medium text-gray-900 mt-3">Running ML underwriting…</p>
                <p className="text-xs text-gray-500 mt-1">XGBoost + SHAP · scoring your application</p>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500">Credit score</p>
                <p className="text-4xl font-bold text-[#6C63FF] mt-1">{Math.round(risk.risk_score)}</p>
                <Pill text={risk.decision} variant={risk.decision === "approve" ? "ok" : risk.decision === "reject" ? "bad" : "warn"} />
                {error && <ErrorPill text={error} />}
              </>
            )}
          </section>
        )}

        {/* 3. Offers + chat */}
        {stage === "offers" && risk && (
          <>
            <section className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">Your offers</h2>
                <span className="text-xs text-gray-500">credit score {Math.round(risk.risk_score)}</span>
              </div>
              <div className="space-y-3">
                {offers.map((o) => (
                  <OfferCard key={o.id} offer={o} busy={busy} onAccept={() => accept(o)} />
                ))}
              </div>
              {risk.shap_values && (
                <details className="mt-4 text-xs text-gray-500">
                  <summary className="cursor-pointer">Why this score? (SHAP top drivers)</summary>
                  <ul className="mt-2 space-y-1">
                    {Object.entries(risk.shap_values)
                      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                      .slice(0, 5)
                      .map(([k, v]) => (
                        <li key={k} className="flex justify-between">
                          <span>{k}</span>
                          <span className={v < 0 ? "text-emerald-600" : "text-red-600"}>
                            {v > 0 ? "+" : ""}{v.toFixed(3)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-2">Negotiate</h2>
              <p className="text-xs text-gray-500 mb-3">
                Ask for a lower EMI, longer tenure, or better rate. The agent stays inside policy.
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto mb-3">
                {chat.length === 0 && (
                  <p className="text-xs text-gray-400 italic">e.g. "Can you bring the EMI down to ₹10,000?"</p>
                )}
                {chat.map((m, i) => (
                  <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                      m.from === "user"
                        ? "bg-[#6C63FF] text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); sendNegotiation(); }} className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={busy}
                  placeholder="Type your message…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF]"
                />
                <button type="submit" disabled={busy || !chatInput.trim()}
                  className="bg-[#6C63FF] hover:bg-[#5a52d6] disabled:opacity-50 text-white font-medium rounded-lg px-4 text-sm">
                  Send
                </button>
              </form>
              {error && <ErrorPill text={error} className="mt-3" />}
            </section>
          </>
        )}

        {/* 4. Sanction */}
        {stage === "sanctioned" && sanction && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="bg-emerald-50 rounded-xl p-4">
              <p className="text-sm font-semibold text-emerald-700">✓ Sanction letter generated</p>
              <p className="text-xs text-emerald-700 mt-1">Reference: <b>{sanction.ref_no}</b></p>
              <p className="text-xs text-emerald-700">Status: {sanction.status.replaceAll("_", " ")}</p>
            </div>
            {sanction.signed_url ? (
              <a href={sanction.signed_url} target="_blank" rel="noreferrer"
                className="mt-4 inline-block bg-[#6C63FF] hover:bg-[#5a52d6] text-white font-medium rounded-lg px-4 py-2 text-sm">
                Open sanction PDF
              </a>
            ) : (
              <p className="text-xs text-gray-500 mt-3">PDF link is being prepared…</p>
            )}
            <button onClick={() => navigate("/dashboard")}
              className="mt-3 block w-full bg-white border border-gray-300 text-gray-700 rounded-lg py-2 text-sm">
              Back to dashboard
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function OfferCard({ offer, busy, onAccept }: { offer: LoanOffer; busy: boolean; onAccept: () => void }) {
  const isBest = offer.is_recommended;
  return (
    <div className={`rounded-xl border p-4 ${isBest ? "border-[#6C63FF] bg-[#f7f6ff]" : "border-gray-200"}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-gray-900">
          ₹ {offer.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </p>
        {offer.is_negotiated && <Pill text={`negotiation round ${offer.negotiation_round}`} variant="info" />}
        {isBest && !offer.is_negotiated && <Pill text="recommended" variant="info" />}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-600 mb-3">
        <div><span className="text-gray-400">Rate</span><br/><b className="text-gray-900">{offer.interest_rate.toFixed(2)}% p.a.</b></div>
        <div><span className="text-gray-400">Tenure</span><br/><b className="text-gray-900">{offer.tenure_months} mo</b></div>
        <div><span className="text-gray-400">EMI</span><br/><b className="text-gray-900">₹ {offer.emi.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</b></div>
      </div>
      <button onClick={onAccept} disabled={busy}
        className="w-full bg-[#6C63FF] hover:bg-[#5a52d6] disabled:opacity-50 text-white font-medium rounded-lg py-2 text-sm">
        {busy ? "…" : "Accept this offer"}
      </button>
    </div>
  );
}

function Pill({ text, variant }: { text: string; variant: "ok" | "bad" | "warn" | "info" }) {
  const colors = {
    ok:   "bg-emerald-100 text-emerald-700",
    bad:  "bg-red-100 text-red-700",
    warn: "bg-amber-100 text-amber-700",
    info: "bg-[#f0f0f8] text-[#6C63FF]",
  }[variant];
  return (
    <span className={`inline-block ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${colors}`}>
      {text}
    </span>
  );
}

function ErrorPill({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 ${className}`}>
      {text}
    </div>
  );
}
