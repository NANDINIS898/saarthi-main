import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import type {
  ApplicationSummary, LoanApplication, LoanOffer, NegotiationResponse,
  RiskAssessment, SanctionLetter,
} from "../api/types";
import { useAuth } from "../store/auth";
import { PageShell } from "../components/PageShell";
import { RiskAssessmentCard } from "../components/RiskAssessmentCard";

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
  const params = useParams();
  const resumeId = params.id ? Number(params.id) : null;
  const user = useAuth((s) => s.user);

  const [stage, setStage] = useState<Stage>("apply");
  const [application, setApplication] = useState<LoanApplication | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [offers, setOffers] = useState<LoanOffer[]>([]);
  const [sanction, setSanction] = useState<SanctionLetter | null>(null);
  // Chat entries can carry an inline offer card (when agent counters) and an
  // acceptingHint flag (when the LLM thinks the user just said yes).
  type ChatEntry = {
    from: "user" | "agent";
    text: string;
    offer?: LoanOffer;
    acceptingHint?: boolean;
  };
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);

  const kycOk = user?.kyc_status === "approved";

  // ─── Resume an existing application via /loan/:id ────────────────────────
  useEffect(() => {
    if (resumeId == null) return;
    let cancelled = false;
    (async () => {
      setHydrating(true);
      setError(null);
      try {
        const { data } = await api.get<ApplicationSummary>(`/applications/${resumeId}/summary`);
        if (cancelled) return;
        setApplication(data.application);
        setRisk(data.risk);
        setOffers(data.offers);
        setSanction(data.sanction);
        // Derive stage from what's already on the server.
        if (data.sanction_issued) setStage("sanctioned");
        else if (data.offers_generated) setStage("offers");
        else if (data.underwriting_done) setStage("offers");
        else setStage("underwriting");
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resumeId]);

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
      setChat((c) => [...c, {
        from: "agent",
        text: data.agent_message,
        offer: data.offer,                   // inline card under the message
        acceptingHint: data.user_accepting,  // promote the Accept button
      }]);
      // Also keep the offers list above the chat in sync — pin the latest
      // negotiated offer to the top so the offer cards section reflects it.
      setOffers((prev) => {
        const withoutOld = prev.filter((p) => p.id !== data.offer.id);
        return [data.offer, ...withoutOld];
      });
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
    <PageShell
      title={resumeId ? `Application #${resumeId}` : "New loan application"}
      subtitle="Apply, underwrite, negotiate, sanction"
    >
      <div className="max-w-3xl mx-auto space-y-4">
        {hydrating && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-sm text-gray-500">
            Loading application…
          </div>
        )}
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
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981]" />
            </Field>
            <Field label="Purpose" id="purpose">
              <input id="purpose" required value={form.loan_purpose} onChange={fld("loan_purpose")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981]" />
            </Field>
            <Field label="Monthly income (₹)" id="income">
              <input id="income" type="number" min={8000} required
                value={form.monthly_income} onChange={fld("monthly_income")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981]" />
            </Field>
            <Field label="Tenure" id="tenure">
              <select id="tenure" required value={form.tenure_preference_months} onChange={fld("tenure_preference_months")}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981]">
                {[12, 24, 36, 48, 60, 72, 84].map((m) => <option key={m} value={m}>{m} months</option>)}
              </select>
            </Field>
            {error && <ErrorPill text={error} />}
            <button type="submit" disabled={busy}
              className="w-full bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm">
              {busy ? "Submitting…" : "Submit application"}
            </button>
          </form>
        )}

        {/* 2. Underwriting result */}
        {stage === "underwriting" && !risk && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <div className="inline-block w-10 h-10 border-4 border-[#10b981] border-t-transparent rounded-full animate-spin" />
            <p className="text-base font-medium text-gray-900 mt-3">Running ML underwriting…</p>
            <p className="text-xs text-gray-500 mt-1">XGBoost + SHAP · scoring your application</p>
            {error && <ErrorPill text={error} className="mt-3" />}
          </section>
        )}

        {/* Rejected — show the full explanation card (policy or model). */}
        {stage === "underwriting" && risk && risk.decision === "reject" && (
          <>
            <RiskAssessmentCard risk={risk} />
            <button
              onClick={() => navigate("/applications")}
              className="w-full bg-white border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm hover:bg-gray-50"
            >
              Back to applications
            </button>
            {error && <ErrorPill text={error} />}
          </>
        )}

        {/* 3. Risk assessment → offers → chat */}
        {stage === "offers" && risk && (
          <>
            {/* Risk panel sits ABOVE the offers so the user understands the
                score before seeing what was offered. */}
            <RiskAssessmentCard risk={risk} />

            <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <p className="text-xs font-semibold text-gray-400 tracking-wider uppercase">
                  Personalised offers
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Generated for credit score <b className="text-gray-900">{Math.round(risk.risk_score)}</b>{" "}
                  {risk.decision === "approve" && <span className="text-emerald-700">· approved</span>}
                  {risk.decision === "review"  && <span className="text-amber-700">· under review</span>}
                </p>
              </div>
              <div className="px-5 pb-5 space-y-3">
                {offers.map((o) => (
                  <OfferCard key={o.id} offer={o} busy={busy} onAccept={() => accept(o)} />
                ))}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-2">Negotiate</h2>
              <p className="text-xs text-gray-500 mb-3">
                Ask for a lower EMI, longer tenure, or better rate. The agent stays inside policy.
              </p>
              <div className="space-y-2 max-h-96 overflow-y-auto mb-3">
                {chat.length === 0 && (
                  <p className="text-xs text-gray-400 italic">e.g. "Can you bring the EMI down to ₹10,000?"</p>
                )}
                {chat.map((m, i) => (
                  <div key={i} className={`flex flex-col ${m.from === "user" ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      m.from === "user"
                        ? "bg-[#10b981] text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}>
                      {m.text}
                    </div>
                    {/* Inline offer card attached to the agent message that produced it */}
                    {m.from === "agent" && m.offer && (
                      <InlineOfferCard
                        offer={m.offer}
                        acceptingHint={m.acceptingHint}
                        busy={busy}
                        onAccept={() => m.offer && accept(m.offer)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); sendNegotiation(); }} className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={busy}
                  placeholder="Type your message…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981]"
                />
                <button type="submit" disabled={busy || !chatInput.trim()}
                  className="bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-white font-medium rounded-lg px-4 text-sm">
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
                className="mt-4 inline-block bg-[#10b981] hover:bg-[#059669] text-white font-medium rounded-lg px-4 py-2 text-sm">
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
      </div>
    </PageShell>
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
    <div className={`relative rounded-xl border p-4 transition-shadow ${
      isBest
        ? "border-[#10b981] bg-gradient-to-br from-[#f0fdf4] to-white shadow-sm"
        : "border-gray-200 hover:border-gray-300"
    }`}>
      {isBest && !offer.is_negotiated && (
        <span className="absolute -top-2 left-3 text-[10px] font-bold tracking-wider uppercase bg-[#10b981] text-white px-2 py-0.5 rounded">
          Recommended
        </span>
      )}
      {offer.is_negotiated && (
        <span className="absolute -top-2 left-3 text-[10px] font-bold tracking-wider uppercase bg-emerald-600 text-white px-2 py-0.5 rounded">
          Negotiated · round {offer.negotiation_round}
        </span>
      )}

      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 tracking-wider uppercase">Loan amount</p>
          <p className="text-2xl font-bold text-gray-900 leading-tight">
            ₹ {offer.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-gray-400 tracking-wider uppercase">Monthly EMI</p>
          <p className="text-lg font-bold text-[#10b981] leading-tight">
            ₹ {offer.emi.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs mb-3 pb-3 border-b border-gray-100">
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-gray-400">Interest rate</p>
          <p className="text-gray-900 font-semibold mt-0.5">{offer.interest_rate.toFixed(2)}% p.a.</p>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-gray-400">Tenure</p>
          <p className="text-gray-900 font-semibold mt-0.5">{offer.tenure_months} months</p>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-3">
        <span>Total payable</span>
        <span className="font-medium text-gray-700">
          ₹ {(offer.emi * offer.tenure_months).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </span>
      </div>

      <button onClick={onAccept} disabled={busy}
        className={`w-full font-medium rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 ${
          isBest
            ? "bg-[#10b981] hover:bg-[#059669] text-white"
            : "bg-white border border-[#10b981] text-[#10b981] hover:bg-[#ecfdf5]"
        }`}>
        {busy ? "Processing…" : "Accept this offer"}
      </button>
    </div>
  );
}

function InlineOfferCard({
  offer, acceptingHint, busy, onAccept,
}: {
  offer: LoanOffer;
  acceptingHint?: boolean;
  busy: boolean;
  onAccept: () => void;
}) {
  return (
    <div className={`mt-2 max-w-[85%] rounded-xl border p-3 ${
      acceptingHint ? "border-emerald-400 bg-emerald-50" : "border-[#10b981] bg-[#f0fdf4]"
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm font-semibold text-gray-900">
          ₹ {offer.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </p>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
          offer.is_negotiated
            ? "bg-[#ecfdf5] text-[#10b981]"
            : "bg-gray-100 text-gray-600"
        }`}>
          {offer.is_negotiated ? `round ${offer.negotiation_round}` : "current"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-600 mb-2">
        <div><span className="text-gray-400">Rate</span><br/><b className="text-gray-900">{offer.interest_rate.toFixed(2)}%</b></div>
        <div><span className="text-gray-400">Tenure</span><br/><b className="text-gray-900">{offer.tenure_months} mo</b></div>
        <div><span className="text-gray-400">EMI</span><br/><b className="text-gray-900">₹ {offer.emi.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</b></div>
      </div>
      <button
        onClick={onAccept}
        disabled={busy}
        className={`w-full font-medium rounded-lg py-1.5 text-xs disabled:opacity-50 ${
          acceptingHint
            ? "bg-emerald-500 hover:bg-emerald-600 text-white"
            : "bg-[#10b981] hover:bg-[#059669] text-white"
        }`}
      >
        {busy ? "Processing…" : acceptingHint ? "✓ Confirm acceptance" : "Accept this offer"}
      </button>
    </div>
  );
}

function ErrorPill({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 ${className}`}>
      {text}
    </div>
  );
}
