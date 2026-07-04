import os
import json
import joblib
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
import psycopg2
import redis.asyncio as aioredis
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST, Counter, Histogram, Gauge

from fraud.dispute_risk import DisputeRiskModel, fetch_dispute_training_data, fetch_non_dispute_training_data
from fraud.gps_spoof import GPSSpoofDetector
from fraud.worker_fraud import WorkerFraudDetector
from eta.model import ETAPredictionModel, fetch_eta_training_data
from reliability.model import WorkerReliabilityModel, fetch_reliability_training_data
from no_show.model import NoShowModel, fetch_no_show_training_data
from bandit.model import BanditModel
from fatigue.model import FatigueMLModel, fetch_fatigue_training_data
from skill_confidence.model import SkillConfidenceModel, fetch_skill_confidence_training_data
from availability.model import WorkerAvailabilityModel, fetch_availability_training_data
from demand_forecast.model import DemandForecastModel, fetch_demand_forecast_training_data
from recommendation.model import RecommendationModel, fetch_recommendation_training_data
from reputation.model import WorkerReputationModel, fetch_reputation_training_data

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml_engine")

DB_DSN = os.getenv("DB_DSN", "postgresql://postgres:@localhost:5432/gigs_db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MODEL_DIR = os.getenv("MODEL_DIR", "/app/models")

os.makedirs(MODEL_DIR, exist_ok=True)

# ─── Feature Schema ───────────────────────────────────────────────────────────
WORKER_FEATURES = [
    "completion_rate", "cancellation_rate", "avg_response_time",
    "distance", "reliability_score", "jobs_completed", "online_consistency",
    "worker_load", "fatigue_24h", "fatigue_7d", "fatigue_30d",
    "acceptance_rate", "trust_score",
]

JOB_FEATURES = [
    "category_encoded", "urgency_encoded", "price", "schedule_type_encoded",
    "demand_pressure",
]

ALL_FEATURES = WORKER_FEATURES + JOB_FEATURES
TARGET = "accepted"

FEATURE_SCHEMA = {
    "worker_features": WORKER_FEATURES,
    "job_features": JOB_FEATURES,
    "all_features": ALL_FEATURES,
    "target": TARGET,
    "version": "2.0.0",
}

DISPUTE_FEATURES = DisputeRiskModel.FEATURE_COLUMNS
GPS_FEATURES = GPSSpoofDetector.FEATURE_COLUMNS
FRAUD_FEATURES = WorkerFraudDetector.FEATURE_COLUMNS
ETA_FEATURES = ETAPredictionModel.FEATURE_COLUMNS


# ─── Pydantic Models ──────────────────────────────────────────────────────────
class RankItem(BaseModel):
    worker_id: str
    distance: float
    completion_rate: float = 100.0
    cancellation_rate: float = 0.0
    avg_response_time: float = 2.0
    reliability_score: float = 1.0
    jobs_completed: int = 0
    online_consistency: float = 1.0
    worker_load: float = 0.0
    fatigue_24h: float = 0.0
    fatigue_7d: float = 0.0
    fatigue_30d: float = 0.0
    acceptance_rate: float = 1.0
    trust_score: float = 1.0
    category_encoded: float = 0.0
    urgency_encoded: float = 0.0
    price: float = 0.0
    schedule_type_encoded: float = 0.0
    demand_pressure: float = 0.0

class RankingRequest(BaseModel):
    workers: list[RankItem]
    model_version: Optional[str] = None
    use_exploration: bool = False
    exploration_rate: float = 0.10

class RankingResponse(BaseModel):
    scores: list[dict]
    model_version: str
    model_type: str
    using_fallback: bool
    timestamp: str

class TrainingRequest(BaseModel):
    force_full_retrain: bool = False
    model_name: str = "acceptance_model"

# ─── Model Registry ───────────────────────────────────────────────────────────
class ModelRegistry:
    def __init__(self):
        self.models = {}
        self.metadata = {}
        self.fallback_models = {}
        self.specialized = {
            "acceptance": None,
            "gps_risk": None,
            "fraud": None,
            "dispute": None,
            "eta": None,
            "reliability": None,
            "no_show": None,
            "fatigue": None,
            "skill_confidence": None,
            "bandit": None,
            "availability": None,
            "demand_forecast": None,
            "recommendation": None,
        }

    def register(self, name, version, model, metadata):
        key = f"{name}:{version}"
        self.models[key] = model
        self.metadata[key] = metadata
        if metadata.get("is_production"):
            self.models["_active"] = model
            self.metadata["_active"] = metadata
            model_type = metadata.get("model_type", "")
            if "ACCEPTANCE" in model_type:
                self.specialized["acceptance"] = model
            elif "GPS_RISK" in model_type:
                self.specialized["gps_risk"] = model
            elif "FRAUD" in model_type:
                self.specialized["fraud"] = model
            elif "DISPUTE" in model_type:
                self.specialized["dispute"] = model
            elif "ETA" in model_type:
                self.specialized["eta"] = model
            elif "RELIABILITY" in model_type:
                self.specialized["reliability"] = model
            elif "NO_SHOW" in model_type:
                self.specialized["no_show"] = model
            elif "FATIGUE" in model_type:
                self.specialized["fatigue"] = model
            elif "SKILL_CONFIDENCE" in model_type:
                self.specialized["skill_confidence"] = model
            elif "AVAILABILITY" in model_type:
                self.specialized["availability"] = model
            elif "DEMAND_FORECAST" in model_type:
                self.specialized["demand_forecast"] = model
            elif "RECOMMENDATION" in model_type:
                self.specialized["recommendation"] = model

        logger.info(f"Registered model {name} v{version} ({metadata.get('model_type', 'unknown')})")

    def register_specialized(self, model_type, model_instance):
        self.specialized[model_type] = model_instance
        logger.info(f"Registered specialized model: {model_type}")

    def get_specialized(self, model_type):
        return self.specialized.get(model_type)

    def get_active(self, name="acceptance_model"):
        key = f"{name}:production"
        if key in self.models:
            return self.models[key], self.metadata[key]
        for k in sorted(self.models.keys(), reverse=True):
            if k.startswith(name) and k != f"{name}:production":
                return self.models[k], self.metadata[k]
        return None, None

    def get(self, name, version):
        return self.models.get(f"{name}:{version}")

    def list_versions(self, name="acceptance_model"):
        return [
            {"version": k.split(":")[1], "metadata": v}
            for k, v in self.metadata.items()
            if k.startswith(name)
        ]

registry = ModelRegistry()

class LightweightFallback:
    def predict(self, features_df):
        scores = []
        for _, row in features_df.iterrows():
            w_completion = 0.35
            w_reliability = 0.20
            w_distance = 0.15
            w_response = 0.10
            w_trust = 0.10
            w_load = 0.10
            completion_norm = row.get("completion_rate", 100) / 100.0
            reliability = row.get("reliability_score", 1.0)
            distance_norm = 1.0 / (1.0 + row.get("distance", 5))
            response_norm = max(0, 1.0 - row.get("avg_response_time", 5) / 30.0)
            trust = row.get("trust_score", 1.0)
            load_penalty = max(0, 1.0 - row.get("worker_load", 0) * 0.3)
            score = (
                w_completion * completion_norm +
                w_reliability * reliability +
                w_distance * distance_norm +
                w_response * response_norm +
                w_trust * trust +
                w_load * load_penalty
            )
            scores.append(min(1.0, score))
        return np.array(scores)

fallback_model = LightweightFallback()

# ─── Database Helpers ─────────────────────────────────────────────────────────
def get_db():
    return psycopg2.connect(DB_DSN)

async def get_redis():
    return await aioredis.from_url(REDIS_URL, decode_responses=True)

def fetch_training_data():
    conn = get_db()
    query = """
    SELECT
        j.id as job_id, j.worker_id, j.category, j.urgency, j.price,
        j.schedule_type, j.demand_pressure, j.status,
        j.created_at as job_created_at,
        COALESCE(w.completion_rate, 100.0) as completion_rate,
        CASE WHEN w.total_jobs > 0
            THEN (w.cancellation_count::decimal / w.total_jobs) * 100
            ELSE 0.0
        END as cancellation_rate,
        COALESCE(w.response_speed, 2.0) as avg_response_time,
        COALESCE(w.reliability_score, 1.0) as reliability_score,
        0.0 as worker_load,
        0.0 as fatigue_24h, 0.0 as fatigue_7d, 0.0 as fatigue_30d,
        1.0 as trust_score,
        w.jobs_completed,
        jo.status as offer_status,
        COALESCE(earth_distance(ll_to_earth(j.location_lat, j.location_lng),
                 ll_to_earth(w.current_lat, w.current_lng)) / 1000.0, 5.0) AS distance
    FROM job_offers jo
    JOIN jobs j ON jo.job_id = j.id
    JOIN workers w ON jo.worker_id = w.id
    WHERE jo.status IN ('ACCEPTED', 'REJECTED')
      AND j.created_at > NOW() - INTERVAL '90 days'
      AND w.current_lat IS NOT NULL AND w.current_lng IS NOT NULL
    """
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty:
        return df
    df["accepted"] = (df["offer_status"] == "ACCEPTED").astype(int)
    return df

def compute_online_consistency(worker_id):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT COUNT(*) FROM event_logs
            WHERE worker_id = %s AND event_type = 'worker_online'
              AND created_at > NOW() - INTERVAL '30 days'
        """, (worker_id,))
        count = cur.fetchone()[0]
        cur.close()
        conn.close()
        return min(1.0, count / 30.0)
    except:
        return 0.5

# ─── Feature Engineering ──────────────────────────────────────────────────────
def engineer_features(df):
    df = df.copy()
    df["completion_rate"] = df["completion_rate"].fillna(100.0).clip(0, 100)
    df["cancellation_rate"] = df["cancellation_rate"].fillna(0.0).clip(0, 100)
    df["avg_response_time"] = df["avg_response_time"].fillna(2.0).clip(0, 60)
    df["reliability_score"] = df["reliability_score"].fillna(1.0).clip(0, 1)
    df["worker_load"] = df["worker_load"].fillna(0.0).clip(0, 10)
    df["jobs_completed"] = df["jobs_completed"].fillna(0).clip(0)
    df["trust_score"] = df["trust_score"].fillna(1.0).clip(0, 1)

    cat_map = {cat: i for i, cat in enumerate(df["category"].unique())}
    df["category_encoded"] = df["category"].map(cat_map).fillna(0)

    urgency_map = {"low": 0, "normal": 1, "high": 2, "urgent": 3}
    df["urgency_encoded"] = df["urgency"].map(urgency_map).fillna(1)

    schedule_map = {"now": 0, "today": 1, "scheduled": 2}
    df["schedule_type_encoded"] = df["schedule_type"].map(schedule_map).fillna(0)

    df["price"] = df["price"].fillna(0).clip(0)
    df["demand_pressure"] = df["demand_pressure"].fillna(0.0).clip(0, 1)

    df["online_consistency"] = df["worker_id"].apply(compute_online_consistency)
    df["acceptance_rate"] = df.apply(
        lambda r: 1.0 - (r["cancellation_rate"] / 100.0) if r["cancellation_rate"] > 0 else 1.0,
        axis=1
    )

    return df

# ─── Training ─────────────────────────────────────────────────────────────────
def train_lightgbm(df, feature_cols):
    import lightgbm as lgb
    X = df[feature_cols].values
    y = df["accepted"].values
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
        "random_state": 42,
    }
    model = lgb.LGBMClassifier(**params, n_estimators=200)
    model.fit(X, y)
    return model

def train_xgboost(df, feature_cols):
    import xgboost as xgb
    X = df[feature_cols].values
    y = df["accepted"].values
    model = xgb.XGBClassifier(
        objective="binary:logistic",
        eval_metric="auc",
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        use_label_encoder=False,
    )
    model.fit(X, y)
    return model

def evaluate_model(model, df, feature_cols):
    from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score, f1_score
    X = df[feature_cols].values
    y = df["accepted"].values
    preds = model.predict_proba(X)[:, 1]
    binary = (preds >= 0.5).astype(int)
    return {
        "auc": float(roc_auc_score(y, preds)),
        "accuracy": float(accuracy_score(y, binary)),
        "precision": float(precision_score(y, binary, zero_division=0)),
        "recall": float(recall_score(y, binary, zero_division=0)),
        "f1": float(f1_score(y, binary, zero_division=0)),
        "positive_count": int(y.sum()),
        "negative_count": int((1 - y).sum()),
        "total_samples": len(y),
    }

# ─── Sample Data Generators (for cold-start bootstrapping) ────────────────────
def _generate_gps_sample_data() -> np.ndarray:
    rng = np.random.default_rng(42)
    n_normal = 190
    n_anomaly = 10
    normal = np.column_stack([
        rng.normal(40, 15, n_normal),       # speed
        rng.normal(2, 1, n_normal),          # acceleration
        rng.normal(10, 5, n_normal),         # gps_accuracy
        rng.normal(5, 3, n_normal),          # heading_change
        rng.normal(0, 0.1, n_normal),        # mock_location
        rng.normal(-70, 10, n_normal),       # signal_strength
        rng.normal(0.9, 0.1, n_normal),      # route_consistency
        rng.normal(5, 3, n_normal),          # timestamp_delta
        rng.normal(1, 0.5, n_normal),        # distance_from_last
    ])
    anomaly = np.column_stack([
        rng.normal(200, 50, n_anomaly),
        rng.normal(20, 10, n_anomaly),
        rng.normal(100, 30, n_anomaly),
        rng.normal(90, 20, n_anomaly),
        rng.normal(1, 0.2, n_anomaly),
        rng.normal(-120, 10, n_anomaly),
        rng.normal(0.1, 0.1, n_anomaly),
        rng.normal(60, 20, n_anomaly),
        rng.normal(50, 10, n_anomaly),
    ])
    return np.vstack([normal, anomaly])

def _generate_fraud_sample_data() -> np.ndarray:
    rng = np.random.default_rng(42)
    n_normal = 194
    n_anomaly = 6
    normal = np.column_stack([
        rng.normal(30, 15, n_normal),       # completion_time
        rng.normal(15, 8, n_normal),         # travel_time
        rng.normal(30, 20, n_normal),        # stay_duration
        rng.normal(0, 0.3, n_normal),        # disputes
        rng.normal(0, 0.5, n_normal),        # complaints
        rng.normal(0, 0.1, n_normal),        # fraud_history
        rng.normal(90, 10, n_normal),        # gps_trust
        rng.normal(3, 1.5, n_normal),        # jobs_per_day
        rng.normal(5, 5, n_normal),          # cancellation_rate
        rng.normal(2, 3, n_normal),          # reassignment_rate
        rng.normal(0, 0.2, n_normal),        # cash_disputes
        rng.normal(0, 0.1, n_normal),        # payout_anomalies
        rng.normal(80, 15, n_normal),        # reputation_score
    ])
    anomaly = np.column_stack([
        rng.normal(5, 3, n_anomaly),
        rng.normal(2, 2, n_anomaly),
        rng.normal(120, 40, n_anomaly),
        rng.normal(5, 2, n_anomaly),
        rng.normal(8, 3, n_anomaly),
        rng.normal(1, 0.3, n_anomaly),
        rng.normal(20, 15, n_anomaly),
        rng.normal(0.2, 0.2, n_anomaly),
        rng.normal(60, 20, n_anomaly),
        rng.normal(40, 15, n_anomaly),
        rng.normal(5, 2, n_anomaly),
        rng.normal(3, 1, n_anomaly),
        rng.normal(20, 10, n_anomaly),
    ])
    return np.vstack([normal, anomaly])

def _engineer_dispute_features(df: pd.DataFrame) -> pd.DataFrame:
    data = df.copy()
    data["category_encoded"] = data["category"].map({
        "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2,
        "PAINTING": 3, "CARPENTRY": 4, "MOVING": 5,
        "GARDENING": 6, "APPLIANCE_REPAIR": 7, "IT_SUPPORT": 8,
        "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
        "DELIVERY": 12, "OTHER": 13
    }).fillna(13)
    data["payment_type_encoded"] = data.get("payment_method", pd.Series(["ONLINE"])).map({
        "ONLINE": 0, "CASH": 1, "BOTH": 2
    }).fillna(0)
    data["is_high_value"] = (data["job_amount"] > 1000).astype(int)
    data["hour_of_day"] = pd.to_datetime(data["job_created_at"]).dt.hour
    data["day_of_week"] = pd.to_datetime(data["job_created_at"]).dt.dayofweek
    data["user_tenure_days"] = 30
    data["worker_fraud_probability"] = 0.0
    for col in ["job_amount", "job_duration_minutes", "worker_trust_score",
                "worker_reliability_score", "worker_dispute_history",
                "user_payment_trust_score", "user_dispute_history"]:
        if col in data.columns:
            data[col] = pd.to_numeric(data[col], errors="coerce").fillna(0)
    return data

# ─── FastAPI App ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("ML Engine starting up...")
    # ─── Acceptance Model ────────────────────────────────────────────────
    try:
        df = fetch_training_data()
        if not df.empty:
            df = engineer_features(df)
            lgb_model = train_lightgbm(df, ALL_FEATURES)
            metrics = evaluate_model(lgb_model, df, ALL_FEATURES)
            logger.info(f"Acceptance model trained. AUC: {metrics['auc']:.4f}")
            registry.register(
                "acceptance_model", "1.0.0", lgb_model,
                {"is_production": True, "model_type": "RANKING", "metrics": metrics,
                 "type": "lightgbm", "features": ALL_FEATURES,
                 "trained_at": datetime.utcnow().isoformat()}
            )
        else:
            logger.warning("No acceptance training data. Using fallback.")
            registry.register_specialized("acceptance", fallback_model)
    except Exception as e:
        logger.error(f"Acceptance model startup failed: {e}")
        registry.register_specialized("acceptance", fallback_model)

    # ─── GPS Spoof Detector ──────────────────────────────────────────────
    try:
        gps_detector = GPSSpoofDetector(model_path=os.path.join(MODEL_DIR, "gps_spoof"))
        X_gps = _generate_gps_sample_data()
        gps_detector.fit(X_gps)
        registry.register_specialized("gps_risk", gps_detector)
        logger.info("GPS Spoof Detector initialized.")
    except Exception as e:
        logger.error(f"GPS model startup failed: {e}")

    # ─── Worker Fraud Detector ───────────────────────────────────────────
    try:
        fraud_detector = WorkerFraudDetector(model_path=os.path.join(MODEL_DIR, "fraud"))
        X_fraud = _generate_fraud_sample_data()
        fraud_detector.fit(X_fraud)
        registry.register_specialized("fraud", fraud_detector)
        logger.info("Worker Fraud Detector initialized.")
    except Exception as e:
        logger.error(f"Fraud model startup failed: {e}")

    # ─── Dispute Risk Model ──────────────────────────────────────────────
    try:
        dispute_model = DisputeRiskModel(model_path=os.path.join(MODEL_DIR, "dispute"))
        dispute_df = fetch_dispute_training_data(DB_DSN)
        non_dispute_df = fetch_non_dispute_training_data(DB_DSN)
        if not dispute_df.empty:
            combined = pd.concat([dispute_df, non_dispute_df], ignore_index=True)
            combined = _engineer_dispute_features(combined)
            dispute_model.train(combined)
            logger.info(f"Dispute Risk Model trained. AUC: {dispute_model.metrics.get('auc', 0):.4f}")
            registry.register(
                "dispute_model", dispute_model.version, dispute_model,
                {"is_production": True, "model_type": "DISPUTE", "metrics": dispute_model.metrics,
                 "type": "lightgbm", "features": DISPUTE_FEATURES,
                 "trained_at": datetime.utcnow().isoformat()}
            )
        else:
            logger.warning("No dispute training data. Using uncalibrated model.")
            registry.register_specialized("dispute", dispute_model)
    except Exception as e:
        logger.error(f"Dispute model startup failed: {e}")
        registry.register_specialized("dispute", DisputeRiskModel())

    # ─── ETA Prediction Model ───────────────────────────────────────────
    try:
        eta_model = ETAPredictionModel(model_path=os.path.join(MODEL_DIR, "eta"))
        eta_df = fetch_eta_training_data(DB_DSN)
        if not eta_df.empty:
            eta_model.train(eta_df)
            logger.info(f"ETA Model trained. MAE: {eta_model.metrics.get('mae', 0):.2f}")
        registry.register_specialized("eta", eta_model)
    except Exception as e:
        logger.error(f"ETA model startup failed: {e}")
        registry.register_specialized("eta", ETAPredictionModel())

    # ─── Reliability Model ────────────────────────────────────────────
    try:
        rel_model = WorkerReliabilityModel(model_path=os.path.join(MODEL_DIR, "reliability"))
        rel_df = fetch_reliability_training_data(DB_DSN)
        if not rel_df.empty and "completed_successfully" in rel_df.columns:
            metrics = rel_model.train(rel_df)
            logger.info(f"Reliability model trained. AUC: {metrics['auc']:.4f}")
            registry.register("reliability_model", rel_model.version, rel_model, {
                "is_production": True, "model_type": "RELIABILITY", "metrics": metrics,
                "type": "lightgbm", "features": WorkerReliabilityModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("reliability", rel_model)
    except Exception as e:
        logger.error(f"Reliability model startup failed: {e}")
        registry.register_specialized("reliability", WorkerReliabilityModel())

    # ─── No-Show Model ────────────────────────────────────────────────
    try:
        ns_model = NoShowModel(model_path=os.path.join(MODEL_DIR, "no_show"))
        ns_df = fetch_no_show_training_data(DB_DSN)
        if not ns_df.empty and "was_no_show" in ns_df.columns:
            from sklearn.model_selection import train_test_split
            X_ns = ns_df[NoShowModel.FEATURE_COLUMNS]
            y_ns = ns_df["was_no_show"].astype(int)
            X_tr, X_va, y_tr, y_va = train_test_split(X_ns, y_ns, test_size=0.2, random_state=42)
            train_data = lgb.Dataset(X_tr, label=y_tr)
            val_data = lgb.Dataset(X_va, label=y_va, reference=train_data)
            ns_model.model = lgb.train({
                "objective": "binary", "metric": "auc", "boosting_type": "gbdt",
                "num_leaves": 31, "learning_rate": 0.05, "verbose": -1, "seed": 42,
            }, train_data, num_boost_round=200,
                valid_sets=[train_data, val_data], valid_names=["train", "val"],
                callbacks=[lgb.early_stopping(20), lgb.log_evaluation(0)])
            from sklearn.metrics import roc_auc_score
            auc = roc_auc_score(y_va, ns_model.model.predict(X_va))
            ns_model.version = datetime.utcnow().strftime(ns_model.VERSION_FORMAT)
            ns_model.metrics = {"auc": float(auc), "training_samples": len(X_tr)}
            logger.info(f"No-show model trained. AUC: {auc:.4f}")
            registry.register("no_show_model", ns_model.version, ns_model, {
                "is_production": True, "model_type": "NO_SHOW", "metrics": ns_model.metrics,
                "type": "lightgbm", "features": NoShowModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("no_show", ns_model)
    except Exception as e:
        logger.error(f"No-show model startup failed: {e}")
        registry.register_specialized("no_show", NoShowModel())

    # ─── Bandit Model ─────────────────────────────────────────────────
    try:
        bandit_model = BanditModel()
        registry.register_specialized("bandit", bandit_model)
        logger.info("Bandit model initialized.")
    except Exception as e:
        logger.error(f"Bandit model startup failed: {e}")

    # ─── Fatigue ML Model ─────────────────────────────────────────────
    try:
        fatigue_model = FatigueMLModel(model_path=os.path.join(MODEL_DIR, "fatigue"))
        fatigue_df = fetch_fatigue_training_data(DB_DSN)
        if not fatigue_df.empty and "fatigue_label" in fatigue_df.columns:
            metrics = fatigue_model.train(fatigue_df)
            logger.info(f"Fatigue ML model trained. MAE: {metrics['mae']:.4f}")
            registry.register("fatigue_model", fatigue_model.version, fatigue_model, {
                "is_production": True, "model_type": "FATIGUE", "metrics": metrics,
                "type": "lightgbm", "features": FatigueMLModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("fatigue", fatigue_model)
    except Exception as e:
        logger.error(f"Fatigue ML model startup failed: {e}")
        registry.register_specialized("fatigue", FatigueMLModel())

    # ─── Skill Confidence Model ──────────────────────────────────────
    try:
        sc_model = SkillConfidenceModel(model_path=os.path.join(MODEL_DIR, "skill_confidence"))
        sc_df = fetch_skill_confidence_training_data(DB_DSN)
        if not sc_df.empty and "quality_score" in sc_df.columns:
            metrics = sc_model.train(sc_df)
            logger.info(f"Skill Confidence model trained. MAE: {metrics['mae']:.4f}")
            registry.register("skill_confidence_model", sc_model.version, sc_model, {
                "is_production": True, "model_type": "SKILL_CONFIDENCE", "metrics": metrics,
                "type": "lightgbm", "features": SkillConfidenceModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("skill_confidence", sc_model)
    except Exception as e:
        logger.error(f"Skill Confidence model startup failed: {e}")
        registry.register_specialized("skill_confidence", SkillConfidenceModel())

    # ─── Availability Model ────────────────────────────────────────────
    try:
        av_model = WorkerAvailabilityModel(model_path=os.path.join(MODEL_DIR, "availability"))
        av_df = fetch_availability_training_data(DB_DSN)
        if not av_df.empty and "was_online_next_hour" in av_df.columns:
            metrics = av_model.train(av_df)
            logger.info(f"Availability model trained. AUC: {metrics['auc']:.4f}")
            registry.register("availability_model", av_model.version, av_model, {
                "is_production": True, "model_type": "AVAILABILITY", "metrics": metrics,
                "type": "lightgbm", "features": WorkerAvailabilityModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("availability", av_model)
    except Exception as e:
        logger.error(f"Availability model startup failed: {e}")
        registry.register_specialized("availability", WorkerAvailabilityModel())

    # ─── Demand Forecast Model ────────────────────────────────────────
    try:
        df_model = DemandForecastModel(model_path=os.path.join(MODEL_DIR, "demand_forecast"))
        demand_df = fetch_demand_forecast_training_data(DB_DSN)
        if not demand_df.empty and "jobs_posted_next_hour" in demand_df.columns:
            metrics = df_model.train(demand_df)
            logger.info(f"Demand Forecast model trained. MAE: {metrics['mae']:.4f}")
            registry.register("demand_forecast_model", df_model.version, df_model, {
                "is_production": True, "model_type": "DEMAND_FORECAST", "metrics": metrics,
                "type": "lightgbm", "features": DemandForecastModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("demand_forecast", df_model)
    except Exception as e:
        logger.error(f"Demand Forecast model startup failed: {e}")
        registry.register_specialized("demand_forecast", DemandForecastModel())

    # ─── Recommendation Model ─────────────────────────────────────────
    try:
        rec_model = RecommendationModel(model_path=os.path.join(MODEL_DIR, "recommendation"))
        rec_df = fetch_recommendation_training_data(DB_DSN)
        if not rec_df.empty and "was_hired" in rec_df.columns:
            metrics = rec_model.train(rec_df)
            logger.info(f"Recommendation model trained. AUC: {metrics.get('auc', 0):.4f}")
            registry.register("recommendation_model", rec_model.version, rec_model, {
                "is_production": True, "model_type": "RECOMMENDATION", "metrics": metrics,
                "type": "lightgbm", "features": RecommendationModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("recommendation", rec_model)
    except Exception as e:
        logger.error(f"Recommendation model startup failed: {e}")
        registry.register_specialized("recommendation", RecommendationModel())

    # ─── Reputation Model ──────────────────────────────────────────────
    try:
        rep_model = WorkerReputationModel(model_path=os.path.join(MODEL_DIR, "reputation"))
        rep_df = fetch_reputation_training_data(DB_DSN)
        if not rep_df.empty and "computed_reputation" in rep_df.columns:
            metrics = rep_model.train(rep_df)
            logger.info(f"Reputation model trained. MAE: {metrics['mae']:.4f}")
            registry.register("reputation_model", rep_model.version, rep_model, {
                "is_production": True, "model_type": "REPUTATION", "metrics": metrics,
                "type": "lightgbm", "features": WorkerReputationModel.FEATURE_COLUMNS,
                "trained_at": datetime.utcnow().isoformat()})
        else:
            registry.register_specialized("reputation", rep_model)
    except Exception as e:
        logger.error(f"Reputation model startup failed: {e}")
        registry.register_specialized("reputation", WorkerReputationModel())

    logger.info("ML Engine startup complete.")
    yield
    logger.info("ML Engine shutting down.")

# ─── Prometheus Metrics ───────────────────────────────────────────────────────
ML_PREDICTION_DURATION = Histogram("ml_prediction_duration_ms", "ML prediction duration", buckets=[5, 10, 25, 50, 100, 250, 500, 1000])
ML_TRAINING_DURATION = Histogram("ml_training_duration_seconds", "ML training duration in seconds", buckets=[1, 5, 10, 30, 60, 120, 300])
ML_MODEL_AUC = Gauge("ml_model_auc", "Active model AUC score", ["model_type"])
DB_QUERY_DURATION = Histogram("ml_db_query_duration_ms", "ML service DB query duration", buckets=[1, 5, 10, 25, 50, 100, 250, 500])

app = FastAPI(title="Shramik Shakti ML Engine", version="2.0.0", lifespan=lifespan)

@app.get("/health")
def health():
    active, meta = registry.get_active()
    return {
        "status": "healthy",
        "service": "ml_engine_v2",
        "model_loaded": active is not None,
        "active_model_version": meta.get("version") if meta else None,
        "models": {
            "acceptance": registry.get_specialized("acceptance") is not None,
            "gps_risk": registry.get_specialized("gps_risk") is not None,
            "fraud": registry.get_specialized("fraud") is not None,
            "dispute": registry.get_specialized("dispute") is not None,
            "eta": registry.get_specialized("eta") is not None,
            "reliability": registry.get_specialized("reliability") is not None,
            "no_show": registry.get_specialized("no_show") is not None,
            "fatigue": registry.get_specialized("fatigue") is not None,
            "skill_confidence": registry.get_specialized("skill_confidence") is not None,
            "bandit": registry.get_specialized("bandit") is not None,
            "availability": registry.get_specialized("availability") is not None,
            "demand_forecast": registry.get_specialized("demand_forecast") is not None,
            "recommendation": registry.get_specialized("recommendation") is not None,
            "reputation": registry.get_specialized("reputation") is not None,
        },
        "timestamp": datetime.utcnow().isoformat(),
    }

@app.post("/predict/ranking", response_model=RankingResponse)
def predict_ranking(req: RankingRequest):
    try:
        active_model, active_meta = registry.get_active()
        model = active_model or registry.get_specialized("acceptance") or fallback_model
        using_fallback = model is None or model is fallback_model
        model_type = (active_meta or {}).get("type", "fallback")
        model_version = (active_meta or {}).get("version", "0.0.0-fallback")
    except:
        model = fallback_model
        model_type = "fallback"
        model_version = "0.0.0-fallback"
        using_fallback = True
    workers_data = [w.model_dump() for w in req.workers]
    df = pd.DataFrame(workers_data)
    missing = [c for c in ALL_FEATURES if c not in df.columns]
    for c in missing:
        df[c] = 0.0
    feature_cols = [c for c in ALL_FEATURES if c in df.columns]
    if using_fallback or model_type == "fallback":
        scores = model.predict(df[feature_cols])
    else:
        scores = model.predict_proba(df[feature_cols])[:, 1]
    if req.use_exploration:
        rng = np.random.default_rng()
        explore_mask = rng.random(len(scores)) < req.exploration_rate
        if explore_mask.any():
            explore_scores = rng.random(explore_mask.sum()) * 0.5 + 0.3
            scores[explore_mask] = np.maximum(scores[explore_mask], explore_scores)
    results = []
    for i, w in enumerate(req.workers):
        results.append({
            "worker_id": w.worker_id,
            "score": float(scores[i]),
            "model_version": model_version,
            "model_type": model_type,
            "is_exploration": bool(req.use_exploration and scores[i] > 0 and i < len(scores)),
        })
    return RankingResponse(
        scores=results,
        model_version=model_version,
        model_type=model_type,
        using_fallback=using_fallback,
        timestamp=datetime.utcnow().isoformat(),
    )

@app.post("/predict/acceptance")
def predict_acceptance(features: dict):
    try:
        active_model, active_meta = registry.get_active()
        model = active_model or registry.get_specialized("acceptance") or fallback_model
    except:
        model = fallback_model
    df = pd.DataFrame([features])
    for c in ALL_FEATURES:
        if c not in df.columns:
            df[c] = 0.0
    feature_cols = [c for c in ALL_FEATURES if c in df.columns]
    try:
        prob = float(model.predict_proba(df[feature_cols])[:, 1][0])
    except:
        prob = float(fallback_model.predict(df[feature_cols])[0])
    return {"acceptance_probability": prob}

# ─── GPS Spoof Detection ──────────────────────────────────────────────────
class GpsSpoofRequest(BaseModel):
    lat: float
    lng: float
    prev_lat: Optional[float] = None
    prev_lng: Optional[float] = None
    timestamp: Optional[str] = None
    prev_timestamp: Optional[str] = None
    mock_location: bool = False
    gps_accuracy: float = 10.0
    heading_change: float = 0.0
    signal_strength: float = -70.0

@app.post("/predict/gps-spoof")
def predict_gps_spoof(req: GpsSpoofRequest):
    detector = registry.get_specialized("gps_risk")
    if not detector:
        return {"gps_trust_score": 100, "alerts": [], "is_suspicious": False}
    now = datetime.utcnow()
    prev_ts = now
    if req.prev_timestamp:
        try:
            prev_ts = datetime.fromisoformat(req.prev_timestamp)
        except:
            pass
    if req.timestamp:
        try:
            now = datetime.fromisoformat(req.timestamp)
        except:
            pass
    rule_result = detector.rule_based_check(
        req.lat, req.lng,
        req.prev_lat or req.lat, req.prev_lng or req.lng,
        now, prev_ts,
        mock_location=req.mock_location
    )
    features = {
        "speed_kmh": 0,
        "acceleration": 0,
        "gps_accuracy_m": req.gps_accuracy,
        "heading_change": req.heading_change,
        "mock_location_flag": 1 if req.mock_location else 0,
        "signal_strength": req.signal_strength,
        "route_consistency": 1.0,
        "timestamp_delta": 0,
        "distance_from_last": 0,
    }
    ml_score = detector.predict_anomaly_score(features)
    final_score = float(min(100, (rule_result["gps_trust_score"] * 0.6 + ml_score * 0.4)))
    return {
        "gps_trust_score": float(round(final_score, 2)),
        "alerts": rule_result["alerts"],
        "is_suspicious": bool(final_score < 60),
        "ml_score": float(round(ml_score, 2)),
        "rule_score": float(rule_result["gps_trust_score"]),
    }

class GpsBatchRequest(BaseModel):
    readings: List[dict]

@app.post("/predict/gps-spoof/batch")
def predict_gps_spoof_batch(req: GpsBatchRequest):
    detector = registry.get_specialized("gps_risk")
    if not detector:
        return {"scores": [100] * len(req.readings)}
    scores = detector.predict_batch(req.readings)
    return {"scores": [round(float(s), 2) for s in scores]}

# ─── Worker Fraud Detection ────────────────────────────────────────────────
class FraudRequest(BaseModel):
    features: dict

@app.post("/predict/fraud")
def predict_fraud(req: FraudRequest):
    detector = registry.get_specialized("fraud")
    if not detector:
        return {"fraud_probability": 0.0, "risk_level": "NORMAL", "actions": ["continue_monitoring"]}
    prob = detector.predict_fraud_probability(req.features)
    risk_level = detector.get_risk_level(prob)
    actions = detector.get_actions(risk_level)
    return {
        "fraud_probability": round(prob, 4),
        "risk_level": risk_level,
        "actions": actions,
    }

class FraudBatchRequest(BaseModel):
    features_list: List[dict]

@app.post("/predict/fraud/batch")
def predict_fraud_batch(req: FraudBatchRequest):
    detector = registry.get_specialized("fraud")
    if not detector:
        return {"probabilities": [0.0] * len(req.features_list)}
    probs = detector.predict_batch(req.features_list)
    return {"probabilities": [round(float(p), 4) for p in probs]}

# ─── Dispute Risk Prediction ──────────────────────────────────────────────
class DisputeRiskRequest(BaseModel):
    features: dict

@app.post("/predict/dispute-risk")
def predict_dispute_risk(req: DisputeRiskRequest):
    model = registry.get_specialized("dispute")
    if not model:
        return {"dispute_risk": 0.0, "risk_band": "LOW", "recommendation": "auto_resolve", "requires_review": False}
    risk = model.predict_dispute_risk(req.features)
    band = model.get_risk_band(risk)
    settlement = model.get_settlement_suggestion(risk, req.features.get("job_amount", 0))
    return {
        "dispute_risk": round(risk, 4),
        **band,
        **settlement,
    }

@app.post("/train")
def train_model(req: TrainingRequest):
    df = fetch_training_data()
    if df.empty:
        raise HTTPException(status_code=400, detail="No training data available")
    df = engineer_features(df)
    t0 = datetime.utcnow()
    lgb_model = train_lightgbm(df, ALL_FEATURES)
    xgb_model = train_xgboost(df, ALL_FEATURES)
    lgb_metrics = evaluate_model(lgb_model, df, ALL_FEATURES)
    xgb_metrics = evaluate_model(xgb_model, df, ALL_FEATURES)
    duration = (datetime.utcnow() - t0).total_seconds()
    best = "lightgbm" if lgb_metrics["auc"] >= xgb_metrics["auc"] else "xgboost"
    best_model = lgb_model if best == "lightgbm" else xgb_model
    best_metrics = lgb_metrics if best == "lightgbm" else xgb_metrics
    existing, meta = registry.get_active()
    major = 1
    if meta:
        parts = meta.get("version", "1.0.0").split(".")
        major = int(parts[0])
        if req.force_full_retrain:
            major += 1
        else:
            major = int(parts[0])
    version = f"{major}.{datetime.utcnow().strftime('%Y%m%d')}.0"
    path = os.path.join(MODEL_DIR, f"{req.model_name}_{version}.joblib")
    joblib.dump(best_model, path)
    registry.register(req.model_name, version, best_model, {
        "is_production": True,
        "metrics": best_metrics,
        "type": best,
        "features": ALL_FEATURES,
        "version": version,
        "trained_at": datetime.utcnow().isoformat(),
        "training_duration": duration,
        "artifact_path": path,
    })
    # Save XGBoost as secondary
    xgb_path = os.path.join(MODEL_DIR, f"{req.model_name}_{version}_xgboost.joblib")
    joblib.dump(xgb_model, xgb_path)
    metrics = {"lightgbm": lgb_metrics, "xgboost": xgb_metrics, "best": best}
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO model_registry
                (model_name, model_version, model_type, artifact_path, feature_schema,
                 training_date, training_duration_seconds, training_rows_count,
                 evaluation_metrics, status, is_production)
            VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
        """, (
            req.model_name, version, best, path,
            json.dumps(FEATURE_SCHEMA), duration, len(df),
            json.dumps(metrics)
        ))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to persist model to registry: {e}")
    return {
        "success": True,
        "model_version": version,
        "best_model": best,
        "metrics": metrics,
        "training_rows": len(df),
        "training_duration_seconds": duration,
    }

@app.get("/models")
def list_models():
    model_names = ["acceptance_model", "dispute_model", "gps_model", "fraud_model",
                    "eta_model", "reliability_model", "no_show_model", "fatigue_model",
                    "skill_confidence_model", "availability_model", "demand_forecast_model",
                    "recommendation_model", "reputation_model"]
    all_db_versions = {}
    try:
        conn = get_db()
        cur = conn.cursor()
        for mname in model_names:
            cur.execute("""
                SELECT model_version, model_type, training_date, evaluation_metrics, status, is_production
                FROM model_registry WHERE model_name = %s
                ORDER BY training_date DESC LIMIT 5
            """, (mname,))
            rows = cur.fetchall()
            all_db_versions[mname] = [
                {"version": r[0], "type": r[1], "trained_at": r[2].isoformat() if r[2] else None,
                 "metrics": r[3], "status": r[4], "is_production": r[5]}
                for r in rows
            ]
        cur.close()
        conn.close()
    except:
        all_db_versions = {}
    return {
        "specialized_models": {
            "acceptance": registry.get_specialized("acceptance") is not None,
            "gps_risk": registry.get_specialized("gps_risk") is not None,
            "fraud": registry.get_specialized("fraud") is not None,
            "dispute": registry.get_specialized("dispute") is not None,
            "eta": registry.get_specialized("eta") is not None,
            "reliability": registry.get_specialized("reliability") is not None,
            "no_show": registry.get_specialized("no_show") is not None,
            "fatigue": registry.get_specialized("fatigue") is not None,
            "skill_confidence": registry.get_specialized("skill_confidence") is not None,
            "bandit": registry.get_specialized("bandit") is not None,
            "availability": registry.get_specialized("availability") is not None,
            "demand_forecast": registry.get_specialized("demand_forecast") is not None,
            "recommendation": registry.get_specialized("recommendation") is not None,
            "reputation": registry.get_specialized("reputation") is not None,
        },
        "db_versions": all_db_versions,
        "feature_schema": FEATURE_SCHEMA,
    }

# ─── Specialized Training Endpoints ──────────────────────────────────────
class SpecializedTrainingRequest(BaseModel):
    force_full_retrain: bool = False

@app.post("/train/gps")
def train_gps_model(req: SpecializedTrainingRequest):
    try:
        detector = GPSSpoofDetector(model_path=os.path.join(MODEL_DIR, "gps_spoof"))
        X_gps = _generate_gps_sample_data()
        detector.fit(X_gps)
        registry.register_specialized("gps_risk", detector)
        path = detector.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry
                    (model_name, model_version, model_type, artifact_path,
                     training_date, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, NOW(), %s, %s, 'active', TRUE)
            """, ("gps_model", detector.version or "unknown", "GPS_RISK", path,
                  len(X_gps), json.dumps({"algorithm": "isolation_forest", "contamination": 0.05})))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist GPS model: {e}")
        return {"success": True, "model_type": "GPS_RISK", "version": detector.version}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/train/fraud")
def train_fraud_model(req: SpecializedTrainingRequest):
    try:
        detector = WorkerFraudDetector(model_path=os.path.join(MODEL_DIR, "fraud"))
        X_fraud = _generate_fraud_sample_data()
        detector.fit(X_fraud)
        registry.register_specialized("fraud", detector)
        path = detector.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry
                    (model_name, model_version, model_type, artifact_path,
                     training_date, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, NOW(), %s, %s, 'active', TRUE)
            """, ("fraud_model", detector.version or "unknown", "FRAUD", path,
                  len(X_fraud), json.dumps({"algorithm": "isolation_forest", "contamination": 0.03})))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist fraud model: {e}")
        return {"success": True, "model_type": "FRAUD", "version": detector.version}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/train/dispute")
def train_dispute_model(req: SpecializedTrainingRequest):
    try:
        dispute_model = DisputeRiskModel(model_path=os.path.join(MODEL_DIR, "dispute"))
        dispute_df = fetch_dispute_training_data(DB_DSN)
        non_dispute_df = fetch_non_dispute_training_data(DB_DSN)
        if dispute_df.empty:
            raise HTTPException(status_code=400, detail="No dispute training data available")
        combined = pd.concat([dispute_df, non_dispute_df], ignore_index=True)
        combined = _engineer_dispute_features(combined)
        metrics = dispute_model.train(combined)
        registry.register_specialized("dispute", dispute_model)
        path = dispute_model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry
                    (model_name, model_version, model_type, artifact_path, feature_schema,
                     training_date, training_duration_seconds, training_rows_count,
                     evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("dispute_model", dispute_model.version or "unknown", "DISPUTE", path,
                  json.dumps({"features": DISPUTE_FEATURES}),
                  metrics.get("training_duration", 0), len(combined),
                  json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist dispute model: {e}")
        return {"success": True, "model_type": "DISPUTE", "version": dispute_model.version, "metrics": metrics}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── ETA Prediction ────────────────────────────────────────────────────
class ETAPredictionRequest(BaseModel):
    features: dict

@app.post("/predict/eta")
def predict_eta(req: ETAPredictionRequest):
    model = registry.get_specialized("eta")
    if not model:
        dist = req.features.get("distance_km", 5)
        eta = max(1, (dist / 20) * 60)
        return {"predicted_eta_minutes": round(eta, 1)}
    eta = model.predict_eta(req.features)
    return {"predicted_eta_minutes": eta}

class ETABatchRequest(BaseModel):
    features_list: List[dict]

@app.post("/predict/eta/batch")
def predict_eta_batch(req: ETABatchRequest):
    model = registry.get_specialized("eta")
    if not model:
        return {"etas": [max(1, (f.get("distance_km", 5) / 20) * 60) for f in req.features_list]}
    etas = model.predict_batch(req.features_list)
    return {"etas": [round(float(e), 1) for e in etas]}

@app.post("/train/eta")
def train_eta_model(req: SpecializedTrainingRequest):
    try:
        model = ETAPredictionModel(model_path=os.path.join(MODEL_DIR, "eta"))
        df = fetch_eta_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No ETA training data")
        metrics = model.train(df)
        registry.register_specialized("eta", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("eta_model", model.version or "unknown", "ETA", path,
                  json.dumps({"features": ETA_FEATURES}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist ETA model: {e}")
        return {"success": True, "model_type": "ETA", "version": model.version, "metrics": metrics}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Reliability Prediction ─────────────────────────────────────────
class ReliabilityRequest(BaseModel):
    features: dict

@app.post("/predict/reliability")
def predict_reliability(req: ReliabilityRequest):
    model = registry.get_specialized("reliability")
    if not model:
        return {"completion_probability": 0.85, "using_fallback": True}
    prob = model.predict_completion_probability(req.features)
    return {"completion_probability": prob, "using_fallback": False}

@app.post("/train/reliability")
def train_reliability_model(req: SpecializedTrainingRequest):
    try:
        model = WorkerReliabilityModel(model_path=os.path.join(MODEL_DIR, "reliability"))
        df = fetch_reliability_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No reliability training data")
        metrics = model.train(df)
        registry.register_specialized("reliability", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("reliability_model", model.version, "RELIABILITY", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist reliability model: {e}")
        return {"success": True, "model_type": "RELIABILITY", "version": model.version, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── No-Show Prediction ─────────────────────────────────────────────
class NoShowRequest(BaseModel):
    features: dict
    subject_type: str = "WORKER"

@app.post("/predict/no-show")
def predict_no_show(req: NoShowRequest):
    model = registry.get_specialized("no_show")
    if not model:
        heuristic = NoShowModel()
        prob = heuristic.predict_no_show_probability(req.features)
        return {"no_show_probability": prob, "risk_level": heuristic.get_risk_level(prob), "actions": heuristic.get_actions(prob), "using_fallback": True}
    prob = model.predict_no_show_probability(req.features, req.subject_type)
    return {"no_show_probability": prob, "risk_level": model.get_risk_level(prob), "actions": model.get_actions(prob), "using_fallback": False}

class NoShowBatchRequest(BaseModel):
    features_list: List[dict]
    subject_type: str = "WORKER"

@app.post("/predict/no-show/batch")
def predict_no_show_batch(req: NoShowBatchRequest):
    model = registry.get_specialized("no_show")
    if not model:
        heuristic = NoShowModel()
        probs = [heuristic.predict_no_show_probability(f) for f in req.features_list]
        return {"probabilities": probs}
    probs = model.predict_batch(req.features_list)
    return {"probabilities": [round(float(p), 4) for p in probs]}

@app.post("/train/no-show")
def train_no_show_model(req: SpecializedTrainingRequest):
    try:
        import lightgbm as lgb
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import roc_auc_score
        model = NoShowModel(model_path=os.path.join(MODEL_DIR, "no_show"))
        df = fetch_no_show_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No no-show training data")
        X = df[NoShowModel.FEATURE_COLUMNS]
        y = df["was_no_show"].astype(int)
        X_tr, X_va, y_tr, y_va = train_test_split(X, y, test_size=0.2, random_state=42)
        train_data = lgb.Dataset(X_tr, label=y_tr)
        val_data = lgb.Dataset(X_va, label=y_va, reference=train_data)
        model.model = lgb.train({
            "objective": "binary", "metric": "auc", "boosting_type": "gbdt",
            "num_leaves": 31, "learning_rate": 0.05, "verbose": -1, "seed": 42,
        }, train_data, num_boost_round=200,
            valid_sets=[train_data, val_data], valid_names=["train", "val"],
            callbacks=[lgb.early_stopping(20), lgb.log_evaluation(0)])
        auc = roc_auc_score(y_va, model.model.predict(X_va))
        model.version = datetime.utcnow().strftime(model.VERSION_FORMAT)
        model.metrics = {"auc": float(auc), "training_samples": len(X_tr), "validation_samples": len(X_va)}
        registry.register_specialized("no_show", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("no_show_model", model.version, "NO_SHOW", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(model.metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist no-show model: {e}")
        return {"success": True, "model_type": "NO_SHOW", "version": model.version, "metrics": model.metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Fatigue ML Prediction ──────────────────────────────────────────
class FatigueRequest(BaseModel):
    features: dict

@app.post("/predict/fatigue")
def predict_fatigue(req: FatigueRequest):
    model = registry.get_specialized("fatigue")
    if not model:
        heuristic = FatigueMLModel()
        score = heuristic._heuristic(req.features)
        return {"fatigue_score": score, "fatigue_band": heuristic.get_fatigue_band(score), "using_fallback": True}
    score = model.predict_fatigue(req.features)
    return {"fatigue_score": score, "fatigue_band": model.get_fatigue_band(score), "using_fallback": False}

@app.post("/train/fatigue")
def train_fatigue_model(req: SpecializedTrainingRequest):
    try:
        model = FatigueMLModel(model_path=os.path.join(MODEL_DIR, "fatigue"))
        df = fetch_fatigue_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No fatigue training data")
        metrics = model.train(df)
        registry.register_specialized("fatigue", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("fatigue_model", model.version, "FATIGUE", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist fatigue model: {e}")
        return {"success": True, "model_type": "FATIGUE", "version": model.version, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Skill Confidence Prediction ────────────────────────────────────
class SkillConfidenceRequest(BaseModel):
    features: dict

@app.post("/predict/skill-confidence")
def predict_skill_confidence(req: SkillConfidenceRequest):
    model = registry.get_specialized("skill_confidence")
    if not model:
        heuristic = SkillConfidenceModel()
        return {"confidence_score": heuristic._heuristic(req.features), "using_fallback": True}
    score = model.predict_confidence(req.features)
    return {"confidence_score": score, "using_fallback": False}

class SkillConfidenceBatchRequest(BaseModel):
    features_list: List[dict]

@app.post("/predict/skill-confidence/batch")
def predict_skill_confidence_batch(req: SkillConfidenceBatchRequest):
    model = registry.get_specialized("skill_confidence")
    if not model:
        heuristic = SkillConfidenceModel()
        scores = [heuristic._heuristic(f) for f in req.features_list]
        return {"confidence_scores": scores}
    scores = model.predict_batch(req.features_list)
    return {"confidence_scores": [round(float(s), 4) for s in scores]}

@app.post("/train/skill-confidence")
def train_skill_confidence_model(req: SpecializedTrainingRequest):
    try:
        model = SkillConfidenceModel(model_path=os.path.join(MODEL_DIR, "skill_confidence"))
        df = fetch_skill_confidence_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No skill confidence training data")
        metrics = model.train(df)
        registry.register_specialized("skill_confidence", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("skill_confidence_model", model.version, "SKILL_CONFIDENCE", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist skill confidence model: {e}")
            return {"success": False, "error": str(e)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # ─── Bandit (Multi-Armed Bandit) ───────────────────────────────────
class BanditSelectRequest(BaseModel):
    workers: List[dict]
    exploration_rate: float = 0.15

@app.post("/predict/bandit/select")
def bandit_select(req: BanditSelectRequest):
    model = registry.get_specialized("bandit")
    if not model:
        model = BanditModel()
        registry.register_specialized("bandit", model)
    selected = model.select(req.workers, req.exploration_rate)
    return {"selected_worker": selected}

class BanditRecordRequest(BaseModel):
    worker_id: str
    was_accepted: bool

@app.post("/predict/bandit/record")
def bandit_record(req: BanditRecordRequest):
    model = registry.get_specialized("bandit")
    if not model:
        return {"success": False, "error": "Bandit model not initialized"}
    model.record(req.worker_id, req.was_accepted)
    return {"success": True}

# ─── Availability Prediction ────────────────────────────────────────
class AvailabilityRequest(BaseModel):
    features: dict

@app.post("/predict/availability")
def predict_availability(req: AvailabilityRequest):
    model = registry.get_specialized("availability")
    if not model:
        heuristic = WorkerAvailabilityModel()
        return {"availability_probability": heuristic._heuristic(req.features), "using_fallback": True}
    prob = model.predict_availability(req.features)
    return {"availability_probability": prob, "using_fallback": False}

@app.post("/train/availability")
def train_availability_model(req: SpecializedTrainingRequest):
    try:
        model = WorkerAvailabilityModel(model_path=os.path.join(MODEL_DIR, "availability"))
        df = fetch_availability_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No availability training data")
        metrics = model.train(df)
        registry.register_specialized("availability", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("availability_model", model.version, "AVAILABILITY", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist availability model: {e}")
        return {"success": True, "model_type": "AVAILABILITY", "version": model.version, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Demand Forecast Prediction ─────────────────────────────────────
class DemandForecastRequest(BaseModel):
    features: dict

@app.post("/predict/demand-forecast")
def predict_demand_forecast(req: DemandForecastRequest):
    model = registry.get_specialized("demand_forecast")
    if not model:
        heuristic = DemandForecastModel()
        return {"predicted_demand": heuristic._heuristic(req.features), "using_fallback": True}
    pred = model.predict_demand(req.features)
    return {"predicted_demand": pred, "using_fallback": False}

@app.post("/train/demand-forecast")
def train_demand_forecast_model(req: SpecializedTrainingRequest):
    try:
        model = DemandForecastModel(model_path=os.path.join(MODEL_DIR, "demand_forecast"))
        df = fetch_demand_forecast_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No demand forecast training data")
        metrics = model.train(df)
        registry.register_specialized("demand_forecast", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("demand_forecast_model", model.version, "DEMAND_FORECAST", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist demand forecast model: {e}")
        return {"success": True, "model_type": "DEMAND_FORECAST", "version": model.version, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Recommendation Prediction ─────────────────────────────────────
class RecommendationRequest(BaseModel):
    user_features: dict
    available_workers: List[dict]
    top_n: int = 5

@app.post("/predict/recommendation")
def predict_recommendation(req: RecommendationRequest):
    model = registry.get_specialized("recommendation")
    if not model:
        model = RecommendationModel()
        registry.register_specialized("recommendation", model)
    recommendations = model.recommend(req.user_features, req.available_workers, req.top_n)
    return {"recommendations": recommendations}

@app.post("/train/recommendation")
def train_recommendation_model(req: SpecializedTrainingRequest):
    try:
        model = RecommendationModel(model_path=os.path.join(MODEL_DIR, "recommendation"))
        df = fetch_recommendation_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No recommendation training data")
        metrics = model.train(df)
        registry.register_specialized("recommendation", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("recommendation_model", model.version, "RECOMMENDATION", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist recommendation model: {e}")
        return {"success": True, "model_type": "RECOMMENDATION", "version": model.version, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Reputation Prediction ─────────────────────────────────────
class ReputationRequest(BaseModel):
    features: dict

@app.post("/predict/reputation")
def predict_reputation(req: ReputationRequest):
    model = registry.get_specialized("reputation")
    if not model:
        return {"reputation_score": 4.0, "using_fallback": True}
    score = model.predict_reputation(req.features)
    return {"reputation_score": score, "using_fallback": False}

class ReputationBatchRequest(BaseModel):
    features_list: List[dict]

@app.post("/predict/reputation/batch")
def predict_reputation_batch(req: ReputationBatchRequest):
    model = registry.get_specialized("reputation")
    if not model:
        heuristic = WorkerReputationModel()
        scores = [heuristic._heuristic(f) for f in req.features_list]
        return {"reputation_scores": scores}
    scores = model.predict_batch(req.features_list)
    return {"reputation_scores": [round(float(s), 2) for s in scores]}

@app.post("/train/reputation")
def train_reputation_model(req: SpecializedTrainingRequest):
    try:
        model = WorkerReputationModel(model_path=os.path.join(MODEL_DIR, "reputation"))
        df = fetch_reputation_training_data(DB_DSN)
        if df.empty:
            raise HTTPException(status_code=400, detail="No reputation training data")
        metrics = model.train(df)
        registry.register_specialized("reputation", model)
        path = model.save()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO model_registry (model_name, model_version, model_type, artifact_path, feature_schema,
                    training_date, training_duration_seconds, training_rows_count, evaluation_metrics, status, is_production)
                VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s, %s, 'active', TRUE)
            """, ("reputation_model", model.version, "REPUTATION", path,
                  json.dumps({"features": model.FEATURE_COLUMNS}), 0, len(df), json.dumps(metrics)))
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to persist reputation model: {e}")
        return {"success": True, "model_type": "REPUTATION", "version": model.version, "metrics": metrics}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Home Services Prediction (All-in-one for the home screen) ──
class HomeServicesRequest(BaseModel):
    categories: List[str]
    lat: float
    lng: float
    user_id: Optional[str] = None

@ML_PREDICTION_DURATION.time()
@app.post("/predict/home-services")
def predict_home_services(req: HomeServicesRequest):
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        now = datetime.utcnow()
        hour = now.hour
        day_of_week = now.weekday()
        is_weekend = 1 if day_of_week >= 5 else 0
        is_peak = 1 if hour in (8, 9, 10, 11, 17, 18, 19, 20, 21) else 0

        results = []
        for category in req.categories:
            cat_lower = category.lower()

            # --- LIVE DB METRICS ---
            # Online workers for this category
            cur.execute("""
                SELECT COUNT(*) FROM workers
                WHERE is_online = true
                AND is_available = true
                AND current_lat IS NOT NULL AND current_lng IS NOT NULL
                AND earth_distance(ll_to_earth(%s, %s), ll_to_earth(current_lat, current_lng)) / 1000.0 <= 30
                AND EXISTS (
                    SELECT 1 FROM unnest(skills) s WHERE LOWER(s) LIKE %s
                )
            """, (req.lat, req.lng, f'%{cat_lower}%'))
            online_workers = cur.fetchone()[0] or 0

            # Available workers
            cur.execute("""
                SELECT COUNT(*) FROM workers
                WHERE is_online = true
                AND is_available = true
                AND current_lat IS NOT NULL AND current_lng IS NOT NULL
            """)
            total_available = cur.fetchone()[0] or 0

            # Jobs in last 1h for demand
            cur.execute("""
                SELECT COUNT(*) FROM jobs
                WHERE LOWER(category) LIKE %s
                AND created_at >= NOW() - INTERVAL '1 hour'
                AND location_lat IS NOT NULL AND location_lng IS NOT NULL
                AND earth_distance(ll_to_earth(%s, %s), ll_to_earth(location_lat, location_lng)) / 1000.0 <= 30
            """, (f'%{cat_lower}%', req.lat, req.lng))
            jobs_last_1h = cur.fetchone()[0] or 0

            # Jobs in last 24h
            cur.execute("""
                SELECT COUNT(*) FROM jobs
                WHERE LOWER(category) LIKE %s
                AND created_at >= NOW() - INTERVAL '24 hours'
                AND location_lat IS NOT NULL AND location_lng IS NOT NULL
                AND earth_distance(ll_to_earth(%s, %s), ll_to_earth(location_lat, location_lng)) / 1000.0 <= 30
            """, (f'%{cat_lower}%', req.lat, req.lng))
            jobs_last_24h = cur.fetchone()[0] or 0

            # Average worker reputation for this category
            cur.execute("""
                SELECT COALESCE(AVG(w.rating), 0) FROM workers w
                WHERE EXISTS (
                    SELECT 1 FROM unnest(w.skills) s
                    WHERE LOWER(s) LIKE %s
                )
                AND w.current_lat IS NOT NULL AND w.current_lng IS NOT NULL
                AND earth_distance(ll_to_earth(%s, %s), ll_to_earth(w.current_lat, w.current_lng)) / 1000.0 <= 30
            """, (f'%{cat_lower}%', req.lat, req.lng))
            avg_reputation = float(cur.fetchone()[0] or 0)

            # Average worker skill confidence (try worker_features table, fall back to avg rating)
            skill_confidence = 0.0
            try:
                cur.execute("""
                    SELECT COALESCE(AVG(wf.quality_score), 0) FROM worker_features wf
                    JOIN workers w ON wf.worker_id = w.id
                    WHERE EXISTS (
                        SELECT 1 FROM unnest(w.skills) s
                        WHERE LOWER(s) LIKE %s
                    )
                """, (f'%{cat_lower}%',))
                skill_confidence = float(cur.fetchone()[0] or 0)
            except Exception:
                skill_confidence = avg_reputation / 5.0 if avg_reputation > 0 else 0.5

            # Average ETA (use actual arrival data)
            cur.execute("""
                SELECT COALESCE(AVG(
                    EXTRACT(EPOCH FROM (j.arrived_at - j.on_the_way_at)) / 60
                ), 0) FROM jobs j
                WHERE LOWER(j.category) LIKE %s
                AND j.status = 'COMPLETED'
                AND j.arrived_at IS NOT NULL
                AND j.on_the_way_at IS NOT NULL
                AND j.created_at >= NOW() - INTERVAL '30 days'
            """, (f'%{cat_lower}%',))
            avg_eta_raw = cur.fetchone()[0] or 0
            avg_eta = max(1, round(float(avg_eta_raw), 1))

            # --- ML PREDICTIONS ---

            # Availability prediction
            availability_model = registry.get_specialized("availability")
            if availability_model:
                av_features = {
                    "hour_of_day": hour, "day_of_week": day_of_week,
                    "is_weekend": is_weekend, "is_peak_hours": is_peak,
                    "avg_hours_online_last_7d": online_workers / max(total_available, 1) * 24,
                    "avg_hours_online_last_30d": online_workers / max(total_available, 1) * 24,
                    "jobs_completed_last_7d": jobs_last_24h // 3,
                    "jobs_completed_last_30d": jobs_last_24h,
                    "avg_response_time": 5.0,
                    "fatigue_score": 0.2,
                    "reliability_score": 0.9,
                    "historical_availability_rate": online_workers / max(total_available, 1),
                }
                availability_score = availability_model.predict_availability(av_features)
            else:
                availability_score = min(1.0, online_workers / max(total_available, 1, 1))

            # Demand forecast
            demand_model = registry.get_specialized("demand_forecast")
            if demand_model:
                df_features = {
                    "hour_of_day": hour, "day_of_week": day_of_week,
                    "is_weekend": is_weekend, "is_peak_hours": is_peak,
                    "month": now.month, "category_encoded": 0,
                    "jobs_posted_last_1h": jobs_last_1h,
                    "jobs_posted_last_24h": jobs_last_24h,
                    "active_workers_last_1h": online_workers,
                    "active_workers_last_24h": online_workers,
                    "avg_completion_time_minutes": avg_eta,
                    "completion_rate_last_24h": 0.85,
                    "is_holiday": 0, "price_avg_last_24h": 250,
                }
                demand_pred = demand_model.predict_demand(df_features)
            else:
                demand_pred = jobs_last_1h + (jobs_last_24h / 24)

            # Acceptance probability
            acceptance_model = registry.get_specialized("acceptance")
            if acceptance_model and hasattr(acceptance_model, 'predict_proba'):
                import pandas as pd
                acc_features = pd.DataFrame([{
                    "completion_rate": 100.0, "cancellation_rate": 0.0,
                    "avg_response_time": 5.0, "distance": 5.0,
                    "reliability_score": 0.9, "jobs_completed": max(jobs_last_24h, 1),
                    "online_consistency": 0.8, "worker_load": 0.3,
                    "fatigue_24h": 0.1, "fatigue_7d": 0.2, "fatigue_30d": 0.3,
                    "acceptance_rate": 0.9, "trust_score": 0.8,
                    "category_encoded": 0.0, "urgency_encoded": 1.0,
                    "price": 250.0, "schedule_type_encoded": 0.0,
                    "demand_pressure": min(1.0, jobs_last_1h / max(online_workers, 1)),
                }])
                for c in ALL_FEATURES:
                    if c not in acc_features.columns:
                        acc_features[c] = 0.0
                try:
                    acceptance_prob = float(acceptance_model.predict_proba(acc_features[ALL_FEATURES])[:, 1][0])
                except:
                    acceptance_prob = 0.85
            else:
                acceptance_prob = min(0.95, 0.5 + (online_workers / max(total_available, 1, 1)) * 0.3)

            # Skill confidence
            sc_model = registry.get_specialized("skill_confidence")
            if sc_model:
                sc_features = {
                    "jobs_completed_in_category": max(jobs_last_24h, 1),
                    "total_jobs_completed": max(jobs_last_24h * 2, 1),
                    "avg_rating_in_category": avg_reputation,
                    "overall_avg_rating": avg_reputation,
                    "recent_jobs_last_30d": jobs_last_24h,
                    "completion_rate": 95.0,
                    "avg_completion_time_minutes": avg_eta,
                    "category_encoded": 0,
                    "days_since_last_job_in_category": 1,
                    "repeat_customer_rate": 0.5,
                }
                sc_score = sc_model.predict_confidence(sc_features)
            else:
                sc_score = skill_confidence

            # Determine demand level
            if demand_pred > 20:
                demand = "VERY_HIGH"
            elif demand_pred > 10:
                demand = "HIGH"
            elif demand_pred > 5:
                demand = "NORMAL"
            else:
                demand = "LOW"

            # Determine status from availability
            if availability_score > 0.90:
                status = "AVAILABLE"
                status_label = "Available Now"
            elif availability_score > 0.70:
                status = "AVAILABLE"
                status_label = "Available"
            elif availability_score > 0.50:
                status = "BUSY"
                status_label = "Busy"
            elif availability_score > 0.30:
                status = "LIMITED"
                status_label = "Limited"
            else:
                status = "UNAVAILABLE"
                status_label = "Unavailable"

            results.append({
                "id": cat_lower.replace(" ", "_"),
                "name": category,
                "status": status,
                "statusLabel": status_label,
                "onlineWorkers": online_workers,
                "availableWorkers": total_available,
                "avgETA": avg_eta,
                "availabilityScore": round(float(availability_score), 4),
                "acceptanceProbability": round(float(acceptance_prob), 4),
                "avgReputation": round(avg_reputation, 2),
                "skillConfidence": round(float(sc_score), 4),
                "demand": demand,
                "serviceHealth": "GOOD" if availability_score > 0.5 else "WARNING" if availability_score > 0.3 else "CRITICAL",
                "demandPrediction": round(float(demand_pred), 2),
                "jobsLastHour": jobs_last_1h,
                "jobsLast24h": jobs_last_24h,
            })

        cur.close()
        conn.close()

        return {
            "success": True,
            "categories": results,
            "meta": {
                "generatedAt": datetime.utcnow().isoformat(),
                "models": {
                    "availability": registry.get_specialized("availability") is not None,
                    "demand_forecast": registry.get_specialized("demand_forecast") is not None,
                    "acceptance": registry.get_specialized("acceptance") is not None,
                    "eta": registry.get_specialized("eta") is not None,
                    "skill_confidence": registry.get_specialized("skill_confidence") is not None,
                    "reputation": registry.get_specialized("reputation") is not None,
                },
            },
        }
    except Exception as e:
        logger.error(f"Home services prediction failed: {e}")
        if conn:
            try:
                conn.close()
            except:
                pass
        return {
            "success": False,
            "error": str(e),
            "categories": [],
        }

@app.post("/models/rollback")
def rollback_model(target_version: str):
    model = registry.get("acceptance_model", target_version)
    if not model:
        raise HTTPException(status_code=404, detail=f"Version {target_version} not found")
    meta = registry.metadata.get(f"acceptance_model:{target_version}", {})
    registry.models["_active"] = model
    registry.metadata["_active"] = {**meta, "version": target_version, "is_production": True}
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("UPDATE model_registry SET is_production = FALSE WHERE model_name = 'acceptance_model'")
        cur.execute(
            "UPDATE model_registry SET is_production = TRUE WHERE model_name = 'acceptance_model' AND model_version = %s",
            (target_version,)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to update DB registry: {e}")
    return {"success": True, "rolled_back_to": target_version}

@app.get("/metrics")
def get_metrics():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT metric_name, metric_value, computed_at
            FROM model_metrics
            ORDER BY computed_at DESC LIMIT 50
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return {"metrics": [{"name": r[0], "value": r[1], "computed_at": r[2].isoformat()} for r in rows]}
    except:
        return {"metrics": []}

@app.get("/metrics/prometheus", response_class=PlainTextResponse)
def get_prometheus_metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
