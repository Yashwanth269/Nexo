import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

class DynamicPricingModel:
    MODEL_TYPE = "PRICING"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "category_encoded",
        "hour_of_day",
        "day_of_week",
        "demand_pressure",
        "worker_supply",
        "distance_km",
        "urgency_encoded",
        "base_price",
        "is_weekend",
        "is_peak_hours",
        "historical_acceptance_rate",
        "time_to_completion_minutes",
    ]

    CATEGORY_ENCODING = {
        "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2,
        "PAINTING": 3, "CARPENTRY": 4, "MOVING": 5,
        "GARDENING": 6, "APPLIANCE_REPAIR": 7, "IT_SUPPORT": 8,
        "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
        "DELIVERY": 12, "OTHER": 13
    }

    def __init__(self, model_path: str = "/models/pricing"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["price_multiplier"]

        X_train, X_val, y_train, y_val = train_test_split(
            X, y, test_size=0.2, random_state=42
        )

        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        params = {
            "objective": "regression",
            "metric": "mae",
            "boosting_type": "gbdt",
            "num_leaves": 31,
            "learning_rate": 0.05,
            "feature_fraction": 0.8,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "seed": 42,
            "min_child_samples": 20,
            "max_depth": 8,
        }

        self.model = lgb.train(
            params,
            train_data,
            num_boost_round=500,
            valid_sets=[train_data, val_data],
            valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(30), lgb.log_evaluation(0)]
        )

        y_pred = self.model.predict(X_val, num_iteration=self.model.best_iteration)
        mae = mean_absolute_error(y_val, y_pred)
        rmse = mean_squared_error(y_val, y_pred, squared=False)
        r2 = r2_score(y_val, y_pred)

        self.metrics = {
            "mae": float(mae),
            "rmse": float(rmse),
            "r2": float(r2),
            "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_multiplier(self, features: Dict) -> float:
        if self.model is None:
            return self._heuristic_multiplier(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        pred = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return round(max(0.5, min(3.0, pred)), 2)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic_multiplier(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return np.clip(self.model.predict(X, num_iteration=self.model.best_iteration), 0.5, 3.0)

    def _heuristic_multiplier(self, features: Dict) -> float:
        mult = 1.0
        if features.get("is_peak_hours"):
            mult += 0.2
        if features.get("urgency_encoded", 0) >= 2:
            mult += 0.15
        demand = features.get("demand_pressure", 0)
        mult += demand * 0.3
        supply = features.get("worker_supply", 10)
        if supply < 3:
            mult += 0.25
        if features.get("is_weekend"):
            mult += 0.1
        return round(max(0.5, min(3.0, mult)), 2)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/pricing_{self.version}.pkl"
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
    def load(cls, path: str) -> "DynamicPricingModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_pricing_training_data(db_dsn: str, days_back: int = 90) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        j.id as job_id,
        j.category,
        j.urgency,
        j.price,
        j.demand_pressure,
        j.schedule_type,
        j.created_at as job_created_at,
        j.completed_at,
        jf.worker_count_offered,
        jf.avg_response_time,
        wf.worker_load_score as worker_supply,
        COALESCE(earth_distance(ll_to_earth(j.location_lat, j.location_lng), w.location_cube) / 1000.0, 5.0) AS distance_km
    FROM jobs j
    LEFT JOIN job_features jf ON jf.job_id = j.id
    LEFT JOIN workers w ON w.id = j.worker_id
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    WHERE j.status = 'COMPLETED'
      AND j.created_at >= NOW() - INTERVAL '{days_back} days'
      AND j.price > 0
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["price_multiplier"] = 1.0 + (df["demand_pressure"].fillna(0) * 0.3)
    df["hour_of_day"] = pd.to_datetime(df["job_created_at"]).dt.hour
    df["day_of_week"] = pd.to_datetime(df["job_created_at"]).dt.dayofweek
    cat_map = {cat: i for i, cat in enumerate(df["category"].unique())}
    df["category_encoded"] = df["category"].map(cat_map).fillna(0)
    urgency_map = {"low": 0, "normal": 1, "high": 2, "urgent": 3}
    df["urgency_encoded"] = df["urgency"].map(urgency_map).fillna(1)
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["is_peak_hours"] = ((df["hour_of_day"] >= 8) & (df["hour_of_day"] <= 11) | (df["hour_of_day"] >= 17) & (df["hour_of_day"] <= 21)).astype(int)
    df["demand_pressure"] = df["demand_pressure"].fillna(0.0).clip(0, 1)
    df["worker_supply"] = df["worker_supply"].fillna(10).clip(0, 100)
    df["base_price"] = df["price"].fillna(0).clip(0)
    df["historical_acceptance_rate"] = 0.8
    df["time_to_completion_minutes"] = 30
    return df
