import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support
import joblib

class DisputeRiskModel:
    MODEL_TYPE = "DISPUTE"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "job_amount",
        "category_encoded",
        "job_duration_minutes",
        "worker_trust_score",
        "worker_reliability_score",
        "worker_fraud_probability",
        "worker_dispute_history",
        "user_payment_trust_score",
        "user_dispute_history",
        "user_tenure_days",
        "payment_type_encoded",
        "is_high_value",
        "hour_of_day",
        "day_of_week",
    ]

    CATEGORY_ENCODING = {
        "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2,
        "PAINTING": 3, "CARPENTRY": 4, "MOVING": 5,
        "GARDENING": 6, "APPLIANCE_REPAIR": 7, "IT_SUPPORT": 8,
        "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
        "DELIVERY": 12, "OTHER": 13
    }

    def __init__(self, model_path: str = "/models/dispute"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def _preprocess(self, df: pd.DataFrame) -> pd.DataFrame:
        data = df.copy()
        for col in self.FEATURE_COLUMNS:
            if col not in data.columns:
                data[col] = 0.0
        return data[self.FEATURE_COLUMNS]

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = self._preprocess(training_data)
        y = training_data["has_dispute"].astype(int)

        if y.sum() < 5 or (1 - y).sum() < 5:
            raise ValueError(f"Insufficient training data: {y.sum()} positive, {(1 - y).sum()} negative")

        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        params = {
            "objective": "binary",
            "metric": "auc",
            "boosting_type": "gbdt",
            "num_leaves": 31,
            "learning_rate": 0.05,
            "feature_fraction": 0.8,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "seed": 42,
            "scale_pos_weight": max(1, (1 - y).sum() / max(1, y.sum())),
            "min_child_samples": 20,
        }

        self.model = lgb.train(
            params,
            train_data,
            num_boost_round=300,
            valid_sets=[train_data, val_data],
            valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(30), lgb.log_evaluation(0)]
        )

        y_pred = self.model.predict(X_val, num_iteration=self.model.best_iteration)
        auc = roc_auc_score(y_val, y_pred)
        y_pred_binary = (y_pred > 0.5).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(y_val, y_pred_binary, average="binary")

        self.metrics = {
            "auc": float(auc),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
            "positive_rate": float(y.mean()),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_dispute_risk(self, features: Dict) -> float:
        if self.model is None:
            return 0.0
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        prob = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return prob

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.zeros(len(features_list))
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return self.model.predict(X, num_iteration=self.model.best_iteration)

    def get_risk_band(self, risk: float) -> Dict:
        if risk < 0.20:
            return {"level": "LOW", "recommendation": "auto_resolve", "requires_review": False}
        elif risk < 0.40:
            return {"level": "MEDIUM", "recommendation": "suggest_mediation", "requires_review": False}
        elif risk < 0.65:
            return {"level": "HIGH", "recommendation": "require_evidence_review", "requires_review": True}
        else:
            return {"level": "CRITICAL", "recommendation": "manual_review_required", "requires_review": True}

    def get_settlement_suggestion(self, risk: float, job_amount: float) -> Dict:
        if risk >= 0.65:
            hold_percent = 1.0
        elif risk >= 0.40:
            hold_percent = 0.5
        else:
            hold_percent = 0.0
        return {
            "hold_amount": round(job_amount * hold_percent, 2),
            "release_amount": round(job_amount * (1 - hold_percent), 2),
            "hold_percent": hold_percent,
            "risk": risk,
        }

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/dispute_risk_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({
            "model": self.model,
            "version": self.version,
            "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS,
            "is_fitted": self.is_fitted,
        }, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "DisputeRiskModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_dispute_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        d.id as dispute_id,
        d.job_id,
        d.initiator_id,
        d.initiator_role,
        d.reason,
        d.status,
        d.created_at,
        j.price as job_amount,
        j.category,
        j.created_at as job_created_at,
        j.completed_at,
        j.user_id,
        j.worker_id,
        j.payment_method,
        wrs.trust_score as worker_trust_score,
        wrs.reliability_score as worker_reliability_score,
        COALESCE(pts_worker.score, 50) as user_payment_trust_score,
        COALESCE(pts_user.score, 50) as worker_payment_trust_score,
        COALESCE(wd.dispute_count, 0) as worker_dispute_history,
        COALESCE(ud.dispute_count, 0) as user_dispute_history,
        EXTRACT(EPOCH FROM COALESCE(j.completed_at, NOW()) - j.created_at)/60 as job_duration_minutes
    FROM disputes d
    JOIN jobs j ON d.job_id = j.id
    LEFT JOIN worker_reputation_scores wrs ON wrs.worker_id = j.worker_id
    LEFT JOIN payment_trust_scores pts_worker ON pts_worker.subject_id = j.worker_id AND pts_worker.role = 'WORKER'
    LEFT JOIN payment_trust_scores pts_user ON pts_user.subject_id = j.user_id AND pts_user.role = 'USER'
    LEFT JOIN (SELECT j2.worker_id, COUNT(*) as dispute_count FROM disputes d2 JOIN jobs j2 ON d2.job_id = j2.id GROUP BY j2.worker_id) wd ON wd.worker_id = j.worker_id
    LEFT JOIN (SELECT j3.user_id, COUNT(*) as dispute_count FROM disputes d3 JOIN jobs j3 ON d3.job_id = j3.id GROUP BY j3.user_id) ud ON ud.user_id = j.user_id
    WHERE d.created_at >= NOW() - INTERVAL '{days_back} days'
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["has_dispute"] = 1
    return df


def fetch_non_dispute_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        j.id as job_id,
        j.price as job_amount,
        j.category,
        j.created_at as job_created_at,
        j.completed_at,
        j.user_id,
        j.worker_id,
        j.payment_method,
        wrs.trust_score as worker_trust_score,
        wrs.reliability_score as worker_reliability_score,
        COALESCE(pts_worker.score, 50) as user_payment_trust_score,
        COALESCE(pts_user.score, 50) as worker_payment_trust_score,
        COALESCE(wd.dispute_count, 0) as worker_dispute_history,
        COALESCE(ud.dispute_count, 0) as user_dispute_history,
        EXTRACT(EPOCH FROM COALESCE(j.completed_at, NOW()) - j.created_at)/60 as job_duration_minutes
    FROM jobs j
    LEFT JOIN worker_reputation_scores wrs ON wrs.worker_id = j.worker_id
    LEFT JOIN payment_trust_scores pts_worker ON pts_worker.subject_id = j.worker_id AND pts_worker.role = 'WORKER'
    LEFT JOIN payment_trust_scores pts_user ON pts_user.subject_id = j.user_id AND pts_user.role = 'USER'
    LEFT JOIN (SELECT j2.worker_id, COUNT(*) as dispute_count FROM disputes d2 JOIN jobs j2 ON d2.job_id = j2.id GROUP BY j2.worker_id) wd ON wd.worker_id = j.worker_id
    LEFT JOIN (SELECT j3.user_id, COUNT(*) as dispute_count FROM disputes d3 JOIN jobs j3 ON d3.job_id = j3.id GROUP BY j3.user_id) ud ON ud.user_id = j.user_id
    WHERE j.status = 'COMPLETED'
      AND j.created_at >= NOW() - INTERVAL '{days_back} days'
      AND j.id NOT IN (SELECT job_id FROM disputes)
    ORDER BY RANDOM()
    LIMIT 5000
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["has_dispute"] = 0
    return df
