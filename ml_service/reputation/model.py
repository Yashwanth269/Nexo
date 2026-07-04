import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
import joblib


class WorkerReputationModel:
    MODEL_TYPE = "REPUTATION"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "avg_rating", "total_ratings", "jobs_completed",
        "completion_rate", "cancellation_rate", "avg_response_time",
        "repeat_customer_ratio", "days_since_last_rating",
        "category_encoded", "rating_volatility",
    ]

    def __init__(self, model_path: str = "/models/reputation"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["computed_reputation"].astype(float)

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

    def predict_reputation(self, features: Dict) -> float:
        if self.model is None:
            return self._heuristic(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        pred = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return round(max(0, min(5, pred)), 2)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        preds = self.model.predict(X, num_iteration=self.model.best_iteration)
        return np.clip(preds, 0, 5)

    def _heuristic(self, features: Dict) -> float:
        base = features.get("avg_rating", 4.0)
        total = features.get("total_ratings", 0)
        if total < 5:
            base = base * 0.7 + 2.5 * 0.3
        completion = features.get("completion_rate", 100) / 100.0
        base = base * (0.7 + 0.3 * completion)
        return round(max(0, min(5, base)), 2)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/reputation_{self.version}.pkl"
        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "WorkerReputationModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_reputation_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    WITH worker_ratings AS (
        SELECT
            w.id as worker_id,
            COALESCE(AVG(r.rating), 0) as avg_rating,
            COUNT(r.id) as total_ratings,
            COALESCE(w.jobs_completed, 0) as jobs_completed,
            COALESCE(w.completion_rate, 100.0) as completion_rate,
            CASE WHEN w.total_jobs > 0
                THEN (w.cancellation_count::decimal / w.total_jobs) * 100
                ELSE 0.0
            END as cancellation_rate,
            COALESCE(w.response_speed, 2.0) as avg_response_time,
            COUNT(DISTINCT r.from_id) as unique_customers,
            CASE WHEN COUNT(DISTINCT r.from_id) > 0
                THEN COUNT(r.id)::decimal / COUNT(DISTINCT r.from_id)
                ELSE 0.0
            END as repeat_customer_ratio,
            COALESCE(EXTRACT(DAY FROM (NOW() - MAX(r.created_at))), 365) as days_since_last_rating,
            COALESCE(STDDEV(r.rating), 0) as rating_volatility,
            CASE WHEN COUNT(r.id) > 0
                THEN (SUM(r.rating * 1.0) / COUNT(r.id)) * 0.7 + (w.rating * 0.3)
                ELSE w.rating
            END as computed_reputation
        FROM workers w
        LEFT JOIN ratings r ON r.to_id = w.id AND r.rating_type = 'USER_TO_WORKER'
        WHERE w.created_at > NOW() - INTERVAL '{days_back} days'
        GROUP BY w.id, w.jobs_completed, w.completion_rate, w.rating, w.total_jobs, w.cancellation_count, w.response_speed
    )
    SELECT
        wr.*,
        0 as category_encoded
    FROM worker_ratings wr
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in df.columns:
        if col in ["worker_id"]:
            continue
        try:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        except:
            pass
    return df
