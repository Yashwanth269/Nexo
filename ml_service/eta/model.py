import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

class ETAPredictionModel:
    MODEL_TYPE = "ETA"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "distance_km",
        "hour_of_day",
        "day_of_week",
        "category_encoded",
        "urgency_encoded",
        "demand_pressure",
        "is_peak_hours",
        "is_weekend",
        "worker_speed_profile",
        "historical_eta_accuracy",
        "traffic_factor",
    ]

    CATEGORY_ENCODING = {
        "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2,
        "PAINTING": 3, "CARPENTRY": 4, "MOVING": 5,
        "GARDENING": 6, "APPLIANCE_REPAIR": 7, "IT_SUPPORT": 8,
        "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
        "DELIVERY": 12, "OTHER": 13
    }

    def __init__(self, model_path: str = "/models/eta"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["actual_eta_minutes"]

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
            "min_child_samples": 10,
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
            "mean_eta": float(y.mean()),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_eta(self, features: Dict) -> float:
        if self.model is None:
            return self._heuristic_eta(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        pred = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return max(1, round(pred, 1))

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic_eta(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return np.maximum(1, self.model.predict(X, num_iteration=self.model.best_iteration))

    def _heuristic_eta(self, features: Dict) -> float:
        dist = features.get("distance_km", 5)
        speed = features.get("worker_speed_profile", 20) or 20
        base = (dist / speed) * 60
        if features.get("is_peak_hours"):
            base *= 1.3
        if features.get("urgency_encoded", 0) >= 2:
            base *= 0.85
        return max(1, round(base, 1))

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/eta_{self.version}.pkl"
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
    def load(cls, path: str) -> "ETAPredictionModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_eta_training_data(db_dsn: str, days_back: int = 90) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        j.id as job_id,
        j.worker_id,
        j.category,
        j.urgency,
        j.demand_pressure,
        j.created_at as job_created_at,
        j.accepted_at,
        j.on_the_way_at,
        j.arrived_at,
        j.completed_at,
        j.route_distance,
        j.route_duration,
        wf.reliability_score as worker_speed_profile,
        COALESCE(earth_distance(ll_to_earth(j.location_lat, j.location_lng), w.location_cube) / 1000.0, 5.0) AS distance_km
    FROM jobs j
    JOIN workers w ON j.worker_id = w.id
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    WHERE j.status = 'COMPLETED'
      AND j.on_the_way_at IS NOT NULL
      AND j.arrived_at IS NOT NULL
      AND j.created_at >= NOW() - INTERVAL '{days_back} days'
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["actual_eta_minutes"] = (pd.to_datetime(df["arrived_at"]) - pd.to_datetime(df["on_the_way_at"])).dt.total_seconds() / 60.0
    df = df[df["actual_eta_minutes"] > 0]
    df["hour_of_day"] = pd.to_datetime(df["job_created_at"]).dt.hour
    df["day_of_week"] = pd.to_datetime(df["job_created_at"]).dt.dayofweek
    cat_map = {cat: i for i, cat in enumerate(df["category"].unique())}
    df["category_encoded"] = df["category"].map(cat_map).fillna(0)
    urgency_map = {"low": 0, "normal": 1, "high": 2, "urgent": 3}
    df["urgency_encoded"] = df["urgency"].map(urgency_map).fillna(1)
    df["is_peak_hours"] = ((df["hour_of_day"] >= 8) & (df["hour_of_day"] <= 11) | (df["hour_of_day"] >= 17) & (df["hour_of_day"] <= 21)).astype(int)
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["demand_pressure"] = df["demand_pressure"].fillna(0.0).clip(0, 1)
    df["worker_speed_profile"] = df["worker_speed_profile"].fillna(0.5).clip(0, 1)
    df["historical_eta_accuracy"] = 0.8
    df["traffic_factor"] = 1.0
    return df
