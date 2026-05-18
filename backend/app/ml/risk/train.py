"""
Train + save the underwriting XGBoost model.

Run:
    cd backend
    python -m app.ml.risk.train

Outputs (next to this file, in app/ml/risk/artifacts/):
    model.json              # XGBoost native format — load with bst.load_model(...)
    feature_columns.json    # ordered list of feature names + the model_version
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from app.ml.risk.features import FEATURE_NAMES, MODEL_VERSION
from app.ml.risk.synthetic import generate

ARTIFACTS = Path(__file__).parent / "artifacts"
MODEL_PATH = ARTIFACTS / "model.json"
META_PATH = ARTIFACTS / "feature_columns.json"


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    print(f"Generating synthetic dataset…")
    X, y = generate(n_rows=50_000)
    print(f"  rows: {len(X):,}   default rate: {y.mean():.1%}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    print(f"Training XGBoost ({MODEL_VERSION})…")
    t0 = time.time()
    model = xgb.XGBClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_lambda=1.0,
        eval_metric="auc",
        tree_method="hist",
        random_state=42,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
    elapsed = time.time() - t0

    proba_test = model.predict_proba(X_test)[:, 1]
    auc = roc_auc_score(y_test, proba_test)
    print(f"  done in {elapsed:.1f}s   test AUC: {auc:.3f}")

    model.save_model(str(MODEL_PATH))
    META_PATH.write_text(json.dumps({
        "feature_columns": FEATURE_NAMES,
        "model_version": MODEL_VERSION,
        "trained_on": "synthetic_v1",
        "test_auc": round(float(auc), 4),
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
    }, indent=2))

    print(f"Wrote: {MODEL_PATH}")
    print(f"Wrote: {META_PATH}")


if __name__ == "__main__":
    main()
