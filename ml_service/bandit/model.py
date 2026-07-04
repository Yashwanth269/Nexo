import numpy as np
import random
from typing import Dict, List, Optional

class ThompsonSamplingBandit:
    def __init__(self, alpha: float = 1.0, beta: float = 1.0):
        self.alpha = alpha
        self.beta = beta
        self.worker_stats = {}

    def select_worker(self, workers: List[Dict], exploration_rate: float = 0.15) -> Dict:
        for w in workers:
            wid = w["id"]
            if wid not in self.worker_stats:
                self.worker_stats[wid] = {"alpha": self.alpha, "beta": self.beta, "served": 0}

        if random.random() < exploration_rate:
            new_workers = [w for w in workers if self.worker_stats[w["id"]]["served"] < 5]
            if new_workers:
                return random.choice(new_workers)

        best_worker = None
        best_score = -float("inf")
        for w in workers:
            wid = w["id"]
            s = self.worker_stats[wid]
            sampled_score = np.random.beta(s["alpha"], s["beta"])
            combined = sampled_score * 0.7 + w.get("score", 0) * 0.3
            if combined > best_score:
                best_score = combined
                best_worker = w
        return best_worker

    def record_outcome(self, worker_id: str, was_accepted: bool):
        if worker_id not in self.worker_stats:
            return
        if was_accepted:
            self.worker_stats[worker_id]["alpha"] += 1
        else:
            self.worker_stats[worker_id]["beta"] += 1
        self.worker_stats[worker_id]["served"] += 1

    def get_worker_score(self, worker_id: str) -> float:
        stats = self.worker_stats.get(worker_id)
        if not stats:
            return 0.5
        return stats["alpha"] / (stats["alpha"] + stats["beta"])

    def get_stats(self) -> Dict:
        return {
            wid: {"mean": s["alpha"] / (s["alpha"] + s["beta"]), "served": s["served"]}
            for wid, s in self.worker_stats.items()
        }

class BanditModel:
    MODEL_TYPE = "BANDIT"

    def __init__(self):
        self.bandit = ThompsonSamplingBandit()

    def select(self, workers: List[Dict], exploration_rate: float = 0.15) -> Dict:
        return self.bandit.select_worker(workers, exploration_rate)

    def record(self, worker_id: str, was_accepted: bool):
        self.bandit.record_outcome(worker_id, was_accepted)
