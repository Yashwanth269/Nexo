/**
 * GeoHash Service — Zero-dependency geohash encoder
 * Used for Redis cache key partitioning by geo-region.
 *
 * Precision 6 = ~1.2km x 0.6km cells (default - street-level)
 * Precision 5 = ~4.9km x 4.9km cells (district-level fallback)
 * Precision 4 = ~39km x 20km cells  (city-level fallback - DEPRECATED)
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encode latitude/longitude to a geohash string.
 * @param {number} lat
 * @param {number} lng
 * @param {number} precision  — number of characters (default 6)
 * @returns {string} geohash
 */
const encode = (lat, lng, precision = 6) => {
    let idx = 0;
    let bit = 0;
    let evenBit = true;
    let hash = '';

    let latMin = -90,  latMax = 90;
    let lngMin = -180, lngMax = 180;

    while (hash.length < precision) {
        if (evenBit) {
            const lngMid = (lngMin + lngMax) / 2;
            if (lng >= lngMid) {
                idx = (idx << 1) | 1;
                lngMin = lngMid;
            } else {
                idx = (idx << 1);
                lngMax = lngMid;
            }
        } else {
            const latMid = (latMin + latMax) / 2;
            if (lat >= latMid) {
                idx = (idx << 1) | 1;
                latMin = latMid;
            } else {
                idx = (idx << 1);
                latMax = latMid;
            }
        }
        evenBit = !evenBit;

        if (++bit === 5) {
            hash += BASE32[idx];
            bit = 0;
            idx = 0;
        }
    }

    return hash;
};

/**
 * Decode a geohash to {lat, lng, latErr, lngErr}.
 */
const decode = (hash) => {
    let isEven = true;
    let lat = [-90, 90];
    let lng = [-180, 180];

    for (const char of hash) {
        const cd = BASE32.indexOf(char);
        if (cd === -1) throw new Error(`Invalid geohash character: ${char}`);
        for (let mask = 16; mask >= 1; mask >>= 1) {
            if (isEven) {
                (cd & mask) ? (lng[0] = (lng[0] + lng[1]) / 2) : (lng[1] = (lng[0] + lng[1]) / 2);
            } else {
                (cd & mask) ? (lat[0] = (lat[0] + lat[1]) / 2) : (lat[1] = (lat[0] + lat[1]) / 2);
            }
            isEven = !isEven;
        }
    }

    return {
        lat: (lat[0] + lat[1]) / 2,
        lng: (lng[0] + lng[1]) / 2,
        latErr: (lat[1] - lat[0]) / 2,
        lngErr: (lng[1] - lng[0]) / 2,
    };
};

/**
 * Return the geohash and its 8 neighbours — for radius edge cases.
 */
const NEIGHBOR_MAP = {
    right:  { even: 'bc01fg45telegramhijklmnopqrstuvwx', odd: 'p0r21436x8zb9dc5h7kjnmqesgutwvy' },
};

/**
 * Generate the Redis cache key for a given coordinate.
 * @param {number} lat
 * @param {number} lng
 * @param {number} precision
 * @returns {string}
 */
const trendingCacheKey   = (lat, lng, precision = 6) => `trending:${encode(lat, lng, precision)}`;
const districtCacheKey   = (lat, lng)                => `trending:${encode(lat, lng, 5)}`;
const cityCacheKey       = (lat, lng)                => `trending:${encode(lat, lng, 4)}`;

module.exports = { encode, decode, trendingCacheKey, districtCacheKey, cityCacheKey };
