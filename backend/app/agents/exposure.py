"""
User exposure snapshot — what does this borrower already owe us?

Used by the Underwriting Agent and the Decision Engine to enforce industry
guardrails:

  • FOIR (Fixed Obligations to Income Ratio)
        FOIR = (sum of all active EMIs + proposed new EMI) / monthly income
        Industry cap for unsecured personal loans: 40 – 50%.
        RBI / HDFC / ICICI / SBI all sit in this band.

  • Total unsecured exposure cap
        max_exposure ≈ 24 × monthly income
        Anything beyond that is over-lending: a single income shock cannot
        be absorbed without default.

  • Concurrent-loan count
        Hard cap of 3 active sanctioned loans per customer. Anything more
        signals credit-churning behavior.

An "active" loan is one whose application is in
{accepted, sanctioned, disbursed} — i.e. a sanction letter has been issued
or is about to be. Rejected / draft / under-review applications do NOT
count toward exposure (no money is on the line yet).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from sqlalchemy.orm import Session

from app.database.models import (
    LoanApplication, LoanOffer, RiskAssessment, User,
)


# Status values that mean "we have committed money to this loan."
ACTIVE_STATUSES: frozenset[str] = frozenset({
    "accepted", "sanctioned", "disbursed",
})

# Industry-standard guardrails
FOIR_LIMIT: float          = 0.50  # 50% — cap for unsecured personal loans
EXPOSURE_MULTIPLE: float   = 24.0  # 24× monthly income
MAX_ACTIVE_LOANS: int      = 3     # concurrent active loans per customer
DEFAULT_FLAG_STATUSES: frozenset[str] = frozenset({"rejected"})


@dataclass(frozen=True)
class ExposureSnapshot:
    active_loans_count: int
    total_outstanding_principal: float   # ₹ — naive: accepted offer amounts summed
    total_monthly_emi: float             # ₹ — sum of EMIs across active loans
    previous_rejections: int             # count of rejected applications (proxy for risk)
    months_since_first_app: int          # proxy for credit history length

    def to_features(self) -> dict[str, float]:
        """The slice that feeds the XGBoost feature vector."""
        return {
            "existing_loans_count":  float(self.active_loans_count),
            "credit_history_months": float(max(self.months_since_first_app, 0)),
            "previous_defaults":     float(self.previous_rejections),
        }


def snapshot_for(db: Session, user: User, exclude_application_id: int | None = None) -> ExposureSnapshot:
    """
    Build the exposure snapshot for `user`.

    `exclude_application_id` is the application currently being underwritten
    — we don't want to double-count its own (not-yet-accepted) offers.
    """
    # All applications for this user, oldest first.
    apps: list[LoanApplication] = (
        db.query(LoanApplication)
        .filter(LoanApplication.user_id == user.id)
        .order_by(LoanApplication.created_at.asc())
        .all()
    )

    active = [
        a for a in apps
        if a.status in ACTIVE_STATUSES and a.id != exclude_application_id
    ]
    rejected = [a for a in apps if a.status in DEFAULT_FLAG_STATUSES]

    # Sum accepted-offer principal + EMI across active loans
    total_principal = 0.0
    total_emi       = 0.0
    if active:
        active_ids = [a.id for a in active]
        accepted_offers: Iterable[LoanOffer] = (
            db.query(LoanOffer)
            .filter(LoanOffer.application_id.in_(active_ids), LoanOffer.accepted.is_(True))
            .all()
        )
        for o in accepted_offers:
            total_principal += float(o.amount or 0)
            total_emi       += float(o.emi    or 0)

    # Months since the user's first application — proxy for credit history.
    months_since_first = 0
    if apps:
        first_created = apps[0].created_at
        if first_created is not None:
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            delta = now - first_created
            months_since_first = max(int(delta.days / 30.4375), 0)

    return ExposureSnapshot(
        active_loans_count=len(active),
        total_outstanding_principal=round(total_principal, 2),
        total_monthly_emi=round(total_emi, 2),
        previous_rejections=len(rejected),
        months_since_first_app=months_since_first,
    )


# ─── Guardrail evaluation ────────────────────────────────────────────────────

@dataclass(frozen=True)
class GuardrailVerdict:
    """Result of running the hard policy gate before the ML model."""
    ok: bool
    reason: str | None            # human-readable, used for the rejection message
    breached_rule: str | None     # one of: foir / exposure / concurrency
    foir: float                   # computed FOIR including the proposed EMI
    new_total_exposure: float     # principal sum after this loan
    exposure_limit: float         # 24× income


def evaluate_guardrails(
    snapshot: ExposureSnapshot,
    monthly_income: float,
    new_emi: float,
    new_principal: float,
) -> GuardrailVerdict:
    """
    Run FOIR + exposure cap + concurrency cap. The first rule that fails
    determines the rejection reason.

    NB: we return a verdict object instead of raising — the caller decides
    whether to hard-reject (Underwriting) or just downsize the offer
    (Decision Engine).
    """
    income = max(float(monthly_income), 1.0)  # avoid div-by-zero
    foir = (snapshot.total_monthly_emi + new_emi) / income
    exposure_limit = income * EXPOSURE_MULTIPLE
    new_total_exposure = snapshot.total_outstanding_principal + new_principal

    if snapshot.active_loans_count >= MAX_ACTIVE_LOANS:
        return GuardrailVerdict(
            ok=False,
            reason=(
                f"Customer already holds {snapshot.active_loans_count} active loans; "
                f"our policy limits concurrent unsecured loans to {MAX_ACTIVE_LOANS}."
            ),
            breached_rule="concurrency",
            foir=round(foir, 4),
            new_total_exposure=round(new_total_exposure, 2),
            exposure_limit=round(exposure_limit, 2),
        )

    if new_total_exposure > exposure_limit:
        return GuardrailVerdict(
            ok=False,
            reason=(
                f"This loan would push total unsecured exposure to "
                f"₹{new_total_exposure:,.0f}, above the "
                f"₹{exposure_limit:,.0f} cap (24× monthly income)."
            ),
            breached_rule="exposure",
            foir=round(foir, 4),
            new_total_exposure=round(new_total_exposure, 2),
            exposure_limit=round(exposure_limit, 2),
        )

    if foir > FOIR_LIMIT:
        return GuardrailVerdict(
            ok=False,
            reason=(
                f"Total EMI burden would reach {foir * 100:.1f}% of income "
                f"(₹{snapshot.total_monthly_emi:,.0f} existing + "
                f"₹{new_emi:,.0f} new vs ₹{income:,.0f} income), "
                f"above our {FOIR_LIMIT * 100:.0f}% FOIR cap."
            ),
            breached_rule="foir",
            foir=round(foir, 4),
            new_total_exposure=round(new_total_exposure, 2),
            exposure_limit=round(exposure_limit, 2),
        )

    return GuardrailVerdict(
        ok=True,
        reason=None,
        breached_rule=None,
        foir=round(foir, 4),
        new_total_exposure=round(new_total_exposure, 2),
        exposure_limit=round(exposure_limit, 2),
    )


def max_safe_principal(
    snapshot: ExposureSnapshot,
    monthly_income: float,
    annual_rate_pct: float,
    tenure_months: int,
) -> float:
    """
    Reverse the FOIR equation to find the largest principal we can lend
    such that (existing EMI + new EMI) / income <= FOIR_LIMIT, and that
    total principal stays inside the 24× exposure cap.

    Returns ₹0 if the borrower has no headroom at all.
    """
    income = max(float(monthly_income), 1.0)
    headroom_emi = max(income * FOIR_LIMIT - snapshot.total_monthly_emi, 0.0)
    if headroom_emi <= 0:
        return 0.0

    # Invert the EMI formula:
    #     EMI = P * r * (1+r)^n / ((1+r)^n - 1)
    # =>  P   = EMI * ((1+r)^n - 1) / (r * (1+r)^n)
    if annual_rate_pct <= 0 or tenure_months <= 0:
        return 0.0
    r = annual_rate_pct / 12.0 / 100.0
    growth = (1 + r) ** tenure_months
    principal_from_emi = headroom_emi * (growth - 1) / (r * growth)

    headroom_principal = max(
        income * EXPOSURE_MULTIPLE - snapshot.total_outstanding_principal,
        0.0,
    )

    return round(min(principal_from_emi, headroom_principal), 2)


__all__ = [
    "ACTIVE_STATUSES",
    "FOIR_LIMIT",
    "EXPOSURE_MULTIPLE",
    "MAX_ACTIVE_LOANS",
    "ExposureSnapshot",
    "GuardrailVerdict",
    "snapshot_for",
    "evaluate_guardrails",
    "max_safe_principal",
]


# Silence unused-import warning for RiskAssessment (kept for future explainability features).
_ = RiskAssessment
