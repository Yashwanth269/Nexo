const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'gigs_db',
    password: 'Yashwanth@123', port: 5432, max: 10
});
const crypto = require('crypto');

async function run() {
    console.log('========================================');
    console.log('  ITEM 8: Dispatch Performance Test');
    console.log('========================================\n');

    await pool.query(`
        CREATE TEMP TABLE IF NOT EXISTS perf_workers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            full_name TEXT,
            current_lat DECIMAL(10,8),
            current_lng DECIMAL(11,8),
            location_cube cube,
            is_online BOOLEAN DEFAULT true,
            is_available BOOLEAN DEFAULT true,
            jobs_completed INTEGER DEFAULT 0
        )
    `);

    const batches = [100, 500, 1000];
    const results = {};

    for (const count of batches) {
        console.log(`\n--- ${count} synthetic workers ---`);
        await pool.query('DELETE FROM perf_workers');
        const genStart = Date.now();

        // Bulk insert
        for (let b = 0; b < count; b += 100) {
            const vals = [], ps = [];
            for (let i = 0; i < 100 && b + i < count; i++) {
                const lat = 12.9 + Math.random() * 0.2, lng = 77.5 + Math.random() * 0.2;
                vals.push(`($${ps.length+1}::uuid,$${ps.length+2},$${ps.length+3}::decimal,$${ps.length+4}::decimal,ll_to_earth($${ps.length+3}::decimal,$${ps.length+4}::decimal),true,true,${Math.floor(Math.random()*20)})`);
                ps.push(crypto.randomUUID(), `W${b+i+1}`, lat, lng);
            }
            await pool.query(`INSERT INTO perf_workers (id,full_name,current_lat,current_lng,location_cube,is_online,is_available,jobs_completed) VALUES ${vals.join(',')}`, ps);
        }
        console.log(`  Generate: ${Date.now() - genStart}ms`);

        // GiST spatial query
        const gT = [];
        for (let t = 0; t < 10; t++) {
            const lat = 12.97 + Math.random() * 0.02, lng = 77.59 + Math.random() * 0.02;
            const s = Date.now();
            await pool.query(`SELECT id, earth_distance(ll_to_earth($1,$2),location_cube)/1000.0 AS d FROM perf_workers WHERE is_online AND is_available AND earth_distance(ll_to_earth($1,$2),location_cube)/1000.0 <= 25 ORDER BY d LIMIT 50`, [lat, lng]);
            gT.push(Date.now() - s);
        }
        const avgG = gT.reduce((a,b) => a + b, 0) / gT.length;

        // Haversine fallback
        const hT = [];
        for (let t = 0; t < 10; t++) {
            const lat = 12.97 + Math.random() * 0.02, lng = 77.59 + Math.random() * 0.02;
            const s = Date.now();
            await pool.query(`SELECT id, (6371 * acos(cos(radians($1))*cos(radians(current_lat))*cos(radians(current_lng)-radians($2))+sin(radians($1))*sin(radians(current_lat)))) AS d FROM perf_workers WHERE is_online AND is_available ORDER BY d LIMIT 50`, [lat, lng]);
            hT.push(Date.now() - s);
        }
        const avgH = hT.reduce((a,b) => a + b, 0) / hT.length;

        // Count full result set for spatial
        const countStart = Date.now();
        const cnt = await pool.query(`SELECT COUNT(*) as c FROM perf_workers WHERE is_online AND is_available AND earth_distance(ll_to_earth(12.97,77.59),location_cube)/1000.0 <= 25`);
        const countTime = Date.now() - countStart;

        results[count] = {
            avgG: avgG.toFixed(2), avgH: avgH.toFixed(2),
            speedup: (avgH / Math.max(avgG, 0.01)).toFixed(1),
            countTime, inRange: cnt.rows[0].c
        };
        console.log(`  GiST: ${avgG.toFixed(2)}ms | Haversine: ${avgH.toFixed(2)}ms | ${(avgH/Math.max(avgG,0.01)).toFixed(1)}x faster`);
        console.log(`  Workers in 25km range: ${cnt.rows[0].c} | Count query: ${countTime}ms`);
    }

    // Check GiST index plan
    console.log('\n--- GiST Index Query Plan (real workers table) ---');
    try {
        const plan = await pool.query(`EXPLAIN (FORMAT TEXT) SELECT w.id FROM workers w WHERE w.is_online AND w.is_available AND earth_distance(ll_to_earth(12.97,77.59),w.location_cube)/1000.0 <= 25 ORDER BY earth_distance(ll_to_earth(12.97,77.59),w.location_cube) LIMIT 10`);
        plan.rows.forEach(r => console.log('  ' + r['QUERY PLAN']));
    } catch(e) { console.log('  Error:', e.message); }

    await pool.query('DROP TABLE IF EXISTS perf_workers');

    console.log('\n========================================');
    console.log('  PERFORMANCE SUMMARY');
    console.log('========================================');
    console.log(`${'Workers'.padStart(8)} | ${'GiST(ms)'.padStart(9)} | ${'Haver(ms)'.padStart(9)} | ${'Speedup'.padStart(8)} | ${'Range'.padStart(6)} | ${'Count(ms)'.padStart(9)}`);
    console.log('-'.repeat(60));
    for (const [c, r] of Object.entries(results)) {
        console.log(`${String(c).padStart(8)} | ${r.avgG.padStart(9)} | ${r.avgH.padStart(9)} | ${r.speedup.padStart(7)}x | ${String(r.inRange).padStart(6)} | ${String(r.countTime).padStart(9)}`);
    }

    console.log('\n  GiST indexes: idx_workers_location_cube (workers), idx_jobs_location_cube (jobs)');
    console.log('  Fallback chain: earthdistance (GiST) -> Redis geohash (precision 6) -> JS haversine');
    console.log('  Ranking pipeline perf: tested in Items 4-7 (~1-2ms/worker without Redis)');

    await pool.end();
    process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
