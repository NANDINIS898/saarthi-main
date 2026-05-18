"""
Feature contract for the risk model.

This is the SINGLE source of truth for what features the underwriting model
expects, in what order, with what dtype. The training script reads this list,
the prediction service reads this list, and the underwriting agent assembles
exactly these features from User + LoanApplication + KYCSubmission.

Add a feature → re-train → bump MODEL_VERSION.
"""

from dataclasses import dataclass
from typing import Literal

# Bump when you re-train so we can audit which model produced a decision.
MODEL_VERSION = "saarthi-xgb-v1"


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    description: str
    kind: Literal["numeric", "binary"]
    typical_min: float
    typical_max: float


# Order matters — XGBoost expects features in the same column order it was trained on.
FEATURES: list[FeatureSpec] = [
    FeatureSpec("monthly_income",        "Self-reported gross monthly income (₹)",        "numeric",     8_000,   500_000),
    FeatureSpec("age",                   "Applicant age in years",                          "numeric",        21,        70),
    FeatureSpec("employment_years",      "Years at current employment",                     "numeric",         0,        40),
    FeatureSpec("existing_loans_count",  "Active loans on credit file",                     "numeric",         0,         8),
    FeatureSpec("credit_history_months", "Length of credit history (months)",               "numeric",         0,       360),
    FeatureSpec("previous_defaults",     "Defaults in last 24 months",                      "numeric",         0,         4),
    FeatureSpec("loan_amount",           "Requested principal (₹)",                          "numeric",    20_000, 5_000_000),
    FeatureSpec("loan_tenure_months",    "Requested tenure",                                "numeric",        12,        84),
    FeatureSpec("emi_to_income_ratio",   "Estimated EMI ÷ monthly income (derived)",        "numeric",       0.0,       0.9),
    FeatureSpec("kyc_face_match",        "Face match score 0–1 from KYC pipeline",          "numeric",       0.0,       1.0),
    FeatureSpec("kyc_liveness",          "Liveness score 0–1 from KYC pipeline",            "numeric",       0.0,       1.0),
    FeatureSpec("address_stability_yrs", "Years at current address",                        "numeric",         0,        30),
]

FEATURE_NAMES: list[str] = [f.name for f in FEATURES]


def feature_descriptions() -> dict[str, str]:
    return {f.name: f.description for f in FEATURES}
