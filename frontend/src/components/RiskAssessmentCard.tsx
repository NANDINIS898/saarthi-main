import { useState } from "react";
import type { RiskAssessment } from "../api/types";

/**
 * Risk-Assessment Card — the model's verdict on the applicant.
 *
 * Two modes:
 *   • Model decision (XGBoost): credit score gauge + SHAP drivers
 *   • Policy-gate rejection (model_version === "policy-gate-v1"):
 *       a human-readable explanation of which industry rule fired
 *       (FOIR / exposure cap / concurrent-loan limit), the actual
 *       numbers behind it, and a remediation hint.
 *
 * The policy-gate branch is the "Explanation Agent" for hard rejects —
 * the XGBoost model was never asked because policy said no upfront, so
 * showing a SHAP chart would be misleading.
 */
export function RiskAssessmentCard({ risk }: { risk: RiskAssessment }) {
  if (risk.model_version === "policy-gate-v1") {
    return <PolicyRejectionCard risk={risk} />;
  }
  return <MLAssessmentCard risk={risk} />;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Policy-gate rejection — explains WHICH industry rule fired
// ─────────────────────────────────────────────────────────────────────────

function PolicyRejectionCard({ risk }: { risk: RiskAssessment }) {
  const f = (risk.features_used || {}) as Record<string, number | string | null>;
  const breachedRule = (f.policy_breached_rule as string) || "policy";
  const reason       = (f.policy_reason       as string) || "Your application breached one of our lending policies.";
  const remediation  = (f.policy_remediation  as string) || "";
  const foir         = num(f.policy_foir);
  const totalExposure= num(f.policy_total_exposure);
  const exposureLimit= num(f.policy_exposure_limit);
  const existingEmi  = num(f.existing_monthly_emi);
  const existingLoans= num(f.existing_loans_count);
  const monthlyIncome= num(f.monthly_income);

  const ruleMeta = RULE_META[breachedRule] || RULE_META.policy;

  return (
    <section className="bg-white rounded-2xl border border-red-200 overflow-hidden">
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-400 tracking-wider uppercase">
            Underwriting decision
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Policy gate <span className="text-gray-300">·</span> {risk.model_version}
          </p>
        </div>
        <DecisionPill decision="reject" />
      </div>

      {/* Hero rule banner */}
      <div className="mx-5 mb-5 rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
            <BanIcon />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">{ruleMeta.title}</p>
            <p className="text-xs text-red-700 mt-1">{reason}</p>
          </div>
        </div>
      </div>

      {/* Numbers behind the decision */}
      <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        {breachedRule === "foir" && (
          <FoirGauge
            existingEmi={existingEmi}
            newEmi={Math.max(foir * monthlyIncome - existingEmi, 0)}
            income={monthlyIncome}
            foir={foir}
          />
        )}
        {breachedRule === "exposure" && (
          <ExposureGauge total={totalExposure} cap={exposureLimit} />
        )}
        {breachedRule === "concurrency" && (
          <ConcurrencyTile activeLoans={existingLoans} />
        )}

        <FactsTile
          rows={[
            ["Active loans", `${existingLoans.toFixed(0)}`],
            ["Existing EMIs / month", `₹${existingEmi.toLocaleString("en-IN")}`],
            ["Declared income", `₹${monthlyIncome.toLocaleString("en-IN")}`],
            ["Total exposure", `₹${totalExposure.toLocaleString("en-IN")}`],
            ["Exposure cap (24× income)", `₹${exposureLimit.toLocaleString("en-IN")}`],
            ["FOIR (incl. new EMI)", `${(foir * 100).toFixed(1)}%`],
          ]}
        />
      </div>

      {/* Remediation */}
      {remediation && (
        <div className="border-t border-gray-100 px-5 py-4 bg-amber-50/40">
          <p className="text-xs font-semibold text-gray-400 tracking-wider uppercase mb-2">
            What you can do
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">{remediation}</p>
        </div>
      )}

      {/* Why-this-rule-exists explainer */}
      <PolicyExplainer breachedRule={breachedRule} />
    </section>
  );
}

const RULE_META: Record<string, { title: string }> = {
  foir: {
    title: "FOIR (Fixed Obligations to Income Ratio) breached",
  },
  exposure: {
    title: "Total unsecured exposure cap breached",
  },
  concurrency: {
    title: "Concurrent active-loan limit breached",
  },
  policy: {
    title: "Lending policy breached",
  },
};

function FoirGauge({
  existingEmi, newEmi, income, foir,
}: { existingEmi: number; newEmi: number; income: number; foir: number }) {
  const existingPct = income > 0 ? Math.min(100, (existingEmi / income) * 100) : 0;
  const newPct      = income > 0 ? Math.min(100 - existingPct, (newEmi / income) * 100) : 0;
  const overflowPct = Math.max(0, foir * 100 - 100);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500">EMI burden vs income</p>
        <span className={`text-xs font-bold ${foir > 0.5 ? "text-red-700" : "text-emerald-700"}`}>
          {(foir * 100).toFixed(1)}%
        </span>
      </div>
      <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className="absolute left-0 top-0 h-full bg-amber-400" style={{ width: `${existingPct}%` }} />
        <div className="absolute top-0 h-full bg-red-500" style={{ left: `${existingPct}%`, width: `${newPct}%` }} />
        {/* 50% FOIR limit marker */}
        <div className="absolute top-0 h-full w-0.5 bg-gray-900" style={{ left: "50%" }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1.5">
        <span><b className="text-amber-600">█</b> Existing ₹{existingEmi.toLocaleString("en-IN")}</span>
        <span><b className="text-red-600">█</b> New ₹{newEmi.toLocaleString("en-IN")}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        Limit: 50% of ₹{income.toLocaleString("en-IN")} = ₹{(income * 0.5).toLocaleString("en-IN")}.
        {overflowPct > 0 && (
          <span className="text-red-700 font-medium"> Over by {overflowPct.toFixed(1)} percentage points.</span>
        )}
      </p>
    </div>
  );
}

function ExposureGauge({ total, cap }: { total: number; cap: number }) {
  const pct = cap > 0 ? Math.min(150, (total / cap) * 100) : 0;
  const overflowPct = Math.max(0, pct - 100);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500">Total unsecured exposure</p>
        <span className={`text-xs font-bold ${total > cap ? "text-red-700" : "text-emerald-700"}`}>
          {((total / Math.max(cap, 1)) * 100).toFixed(0)}% of cap
        </span>
      </div>
      <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full ${total > cap ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {/* Show overflow segment past 100% */}
        {overflowPct > 0 && (
          <div
            className="absolute top-0 h-full bg-red-700"
            style={{ left: "100%", width: `${Math.min(50, overflowPct)}%`, transform: "translateX(-100%)", opacity: 0.4 }}
          />
        )}
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        ₹{total.toLocaleString("en-IN")} of ₹{cap.toLocaleString("en-IN")} (24× monthly income).
      </p>
    </div>
  );
}

function ConcurrencyTile({ activeLoans }: { activeLoans: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 mb-2">Active loan count</p>
      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-bold text-red-700">{activeLoans.toFixed(0)}</p>
        <p className="text-sm text-gray-500">of 3 max</p>
      </div>
      <div className="flex gap-1 mt-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`flex-1 h-1.5 rounded-full ${i < activeLoans ? "bg-red-500" : "bg-gray-200"}`}
          />
        ))}
        {activeLoans > 3 && Array.from({ length: Math.min(3, activeLoans - 3) }).map((_, i) => (
          <div key={`o${i}`} className="flex-1 h-1.5 rounded-full bg-red-700" />
        ))}
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        Industry norm: max 3 concurrent unsecured loans per customer.
      </p>
    </div>
  );
}

function FactsTile({ rows }: { rows: [string, string][] }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 mb-2.5">Numbers behind the decision</p>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-xs">
            <span className="text-gray-500">{k}</span>
            <span className="font-medium text-gray-900 font-mono">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PolicyExplainer({ breachedRule }: { breachedRule: string }) {
  const [open, setOpen] = useState(false);
  const body = (() => {
    switch (breachedRule) {
      case "foir":
        return (
          <>
            <p>
              <b>FOIR</b> (Fixed Obligations to Income Ratio) caps total EMI commitments
              at <b>50% of monthly income</b> for unsecured personal loans. RBI guidance
              and every major Indian lender (HDFC, ICICI, SBI, Bajaj Finserv) sit in
              the 40–55% band.
            </p>
            <p>
              Why this matters: above 50%, a single missed paycheck or medical
              shock pushes the borrower into default. The rule protects you as
              much as us.
            </p>
          </>
        );
      case "exposure":
        return (
          <>
            <p>
              The <b>24× monthly-income cap</b> limits total unsecured exposure to
              roughly two years of gross income. It prevents debt stacking, where
              several small loans add up to an unrepayable total.
            </p>
            <p>
              Reducing the requested amount, repaying part of an existing loan,
              or letting an existing loan close will free up headroom.
            </p>
          </>
        );
      case "concurrency":
        return (
          <>
            <p>
              We allow at most <b>3 concurrent active unsecured loans</b> per
              customer. Beyond that, the data shows sharply higher default rates
              regardless of credit score — the borrower is over-leveraged.
            </p>
            <p>
              Close or fully repay an active loan, and the policy gate reopens.
            </p>
          </>
        );
      default:
        return <p>A hard policy rule was breached. Contact support for details.</p>;
    }
  })();

  return (
    <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-emerald-700 hover:underline font-medium"
      >
        {open ? "− Hide policy details" : "+ Why does this rule exist?"}
      </button>
      {open && (
        <div className="mt-3 text-xs text-gray-600 space-y-2 leading-relaxed">
          {body}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Standard ML assessment (XGBoost score + SHAP)
// ─────────────────────────────────────────────────────────────────────────

function MLAssessmentCard({ risk }: { risk: RiskAssessment }) {
  const [showHow, setShowHow] = useState(false);

  const score = Math.round(risk.risk_score);
  const band  = riskBand(score);
  const driverEntries = Object.entries(risk.shap_values || {})
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 5);
  const maxAbs = Math.max(0.1, ...driverEntries.map(([, v]) => Math.abs(v)));

  return (
    <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-400 tracking-wider uppercase">
            Underwriting decision
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Powered by XGBoost <span className="text-gray-300">·</span> {risk.model_version}
          </p>
        </div>
        <DecisionPill decision={risk.decision} />
      </div>

      <div className="px-5 pb-5">
        <div className="flex items-baseline gap-3">
          <p className="text-4xl font-bold text-gray-900 leading-none">{score}</p>
          <p className="text-sm text-gray-400">/ 900</p>
          <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${band.bg} ${band.text}`}>
            {band.label}
          </span>
        </div>
        <ScoreGauge score={score} />
      </div>

      {driverEntries.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-5">
          <p className="text-xs font-semibold text-gray-400 tracking-wider uppercase mb-3">
            What drove this score
          </p>
          <div className="space-y-2.5">
            {driverEntries.map(([name, contribution]) => (
              <DriverBar
                key={name}
                name={prettyName(name)}
                contribution={contribution}
                maxAbs={maxAbs}
              />
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3 italic">
            Green = improved your score · Red = hurt your score
          </p>
        </div>
      )}

      <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
        <button
          onClick={() => setShowHow((s) => !s)}
          className="text-xs text-emerald-700 hover:underline font-medium"
        >
          {showHow ? "− Hide calculation" : "+ How is this score calculated?"}
        </button>
        {showHow && (
          <div className="mt-3 text-xs text-gray-600 space-y-2 leading-relaxed">
            <p>
              An <b>XGBoost</b> gradient-boosted tree model trained on 50,000 loan
              applications predicts your probability of default from 12 signals:
              income, age, employment, existing loans, credit history, defaults,
              loan amount, tenure, EMI/income ratio, and KYC scores.
            </p>
            <p>
              The raw probability (e.g. 0.07) is mapped to a credit score:
              <code className="bg-white border border-gray-200 rounded px-1.5 py-0.5 mx-1 font-mono">
                score = 900 − probability × 600
              </code>
              so 900 means certain repay, 300 means certain default.
            </p>
            <p>
              Decision thresholds:{" "}
              <span className="font-medium text-emerald-700">≥ 700 approve</span>{" "}
              ·{" "}
              <span className="font-medium text-amber-700">600–699 review</span>{" "}
              ·{" "}
              <span className="font-medium text-red-700">&lt; 600 reject</span>.
            </p>
            <p>
              The bars above are <b>SHAP values</b>: how much each feature pushed
              your prediction up or down compared to the average applicant.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, ((score - 300) / 600) * 100));
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full overflow-hidden bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-900 shadow"
          style={{ left: `calc(${pct}% - 6px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1.5 font-medium">
        <span>300</span>
        <span>600</span>
        <span>700</span>
        <span>900</span>
      </div>
    </div>
  );
}

function DriverBar({
  name, contribution, maxAbs,
}: { name: string; contribution: number; maxAbs: number }) {
  const isGood = contribution < 0;
  const widthPct = Math.min(100, (Math.abs(contribution) / maxAbs) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-gray-700 font-medium w-44 truncate flex-shrink-0">
        {name}
      </div>
      <div className="flex-1 relative h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full rounded-full ${
            isGood ? "bg-emerald-500" : "bg-red-500"
          }`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <div className={`text-xs font-mono font-semibold w-14 text-right ${
        isGood ? "text-emerald-700" : "text-red-700"
      }`}>
        {contribution > 0 ? "+" : ""}{contribution.toFixed(2)}
      </div>
    </div>
  );
}

function DecisionPill({ decision }: { decision: string }) {
  const styles = {
    approve: "bg-emerald-50 text-emerald-700 border-emerald-200",
    review:  "bg-amber-50 text-amber-700 border-amber-200",
    reject:  "bg-red-50 text-red-700 border-red-200",
  }[decision.toLowerCase()] || "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${styles}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        decision === "approve" ? "bg-emerald-500" :
        decision === "review"  ? "bg-amber-500" :
        decision === "reject"  ? "bg-red-500" : "bg-gray-500"
      }`} />
      {decision.toUpperCase()}
    </span>
  );
}

function BanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function riskBand(score: number): { label: string; bg: string; text: string } {
  if (score >= 800) return { label: "Very low risk",   bg: "bg-emerald-100", text: "text-emerald-700" };
  if (score >= 700) return { label: "Low risk",        bg: "bg-emerald-50",  text: "text-emerald-700" };
  if (score >= 600) return { label: "Medium risk",     bg: "bg-amber-50",    text: "text-amber-700" };
  if (score >= 500) return { label: "High risk",       bg: "bg-orange-50",   text: "text-orange-700" };
  return                    { label: "Very high risk", bg: "bg-red-50",      text: "text-red-700" };
}

function prettyName(snake: string): string {
  return snake
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Emi/i, "EMI")
    .replace(/Kyc/i, "KYC")
    .replace(/Yrs/i, "Years");
}

function num(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}
