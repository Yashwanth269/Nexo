// =============================================================
// HAVERSINE — Single Source of Truth for distance calculations
// Replaces 6 duplicate implementations across the codebase
// =============================================================

const EARTH_RADIUS_KM = 6371;
const EARTH_RADIUS_METERS = 6371e3;

/**
 * Calculate great-circle distance between two GPS coordinates.
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function distanceKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
}

/**
 * Calculate great-circle distance in meters.
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
    return distanceKm(lat1, lon1, lat2, lon2) * 1000;
}

/**
 * Format a distance value to a human-readable string.
 * @param {number} km - Distance in kilometers
 * @returns {string} e.g. "450m" or "2.3 km"
 */
function formatDistance(km) {
    if (km < 1) {
        return `${Math.round(km * 1000)}m`;
    }
    return `${km.toFixed(1)} km`;
}

function toRad(deg) {
    return deg * Math.PI / 180;
}

module.exports = { distanceKm, distanceMeters, formatDistance };
