import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support

from .features import AcceptanceFeatureEngineer

class AcceptanceModel:
    MODEL_TYPE = "ACCEPTANCE"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"
    
    def __init__(self, db_pool, model_path: str = "/models/acceptance"):
        self.db_pool = db_pool
        self.model_path = model_path
        self.feature_engineer = AcceptanceFeatureEngineer(db_pool)
        self.model = None
        self.feature_columns = self.feature_engineer.FEATURE_COLUMNS
        self.version = None
        self.metrics = {}

    def train(self, training_data: pd.DataFrame, force_retrain: bool = False) -> Dict:
        X = training_data[self.feature_columns]
        y = training_data["target"]
        
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
        }
        
        self.model = lgb.train(
            params,
            train_data,
            num_boost_round=500,
            valid_sets=[train_data, val_data],
            valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(50), lgb.log_evaluation(0)]
        )
        
        y_pred = self.model.predict(X_val, num_iteration=self.model.best_iteration)
        auc = roc_auc_score(y_val, y_pred)
        
        y_pred_binary = (y_pred > 0.5).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(y_val, y_pred_binary, average="binary")
        
        self.metrics = {
            "auc": float(auc),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "best_iteration": self.model.best_iteration,
            "training_samples": len(X_train),
            "validation_samples": len(X_val),
            "positive_rate": float(y.mean()),
        }
        
        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
        return self.metrics

    def predict_proba(self, features: Dict) -> float:
        if self.model is None:
            raise ValueError("Model not loaded")
        X = self.feature_engineer.prepare_inference_features(features)
        return float(self.model.predict(X, num_iteration=self.model.best_iteration)[0])

    def predict_batch(self, features_list: list) -> np.ndarray:
        if self.model is None:
            raise ValueError("Model not loaded")
        X = np.array([[f.get(col, 0) for col in self.feature_columns] for f in features_list])
        return self.model.predict(X, num_iteration=self.model.best_iteration)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/acceptance_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({
            "model": self.model,
            "version": self.version,
            "feature_columns": self.feature_columns,
            "metrics": self.metrics,
        }, save_path)
        return save_path

    @classmethod
    def load(cls, path: str, db_pool) -> "AcceptanceModel":
        data = joblib.load(path)
        instance = cls(db_pool)
        instance.model = data["model"]
        instance.version = data["version"]
        instance.feature_columns = data["feature_columns"]
        instance.metrics = data["metrics"]
        return instance

async def fetch_training_data(db_pool, days_back: int = 90) -> pd.DataFrame:
    cutoff = datetime.utcnow() - timedelta(days=days_back)
    query = ("SELECT jo.id, jo.job_id, jo.worker_id, jo.status, jo.created_at "
           "FROM job_offers jo "
           "WHERE jo.created_at >= $1 "
           "AND jo.status IN ('ACCEPTED', 'REJECTED')")
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(query, cutoff)
    return pd.DataFrame([dict(r) for r in rows])

