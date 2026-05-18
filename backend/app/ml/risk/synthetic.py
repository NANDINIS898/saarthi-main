"""
Synthetic loan-default dataset generator.

Why synthetic for v1?
  - The real Home Credit Default Risk Kaggle dataset is ~700MB and 219 features.
  - To prove the pipeline end-to-end we only need realistic signals.
  - Once the demo flow works, swap this for the Kaggle CSV and re-run train.py.

The "true" risk function below is what XGBoost has to learn. Keep it noisy
enough that the model has to generalize.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.ml.risk.features import FEATURE_NAMES


def generate(n_rows: int = 50_000, seed: int = 42) -> tuple[pd.DataFrame, np.ndarray]:
    """Return (X dataframe with FEATURE_NAMES columns, y binary defaults array)."""
    rng = np.random.default_rng(seed)

    # ── Independent features ──────────────────────────────────────────────
    monthly_income       = rng.lognormal(mean=10.7, sigma=0.55, size=n_rows).clip(8_000, 500_000)
    age                  = rng.normal(loc=34, scale=8, size=n_rows).clip(21, 70).astype(int)
    employment_years     = rng.gamma(shape=2.0, scale=2.5, size=n_rows).clip(0, 40).astype(int)
    existing_loans_count = rng.poisson(lam=1.2, size=n_rows).clip(0, 8)
    credit_history_months= rng.normal(loc=60, scale=40, size=n_rows).clip(0, 360).astype(int)
    previous_defaults    = rng.binomial(n=4, p=0.06, size=n_rows)  # mostly 0, sometimes 1-2
    loan_amount          = rng.lognormal(mean=12.5, sigma=0.65, size=n_rows).clip(20_000, 5_000_000)
    loan_tenure_months   = rng.choice([12, 24, 36, 48, 60, 72, 84], size=n_rows,
                                      p=[0.10, 0.18, 0.32, 0.22, 0.10, 0.05, 0.03])
    kyc_face_match       = rng.beta(a=18, b=2, size=n_rows).clip(0.0, 1.0)
    kyc_liveness         = rng.beta(a=8, b=2, size=n_rows).clip(0.0, 1.0)
    address_stability_yrs= rng.gamma(shape=1.5, scale=3.0, size=n_rows).clip(0, 30).astype(int)

    # ── Derived feature ────────────────────────────────────────────────────
    # Rough EMI assuming 12% APR over the requested tenure
    monthly_rate = 0.12 / 12
    emi = loan_amount * monthly_rate * (1 + monthly_rate) ** loan_tenure_months / \
          ((1 + monthly_rate) ** loan_tenure_months - 1)
    emi_to_income_ratio = (emi / monthly_income).clip(0.0, 0.9)

    df = pd.DataFrame({
        "monthly_income":        monthly_income,
        "age":                   age,
        "employment_years":      employment_years,
        "existing_loans_count":  existing_loans_count,
        "credit_history_months": credit_history_months,
        "previous_defaults":     previous_defaults,
        "loan_amount":           loan_amount,
        "loan_tenure_months":    loan_tenure_months,
        "emi_to_income_ratio":   emi_to_income_ratio,
        "kyc_face_match":        kyc_face_match,
        "kyc_liveness":          kyc_liveness,
        "address_stability_yrs": address_stability_yrs,
    })[FEATURE_NAMES]

    # ── "True" default risk function the model must learn ─────────────────
    # Higher score → more likely to default. We pass it through sigmoid + noise.
    risk_logit = (
        -3.0
        + 2.4 * (previous_defaults > 0).astype(float)
        + 1.6 * previous_defaults
        + 4.5 * (emi_to_income_ratio - 0.35).clip(0, None)  # heavily punish > 35% DTI
        - 0.04 * employment_years
        - 0.01 * credit_history_months / 12
        + 0.25 * existing_loans_count
        - 1.5  * (kyc_face_match - 0.7).clip(None, 0)       # only hurts when low
        - 1.0  * (kyc_liveness   - 0.5).clip(None, 0)       # only hurts when low
        - 0.05 * address_stability_yrs
        + rng.normal(0, 0.55, size=n_rows)
    )
    probability_of_default = 1 / (1 + np.exp(-risk_logit))
    y = (rng.random(n_rows) < probability_of_default).astype(int)

    return df, y
