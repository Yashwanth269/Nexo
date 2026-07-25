/**
 * GeoHash Service — Zero-dependency geohash encoder & decoder with neighbor expansion
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

// Local high-speed caching maps
const encodeCache = new Map();
const decodeCache = new Map();

/**
 * Validate input coordinates bounds, NaN, and Infinity
 */
const validateCoordinates = (lat, lng) => {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
        throw new Error("[GEOHASH-VALIDATION-ERROR] Coordinates must be numbers");
    }
    if (!isFinite(latitude) || !isFinite(longitude)) {
        throw new Error("[GEOHASH-VALIDATION-ERROR] Coordinates cannot be Infinity");
    }
    if (latitude < -90.0 || latitude > 90.0 || longitude < -180.0 || longitude > 180.0) {
        throw new Error("[GEOHASH-VALIDATION-ERROR] Coordinates out of global bounds (-90 to 90 lat, -180 to 180 lng)");
    }
    return { lat: latitude, lng: longitude };
};

/**
 * Encode latitude/longitude to a geohash string
 */
const encode = (lat, lng, precision = 6) => {
    const { lat: safeLat, lng: safeLng } = validateCoordinates(lat, lng);
    
    const cacheKey = `${safeLat}:${safeLng}:${precision}`;
    if (encodeCache.has(cacheKey)) {
        return encodeCache.get(cacheKey);
    }

    let idx = 0;
    let bit = 0;
    let evenBit = true;
    let hash = '';

    let latMin = -90,  latMax = 90;
    let lngMin = -180, lngMax = 180;

    while (hash.length < precision) {
        if (evenBit) {
            const lngMid = (lngMin + lngMax) / 2;
            if (safeLng >= lngMid) {
                idx = (idx << 1) | 1;
                lngMin = lngMid;
            } else {
                idx = (idx << 1);
                lngMax = lngMid;
            }
        } else {
            const latMid = (latMin + latMax) / 2;
            if (safeLat >= latMid) {
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

    // Keep cache size low (1000 items)
    if (encodeCache.size > 1000) {
        encodeCache.clear();
    }
    encodeCache.set(cacheKey, hash);

    return hash;
};

/**
 * Decode a geohash to center coordinates and errors
 */
const decode = (hash) => {
    if (decodeCache.has(hash)) {
        return decodeCache.get(hash);
    }

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

    const result = {
        lat: (lat[0] + lat[1]) / 2,
        lng: (lng[0] + lng[1]) / 2,
        latErr: (lat[1] - lat[0]) / 2,
        lngErr: (lng[1] - lng[0]) / 2,
    };

    if (decodeCache.size > 1000) {
        decodeCache.clear();
    }
    decodeCache.set(hash, result);

    return result;
};

/**
 * Calculates 8 neighbor geohashes dynamically using shifts of the cell bounding box
 */
const getNeighbors = (geohash) => {
    const { lat, lng, latErr, lngErr } = decode(geohash);
    const precision = geohash.length;

    // Shift centers to each neighboring cell
    const shifts = {
        n:  { lat: lat + 2 * latErr, lng },
        s:  { lat: lat - 2 * latErr, lng },
        e:  { lat, lng: lng + 2 * lngErr },
        w:  { lat, lng: lng - 2 * lngErr },
        ne: { lat: lat + 2 * latErr, lng: lng + 2 * lngErr },
        nw: { lat: lat + 2 * latErr, lng: lng - 2 * lngErr },
        se: { lat: lat - 2 * latErr, lng: lng + 2 * lngErr },
        sw: { lat: lat - 2 * latErr, lng: lng - 2 * lngErr }
    };

    const neighbors = {};
    for (const [dir, coord] of Object.entries(shifts)) {
        // Adjust for wrapping borders
        let adjLat = coord.lat;
        let adjLng = coord.lng;
        if (adjLat > 90) adjLat = 90;
        if (adjLat < -90) adjLat = -90;
        if (adjLng > 180) adjLng -= 360;
        if (adjLng < -180) adjLng += 360;

        neighbors[dir] = encode(adjLat, adjLng, precision);
    }

    return neighbors;
};

/**
 * Haversine formula distance utility
 */
const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Returns shared prefix count indicating geospacial proximity
 */
const sharedPrefixLength = (hash1, hash2) => {
    let match = 0;
    const len = Math.min(hash1.length, hash2.length);
    for (let i = 0; i < len; i++) {
        if (hash1[i] === hash2[i]) {
            match++;
        } else {
            break;
        }
    }
    return match;
};

const trendingCacheKey   = (lat, lng, precision = 6) => `trending:${encode(lat, lng, precision)}`;
const districtCacheKey   = (lat, lng)                => `trending:${encode(lat, lng, 5)}`;
const cityCacheKey       = (lat, lng)                => `trending:${encode(lat, lng, 4)}`;

module.exports = {
    encode,
    decode,
    getNeighbors,
    getDistance,
    sharedPrefixLength,
    trendingCacheKey,
    districtCacheKey,
    cityCacheKey
};
