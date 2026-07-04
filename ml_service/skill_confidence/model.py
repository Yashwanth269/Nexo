import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, mean_absolute_error
import joblib


class SkillConfidenceModel:
    MODEL_TYPE = "SKILL_CONFIDENCE"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "jobs_completed_in_category", "total_jobs_completed",
        "avg_rating_in_category", "overall_avg_rating",
        "recent_jobs_last_30d", "completion_rate",
        "avg_completion_time_minutes", "category_encoded",
        "days_since_last_job_in_category", "repeat_customer_rate",
    ]

    def __init__(self, model_path: str = "/models/skill_confidence"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["quality_score"].astype(float)

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

    def predict_confidence(self, features: Dict) -> float:
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
        base = 0.5
        jobs = features.get("jobs_completed_in_category", 0)
        total = features.get("total_jobs_completed", 0)
        if total > 0:
            base += min(0.3, jobs / total * 0.3)
        base += (features.get("avg_rating_in_category", 0) / 5 - 0.7) * 0.2
        base += (features.get("completion_rate", 100) / 100 - 0.8) * 0.15
        recent = features.get("recent_jobs_last_30d", 0)
        base += min(0.1, recent * 0.02)
        return round(max(0, min(1, base)), 4)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/skill_confidence_{self.version}.pkl"
        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "SkillConfidenceModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_skill_confidence_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        w.id as worker_id,
        j.category,
        COUNT(*) FILTER (WHERE j.status = 'COMPLETED') as jobs_completed_in_category,
        w.jobs_completed as total_jobs_completed,
        COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'USER_TO_WORKER'), 0) as avg_rating_in_category,
        w.rating as overall_avg_rating,
        COUNT(*) FILTER (WHERE j.status = 'COMPLETED' AND j.completed_at > NOW() - INTERVAL '30 days') as recent_jobs_last_30d,
        wf.completion_rate,
        COALESCE(AVG(EXTRACT(EPOCH FROM (j.completed_at - j.started_at)) / 60), 0) as avg_completion_time_minutes,
        CASE j.category
            WHEN 'PLUMBING' THEN 0 WHEN 'ELECTRICIAN' THEN 1 WHEN 'CLEANING' THEN 2
            WHEN 'PAINTING' THEN 3 WHEN 'CARPENTRY' THEN 4 WHEN 'MOVING' THEN 5
            WHEN 'GARDENING' THEN 6 WHEN 'APPLIANCE_REPAIR' THEN 7 WHEN 'IT_SUPPORT' THEN 8
            WHEN 'TUTORING' THEN 9 WHEN 'PHOTOGRAPHY' THEN 10 WHEN 'EVENT' THEN 11
            WHEN 'DELIVERY' THEN 12 ELSE 13
        END as category_encoded,
        COALESCE(EXTRACT(DAY FROM (NOW() - MAX(j.completed_at) FILTER (WHERE j.status = 'COMPLETED'))), 365) as days_since_last_job_in_category,
        CASE WHEN COUNT(DISTINCT j.user_id) > 0
            THEN COUNT(*) FILTER (WHERE j.status = 'COMPLETED')::decimal / COUNT(DISTINCT j.user_id)
            ELSE 0
        END as repeat_customer_rate,
        COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'USER_TO_WORKER'), 0) / 5.0 as quality_score
    FROM workers w
    JOIN jobs j ON j.worker_id = w.id
    LEFT JOIN ratings r ON r.to_id = w.id AND r.rating_type = 'USER_TO_WORKER'
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    WHERE j.created_at > NOW() - INTERVAL '{days_back} days'
    GROUP BY w.id, j.category, w.jobs_completed, w.rating, wf.completion_rate
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in df.columns:
        if col in ["worker_id", "category"]:
            continue
        try:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        except:
            pass
    return df
