"""
EMI calculator — used by the Decision Engine and Negotiation Agent as a tool.

Formula:
    EMI = P * r * (1+r)^n / ((1+r)^n - 1)
where
    P = principal in ₹
    r = monthly interest rate (annual / 12 / 100)
    n = tenure in months
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LoanMath:
    principal: float
    annual_rate_pct: float
    tenure_months: int
    emi: float
    total_payment: float
    total_interest: float


def calculate(principal: float, annual_rate_pct: float, tenure_months: int) -> LoanMath:
    if principal <= 0 or annual_rate_pct < 0 or tenure_months <= 0:
        raise ValueError("principal > 0, rate >= 0, tenure > 0 required")

    if annual_rate_pct == 0:
        emi = principal / tenure_months
    else:
        r = annual_rate_pct / 12 / 100
        emi = principal * r * (1 + r) ** tenure_months / ((1 + r) ** tenure_months - 1)

    total = emi * tenure_months
    return LoanMath(
        principal=round(principal, 2),
        annual_rate_pct=round(annual_rate_pct, 3),
        tenure_months=tenure_months,
        emi=round(emi, 2),
        total_payment=round(total, 2),
        total_interest=round(total - principal, 2),
    )


def emi_to_income_ratio(emi: float, monthly_income: float) -> float:
    """Return DTI for a single proposed offer. 0 if income is non-positive."""
    if monthly_income <= 0:
        return 0.0
    return round(emi / monthly_income, 4)
