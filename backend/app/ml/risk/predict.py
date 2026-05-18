"""
Risk model inference + SHAP explainability.

Lazy-loads the trained model on first use (the file is small, ~400KB).
Thread-safe enough for our single-process FastAPI setup.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import shap
import xgboost as xgb

from app.ml.risk.features import FEATURE_NAMES
from app.utils.logger import logger

ARTIFACTS = Path(__file__).parent / "artifacts"
MODEL_PATH = ARTIFACTS / "model.json"
META_PATH = ARTIFACTS / "feature_columns.json"

# Score scale: we expose 300–900 (CIBIL-like) so the UI doesn't have to convert.
SCORE_MIN, SCORE_MAX = 300, 900


class _ModelHolder:
    """Singleton wrapper so we load the model + SHAP explainer exactly once."""
    _lock = threading.Lock()
    _booster: xgb.XGBClassifier | None = None
    _explainer: shap.TreeExplainer | None = None
    _meta: dict[str, Any] = {}

    @classmethod
    def get(cls) -> tuple[xgb.XGBClassifier, shap.TreeExplainer, dict[str, Any]]:
        if cls._booster is None:
            with cls._lock:
                if cls._booster is None:
                    if not MODEL_PATH.exists():
                        raise FileNotFoundError(
                            f"Risk model not found at {MODEL_PATH}. "
                            f"Run:  python -m app.ml.risk.train"
                        )
                    booster = xgb.XGBClassifier()
                    booster.load_model(str(MODEL_PATH))
                    cls._booster = booster
                    cls._explainer = shap.TreeExplainer(booster)
                    cls._meta = json.loads(META_PATH.read_text())
                    logger.info(
                        f"Loaded risk model {cls._meta.get('model_version')} "
                        f"(AUC {cls._meta.get('test_auc')})"
                    )
        assert cls._booster is not None and cls._explainer is not None
        return cls._booster, cls._explainer, cls._meta


def predict(features: dict[str, float]) -> dict[str, Any]:
    """
    Run a single underwriting prediction.

    Args:
        features: dict keyed by FEATURE_NAMES.

    Returns:
        {
          "risk_probability": 0.0–1.0,
          "credit_score": 300–900,
          "decision": "approve" / "review" / "reject",
          "model_version": "...",
          "shap_values": {feature_name: contribution_to_logit},
          "top_drivers": [{"feature": ..., "value": ..., "contribution": ...}, ...]
        }
    """
    missing = [c for c in FEATURE_NAMES if c not in features]
    if missing:
        raise ValueError(f"Missing features: {missing}")

    booster, explainer, meta = _ModelHolder.get()
    row = pd.DataFrame([{c: features[c] for c in FEATURE_NAMES}], columns=FEATURE_NAMES)
    proba = float(booster.predict_proba(row)[0, 1])

    # 0.0 (safe) → 900, 1.0 (will default) → 300
    score = int(round(SCORE_MAX - proba * (SCORE_MAX - SCORE_MIN)))

    # SHAP values for the single row, ordered the same as FEATURE_NAMES.
    shap_arr = np.asarray(explainer.shap_values(row))
    # TreeExplainer for binary classifier returns shape (1, n_features)
    if shap_arr.ndim == 2 and shap_arr.shape[0] == 1:
        shap_row = shap_arr[0]
    elif shap_arr.ndim == 3:  # rare: (classes, rows, features)
        shap_row = shap_arr[1, 0] if shap_arr.shape[0] >= 2 else shap_arr[0, 0]
    else:
        shap_row = shap_arr.flatten()[:len(FEATURE_NAMES)]

    shap_values = {name: float(v) for name, v in zip(FEATURE_NAMES, shap_row)}

    # Top drivers ranked by absolute SHAP contribution
    top_drivers = sorted(
        ({"feature": n, "value": float(features[n]), "contribution": float(v)}
         for n, v in shap_values.items()),
        key=lambda d: abs(d["contribution"]),
        reverse=True,
    )[:5]

    decision = _decide(score)

    return {
        "risk_probability": proba,
        "credit_score": score,
        "decision": decision,
        "model_version": meta.get("model_version", "unknown"),
        "shap_values": shap_values,
        "top_drivers": top_drivers,
    }


def _decide(score: int) -> str:
    if score >= 700:
        return "approve"
    if score >= 600:
        return "review"
    return "reject"
