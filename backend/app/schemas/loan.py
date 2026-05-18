"""
Pydantic schemas for the loan application lifecycle.

Endpoints under /applications and /applications/{id}/* speak these shapes.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ─── Inbound ───────────────────────────────────────────────────────────────────
class LoanApplicationCreate(BaseModel):
    loan_amount: float = Field(..., ge=20_000, le=5_000_000)
    loan_purpose: str = Field(..., min_length=3, max_length=100)
    monthly_income: float = Field(..., ge=8_000, le=5_000_000)
    tenure_preference_months: int = Field(..., ge=6, le=84)


class NegotiationRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


# ─── Outbound ──────────────────────────────────────────────────────────────────
class LoanOfferOut(BaseModel):
    id: int
    application_id: int
    amount: float
    interest_rate: float
    tenure_months: int
    emi: float
    is_recommended: bool
    is_negotiated: bool
    negotiation_round: int
    accepted: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class RiskAssessmentOut(BaseModel):
    id: int
    application_id: int
    risk_score: float
    decision: str
    model_version: str
    shap_values: Optional[dict[str, float]] = None
    features_used: Optional[dict[str, float]] = None
    created_at: datetime

    # "model_version" collides with Pydantic's protected `model_` namespace.
    model_config = {"from_attributes": True, "protected_namespaces": ()}


class LoanApplicationOut(BaseModel):
    id: int
    user_id: int
    loan_amount: Optional[float] = None
    loan_purpose: Optional[str] = None
    monthly_income: Optional[float] = None
    tenure_preference_months: Optional[int] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SanctionLetterOut(BaseModel):
    id: int
    application_id: int
    ref_no: str
    pdf_url: Optional[str] = None
    signed_url: Optional[str] = None     # populated by the route for convenience
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class NegotiationResponse(BaseModel):
    offer: LoanOfferOut
    agent_message: str
    concession: str
    round: int
    dti: float
