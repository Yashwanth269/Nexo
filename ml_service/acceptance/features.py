import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional

class AcceptanceFeatureEngineer:
    FEATURE_COLUMNS = [
        "distance_km",
        "category_encoded",
        "price",
        "urgency",
        "hour_of_day",
        "day_of_week",
        "worker_load",
        "acceptance_rate",
        "completion_rate",
        "trust_score",
        "reliability_score",
        "response_score",
        "avg_response_time",
        "online_duration_hours",
        "jobs_today",
        "jobs_this_week",
        "recent_rejection_rate",
    ]

    CATEGORY_ENCODING = {
        "PLUMBING": 0, "ELECTRICIAN": 1, "CLEANING": 2,
        "PAINTING": 3, "CARPENTRY": 4, "MOVING": 5,
        "GARDENING": 6, "APPLIANCE_REPAIR": 7, "IT_SUPPORT": 8,
        "TUTORING": 9, "PHOTOGRAPHY": 10, "EVENT": 11,
        "DELIVERY": 12, "OTHER": 13
    }

    def __init__(self, db_pool):
        self.db_pool = db_pool

    async def build_training_features(self, job_offers):
        features = []
        for _, offer in job_offers.iterrows():
            feat = await self._extract_features(
                offer["job_id"], 
                offer["worker_id"],
                offer["created_at"]
            )
            if feat:
                feat["target"] = 1 if offer["status"] == "ACCEPTED" else 0
                features.append(feat)
        return pd.DataFrame(features)

    async def _extract_features(self, job_id, worker_id, offer_time):
        try:
            job = await self._get_job(job_id)
            worker = await self._get_worker(worker_id)
            reputation = await self._get_reputation(worker_id)
            recent_stats = await self._get_recent_stats(worker_id, offer_time)
            if not job or not worker:
                return None
            distance = self._calculate_distance(
                job["location_lat"], job["location_lng"],
                worker["current_lat"], worker["current_lng"]
            )
            return {
                "job_id": job_id,
                "worker_id": worker_id,
                "distance_km": distance,
                "category_encoded": self.CATEGORY_ENCODING.get(job["category"], 13),
                "price": float(job["price"]),
                "urgency": job.get("urgency", 1),
                "hour_of_day": offer_time.hour,
                "day_of_week": offer_time.weekday(),
                "worker_load": recent_stats["active_jobs"],
                "acceptance_rate": worker.get("acceptance_rate", 50),
                "completion_rate": worker.get("completion_rate", 100),
                "trust_score": reputation.get("trust_score", 50) if reputation else 50,
                "reliability_score": reputation.get("reliability_score", 50) if reputation else 50,
                "response_score": reputation.get("response_score", 50) if reputation else 50,
                "avg_response_time": worker.get("avg_response_time", 30),
                "online_duration_hours": recent_stats["online_hours"],
                "jobs_today": recent_stats["jobs_today"],
                "jobs_this_week": recent_stats["jobs_this_week"],
                "recent_rejection_rate": recent_stats["rejection_rate"],
            }
        except Exception as e:
            print(f"Feature extraction error: {e}")
            return None

    def _calculate_distance(self, lat1, lng1, lat2, lng2):
        if not all([lat1, lng1, lat2, lng2]):
            return 50.0
        from math import radians, sin, cos, sqrt, atan2
        R = 6371
        dlat = radians(lat2 - lat1)
        dlng = radians(lng2 - lng1)
        a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)**2
        return R * 2 * atan2(sqrt(a), sqrt(1-a))

    async def _get_job(self, job_id):
        query = "SELECT * FROM jobs WHERE id = $1"
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(query, job_id)
            return dict(row) if row else None

    async def _get_worker(self, worker_id):
        query = "SELECT w.*, wf.acceptance_rate, wf.completion_rate, wf.avg_response_time FROM workers w LEFT JOIN worker_features wf ON wf.worker_id = w.id WHERE w.id = $1"
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(query, worker_id)
            return dict(row) if row else None

    async def _get_reputation(self, worker_id):
        query = "SELECT * FROM worker_reputation_scores WHERE worker_id = $1"
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(query, worker_id)
            return dict(row) if row else None

    async def _get_recent_stats(self, worker_id, offer_time):
        cutoff_24h = offer_time - timedelta(hours=24)
        cutoff_7d = offer_time - timedelta(days=7)
        queries = {
            "active_jobs": "SELECT COUNT(*) FROM jobs WHERE worker_id = $1 AND status IN ('ACCEPTED', 'ON_THE_WAY', 'IN_PROGRESS')",
            "jobs_today": "SELECT COUNT(*) FROM jobs WHERE worker_id = $1 AND created_at >= $2 AND status = 'COMPLETED'",
            "jobs_this_week": "SELECT COUNT(*) FROM jobs WHERE worker_id = $1 AND created_at >= $2 AND status = 'COMPLETED'",
            "rejection_rate": "SELECT COUNT(*) FILTER (WHERE status = 'REJECTED')::float / NULLIF(COUNT(*), 0) FROM job_offers WHERE worker_id = $1 AND created_at >= $2",
        }
        stats = {}
        async with self.db_pool.acquire() as conn:
            for key, query in queries.items():
                if key in ["jobs_today", "jobs_this_week"]:
                    val = await conn.fetchval(query, worker_id, cutoff_24h if key == "jobs_today" else cutoff_7d)
                elif key == "rejection_rate":
                    val = await conn.fetchval(query, worker_id, cutoff_7d)
                else:
                    val = await conn.fetchval(query, worker_id)
                stats[key] = float(val) if val is not None else 0.0
        stats["online_hours"] = await self._get_online_hours(worker_id, offer_time)
        return stats

    async def _get_online_hours(self, worker_id, offer_time):
        cutoff = offer_time - timedelta(hours=24)
        query = "SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(offline_at, NOW()) - online_at))/3600) FROM worker_online_sessions WHERE worker_id = $1 AND online_at >= $2"
        async with self.db_pool.acquire() as conn:
            val = await conn.fetchval(query, worker_id, cutoff)
            return float(val) if val else 0.0

    def prepare_inference_features(self, features):
        row = [features.get(col, 0) for col in self.FEATURE_COLUMNS]
        return np.array(row).reshape(1, -1)
