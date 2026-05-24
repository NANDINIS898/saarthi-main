"""
Underwriting Agent.

Pulls features from User + LoanApplication + KYCSubmission + the user's
existing loan portfolio (via `app.agents.exposure`), runs a hard policy
gate (FOIR, total exposure, concurrent-loan count), then runs the XGBoost
risk model. Persists a RiskAssessment + AgentDecision and returns the
verdict.

Why two layers?
  • The policy gate enforces industry-mandated hard rules. The ML model
    cannot override these — e.g. RBI guidance on responsible lending.
  • The ML model handles the soft, score-based decision once the customer
    has cleared the gate. It receives REAL exposure features (existing
    loans count, defaults, credit history) instead of the previous
    hardcoded defaults.
"""

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.agents.emi import calculate, emi_to_income_ratio
from app.agents.exposure import (
    ExposureSnapshot, evaluate_guardrails, snapshot_for,
)
from app.database.models import (
    AgentDecision, KYCSubmission, LoanApplication, RiskAssessment, User,
)
from app.ml.risk.features import FEATURE_NAMES
from app.ml.risk.predict import predict as ml_predict
from app.utils.logger import logger


class UnderwritingAgent:
    @staticmethod
    def assess(db: Session, application: LoanApplication, user: User) -> RiskAssessment:
        """Run policy gate + ML model and persist a fresh RiskAssessment."""
        if not application.loan_amount or not application.monthly_income or not application.tenure_preference_months:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Application is missing loan_amount, monthly_income, or tenure_preference_months.",
            )

        snapshot = snapshot_for(db, user, exclude_application_id=application.id)

        # ── 1. Hard policy gate (FOIR, exposure, concurrency) ───────────────
        loan_math = calculate(
            principal=float(application.loan_amount),
            annual_rate_pct=12.0,
            tenure_months=int(application.tenure_preference_months),
        )
        verdict = evaluate_guardrails(
            snapshot=snapshot,
            monthly_income=float(application.monthly_income),
            new_emi=loan_math.emi,
            new_principal=float(application.loan_amount),
        )

        if not verdict.ok:
            assert verdict.reason is not None
            return UnderwritingAgent._reject_for_policy(
                db, application, user, snapshot, verdict.reason, verdict,
            )

        # ── 2. ML scoring (only if the gate passed) ─────────────────────────
        features = UnderwritingAgent._build_features(
            db, application, user, snapshot, loan_math.emi,
        )

        result = ml_predict(features)
        logger.info(
            f"[Underwriting] app={application.id} score={result['credit_score']} "
            f"decision={result['decision']} model={result['model_version']} "
            f"foir={verdict.foir:.2%} active_loans={snapshot.active_loans_count}"
        )

        assessment = RiskAssessment(
            application_id=application.id,
            risk_score=float(result["credit_score"]),
            decision=result["decision"],
            model_version=result["model_version"],
            shap_values=result["shap_values"],
            features_used={
                **features,
                # Embed the policy-gate context so the UI can show "passed FOIR".
                "policy_foir":             verdict.foir,
                "policy_total_exposure":   verdict.new_total_exposure,
                "policy_exposure_limit":   verdict.exposure_limit,
            },
        )
        db.add(assessment)

        db.add(AgentDecision(
            application_id=application.id,
            agent_name="underwriting",
            decision=result["decision"],
            reasoning=_human_reasoning(result, verdict),
            llm_trace={
                "risk_probability": result["risk_probability"],
                "credit_score":     result["credit_score"],
                "top_drivers":      result["top_drivers"],
                "model_version":    result["model_version"],
                "policy": {
                    "foir":             verdict.foir,
                    "total_exposure":   verdict.new_total_exposure,
                    "exposure_limit":   verdict.exposure_limit,
                    "active_loans":     snapshot.active_loans_count,
                    "existing_emi":     snapshot.total_monthly_emi,
                },
            },
        ))

        application.status = {
            "approve": "offer_pending",
            "review":  "offer_pending",
            "reject":  "rejected",
        }.get(result["decision"], application.status)

        db.commit()
        db.refresh(assessment)
        return assessment

    # ──────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _build_features(
        db: Session,
        app: LoanApplication,
        user: User,
        snapshot: ExposureSnapshot,
        new_emi: float,
    ) -> dict[str, float]:
        """Assemble FEATURE_NAMES dict using REAL exposure data + KYC scores."""
        kyc = (
            db.query(KYCSubmission)
            .filter(KYCSubmission.user_id == user.id)
            .order_by(KYCSubmission.id.desc())
            .first()
        )
        face_match = float(kyc.face_match_score) if kyc and kyc.face_match_score is not None else 0.5
        liveness   = float(kyc.liveness_score)   if kyc and kyc.liveness_score   is not None else 0.5

        # DTI now reflects TOTAL EMI burden (existing + new), not just the new loan.
        # This is the single biggest fix — previously the model saw only the
        # new loan's DTI and had no idea the customer was already stretched.
        total_emi = snapshot.total_monthly_emi + new_emi
        dti = emi_to_income_ratio(total_emi, float(app.monthly_income or 0))

        features = {
            "monthly_income":        float(app.monthly_income or 0),
            "age":                   30.0,          # collected via onboarding later
            "employment_years":      3.0,           # collected via onboarding later
            "loan_amount":           float(app.loan_amount or 0),
            "loan_tenure_months":    float(app.tenure_preference_months or 0),
            "emi_to_income_ratio":   float(dti),
            "kyc_face_match":        face_match,
            "kyc_liveness":          liveness,
            "address_stability_yrs": 4.0,           # collected via onboarding later
            # ── Real exposure-derived features ───────────────────────────────
            **snapshot.to_features(),
        }

        for name in FEATURE_NAMES:
            features.setdefault(name, 0.0)
        return features

    # ──────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _reject_for_policy(
        db: Session,
        application: LoanApplication,
        user: User,
        snapshot: ExposureSnapshot,
        reason: str,
        verdict,
    ) -> RiskAssessment:
        """
        Persist a synthetic 'reject' RiskAssessment with no ML scoring —
        we never asked the model because policy refuses the loan outright.
        """
        logger.info(
            f"[Underwriting] app={application.id} POLICY REJECT — {verdict.breached_rule}: {reason}"
        )
        remediation = _remediation_for(verdict.breached_rule, snapshot, application)

        assessment = RiskAssessment(
            application_id=application.id,
            risk_score=0.0,
            decision="reject",
            model_version="policy-gate-v1",
            shap_values=None,
            features_used={
                "rejected_by_policy":     1.0,
                "policy_breached_rule":   verdict.breached_rule,
                "policy_reason":          reason,
                "policy_remediation":     remediation,
                "policy_foir":            verdict.foir,
                "policy_total_exposure":  verdict.new_total_exposure,
                "policy_exposure_limit":  verdict.exposure_limit,
                "existing_loans_count":   float(snapshot.active_loans_count),
                "existing_monthly_emi":   float(snapshot.total_monthly_emi),
                "monthly_income":         float(application.monthly_income or 0),
                "requested_amount":       float(application.loan_amount or 0),
            },
        )
        db.add(assessment)

        db.add(AgentDecision(
            application_id=application.id,
            agent_name="underwriting",
            decision="reject",
            reasoning=f"Policy gate failed ({verdict.breached_rule}): {reason}",
            llm_trace={
                "breached_rule":   verdict.breached_rule,
                "foir":            verdict.foir,
                "total_exposure":  verdict.new_total_exposure,
                "exposure_limit":  verdict.exposure_limit,
                "active_loans":    snapshot.active_loans_count,
                "existing_emi":    snapshot.total_monthly_emi,
                "user_id":         user.id,
            },
        ))

        application.status = "rejected"
        db.commit()
        db.refresh(assessment)
        return assessment


def _remediation_for(rule: str | None, snapshot: ExposureSnapshot, app: LoanApplication) -> str:
    """
    Plain-language suggestion for what the user can do to become eligible.
    Drives the 'What you can do' section in the explanation card.
    """
    if rule == "concurrency":
        return (
            f"You currently hold {snapshot.active_loans_count} active loans. "
            "Close or fully repay at least one before applying again — our "
            "policy limits concurrent unsecured loans to 3 to protect borrowers "
            "from over-leverage."
        )
    if rule == "exposure":
        income = float(app.monthly_income or 0)
        cap = income * 24
        excess = snapshot.total_outstanding_principal + float(app.loan_amount or 0) - cap
        return (
            f"Your total unsecured exposure with this loan would exceed our "
            f"24× monthly-income cap (₹{cap:,.0f}) by about ₹{max(excess, 0):,.0f}. "
            "Reduce the requested amount, close part of an existing loan, or wait "
            "until one closes. You can also re-apply with a higher declared income "
            "if your income has increased."
        )
    if rule == "foir":
        return (
            f"Your existing EMIs already consume a large share of your declared "
            f"income (₹{snapshot.total_monthly_emi:,.0f}/month). Try a smaller "
            "amount or a longer tenure to bring the new EMI down, or wait until "
            "an existing loan is paid off."
        )
    return "Please contact support — we couldn't auto-determine a remediation."


def _human_reasoning(result: dict[str, Any], verdict) -> str:
    """One-line summary for the audit trail."""
    base = f"Credit score {result['credit_score']} → {result['decision']}"
    base += f" | FOIR {verdict.foir * 100:.1f}% | exposure ₹{verdict.new_total_exposure:,.0f}/{verdict.exposure_limit:,.0f}"
    drivers = result.get("top_drivers", [])
    if drivers:
        parts = [f"{d['feature']}={d['value']:.2f} (Δ {d['contribution']:+.2f})"
                 for d in drivers[:3]]
        base += f". Top drivers: {', '.join(parts)}."
    return base
