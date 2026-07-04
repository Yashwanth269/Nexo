import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
import joblib


class FatigueMLModel:
    MODEL_TYPE = "FATIGUE"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "jobs_completed_24h", "jobs_completed_7d", "jobs_completed_30d",
        "hours_online_24h", "hours_online_7d",
        "travel_distance_24h_km", "travel_distance_7d_km",
        "stress_events_24h", "stress_events_7d",
        "active_jobs_current", "offer_load_24h",
        "avg_completion_time_minutes", "hour_of_day",
        "rejection_rate_24h", "timeout_rate_24h",
    ]

    def __init__(self, model_path: str = "/models/fatigue"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["fatigue_label"].astype(float)

        X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)

        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        params = {
            "objective": "regression", "metric": "mae", "boosting_type": "gbdt",
            "num_leaves": 31, "learning_rate": 0.05, "feature_fraction": 0.8,
            "bagging_fraction": 0.8, "bagging_freq": 5, "verbose": -1,
            "seed": 42,
        }

        self.model = lgb.train(params, train_data, num_boost_round=200,
            valid_sets=[train_data, val_data], valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(20), lgb.log_evaluation(0)])

        y_pred = self.model.predict(X_val, num_iteration=self.model.best_iteration)
        mae = mean_absolute_error(y_val, y_pred)

        self.metrics = {
            "mae": float(mae),
            "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_fatigue(self, features: Dict) -> float:
        if self.model is None:
            return self._heuristic(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        pred = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return round(max(0, min(1, pred)), 4)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        preds = self.model.predict(X, num_iteration=self.model.best_iteration)
        return np.clip(preds, 0, 1)

    def _heuristic(self, features: Dict) -> float:
        score = 0
        score += min(0.25, features.get("jobs_completed_24h", 0) * 0.05)
        score += min(0.20, features.get("hours_online_24h", 0) / 24 * 0.20)
        score += min(0.15, features.get("travel_distance_24h_km", 0) / 100 * 0.15)
        score += min(0.15, features.get("offer_load_24h", 0) * 0.03)
        score += min(0.20, features.get("active_jobs_current", 0) * 0.08)
        score += min(0.20, features.get("stress_events_24h", 0) * 0.10)
        return round(max(0, min(1, score)), 4)

    def get_fatigue_band(self, score: float) -> str:
        if score >= 0.70: return "CRITICAL"
        if score >= 0.50: return "HIGH"
        if score >= 0.30: return "MODERATE"
        if score >= 0.15: return "LOW"
        return "NONE"

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/fatigue_{self.version}.pkl"
        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "FatigueMLModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_fatigue_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        w.id as worker_id,
        wf.fatigue_24h,
        wf.fatigue_7d,
        wf.fatigue_30d,
        wf.worker_load_score as active_jobs_current,
        (SELECT COUNT(*) FROM jobs j2 WHERE j2.worker_id = w.id AND j2.status = 'COMPLETED' AND j2.completed_at > NOW() - INTERVAL '24 hours') as jobs_completed_24h,
        (SELECT COUNT(*) FROM jobs j2 WHERE j2.worker_id = w.id AND j2.status = 'COMPLETED' AND j2.completed_at > NOW() - INTERVAL '7 days') as jobs_completed_7d,
        (SELECT COUNT(*) FROM jobs j2 WHERE j2.worker_id = w.id AND j2.status = 'COMPLETED' AND j2.completed_at > NOW() - INTERVAL '30 days') as jobs_completed_30d,
        COALESCE((SELECT SUM(route_distance) FROM jobs j2 WHERE j2.worker_id = w.id AND j2.status = 'COMPLETED' AND j2.completed_at > NOW() - INTERVAL '24 hours'), 0) as travel_distance_24h_km,
        COALESCE((SELECT SUM(route_distance) FROM jobs j2 WHERE j2.worker_id = w.id AND j2.status = 'COMPLETED' AND j2.completed_at > NOW() - INTERVAL '7 days'), 0) as travel_distance_7d_km,
        (SELECT COUNT(*) FROM event_logs el WHERE el.worker_id = w.id AND el.event_type IN ('CANCELLATION', 'DISPUTE', 'COMPLAINT', 'NO_SHOW') AND el.created_at > NOW() - INTERVAL '24 hours') as stress_events_24h,
        (SELECT COUNT(*) FROM event_logs el WHERE el.worker_id = w.id AND el.event_type IN ('CANCELLATION', 'DISPUTE', 'COMPLAINT', 'NO_SHOW') AND el.created_at > NOW() - INTERVAL '7 days') as stress_events_7d,
        (SELECT COUNT(*) FROM job_offers jo WHERE jo.worker_id = w.id AND jo.created_at > NOW() - INTERVAL '24 hours') as offer_load_24h,
        CASE WHEN wf.fatigue_24h > 0 THEN wf.fatigue_24h ELSE 0 END as fatigue_label
    FROM workers w
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    WHERE wf.worker_id IS NOT NULL
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in df.columns:
        if col == "worker_id":
            continue
        try:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        except:
            pass
    df["avg_completion_time_minutes"] = 30
    df["hour_of_day"] = datetime.utcnow().hour
    df["rejection_rate_24h"] = 0
    df["timeout_rate_24h"] = 0
    return df
