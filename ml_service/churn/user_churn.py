import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support, accuracy_score
import joblib

class UserChurnModel:
    MODEL_TYPE = "CHURN"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "days_since_last_job",
        "jobs_last_7d",
        "jobs_last_30d",
        "jobs_last_90d",
        "total_spend",
        "avg_job_value",
        "cancellation_rate",
        "dispute_count",
        "avg_rating_given",
        "is_business_hours_user",
        "repeat_worker_rate",
        "unique_workers_hired",
        "account_age_days",
    ]

    def __init__(self, model_path: str = "/models/churn/user"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["is_churned"].astype(int)

        scale_pos = max(1, (1 - y).sum() / max(1, y.sum()))
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
            "scale_pos_weight": scale_pos,
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
        y_binary = (y_pred >= 0.5).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(y_val, y_binary, average="binary")

        self.metrics = {
            "auc": float(auc),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "accuracy": float(accuracy_score(y_val, y_binary)),
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
            "churn_rate": float(y.mean()),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_churn_probability(self, features: Dict) -> float:
        if self.model is None:
            return self._heuristic_churn(features)
        row = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        prob = float(self.model.predict(row, num_iteration=self.model.best_iteration)[0])
        return round(prob, 4)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic_churn(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return self.model.predict(X, num_iteration=self.model.best_iteration)

    def get_risk_level(self, prob: float) -> str:
        if prob >= 0.70:
            return "CRITICAL"
        elif prob >= 0.50:
            return "HIGH"
        elif prob >= 0.30:
            return "MEDIUM"
        return "LOW"

    def get_retention_action(self, prob: float, features: Dict) -> List[str]:
        actions = []
        if prob >= 0.70:
            actions.append("send_discount_offer")
            actions.append("priority_support")
            actions.append("account_manager_call")
        elif prob >= 0.50:
            actions.append("send_promotion")
            actions.append("email_campaign")
        elif prob >= 0.30:
            actions.append("send_engagement_notification")
            actions.append("showcase_new_workers")

        if features.get("days_since_last_job", 0) > 14:
            actions.append("re_engagement_email")
        if features.get("avg_rating_given", 5) < 3:
            actions.append("satisfaction_feedback")
        return actions

    def _heuristic_churn(self, features: Dict) -> float:
        days = features.get("days_since_last_job", 30)
        jobs_30d = features.get("jobs_last_30d", 0)
        base = 0.5
        base += min(0.4, days / 90 * 0.4)
        base -= min(0.3, jobs_30d / 10 * 0.3)
        return round(max(0, min(1, base)), 4)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/user_churn_{self.version}.pkl"
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
    def load(cls, path: str) -> "UserChurnModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_user_churn_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    WITH user_stats AS (
        SELECT
            u.id as user_id,
            COALESCE(EXTRACT(EPOCH FROM NOW() - MAX(j.created_at))/86400, 60) as days_since_last_job,
            COALESCE(SUM(CASE WHEN j.created_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END), 0) as jobs_last_7d,
            COALESCE(SUM(CASE WHEN j.created_at > NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END), 0) as jobs_last_30d,
            COALESCE(SUM(CASE WHEN j.created_at > NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END), 0) as jobs_last_90d,
            COALESCE(SUM(j.price) FILTER (WHERE j.created_at > NOW() - INTERVAL '90 days' AND j.status = 'COMPLETED'), 0) as total_spend,
            COALESCE(AVG(j.price) FILTER (WHERE j.status = 'COMPLETED'), 0) as avg_job_value,
            COALESCE(SUM(DISTINCT j.worker_id), 0) as unique_workers_hired,
            COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'WORKER_TO_USER'), 4.0) as avg_rating_given,
            COALESCE(EXTRACT(EPOCH FROM NOW() - u.created_at)/86400, 30) as account_age_days,
            COUNT(DISTINCT jc.id) as cancellation_count,
            COUNT(DISTINCT d.id) as dispute_count
        FROM users u
        LEFT JOIN jobs j ON j.user_id = u.id
        LEFT JOIN ratings r ON r.to_id = u.id
        LEFT JOIN job_cancellations jc ON jc.job_id = j.id
        LEFT JOIN disputes d ON d.job_id = j.id
        GROUP BY u.id, u.created_at
    )
    SELECT *,
        CASE
            WHEN days_since_last_job > 30 AND jobs_last_30d = 0 THEN 1
            WHEN days_since_last_job > 60 THEN 1
            ELSE 0
        END as is_churned
    FROM user_stats
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    total_jobs = df["jobs_last_90d"] + 1
    df["repeat_worker_rate"] = df["unique_workers_hired"] / total_jobs
    df["cancellation_rate"] = (df["cancellation_count"] / total_jobs * 100).fillna(0)
    df["is_business_hours_user"] = 1
    return df
