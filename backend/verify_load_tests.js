const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'gigs_db',
    password: 'Yashwanth@123', port: 5432, max: 10
});
const crypto = require('crypto');
const http = require('http');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const redisMock = require('./config/redis');

async function runLoadTests() {
    console.log("=================================================");
    console.log("🚀 STARTING SCALABLE PERFORMANCE LOAD TESTING");
    console.log("=================================================\n");

    const scales = [100, 500, 1000, 5000, 10000];
    const results = [];

    // Create temp table for performance profiling
    await pool.query(`
        CREATE TEMP TABLE IF NOT EXISTS load_perf_workers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            full_name TEXT,
            current_lat DECIMAL(10,8),
            current_lng DECIMAL(11,8),
            location_cube cube,
            is_online BOOLEAN DEFAULT true,
            is_available BOOLEAN DEFAULT true
        )
    `);

    console.log("Waiting 2s for Redis connection attempts / fallback...");
    await sleep(2000);

    for (const count of scales) {
        console.log(`\n--- Profiling at scale: ${count} workers ---`);
        await pool.query('DELETE FROM load_perf_workers');

        // Measure DB Insert Latency (Bulk generation)
        const dbInsertStart = Date.now();
        for (let b = 0; b < count; b += 500) {
            const vals = [], ps = [];
            for (let i = 0; i < 500 && b + i < count; i++) {
                const lat = 12.9 + Math.random() * 0.2, lng = 77.5 + Math.random() * 0.2;
                vals.push(`($${ps.length+1}::uuid,$${ps.length+2},$${ps.length+3}::decimal,$${ps.length+4}::decimal,ll_to_earth($${ps.length+3}::decimal,$${ps.length+4}::decimal),true,true)`);
                ps.push(crypto.randomUUID(), `Worker_${b+i}`, lat, lng);
            }
            await pool.query(`INSERT INTO load_perf_workers (id,full_name,current_lat,current_lng,location_cube,is_online,is_available) VALUES ${vals.join(',')}`, ps);
        }
        const dbInsertTime = Date.now() - dbInsertStart;
        console.log(`  Inserted ${count} workers in: ${dbInsertTime}ms`);

        // DB Query Latency (GiST index query simulation)
        const dbQueryTimes = [];
        for (let t = 0; t < 10; t++) {
            const lat = 12.97, lng = 77.59;
            const start = Date.now();
            await pool.query(`
                SELECT id, earth_distance(ll_to_earth($1,$2), location_cube)/1000.0 AS dist
                FROM load_perf_workers
                WHERE is_online AND is_available 
                AND earth_distance(ll_to_earth($1,$2), location_cube)/1000.0 <= 25
                ORDER BY dist LIMIT 50
            `, [lat, lng]);
            dbQueryTimes.push(Date.now() - start);
        }
        const avgDbQuery = dbQueryTimes.reduce((a,b)=>a+b,0)/dbQueryTimes.length;

        // Redis Latency simulation (mock command executions)
        const redisTimes = [];
        const redisMock = require('./config/redis');
        for (let t = 0; t < 50; t++) {
            const start = Date.now();
            await redisMock.set(`perf_test:${count}:${t}`, `val_${t}`, 'EX', 10);
            await redisMock.get(`perf_test:${count}:${t}`);
            redisTimes.push(Date.now() - start);
        }
        const avgRedis = redisTimes.reduce((a,b)=>a+b,0)/redisTimes.length;

        // ML Latency (Querying ML service if running, else local baseline)
        const mlTimes = [];
        const mlBody = JSON.stringify({
            lat: 12.9715, lng: 77.5945, gps_accuracy: 10,
            heading_change: 0, signal_strength: -70, mock_location: false
        });
        
        for (let t = 0; t < 5; t++) {
            const start = Date.now();
            const res = await new Promise((resolve) => {
                const req = http.request({
                    hostname: 'localhost', port: 8000, path: '/predict/gps-spoof',
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mlBody) },
                    timeout: 500
                }, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => resolve(true));
                });
                req.on('error', () => resolve(false));
                req.on('timeout', () => { req.destroy(); resolve(false); });
                req.write(mlBody);
                req.end();
            });
            mlTimes.push(Date.now() - start);
        }
        const avgMl = mlTimes.reduce((a,b)=>a+b,0)/mlTimes.length;

        // API & Socket latency estimation
        const apiLatStart = Date.now();
        const apiRes = await fetch('http://localhost:5000/ready');
        await apiRes.text();
        const apiLatency = Date.now() - apiLatStart;

        // System Resource usage
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();

        results.push({
            workers: count,
            dbInsertTime,
            avgDbQuery: avgDbQuery.toFixed(2),
            avgRedis: avgRedis.toFixed(2),
            avgMl: avgMl.toFixed(2),
            apiLatency,
            memoryMB: Math.round(mem.rss / 1024 / 1024),
            cpuSystem: cpu.system
        });

        console.log(`  Avg DB Query: ${avgDbQuery.toFixed(2)}ms`);
        console.log(`  Avg Redis Roundtrip: ${avgRedis.toFixed(2)}ms`);
        console.log(`  Avg ML Service: ${avgMl.toFixed(2)}ms`);
        console.log(`  API Latency (/ready): ${apiLatency}ms`);
        console.log(`  Memory usage: ${Math.round(mem.rss / 1024 / 1024)} MB`);
    }

    await pool.query('DROP TABLE IF EXISTS load_perf_workers');

    // Print final summary table
    console.log("\n==========================================================================================");
    console.log("📊 SCALABLE LOAD TESTING PERFORMANCE SUMMARY");
    console.log("==========================================================================================");
    console.log(" Workers | DB Query (ms) | Redis (ms) | ML API (ms) | API Lat (ms) | Mem RSS (MB) | CPU Sys");
    console.log("------------------------------------------------------------------------------------------");
    for (const r of results) {
        console.log(
            `${String(r.workers).padStart(8)} | ` +
            `${String(r.avgDbQuery).padStart(13)} | ` +
            `${String(r.avgRedis).padStart(10)} | ` +
            `${String(r.avgMl).padStart(11)} | ` +
            `${String(r.apiLatency).padStart(12)} | ` +
            `${String(r.memoryMB).padStart(12)} | ` +
            `${r.cpuSystem}`
        );
    }
    console.log("==========================================================================================\n");

    await pool.end();
    process.exit(0);
}

runLoadTests().catch(e => {
    console.error("❌ Performance Load Test failed:", e.message);
    process.exit(1);
});
