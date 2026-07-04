import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support
import joblib

class WorkerReliabilityModel:
    MODEL_TYPE = "RELIABILITY"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    FEATURE_COLUMNS = [
        "completion_rate", "trust_score", "reliability_score",
        "dispute_count", "fraud_probability", "gps_trust_score",
        "cancellation_rate", "reassignment_rate", "fatigue_score",
    ]

    def __init__(self, model_path: str = "/models/reliability"):
        self.model_path = model_path
        self.model = None
        self.version = None
        self.metrics = {}
        self.is_fitted = False

    def train(self, training_data: pd.DataFrame) -> Dict:
        X = training_data[self.FEATURE_COLUMNS]
        y = training_data["completed_successfully"].astype(int)

        scale_pos = max(1, (1 - y).sum() / max(1, y.sum()))
        X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

        train_data = lgb.Dataset(X_train, label=y_train)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data)

        params = {
            "objective": "binary", "metric": "auc", "boosting_type": "gbdt",
            "num_leaves": 31, "learning_rate": 0.05, "feature_fraction": 0.8,
            "bagging_fraction": 0.8, "bagging_freq": 5, "verbose": -1,
            "seed": 42, "scale_pos_weight": scale_pos,
        }

        self.model = lgb.train(params, train_data, num_boost_round=300,
            valid_sets=[train_data, val_data], valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(30), lgb.log_evaluation(0)])

        y_pred = self.model.predict(X_val, num_iteration=self.model.best_iteration)
        auc = roc_auc_score(y_val, y_pred)
        y_binary = (y_pred >= 0.5).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(y_val, y_binary, average="binary")

        self.metrics = {
            "auc": float(auc), "precision": float(precision), "recall": float(recall),
            "f1": float(f1), "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train), "validation_samples": len(X_val),
            "success_rate": float(y.mean()),
        }

        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        self.is_fitted = True
        return self.metrics

    def predict_completion_probability(self, features: Dict) -> float:
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
        base = 0.85
        base -= features.get("cancellation_rate", 0) / 100 * 0.3
        base -= features.get("dispute_count", 0) * 0.05
        base -= features.get("fraud_probability", 0) * 0.3
        base -= features.get("fatigue_score", 0) * 0.15
        base += (features.get("completion_rate", 100) / 100 - 0.8) * 0.2
        base += (features.get("trust_score", 50) / 100 - 0.5) * 0.2
        return round(max(0, min(1, base)), 4)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/reliability_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({"model": self.model, "version": self.version, "metrics": self.metrics,
            "feature_columns": self.FEATURE_COLUMNS, "is_fitted": self.is_fitted}, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "WorkerReliabilityModel":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.version = data["version"]
        instance.metrics = data["metrics"]
        instance.feature_columns = data.get("feature_columns", instance.FEATURE_COLUMNS)
        instance.is_fitted = data.get("is_fitted", False)
        return instance

def fetch_reliability_training_data(db_dsn: str, days_back: int = 180) -> pd.DataFrame:
    import psycopg2
    query = f"""
    SELECT
        w.id as worker_id,
        wf.completion_rate, wf.cancellation_rate, wf.reliability_score,
        wf.fraud_risk_score as fraud_probability,
        COALESCE((SELECT gps_trust_score FROM worker_gps_risk WHERE worker_id = w.id), 100) as gps_trust_score,
        (SELECT COUNT(*) FROM disputes d JOIN jobs j ON d.job_id = j.id WHERE j.worker_id = w.id) as dispute_count,
        (SELECT COUNT(*) FROM job_cancellations WHERE worker_id = w.id AND created_at > NOW() - INTERVAL '90 days')::decimal /
            NULLIF((SELECT COUNT(*) FROM jobs WHERE worker_id = w.id AND created_at > NOW() - INTERVAL '90 days'), 0) * 100 as reassignment_rate,
        COALESCE(afs.fatigue_score, 0) as fatigue_score,
        wf.completion_rate as trust_score,
        CASE WHEN j.status = 'COMPLETED' THEN 1 ELSE 0 END as completed_successfully
    FROM workers w
    JOIN jobs j ON j.worker_id = w.id
    LEFT JOIN worker_features wf ON wf.worker_id = w.id
    LEFT JOIN advanced_fatigue_scores afs ON afs.worker_id = w.id
    WHERE j.created_at > NOW() - INTERVAL '{days_back} days'
      AND j.status IN ('COMPLETED', 'CANCELLED')
    """
    conn = psycopg2.connect(db_dsn)
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    for col in ["completion_rate", "cancellation_rate", "reliability_score", "fraud_probability",
                "gps_trust_score", "fatigue_score", "reassignment_rate"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["trust_score"] = pd.to_numeric(df.get("trust_score", 50), errors="coerce").fillna(50)
    return df
