const https = require('https');
const http = require('http');
require('dotenv').config();

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyB6SnWAcEupDUfXAXW82Jp1Du9nwuIEEBU';

/**
 * Fetch directions from Google Directions API
 */
async function fetchDirectionsFromGoogle(originLat, originLng, destLat, destLng) {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${GOOGLE_API_KEY}`;
    
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.status === 'OK' && data.routes && data.routes.length > 0) {
                        const route = data.routes[0];
                        const leg = route.legs[0];
                        resolve({
                            distanceMeters: leg.distance.value,
                            durationSeconds: leg.duration.value,
                            polyline: route.overview_polyline.points,
                            source: 'google'
                        });
                    } else {
                        reject(new Error(`Google Directions API error status: ${data.status}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Google Directions API timeout'));
        });
    });
}

/**
 * Fetch directions from OSRM (Open Source Routing Machine)
 * Note: OSRM uses longitude,latitude format.
 */
async function fetchDirectionsFromOSRM(originLat, originLng, destLat, destLng) {
    const url = `http://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full`;
    
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                        const route = data.routes[0];
                        resolve({
                            distanceMeters: Math.round(route.distance),
                            durationSeconds: Math.round(route.duration),
                            polyline: route.geometry, // geometry contains encoded polyline string when overview=full
                            source: 'osrm'
                        });
                    } else {
                        reject(new Error(`OSRM routing error code: ${data.code}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('OSRM routing timeout'));
        });
    });
}

/**
 * Main helper to calculate route distance, duration, and polyline.
 * Tries Google Directions API first, falls back to OSRM, and then to Haversine heuristic.
 */
async function getDirections(originLat, originLng, destLat, destLng) {
    try {
        console.log(`[DIRECTIONS] Fetching route from Google for (${originLat}, ${originLng}) -> (${destLat}, ${destLng})`);
        return await fetchDirectionsFromGoogle(originLat, originLng, destLat, destLng);
    } catch (googleErr) {
        console.warn(`⚠️ [DIRECTIONS] Google Directions API failed: ${googleErr.message}. Trying OSRM fallback...`);
        try {
            return await fetchDirectionsFromOSRM(originLat, originLng, destLat, destLng);
        } catch (osrmErr) {
            console.error(`❌ [DIRECTIONS] OSRM fallback failed: ${osrmErr.message}. Using straight-line heuristic...`);
            
            // Haversine formula calculation
            const R = 6371e3; // meters
            const phi1 = originLat * Math.PI / 180;
            const phi2 = destLat * Math.PI / 180;
            const deltaPhi = (destLat - originLat) * Math.PI / 180;
            const deltaLambda = (destLng - originLng) * Math.PI / 180;

            const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                      Math.cos(phi1) * Math.cos(phi2) *
                      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const straightDistanceMeters = R * c;
            
            const roadDistanceMeters = Math.round(straightDistanceMeters * 1.3);
            const averageSpeedKmh = 20; // 20 km/h urban average speed
            const durationSeconds = Math.round((roadDistanceMeters / 1000 / averageSpeedKmh) * 3600);

            return {
                distanceMeters: roadDistanceMeters,
                durationSeconds: durationSeconds,
                polyline: '', // Empty polyline as fallback
                source: 'heuristic'
            };
        }
    }
}

module.exports = {
    getDirections
};
