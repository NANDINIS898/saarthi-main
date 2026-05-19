import { useState } from "react";
import type { RiskAssessment } from "../api/types";

/**
 * Risk-Assessment Card — the model's verdict on the applicant, shown BEFORE
 * the loan offers so the user understands *why* they got what they got.
 *
 * Visuals:
 *   - Big credit score (300–900) with a horizontal gauge and risk-band marker
 *   - Decision pill (Approve / Review / Reject)
 *   - Top 5 SHAP drivers as horizontal bars (green = lowered risk, red = raised it)
 *   - "How is this calculated?" expander
 */
export function RiskAssessmentCard({ risk }: { risk: RiskAssessment }) {
  const [showHow, setShowHow] = useState(false);

  const score = Math.round(risk.risk_score);
  const band  = riskBand(score);
  const driverEntries = Object.entries(risk.shap_values || {})
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 5);
  const maxAbs = Math.max(0.1, ...driverEntries.map(([, v]) => Math.abs(v)));

  return (
    <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      {/* Header */}
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

      {/* Score + gauge */}
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

      {/* SHAP drivers */}
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

      {/* Explainer */}
      <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
        <button
          onClick={() => setShowHow((s) => !s)}
          className="text-xs text-[#6C63FF] hover:underline font-medium"
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

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  // Map 300..900 to 0..100% of the bar
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
  // Negative contribution => model LOWERED risk (good for the applicant).
  // We want the visual to feel positive (green) when risk goes down.
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

// ─────────────────────────────────────────────────────────────────────────────
function riskBand(score: number): { label: string; bg: string; text: string } {
  if (score >= 800) return { label: "Very low risk",  bg: "bg-emerald-100", text: "text-emerald-700" };
  if (score >= 700) return { label: "Low risk",       bg: "bg-emerald-50",  text: "text-emerald-700" };
  if (score >= 600) return { label: "Medium risk",    bg: "bg-amber-50",    text: "text-amber-700" };
  if (score >= 500) return { label: "High risk",      bg: "bg-orange-50",   text: "text-orange-700" };
  return                    { label: "Very high risk",bg: "bg-red-50",      text: "text-red-700" };
}

function prettyName(snake: string): string {
  return snake
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Emi/i, "EMI")
    .replace(/Kyc/i, "KYC")
    .replace(/Yrs/i, "Years");
}
