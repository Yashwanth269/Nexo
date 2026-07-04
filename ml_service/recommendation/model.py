import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import joblib


class RecommendationModel:
    MODEL_TYPE = "RECOMMENDATION"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "category_encoded", "price_range_encoded",
        "urgency_encoded", "distance_km",
        "worker_completion_rate", "worker_rating",
        "worker_jobs_completed", "worker_reliability_score",
        "user_prior_category_count", "user_total_jobs_posted",
    ]

    def __init__(self, model_path: str = "/models/recommendation"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False
        self.popularity_scores = {}
        self.category_affinity = {}

    def train(self, training_data: pd.DataFrame) -> Dict:
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import ndcg_score

        self.popularity_scores = training_data.groupby("category_encoded")["was_hired"].mean().to_dict()
        for col in self.FEATURE_COLUMNS:
            if col not in training_data.columns:
                training_data[col] = 0

        try:
            import lightgbm as lgb
            X = training_data[self.FEATURE_COLUMNS]
            y = training_data["was_hired"].astype(int)

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
            from sklearn.metrics import roc_auc_score
            auc = roc_auc_score(y_val, y_pred)

            self.metrics = {
                "auc": float(auc),
                "best_iteration": self.model.best_iteration,
                "training_samples": len(X_train),
                "validation_samples": len(X_val),
                "categories": len(self.popularity_scores),
            }
        except Exception:
            self.metrics = {
                "auc": 0.5,
                "training_samples": len(training_data),
                "validation_samples": 0,
                "categories": len(self.popularity_scores),
            }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def recommend(self, user_features: Dict, available_workers: List[Dict], top_n: int = 5) -> List[Dict]:
        scored = []
        for worker in available_workers:
            features = self._build_features(user_features, worker)
            if self.model is not None:
                row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
                score = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
            else:
                score = self._heuristic_score(user_features, worker)
            scored.append({**worker, "recommendation_score": round(score, 4)})

        scored.sort(key=lambda x: x["recommendation_score"], reverse=True)
        return scored[:top_n]

    def _build_features(self, user_features: Dict, worker: Dict) -> Dict:
        cat = user_features.get("category_encoded", 0)
        return {
            "category_encoded": cat,
            "price_range_encoded": user_features.get("price_range_encoded", 0),
            "urgency_encoded": user_features.get("urgency_encoded", 1),
            "distance_km": worker.get("distance", 5),
            "worker_completion_rate": worker.get("completion_rate", 100) / 100.0,
            "worker_rating": worker.get("rating", 4.0) / 5.0,
            "worker_jobs_completed": worker.get("jobs_completed", 0),
            "worker_reliability_score": worker.get("reliability_score", 1.0),
            "user_prior_category_count": user_features.get("prior_category_count", 0),
            "user_total_jobs_posted": user_features.get("total_jobs_posted", 0),
        }

    def _heuristic_score(self, user_features: Dict, worker: Dict) -> float:
        base = 0.5
        base += (worker.get("completion_rate", 100) / 100 - 0.8) * 0.2
        base += (worker.get("rating", 4.0) / 5.0 - 0.7) * 0.15
        base += (1.0 / (1.0 + worker.get("distance", 5))) * 0.1
        cat = user_features.get("category_encoded", -1)
        if cat >= 0 and cat in self.popularity_scores:
            base += self.popularity_scores[cat] * 0.1
        return round(max(0, min(1, base)), 4)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/recommendation_{self.version}.pkl"
        import os
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({
            "model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted,
            "popularity_scores": self.popularity_scores,
        }, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "RecommendationModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        instance.popularity_scores = data.get("popularity_scores", {})
        return instance


def fetch_recommendation_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        CASE j.category
            WHEN 'PLUMBING' THEN 0 WHEN 'ELECTRICIAN' THEN 1 WHEN 'CLEANING' THEN 2
            WHEN 'PAINTING' THEN 3 WHEN 'CARPENTRY' THEN 4 WHEN 'MOVING' THEN 5
            WHEN 'GARDENING' THEN 6 WHEN 'APPLIANCE_REPAIR' THEN 7 WHEN 'IT_SUPPORT' THEN 8
            WHEN 'TUTORING' THEN 9 WHEN 'PHOTOGRAPHY' THEN 10 WHEN 'EVENT' THEN 11
            WHEN 'DELIVERY' THEN 12 ELSE 13
        END as category_encoded,
        CASE
            WHEN j.price < 100 THEN 0 WHEN j.price < 300 THEN 1 WHEN j.price < 500 THEN 2 ELSE 3
        END as price_range_encoded,
        CASE j.urgency WHEN 'low' THEN 0 WHEN 'normal' THEN 1 WHEN 'high' THEN 2 WHEN 'urgent' THEN 3 ELSE 1
        END as urgency_encoded,
        COALESCE(earth_distance(ll_to_earth(j.location_lat, j.location_lng), w.location_cube) / 1000.0, 5.0) as distance_km,
        wf.completion_rate as worker_completion_rate,
        w.rating as worker_rating,
        w.jobs_completed as worker_jobs_completed,
        wf.reliability_score as worker_reliability_score,
        0 as user_prior_category_count,
        0 as user_total_jobs_posted,
        CASE WHEN jo.status = 'ACCEPTED' THEN 1 ELSE 0 END as was_hired
    FROM jobs j
    JOIN job_offers jo ON jo.job_id = j.id
    JOIN workers w ON jo.worker_id = w.id
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    WHERE j.created_at > NOW() - INTERVAL '{days_back} days'
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in ["distance_km", "worker_completion_rate", "worker_rating", "worker_jobs_completed", "worker_reliability_score"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df
