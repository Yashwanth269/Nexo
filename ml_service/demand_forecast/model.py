import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib


class DemandForecastModel:
    MODEL_TYPE = "DEMAND_FORECAST"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "hour_of_day", "day_of_week", "is_weekend", "is_peak_hours",
        "month", "category_encoded",
        "jobs_posted_last_1h", "jobs_posted_last_24h",
        "active_workers_last_1h", "active_workers_last_24h",
        "avg_completion_time_minutes", "completion_rate_last_24h",
        "is_holiday", "price_avg_last_24h",
    ]

    def __init__(self, model_path: str = "/models/demand_forecast"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["jobs_posted_next_hour"].astype(float)

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
        r2 = r2_score(y_val, y_pred)

        self.metrics = {
            "mae": float(mae), "r2": float(r2),
            "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_demand(self, features: Dict) -> float:
        if self.model is None:
            return self._heuristic(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        pred = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return round(max(0, pred), 2)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return self.model.predict(X, num_iteration=self.model.best_iteration)

    def _heuristic(self, features: Dict) -> float:
        base = features.get("jobs_posted_last_1h", 0) * 0.5 + features.get("jobs_posted_last_24h", 0) * 0.05
        if features.get("is_peak_hours", 0):
            base *= 1.3
        if features.get("is_weekend", 0):
            base *= 0.8
        return round(max(0, base), 2)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/demand_forecast_{self.version}.pkl"
        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "DemandForecastModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_demand_forecast_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    WITH hourly_agg AS (
        SELECT
            EXTRACT(HOUR FROM j.created_at)::int as hour_of_day,
            EXTRACT(DOW FROM j.created_at)::int as day_of_week,
            DATE_TRUNC('hour', j.created_at) as hour_slot,
            j.category,
            COUNT(*) as jobs_posted_this_hour
        FROM jobs j
        WHERE j.created_at > NOW() - INTERVAL '{days_back} days'
        GROUP BY hour_slot, j.category, EXTRACT(HOUR FROM j.created_at), EXTRACT(DOW FROM j.created_at)
    )
    SELECT
        ha.hour_of_day, ha.day_of_week,
        CASE WHEN ha.day_of_week IN (0, 6) THEN 1 ELSE 0 END as is_weekend,
        CASE WHEN ha.hour_of_day IN (8, 9, 10, 11, 17, 18, 19, 20, 21) THEN 1 ELSE 0 END as is_peak_hours,
        EXTRACT(MONTH FROM ha.hour_slot)::int as month,
        CASE ha.category
            WHEN 'PLUMBING' THEN 0 WHEN 'ELECTRICIAN' THEN 1 WHEN 'CLEANING' THEN 2
            WHEN 'PAINTING' THEN 3 WHEN 'CARPENTRY' THEN 4 WHEN 'MOVING' THEN 5
            WHEN 'GARDENING' THEN 6 WHEN 'APPLIANCE_REPAIR' THEN 7 WHEN 'IT_SUPPORT' THEN 8
            WHEN 'TUTORING' THEN 9 WHEN 'PHOTOGRAPHY' THEN 10 WHEN 'EVENT' THEN 11
            WHEN 'DELIVERY' THEN 12 ELSE 13
        END as category_encoded,
        ha.jobs_posted_this_hour as jobs_posted_last_1h,
        AVG(ha.jobs_posted_this_hour) OVER (PARTITION BY ha.category ORDER BY ha.hour_slot ROWS BETWEEN 23 PRECEDING AND 1 PRECEDING) as jobs_posted_last_24h,
        LEAD(ha.jobs_posted_this_hour, 1) OVER (PARTITION BY ha.category ORDER BY ha.hour_slot) as jobs_posted_next_hour
    FROM hourly_agg ha
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["active_workers_last_1h"] = 0
    df["active_workers_last_24h"] = 0
    df["avg_completion_time_minutes"] = 30
    df["completion_rate_last_24h"] = 0.85
    df["is_holiday"] = 0
    df["price_avg_last_24h"] = 250
    for col in df.columns:
        if df[col].dtype == object:
            try:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            except:
                pass
    return df.fillna(0)
