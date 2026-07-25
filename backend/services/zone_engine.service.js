const db = require('../config/db');

class ZoneEngineService {
  async suggestZones(lat, lng, query) {
    const results = [];
    const normalizedQuery = (query || '').toLowerCase().trim();

    // Geographic hubs mapping
    const hubs = [
      { name: 'Kolar', lat: 13.1368, lng: 78.1292, localities: ['Bangarpet', 'Malur', 'Srinivaspur', 'Mulbagal', 'Kolar Town'] },
      { name: 'Mysuru', lat: 12.2958, lng: 76.6394, localities: ['Gokulam', 'Vidyaranyapuram', 'Jayanagar', 'Hebbal', 'Mysuru Town'] },
      { name: 'Bangalore', lat: 12.9716, lng: 77.5946, localities: ['MG Road', 'Koramangala', 'HSR Layout', 'Indiranagar', 'Whitefield', 'Electronic City', 'Yelahanka', 'Jayanagar'] }
    ];

    // Try to find matching localities in our hubs
    for (const hub of hubs) {
      if (hub.name.toLowerCase().includes(normalizedQuery) || (lat && lng && this.getDistance(lat, lng, hub.lat, hub.lng) < 50)) {
        for (const loc of hub.localities) {
          if (!normalizedQuery || loc.toLowerCase().includes(normalizedQuery)) {
            results.push({
              locality: loc,
              city: hub.name,
              center_lat: hub.lat,
              center_lng: hub.lng,
              source: 'hub_fallback'
            });
          }
        }
      }
    }

    // Dynamic address parsing from jobs
    try {
      const jobsRes = await db.query(
        "SELECT address, location_lat, location_lng FROM jobs WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL"
      );

      const parsedLocalities = new Set();
      for (const row of jobsRes.rows) {
        const addr = row.address;
        if (!addr) continue;

        // Try to extract locality from address (e.g., Koramangala, HSR Layout, etc.)
        const parts = addr.split(',').map(p => p.trim());
        for (const part of parts) {
          if (part.length > 3 && part.length < 30 && !part.match(/\d{6}/)) { // ignore pin codes and very long/short strings
            const lowerPart = part.toLowerCase();
            // simple check to avoid generic terms
            if (['bangalore', 'karnataka', 'india', 'street', 'road', 'floor', 'layout', 'cross', 'main'].includes(lowerPart)) {
              continue;
            }
            if (normalizedQuery && !lowerPart.includes(normalizedQuery)) {
              continue;
            }

            if (!parsedLocalities.has(part)) {
              parsedLocalities.add(part);
              results.push({
                locality: part,
                city: 'Bangalore',
                center_lat: parseFloat(row.location_lat),
                center_lng: parseFloat(row.location_lng),
                source: 'parsed_job'
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to parse jobs dynamically for zones:", err.message);
    }

    // Self-healing database insertion: If suggested locality is not present in marketplace_zones, insert it
    for (const res of results) {
      try {
        const checkRes = await db.query(
          "SELECT id FROM marketplace_zones WHERE LOWER(locality) = LOWER($1)",
          [res.locality]
        );
        if (checkRes.rowCount === 0) {
          const zoneName = `${res.locality} Zone`;
          await db.query(
            `INSERT INTO marketplace_zones (zone_name, locality, city, center_lat, center_lng, radius_km)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [zoneName, res.locality, res.city, res.center_lat, res.center_lng, 5.0]
          );
          console.log(`🌱 [ZONE-ENGINE] Dynamically created zone: ${zoneName} in ${res.city}`);
        }
      } catch (err) {
        console.warn(`⚠️ Failed to self-heal/insert zone ${res.locality}:`, err.message);
      }
    }

    // Remove duplicates from results based on locality name
    const uniqueResults = [];
    const seen = new Set();
    for (const item of results) {
      const key = item.locality.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueResults.push(item);
      }
    }

    return uniqueResults;
  }

  getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

module.exports = new ZoneEngineService();
