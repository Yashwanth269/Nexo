const db = require('../config/db');
const { getIO } = require('../config/socket');

class RouteDeviationService {
    async checkDeviation(jobId, workerId, workerLat, workerLng) {
        const jobRes = await db.query(
            "SELECT location_lat, location_lng, route_polyline FROM jobs WHERE id = $1 AND worker_id = $2",
            [jobId, workerId]
        );
        if (jobRes.rowCount === 0) return null;
        const job = jobRes.rows[0];

        const distToDest = this._haversine(workerLat, workerLng, parseFloat(job.location_lat), parseFloat(job.location_lng));
        const DEVIATION_THRESHOLD_M = 200;
        const PROGRESS_THRESHOLD = 0.1;

        let deviationScore = 0;
        let deviationDistance = 0;
        let isDeviating = false;

        if (job.route_polyline) {
            const { decodePolyline } = require('./execution.service');
            const routePoints = decodePolyline(job.route_polyline);
            if (routePoints.length > 0) {
                let minDistToRoute = Infinity;
                for (const pt of routePoints) {
                    const d = this._haversine(workerLat, workerLng, pt.latitude, pt.longitude);
                    if (d < minDistToRoute) minDistToRoute = d;
                }
                const totalRouteLen = this._routeLength(routePoints);
                const distFromStart = this._distanceAlongRoute(routePoints, workerLat, workerLng);
                const progress = totalRouteLen > 0 ? distFromStart / totalRouteLen : 0;

                if (minDistToRoute > DEVIATION_THRESHOLD_M && progress > PROGRESS_THRESHOLD) {
                    deviationDistance = Math.round(minDistToRoute);
                    deviationScore = Math.min(1, (minDistToRoute - DEVIATION_THRESHOLD_M) / 1000);
                    isDeviating = true;
                }
            }
        } else if (distToDest > 500) {
            deviationDistance = Math.round(distToDest);
            deviationScore = Math.min(1, (distToDest - 500) / 5000);
            isDeviating = true;
        }

        if (isDeviating) {
            await db.query(`
                INSERT INTO route_deviations (job_id, worker_id, deviation_distance_meters, deviation_score, worker_lat, worker_lng, destination_lat, destination_lng)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [jobId, workerId, deviationDistance, deviationScore, workerLat, workerLng, job.location_lat, job.location_lng]);

            if (deviationScore > 0.3) {
                const io = getIO();
                io.to(`worker:${workerId}`).emit('route_deviation_warning', {
                    jobId,
                    deviationDistance,
                    message: `You appear to be ${Math.round(deviationDistance)}m away from the expected route.`,
                });
                await db.query(
                    "UPDATE route_deviations SET notified = TRUE WHERE job_id = $1 AND worker_id = $2 AND notified = FALSE",
                    [jobId, workerId]
                );
            }
        }
        return { isDeviating, deviationScore: Math.round(deviationScore * 100) / 100, deviationDistance };
    }

    _haversine(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    _routeLength(points) {
        let len = 0;
        for (let i = 1; i < points.length; i++) {
            len += this._haversine(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
        }
        return len;
    }

    _distanceAlongRoute(points, lat, lng) {
        let minDist = Infinity;
        let bestIdx = 0;
        for (let i = 0; i < points.length; i++) {
            const d = this._haversine(lat, lng, points[i].latitude, points[i].longitude);
            if (d < minDist) { minDist = d; bestIdx = i; }
        }
        let dist = 0;
        for (let i = 1; i <= bestIdx; i++) {
            dist += this._haversine(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude);
        }
        return dist;
    }
}

module.exports = new RouteDeviationService();
