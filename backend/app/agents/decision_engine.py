"""
Decision Intelligence Engine , the main orchestrator.

Responsibilities:
  1. Generate 3 personalized loan offers from a credit score using risk-tiered pricing.
  2. Provide hard business constraints (min/max rate, max tenure) the
     Negotiation Agent must respect.
  3. Accept an offer → drive sanction letter generation.
  4. Reject path (already handled by the Underwriting Agent).

The 3 offer variants follow the mockup (S4):
  - "best"   — recommended balance of EMI + tenure
  - "lower_emi"   — longer tenure, slightly higher rate
  - "quick_payoff" — shorter tenure, slightly lower rate
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.agents.emi import calculate, emi_to_income_ratio
from app.agents.exposure import max_safe_principal, snapshot_for
from app.database.models import (
    AgentDecision, LoanApplication, LoanOffer, RiskAssessment, User,
)
from app.utils.logger import logger


# ─── Risk tiers + pricing policy ──────────────────────────────────────────────
@dataclass(frozen=True)
class Tier:
    name: str                    # "premium" / "standard" / "subprime" / "risky"
    min_score: int
    base_rate: float             # %, applied to the "best" variant
    rate_floor: float            # %, hard floor negotiation cannot cross
    rate_ceiling: float          # %, hard ceiling
    amount_factor: float         # what fraction of the asked amount we'll offer
    max_tenure: int              # months
    max_dti: float               # EMI / income — anything beyond is unsafe


TIERS: list[Tier] = [
    Tier("premium",  800, 10.50, 10.00, 14.00, amount_factor=1.00, max_tenure=72, max_dti=0.50),
    Tier("standard", 700, 12.00, 11.00, 16.00, amount_factor=0.95, max_tenure=60, max_dti=0.45),
    Tier("subprime", 600, 14.50, 13.50, 18.50, amount_factor=0.75, max_tenure=48, max_dti=0.40),
    Tier("risky",    500, 17.00, 16.00, 22.00, amount_factor=0.50, max_tenure=24, max_dti=0.35),
]


def tier_for_score(score: float) -> Tier | None:
    """Return the highest tier whose threshold the score meets, or None if rejected."""
    for t in TIERS:
        if score >= t.min_score:
            return t
    return None


class DecisionEngine:
    # ──────────────────────────────────────────────────────────────────────
    @staticmethod
    def generate_offers(db: Session, application: LoanApplication, user: User) -> list[LoanOffer]:
        """Produce 3 offers for this application based on its latest RiskAssessment."""
        assessment = _latest_assessment(db, application.id)
        tier = tier_for_score(assessment.risk_score)
        if tier is None or assessment.decision == "reject":
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Cannot generate offers — risk score {assessment.risk_score:.0f} is below approval threshold.",
            )

        # Wipe any prior offers that weren't accepted, so we have a clean shelf
        db.query(LoanOffer).filter(
            LoanOffer.application_id == application.id,
            LoanOffer.accepted.is_(False),
        ).delete(synchronize_session=False)

        asked_amount = float(application.loan_amount or 0)
        income       = float(application.monthly_income or 0)
        asked_tenure = int(application.tenure_preference_months or 36)

        # Tier-based ceiling — how much we'd offer ignoring existing debt.
        tier_ceiling = round(asked_amount * tier.amount_factor, -2)

        # Headroom ceiling — the largest principal that keeps FOIR ≤ 50% and
        # exposure ≤ 24× income, given the borrower's existing EMI burden.
        # Without this, a customer at 4 active loans could still be offered
        # the full tier amount — overlending.
        snapshot = snapshot_for(db, user, exclude_application_id=application.id)
        headroom_ceiling = max_safe_principal(
            snapshot=snapshot,
            monthly_income=income,
            annual_rate_pct=tier.base_rate,
            tenure_months=min(max(24, asked_tenure), tier.max_tenure),
        )

        offered_amount = round(min(tier_ceiling, headroom_ceiling), -2)
        if offered_amount <= 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "No safe lending headroom — existing EMIs already consume the "
                "FOIR budget or exposure cap. Close an existing loan first.",
            )

        variants = _variants(tier, asked_tenure)
        rows: list[LoanOffer] = []
        for v in variants:
            m = calculate(offered_amount, v["rate"], v["tenure"])
            rows.append(LoanOffer(
                application_id=application.id,
                amount=m.principal,
                interest_rate=m.annual_rate_pct,
                tenure_months=m.tenure_months,
                emi=m.emi,
                is_recommended=(v["label"] == "best"),
                is_negotiated=False,
                negotiation_round=0,
                accepted=False,
            ))

        db.add_all(rows)
        binding = "headroom" if headroom_ceiling < tier_ceiling else "tier"
        db.add(AgentDecision(
            application_id=application.id,
            agent_name="decision_engine",
            decision="offers_generated",
            reasoning=(
                f"Tier '{tier.name}' at score {assessment.risk_score:.0f}. "
                f"Tier ceiling ₹{tier_ceiling:,.0f}, headroom ceiling "
                f"₹{headroom_ceiling:,.0f} → offered ₹{offered_amount:,.0f} "
                f"({binding}-bound)."
            ),
            llm_trace={
                "tier": tier.name,
                "offered_amount": offered_amount,
                "tier_ceiling": tier_ceiling,
                "headroom_ceiling": headroom_ceiling,
                "binding_constraint": binding,
                "asked_amount": asked_amount,
                "asked_tenure": asked_tenure,
                "monthly_income": income,
                "max_dti": tier.max_dti,
                "existing_emi": snapshot.total_monthly_emi,
                "existing_loans": snapshot.active_loans_count,
            },
        ))
        application.status = "offer_pending"
        db.commit()

        for r in rows:
            db.refresh(r)
        logger.info(f"[Decision] app={application.id} → {len(rows)} offers")
        return rows

    # ──────────────────────────────────────────────────────────────────────
    @staticmethod
    def get_offers(db: Session, application_id: int) -> list[LoanOffer]:
        return (
            db.query(LoanOffer)
            .filter(LoanOffer.application_id == application_id)
            .order_by(LoanOffer.id.asc())
            .all()
        )

    # ──────────────────────────────────────────────────────────────────────
    @staticmethod
    def accept_offer(db: Session, application: LoanApplication, offer_id: int) -> LoanOffer:
        """Mark an offer accepted, unaccept all sibling offers, advance lifecycle."""
        offer = (
            db.query(LoanOffer)
            .filter(LoanOffer.id == offer_id, LoanOffer.application_id == application.id)
            .first()
        )
        if not offer:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Offer not found.")

        # Toggle accepted flag — only one wins
        db.query(LoanOffer).filter(LoanOffer.application_id == application.id).update(
            {"accepted": False}, synchronize_session=False
        )
        offer.accepted = True
        application.status = "accepted"

        db.add(AgentDecision(
            application_id=application.id,
            agent_name="decision_engine",
            decision="offer_accepted",
            reasoning=f"Offer #{offer.id} accepted by user.",
            llm_trace={"offer_id": offer.id, "amount": offer.amount,
                       "rate": offer.interest_rate, "tenure": offer.tenure_months,
                       "emi": offer.emi},
        ))
        db.commit()
        db.refresh(offer)
        return offer

    # ──────────────────────────────────────────────────────────────────────
    @staticmethod
    def constraints(db: Session, application: LoanApplication) -> dict:
        """The Negotiation Agent calls this to learn the hard bounds it must obey."""
        assessment = _latest_assessment(db, application.id)
        tier = tier_for_score(assessment.risk_score)
        if tier is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "No valid tier for this application.")
        return {
            "tier":              tier.name,
            "credit_score":      assessment.risk_score,
            "rate_floor":        tier.rate_floor,
            "rate_ceiling":      tier.rate_ceiling,
            "max_tenure_months": tier.max_tenure,
            "max_dti":           tier.max_dti,
            "asked_amount":      float(application.loan_amount or 0),
            "monthly_income":    float(application.monthly_income or 0),
            "amount_factor":     tier.amount_factor,
        }


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _latest_assessment(db: Session, application_id: int) -> RiskAssessment:
    row = (
        db.query(RiskAssessment)
        .filter(RiskAssessment.application_id == application_id)
        .order_by(RiskAssessment.id.desc())
        .first()
    )
    if not row:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No risk assessment yet — run /applications/{id}/underwrite first.",
        )
    return row


def _variants(tier: Tier, asked_tenure: int) -> Iterable[dict]:
    """3 offer variants for the chosen tier."""
    # Use the user's asked tenure as the "best" anchor, clamped to tier max.
    best_tenure = min(max(24, asked_tenure), tier.max_tenure)
    longer = min(best_tenure + 12, tier.max_tenure)
    shorter = max(best_tenure - 12, 12)
    return [
        {"label": "best",          "rate": tier.base_rate,        "tenure": best_tenure},
        {"label": "lower_emi",     "rate": tier.base_rate + 0.5,  "tenure": longer},
        {"label": "quick_payoff",  "rate": tier.base_rate - 0.25, "tenure": shorter},
    ]
