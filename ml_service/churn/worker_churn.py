import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support, accuracy_score
import joblib

class WorkerChurnModel:
    MODEL_TYPE = "CHURN"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "days_since_last_job",
        "jobs_last_7d",
        "jobs_last_30d",
        "jobs_last_90d",
        "acceptance_rate",
        "avg_rating",
        "earnings_last_30d",
        "cancellation_rate",
        "dispute_count",
        "completion_rate",
        "avg_response_time",
        "reliability_score",
        "online_hours_last_7d",
        "jobs_today_count",
    ]

    def __init__(self, model_path: str = "/models/churn/worker"):
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

        self.model = xgb.XGBClassifier(
            objective="binary:logistic",
            eval_metric="auc",
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            scale_pos_weight=scale_pos,
            random_state=42,
            early_stopping_rounds=30,
        )

        self.model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        y_pred = self.model.predict_proba(X_val)[:, 1]
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
        prob = float(self.model.predict_proba(row)[0, 1])
        return round(prob, 4)

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if self.model is None:
            return np.array([self._heuristic_churn(f) for f in features_list])
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        return self.model.predict_proba(X)[:, 1]

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
            actions.append("send_personalized_offer")
            actions.append("priority_support")
            actions.append("manager_outreach")
        elif prob >= 0.50:
            actions.append("send_bonus_incentive")
            actions.append("increase_job_offers")
        elif prob >= 0.30:
            actions.append("send_engagement_notification")
            actions.append("highlight_nearby_jobs")

        if features.get("days_since_last_job", 0) > 14:
            actions.append("re_engagement_campaign")
        if features.get("avg_rating", 5) < 3:
            actions.append("satisfaction_survey")
        if features.get("earnings_last_30d", 0) < 500:
            actions.append("earnings_boost_program")
        return actions

    def _heuristic_churn(self, features: Dict) -> float:
        days = features.get("days_since_last_job", 30)
        jobs_30d = features.get("jobs_last_30d", 0)
        rating = features.get("avg_rating", 4)
        base = 0.5
        base += min(0.4, days / 90 * 0.4)
        base -= min(0.3, jobs_30d / 20 * 0.3)
        if rating < 3:
            base += 0.15
        return round(max(0, min(1, base)), 4)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/worker_churn_{self.version}.pkl"
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
    def load(cls, path: str) -> "WorkerChurnModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance


def fetch_worker_churn_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    WITH worker_stats AS (
        SELECT
            w.id as worker_id,
            COALESCE(EXTRACT(EPOCH FROM NOW() - MAX(j.created_at))/86400, 60) as days_since_last_job,
            COALESCE(SUM(CASE WHEN j.created_at > NOW() - INTERVAL '7 days' AND j.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as jobs_last_7d,
            COALESCE(SUM(CASE WHEN j.created_at > NOW() - INTERVAL '30 days' AND j.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as jobs_last_30d,
            COALESCE(SUM(CASE WHEN j.created_at > NOW() - INTERVAL '90 days' AND j.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as jobs_last_90d,
            COALESCE(AVG(r.rating) FILTER (WHERE r.rating_type = 'USER_TO_WORKER'), 4.0) as avg_rating,
            COALESCE(AVG(j.price) FILTER (WHERE j.created_at > NOW() - INTERVAL '30 days' AND j.status = 'COMPLETED'), 0) as earnings_last_30d,
            wf.completion_rate,
            wf.cancellation_rate,
            wf.avg_response_time,
            wf.acceptance_rate,
            wf.reliability_score,
            w.is_online
        FROM workers w
        LEFT JOIN jobs j ON j.worker_id = w.id
        LEFT JOIN ratings r ON r.to_id = w.id
        LEFT JOIN worker_features wf ON wf.worker_id = w.id
        GROUP BY w.id, wf.completion_rate, wf.cancellation_rate, wf.avg_response_time, wf.acceptance_rate, wf.reliability_score, w.is_online
    )
    SELECT *,
        CASE
            WHEN days_since_last_job > 30 AND jobs_last_30d = 0 THEN 1
            WHEN days_since_last_job > 60 THEN 1
            ELSE 0
        END as is_churned
    FROM worker_stats
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["dispute_count"] = 0
    df["online_hours_last_7d"] = 0
    df["jobs_today_count"] = 0
    for col in ["completion_rate", "cancellation_rate", "avg_response_time", "acceptance_rate", "reliability_score"]:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df
