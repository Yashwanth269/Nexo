import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib
import os

class WorkerFraudDetector:
    MODEL_TYPE = "FRAUD"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"
    
    FEATURE_COLUMNS = [
        "completion_time_minutes",
        "travel_time_minutes",
        "stay_duration_minutes",
        "disputes_count",
        "complaints_count",
        "fraud_history",
        "gps_trust_score",
        "jobs_per_day",
        "cancellation_rate",
        "reassignment_rate",
        "cash_disputes",
        "payout_anomalies",
        "reputation_score",
    ]
    
    RISK_THRESHOLDS = {
        "NORMAL": 0.30,
        "MONITOR": 0.60,
        "REDUCE_RANKING": 0.80,
        "MANUAL_REVIEW": 0.90,
    }
    
    def __init__(self, model_path: str = "/models/fraud"):
        self.model_path = model_path
        self.model = IsolationForest(
            n_estimators=300,
            contamination=0.03,
            max_samples='auto',
            random_state=42,
            n_jobs=-1
        )
        self.scaler = StandardScaler()
        self.version = None
        self.is_fitted = False
    
    def fit(self, X: np.ndarray):
        X_scaled = self.scaler.fit_transform(X)
        self.model.fit(X_scaled)
        self.is_fitted = True
        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)
    
    def predict_fraud_probability(self, features: Dict) -> float:
        if not self.is_fitted:
            return 0.0
        X = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        X_scaled = self.scaler.transform(X)
        score = self.model.decision_function(X_scaled)[0]
        prob = 1 / (1 + np.exp(score * 2))
        return float(np.clip(prob, 0, 1))

    def get_risk_level(self, fraud_prob: float) -> str:
        if fraud_prob >= self.RISK_THRESHOLDS["MANUAL_REVIEW"]:
            return "MANUAL_REVIEW"
        elif fraud_prob >= self.RISK_THRESHOLDS["REDUCE_RANKING"]:
            return "REDUCE_RANKING"
        elif fraud_prob >= self.RISK_THRESHOLDS["MONITOR"]:
            return "MONITOR"
        return "NORMAL"

    def get_actions(self, risk_level: str) -> List[str]:
        actions = {
            "NORMAL": ["continue_monitoring"],
            "MONITOR": ["increase_scrutiny", "log_for_review"],
            "REDUCE_RANKING": ["reduce_ranking_weight", "flag_for_compliance"],
            "MANUAL_REVIEW": ["require_manual_verification", "suspend_payouts", "notify_compliance"],
        }
        return actions.get(risk_level, ["continue_monitoring"])

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if not self.is_fitted:
            return np.zeros(len(features_list))
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        X_scaled = self.scaler.transform(X)
        scores = self.model.decision_function(X_scaled)
        return 1 / (1 + np.exp(scores * 2))

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/worker_fraud_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({
            "model": self.model,
            "scaler": self.scaler,
            "version": self.version,
            "is_fitted": self.is_fitted,
        }, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "WorkerFraudDetector":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.scaler = data["scaler"]
        instance.version = data["version"]
        instance.is_fitted = data["is_fitted"]
        return instance
