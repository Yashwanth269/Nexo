import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support
import joblib

class NoShowModel:
    MODEL_TYPE = "NO_SHOW"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "past_no_shows", "cancellation_rate", "avg_response_delay_seconds",
        "arrival_history_score", "trust_score", "reliability_score",
        "distance_km", "hour_of_day", "is_weekend", "category_encoded",
    ]

    def __init__(self, model_path: str = "/models/no_show"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}

    def predict_no_show_probability(self, features: Dict, subject_type: str = "WORKER") -> float:
        if self.model is None:
            return self._heuristic(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        prob = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return round(prob, 4)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return self.model.predict(X, num_iteration=self.model.best_iteration)

    def _heuristic(self, features: Dict) -> float:
        base = 0.05
        base += features.get("past_no_shows", 0) * 0.15
        base += features.get("cancellation_rate", 0) / 100 * 0.2
        delay = features.get("avg_response_delay_seconds", 0)
        base += min(0.2, delay / 3600 * 0.1)
        base -= (features.get("arrival_history_score", 100) / 100 - 0.5) * 0.15
        base -= (features.get("trust_score", 50) / 100 - 0.5) * 0.1
        if features.get("distance_km", 5) > 20:
            base += 0.05
        return round(max(0, min(1, base)), 4)

    def get_risk_level(self, prob: float) -> str:
        if prob >= 0.40: return "HIGH"
        if prob >= 0.20: return "MEDIUM"
        return "LOW"

    def get_actions(self, prob: float) -> List[str]:
        actions = []
        if prob >= 0.40:
            actions.append("send_reminder_sms")
            actions.append("request_confirmation")
            actions.append("prepare_backup_worker")
        elif prob >= 0.20:
            actions.append("send_reminder_notification")
            actions.append("request_confirmation")
        return actions

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/no_show_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version,
            "feature_columns": self.FEATURE_COLUMNS}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "NoShowModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data.get("version")
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        return instance


def fetch_no_show_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        w.id as worker_id,
        COALESCE((SELECT COUNT(*) FROM job_cancellations jc WHERE jc.worker_id = w.id AND jc.created_at > NOW() - INTERVAL '90 days'), 0) as past_no_shows,
        wf.cancellation_rate,
        wf.avg_response_time * 60 as avg_response_delay_seconds,
        COALESCE((SELECT AVG(r.rating) FROM ratings r WHERE r.to_id = w.id AND r.rating_type = 'USER_TO_WORKER'), 0) * 20 as arrival_history_score,
        COALESCE(wf.trust_decay_factor * 100, 50) as trust_score,
        wf.reliability_score,
        COALESCE(earth_distance(ll_to_earth(j.location_lat, j.location_lng), w.location_cube) / 1000.0, 5.0) as distance_km,
        EXTRACT(HOUR FROM j.created_at) as hour_of_day,
        CASE WHEN EXTRACT(DOW FROM j.created_at) IN (0, 6) THEN 1 ELSE 0 END as is_weekend,
        CASE j.category
            WHEN 'PLUMBING' THEN 0 WHEN 'ELECTRICIAN' THEN 1 WHEN 'CLEANING' THEN 2
            WHEN 'PAINTING' THEN 3 WHEN 'CARPENTRY' THEN 4 WHEN 'MOVING' THEN 5
            WHEN 'GARDENING' THEN 6 WHEN 'APPLIANCE_REPAIR' THEN 7 WHEN 'IT_SUPPORT' THEN 8
            WHEN 'TUTORING' THEN 9 WHEN 'PHOTOGRAPHY' THEN 10 WHEN 'EVENT' THEN 11
            WHEN 'DELIVERY' THEN 12 ELSE 13
        END as category_encoded,
        CASE WHEN j.status = 'CANCELLED' AND j.cancellation_reason LIKE '%no_show%' THEN 1 ELSE 0 END as was_no_show
    FROM workers w
    JOIN jobs j ON j.worker_id = w.id
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    WHERE j.created_at > NOW() - INTERVAL '{days_back} days'
      AND j.status IN ('COMPLETED', 'CANCELLED')
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in ["past_no_shows", "cancellation_rate", "avg_response_delay_seconds", "arrival_history_score",
                "trust_score", "reliability_score", "distance_km"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df
