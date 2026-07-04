import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib
import os

class GPSSpoofDetector:
    MODEL_TYPE = "GPS_RISK"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"
    
    FEATURE_COLUMNS = [
        "speed_kmh",
        "acceleration",
        "gps_accuracy_m",
        "heading_change",
        "mock_location_flag",
        "signal_strength",
        "route_consistency",
        "timestamp_delta",
        "distance_from_last",
    ]
    
    def __init__(self, model_path: str = "/models/gps_spoof"):
        self.model_path = model_path
        self.model = IsolationForest(
            n_estimators=200,
            contamination=0.05,
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
    
    def predict_anomaly_score(self, features: Dict) -> float:
        if not self.is_fitted:
            return 50.0
        X = np.array([[features.get(col, 0) for col in self.FEATURE_COLUMNS]])
        X_scaled = self.scaler.transform(X)
        score = self.model.decision_function(X_scaled)[0]
        gps_trust = max(0, min(100, 50 + score * 25))
        return gps_trust

    def predict_batch(self, features_list: List[Dict]) -> np.ndarray:
        if not self.is_fitted:
            return np.full(len(features_list), 50.0)
        X = np.array([[f.get(col, 0) for col in self.FEATURE_COLUMNS] for f in features_list])
        X_scaled = self.scaler.transform(X)
        scores = self.model.decision_function(X_scaled)
        return np.clip(50 + scores * 25, 0, 100)

    def rule_based_check(self, lat: float, lng: float, prev_lat: float, prev_lng: float,
                        timestamp: datetime, prev_timestamp: datetime,
                        mock_location: bool = False) -> Dict:
        alerts = []
        risk_score = 100
        
        if mock_location:
            alerts.append("MOCK_LOCATION_DETECTED")
            risk_score -= 40
        
        if prev_lat and prev_lng:
            from math import radians, sin, cos, sqrt, atan2
            R = 6371
            dlat = radians(lat - prev_lat)
            dlng = radians(lng - prev_lng)
            a = sin(dlat/2)**2 + cos(radians(prev_lat)) * cos(radians(lat)) * sin(dlng/2)**2
            distance = R * 2 * atan2(sqrt(a), sqrt(1-a))
            
            time_diff = (timestamp - prev_timestamp).total_seconds() / 3600
            if time_diff > 0:
                speed = distance / time_diff
                if speed > 200:
                    alerts.append(f"IMPOSSIBLE_SPEED_{speed:.0f}_KMH")
                    risk_score -= 30
                elif speed > 120:
                    alerts.append(f"HIGH_SPEED_{speed:.0f}_KMH")
                    risk_score -= 15
        
        return {
            "gps_trust_score": max(0, min(100, risk_score)),
            "alerts": alerts,
            "is_suspicious": risk_score < 60
}
    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/gps_spoof_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        joblib.dump({
            "model": self.model,
            "scaler": self.scaler,
            "version": self.version,
            "is_fitted": self.is_fitted,
        }, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "GPSSpoofDetector":
        data = joblib.load(path)
        instance = cls()
        instance.model = data["model"]
        instance.scaler = data["scaler"]
        instance.version = data["version"]
        instance.is_fitted = data["is_fitted"]
        return instance
