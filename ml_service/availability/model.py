import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib


class WorkerAvailabilityModel:
    MODEL_TYPE = "AVAILABILITY"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "hour_of_day", "day_of_week", "is_weekend", "is_peak_hours",
        "avg_hours_online_last_7d", "avg_hours_online_last_30d",
        "jobs_completed_last_7d", "jobs_completed_last_30d",
        "avg_response_time", "fatigue_score", "reliability_score",
        "historical_availability_rate",
    ]

    def __init__(self, model_path: str = "/models/availability"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["was_online_next_hour"].astype(float)

        X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)

        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        params = {
            "objective": "binary", "metric": "auc", "boosting_type": "gbdt",
            "num_leaves": 31, "learning_rate": 0.05, "feature_fraction": 0.8,
            "bagging_fraction": 0.8, "bagging_freq": 5, "verbose": -1,
            "seed": 42,
        }

        self.model = lgb.train(params, train_data, num_boost_round=200,
            valid_sets=[train_data, val_data], valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(20), lgb.log_evaluation(0)])

        y_pred = self.model.predict(X_val, num_iteration=self.model.best_iteration)
        y_binary = (y_pred >= 0.5).astype(int)

        self.metrics = {
            "auc": float(__import__("sklearn").metrics.roc_auc_score(y_val, y_pred)),
            "accuracy": float(__import__("sklearn").metrics.accuracy_score(y_val, y_binary)),
            "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_availability(self, features: Dict) -> float:
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
        base = 0.6
        if features.get("is_peak_hours", 0):
            base += 0.15
        if features.get("is_weekend", 0):
            base -= 0.05
        base += (features.get("historical_availability_rate", 0.5) - 0.5) * 0.3
        base -= features.get("fatigue_score", 0) * 0.2
        return round(max(0, min(1, base)), 4)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/availability_{self.version}.pkl"
        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "WorkerAvailabilityModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_availability_training_data(db_dsn: str, days_back: int = 90) -> pd.DataFrame:
    import psycopg2
    query = f"""
    WITH hourly_slots AS (
        SELECT
            w.id as worker_id,
            EXTRACT(HOUR FROM gs.hour)::int as hour_of_day,
            EXTRACT(DOW FROM gs.hour)::int as day_of_week,
            gs.hour as slot_hour,
            CASE WHEN EXTRACT(DOW FROM gs.hour) IN (0, 6) THEN 1 ELSE 0 END as is_weekend,
            CASE WHEN EXTRACT(HOUR FROM gs.hour) IN (8, 9, 10, 11, 17, 18, 19, 20, 21) THEN 1 ELSE 0 END as is_peak_hours,
            wf.fatigue_24h as fatigue_score,
            wf.reliability_score,
            wf.avg_response_time,
            EXTRACT(EPOCH FROM (
                SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(LEAD(created_at) OVER (ORDER BY created_at), NOW()) - created_at)))
                FROM event_logs el2
                WHERE el2.worker_id = w.id AND el2.event_type = 'worker_online'
                AND el2.created_at > gs.hour - INTERVAL '7 days'
            )) / 3600 as avg_hours_online_last_7d
        FROM workers w
        CROSS JOIN generate_series(
            NOW() - INTERVAL '{days_back} days',
            NOW(),
            INTERVAL '1 hour'
        ) gs(hour)
        LEFT JOIN worker_features wf ON wf.worker_id = w.id
    )
    SELECT
        hs.*,
        COALESCE((
            SELECT COUNT(*) FROM event_logs el
            WHERE el.worker_id = hs.worker_id
            AND el.event_type = 'worker_online'
            AND el.created_at >= hs.slot_hour
            AND el.created_at < hs.slot_hour + INTERVAL '1 hour'
        ), 0) > 0 as was_online_next_hour
    FROM hourly_slots hs
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in ["fatigue_score", "reliability_score", "avg_response_time", "avg_hours_online_last_7d"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["historical_availability_rate"] = df.groupby("worker_id")["was_online_next_hour"].transform("mean").fillna(0.5)
    return df
