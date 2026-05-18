"""
Underwriting Agent.

Pulls features from the User + LoanApplication + KYCSubmission rows, runs the
XGBoost risk model, persists a RiskAssessment + AgentDecision, and returns
the verdict.

The ML model returns: probability, credit_score (300-900), decision,
SHAP feature contributions, and top 5 drivers.
"""

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.agents.emi import calculate, emi_to_income_ratio
from app.database.models import (
    AgentDecision, KYCSubmission, LoanApplication, RiskAssessment, User,
)
from app.ml.risk.features import FEATURE_NAMES
from app.ml.risk.predict import predict as ml_predict
from app.utils.logger import logger


class UnderwritingAgent:
    @staticmethod
    def assess(db: Session, application: LoanApplication, user: User) -> RiskAssessment:
        """Run the model and persist a fresh RiskAssessment for this application."""
        features = UnderwritingAgent._build_features(db, application, user)

        result = ml_predict(features)
        logger.info(
            f"[Underwriting] app={application.id} score={result['credit_score']} "
            f"decision={result['decision']} model={result['model_version']}"
        )

        assessment = RiskAssessment(
            application_id=application.id,
            risk_score=float(result["credit_score"]),
            decision=result["decision"],
            model_version=result["model_version"],
            shap_values=result["shap_values"],
            features_used=features,
        )
        db.add(assessment)

        db.add(AgentDecision(
            application_id=application.id,
            agent_name="underwriting",
            decision=result["decision"],
            reasoning=_human_reasoning(result),
            llm_trace={
                "risk_probability": result["risk_probability"],
                "credit_score": result["credit_score"],
                "top_drivers": result["top_drivers"],
                "model_version": result["model_version"],
            },
        ))

        # Move the application lifecycle forward
        application.status = {
            "approve": "offer_pending",
            "review":  "offer_pending",
            "reject":  "rejected",
        }.get(result["decision"], application.status)

        db.commit()
        db.refresh(assessment)
        return assessment

    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _build_features(db: Session, app: LoanApplication, user: User) -> dict[str, float]:
        """Assemble the FEATURE_NAMES dict from DB rows + sensible defaults."""
        if not app.loan_amount or not app.monthly_income or not app.tenure_preference_months:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Application is missing loan_amount, monthly_income, or tenure_preference_months.",
            )

        kyc = (
            db.query(KYCSubmission)
            .filter(KYCSubmission.user_id == user.id)
            .order_by(KYCSubmission.id.desc())
            .first()
        )
        face_match = float(kyc.face_match_score) if kyc and kyc.face_match_score is not None else 0.5
        liveness   = float(kyc.liveness_score)   if kyc and kyc.liveness_score   is not None else 0.5

        loan_math = calculate(
            principal=app.loan_amount,
            annual_rate_pct=12.0,            # assumption used at underwriting time
            tenure_months=app.tenure_preference_months,
        )
        dti = emi_to_income_ratio(loan_math.emi, app.monthly_income)

        # Defaults — these get replaced as we collect them from the user via
        # additional onboarding questions (phase 4.5 / 5).
        features = {
            "monthly_income":        float(app.monthly_income),
            "age":                   30.0,
            "employment_years":      3.0,
            "existing_loans_count":  1.0,
            "credit_history_months": 36.0,
            "previous_defaults":     0.0,
            "loan_amount":           float(app.loan_amount),
            "loan_tenure_months":    float(app.tenure_preference_months),
            "emi_to_income_ratio":   float(dti),
            "kyc_face_match":        face_match,
            "kyc_liveness":          liveness,
            "address_stability_yrs": 4.0,
        }

        # Final sanity — every expected feature is present.
        for name in FEATURE_NAMES:
            features.setdefault(name, 0.0)
        return features


def _human_reasoning(result: dict[str, Any]) -> str:
    """One-line summary of the model's decision for the audit trail."""
    drivers = result.get("top_drivers", [])
    if drivers:
        parts = [f"{d['feature']}={d['value']:.2f} (Δ {d['contribution']:+.2f})"
                 for d in drivers[:3]]
        return (
            f"Credit score {result['credit_score']} → {result['decision']}. "
            f"Top drivers: {', '.join(parts)}."
        )
    return f"Credit score {result['credit_score']} → {result['decision']}."
