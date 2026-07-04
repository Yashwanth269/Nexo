import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Set
from collections import defaultdict
import joblib
import networkx as nx

class CollusionDetector:
    MODEL_TYPE = "COLLUSION"
    VERSION_FORMAT = "%Y%m%d.%H%M%S"

    def __init__(self, model_path: str = "/models/collusion"):
        self.model_path = model_path
        self.graph = nx.Graph()
        self.version = None
        self.is_fitted = False
        self.metrics = {}

    def build_graph(self, worker_pairs: List[Dict]) -> None:
        self.graph.clear()
        for pair in worker_pairs:
            w1 = pair["worker_a_id"]
            w2 = pair["worker_b_id"]
            weight = pair.get("weight", 1.0)
            shared_devices = pair.get("shared_devices", 0)
            shared_ips = pair.get("shared_ips", 0)
            overlapping_jobs = pair.get("overlapping_jobs", 0)
            co_ratings = pair.get("co_ratings", 0)
            same_location_count = pair.get("same_location_count", 0)

            if not self.graph.has_node(w1):
                self.graph.add_node(w1, device_count=0, ip_count=0)
            if not self.graph.has_node(w2):
                self.graph.add_node(w2, device_count=0, ip_count=0)

            self.graph.add_edge(w1, w2,
                weight=weight,
                shared_devices=shared_devices,
                shared_ips=shared_ips,
                overlapping_jobs=overlapping_jobs,
                co_ratings=co_ratings,
                same_location_count=same_location_count,
            )

        self.is_fitted = True
        self.version = datetime.utcnow().strftime(self.VERSION_FORMAT)

    def fit(self, worker_pairs: List[Dict]) -> Dict:
        self.build_graph(worker_pairs)
        n_nodes = self.graph.number_of_nodes()
        n_edges = self.graph.number_of_edges()
        components = list(nx.connected_components(self.graph))
        self.metrics = {
            "nodes": n_nodes,
            "edges": n_edges,
            "connected_components": len(components),
            "max_component_size": max(len(c) for c in components) if components else 0,
            "density": nx.density(self.graph) if n_nodes > 1 else 0,
        }
        return self.metrics

    def predict_collusion_score(self, worker_a_id: str, worker_b_id: str) -> Dict:
        if not self.is_fitted:
            return {"collusion_score": 0.0, "signals": [], "is_suspicious": False}

        if not self.graph.has_edge(worker_a_id, worker_b_id):
            return {"collusion_score": 0.0, "signals": [], "is_suspicious": False}

        edge = self.graph.get_edge_data(worker_a_id, worker_b_id)
        signals = []
        score = 0.0

        shared_devices = edge.get("shared_devices", 0)
        if shared_devices >= 3:
            score += 0.35
            signals.append(f"high_device_overlap_{shared_devices}")
        elif shared_devices >= 1:
            score += 0.15
            signals.append(f"device_overlap_{shared_devices}")

        shared_ips = edge.get("shared_ips", 0)
        if shared_ips >= 5:
            score += 0.30
            signals.append(f"high_ip_overlap_{shared_ips}")
        elif shared_ips >= 2:
            score += 0.15
            signals.append(f"ip_overlap_{shared_ips}")

        overlapping_jobs = edge.get("overlapping_jobs", 0)
        if overlapping_jobs >= 3:
            score += 0.25
            signals.append(f"job_overlap_{overlapping_jobs}")
        elif overlapping_jobs >= 1:
            score += 0.10
            signals.append(f"some_job_overlap_{overlapping_jobs}")

        co_ratings = edge.get("co_ratings", 0)
        if co_ratings >= 3:
            score += 0.20
            signals.append(f"suspicious_rating_pattern_{co_ratings}")
        elif co_ratings >= 1:
            score += 0.08
            signals.append(f"co_rating_{co_ratings}")

        same_location = edge.get("same_location_count", 0)
        if same_location >= 5:
            score += 0.20
            signals.append(f"frequent_co_location_{same_location}")

        edge_weight = edge.get("weight", 1.0)
        score = min(1.0, score * edge_weight)

        return {
            "collusion_score": round(score, 4),
            "signals": signals,
            "is_suspicious": score >= 0.50,
            "risk_level": "HIGH" if score >= 0.70 else "MEDIUM" if score >= 0.40 else "LOW",
            "shared_devices": shared_devices,
            "shared_ips": shared_ips,
            "overlapping_jobs": overlapping_jobs,
        }

    def get_worker_risk(self, worker_id: str) -> Dict:
        if not self.is_fitted or not self.graph.has_node(worker_id):
            return {"collusion_score": 0.0, "suspicious_connections": 0, "is_suspicious": False}

        neighbors = list(self.graph.neighbors(worker_id))
        if not neighbors:
            return {"collusion_score": 0.0, "suspicious_connections": 0, "is_suspicious": False}

        scores = [self.predict_collusion_score(worker_id, n) for n in neighbors]
        high_risk = [s for s in scores if s["is_suspicious"]]
        avg_score = np.mean([s["collusion_score"] for s in scores]) if scores else 0

        return {
            "collusion_score": round(float(avg_score), 4),
            "suspicious_connections": len(high_risk),
            "total_connections": len(neighbors),
            "is_suspicious": avg_score >= 0.50 or len(high_risk) >= 2,
        }

    def find_collusion_rings(self, min_size: int = 3, min_score: float = 0.5) -> List[Dict]:
        if not self.is_fitted:
            return []
        rings = []
        components = list(nx.connected_components(self.graph))
        for component in components:
            if len(component) < min_size:
                continue
            subgraph = self.graph.subgraph(component)
            edge_scores = []
            for u, v in subgraph.edges():
                result = self.predict_collusion_score(u, v)
                edge_scores.append(result["collusion_score"])
            avg_ring_score = np.mean(edge_scores) if edge_scores else 0
            if avg_ring_score >= min_score:
                rings.append({
                    "worker_ids": list(component),
                    "size": len(component),
                    "avg_collusion_score": round(float(avg_ring_score), 4),
                    "edge_count": len(edge_scores),
                })
        return sorted(rings, key=lambda r: r["avg_collusion_score"], reverse=True)

    def save(self, path: Optional[str] = None) -> str:
        save_path = path or f"{self.model_path}/collusion_{self.version}.pkl"
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        data = {
            "adjacency": dict(self.graph.adjacency()),
            "node_data": dict(self.graph.nodes(data=True)),
            "edge_data": {(u, v): d for u, v, d in self.graph.edges(data=True)},
            "version": self.version,
            "is_fitted": self.is_fitted,
            "metrics": self.metrics,
        }
        joblib.dump(data, save_path)
        return save_path

    @classmethod
    def load(cls, path: str) -> "CollusionDetector":
        data = joblib.load(path)
        instance = cls()
        instance.graph = nx.Graph()
        for node, attrs in data.get("node_data", {}).items():
            instance.graph.add_node(node, **attrs)
        for (u, v), attrs in data.get("edge_data", {}).items():
            instance.graph.add_edge(u, v, **attrs)
        instance.version = data.get("version")
        instance.is_fitted = data.get("is_fitted", False)
        instance.metrics = data.get("metrics", {})
        return instance


def fetch_collusion_training_data(db_dsn: str, days_back: int = 30) -> List[Dict]:
    import psycopg2
    conn = psycopg2.connect(db_dsn)
    cur = conn.cursor()

    cur.execute(f"""
        SELECT
            e1.worker_id as worker_a,
            e2.worker_id as worker_b,
            COUNT(DISTINCT e1.job_id) as overlapping_jobs,
            COUNT(DISTINCT COALESCE(e1.metadata->>'ip_address', '')) as shared_ips,
            COUNT(DISTINCT COALESCE(e1.metadata->>'device_id', '')) as shared_devices
        FROM event_logs e1
        JOIN event_logs e2 ON e1.job_id = e2.job_id AND e1.worker_id < e2.worker_id
        WHERE e1.worker_id IS NOT NULL AND e2.worker_id IS NOT NULL
          AND e1.created_at >= NOW() - INTERVAL '{days_back} days'
        GROUP BY e1.worker_id, e2.worker_id
        HAVING COUNT(DISTINCT e1.job_id) >= 2
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    pairs = []
    for row in rows:
        pairs.append({
            "worker_a_id": row[0],
            "worker_b_id": row[1],
            "overlapping_jobs": row[2],
            "shared_ips": row[3],
            "shared_devices": row[4],
            "weight": min(2.0, 1.0 + row[2] * 0.1),
            "co_ratings": 0,
            "same_location_count": 0,
        })
    return pairs
