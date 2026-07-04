"""
Standalone training pipeline.
Run daily for incremental training, weekly for full retraining.
Usage:
    python train_pipeline.py                    # daily incremental
    python train_pipeline.py --full             # weekly full retrain
    python train_pipeline.py --metrics-only     # compute metrics without retraining
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import psycopg2
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("train_pipeline")

ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://localhost:8000")
DB_DSN = os.getenv("DB_DSN", "postgresql://postgres:@localhost:5432/gigs_db")

METRIC_NAMES = [
    "acceptance_prediction_accuracy",
    "completion_prediction_accuracy",
    "cancellation_prediction_accuracy",
    "worker_ranking_ctr",
    "dispatch_success_rate",
]

def get_db():
    return psycopg2.connect(DB_DSN)

def compute_acceptance_accuracy():
    conn = get_db()
    query = """
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN jo.status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN jo.status = 'REJECTED' THEN 1 ELSE 0 END) as rejected
    FROM job_offers jo
    WHERE jo.created_at > NOW() - INTERVAL '7 days'
      AND jo.status IN ('ACCEPTED', 'REJECTED')
    """
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty or df.iloc[0]['total'] == 0:
        return 0.0
    row = df.iloc[0]
    return row['accepted'] / row['total'] if row['total'] > 0 else 0.0

def compute_completion_accuracy():
    conn = get_db()
    query = """
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
    FROM jobs
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND status IN ('COMPLETED', 'CANCELLED')
    """
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty or df.iloc[0]['total'] == 0:
        return 0.0
    row = df.iloc[0]
    return row['completed'] / row['total'] if row['total'] > 0 else 0.0

def compute_cancellation_accuracy():
    conn = get_db()
    query = """
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled
    FROM jobs
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND status IN ('COMPLETED', 'CANCELLED')
    """
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty or df.iloc[0]['total'] == 0:
        return 0.0
    row = df.iloc[0]
    return 1.0 - (row['cancelled'] / row['total']) if row['total'] > 0 else 0.0

def compute_ranking_ctr():
    conn = get_db()
    query = """
    SELECT
        COUNT(DISTINCT CASE WHEN action_type = 'click' THEN CONCAT(user_id, '_', worker_id) END) as clicks,
        COUNT(DISTINCT CONCAT(user_id, '_', worker_id)) as impressions
    FROM ranking_clicks
    WHERE created_at > NOW() - INTERVAL '7 days'
    """
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty or df.iloc[0]['impressions'] == 0:
        return 0.0
    row = df.iloc[0]
    return row['clicks'] / row['impressions'] if row['impressions'] > 0 else 0.0

def compute_dispatch_success_rate():
    conn = get_db()
    query = """
    WITH dispatched AS (
        SELECT DISTINCT job_id, worker_id, status
        FROM job_offers
        WHERE created_at > NOW() - INTERVAL '7 days'
    )
    SELECT
        COUNT(DISTINCT d.job_id) as total_dispatched,
        COUNT(DISTINCT CASE WHEN j.status = 'COMPLETED' THEN d.job_id END) as completed
    FROM dispatched d
    JOIN jobs j ON d.job_id = j.id
    """
    df = pd.read_sql(query, conn)
    conn.close()
    if df.empty or df.iloc[0]['total_dispatched'] == 0:
        return 0.0
    row = df.iloc[0]
    return row['completed'] / row['total_dispatched'] if row['total_dispatched'] > 0 else 0.0

def persist_metrics(metrics):
    conn = get_db()
    cur = conn.cursor()
    for name, value in metrics.items():
        cur.execute(
            "INSERT INTO model_metrics (model_version, metric_name, metric_value, metadata) VALUES (%s, %s, %s, %s)",
            [datetime.utcnow().strftime('%Y%m%d'), name, float(value), json.dumps({"source": "train_pipeline", "computed_at": datetime.utcnow().isoformat()})]
        )
    conn.commit()
    cur.close()
    conn.close()
    logger.info(f"Persisted {len(metrics)} metrics to model_metrics table")

def trigger_training(full_retrain=False):
    payload = {"force_full_retrain": full_retrain, "model_name": "acceptance_model"}
    try:
        resp = requests.post(f"{ML_SERVICE_URL}/train", json=payload, timeout=300)
        if resp.status_code == 200:
            result = resp.json()
            logger.info(f"Training complete. Version: {result.get('model_version')}, AUC: {result.get('metrics', {}).get('best', {}).get('auc', 'N/A')}")
            return result
        else:
            logger.error(f"Training request failed: {resp.status_code} {resp.text}")
    except requests.exceptions.RequestException as e:
        logger.error(f"Training request error: {e}")
    return None

def main():
    parser = argparse.ArgumentParser(description="Model Training Pipeline")
    parser.add_argument("--full", action="store_true", help="Full retraining (weekly)")
    parser.add_argument("--metrics-only", action="store_true", help="Only compute and persist metrics")
    args = parser.parse_args()

    logger.info(f"Starting training pipeline (full_retrain={args.full}, metrics_only={args.metrics_only})")

    metrics = {
        "acceptance_prediction_accuracy": compute_acceptance_accuracy(),
        "completion_prediction_accuracy": compute_completion_accuracy(),
        "cancellation_prediction_accuracy": compute_cancellation_accuracy(),
        "worker_ranking_ctr": compute_ranking_ctr(),
        "dispatch_success_rate": compute_dispatch_success_rate(),
    }

    logger.info(f"Computed metrics: {json.dumps(metrics, indent=2)}")
    persist_metrics(metrics)

    if not args.metrics_only:
        result = trigger_training(full_retrain=args.full)
        if result:
            metrics["training_auc"] = result.get("metrics", {}).get("best", {}).get("auc", 0)
            metrics["training_rows"] = result.get("training_rows", 0)
            persist_metrics({f"training_{k}": v for k, v in metrics.items() if k.startswith("training_")})
            logger.info(f"Training pipeline completed successfully. Model version: {result.get('model_version')}")
        else:
            logger.warning("Training failed, but metrics were still persisted.")

    logger.info("Pipeline finished.")

if __name__ == "__main__":
    main()
