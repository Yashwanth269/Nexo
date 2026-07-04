const db = require('./config/db');

async function fix() {
    try {
        const res = await db.query(
            "INSERT INTO users (id, phone_number) VALUES ('b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', '0987654321') ON CONFLICT (id) DO NOTHING RETURNING *"
        );
        console.log("Insert result:", res.rows);
        
        // Let's also check if the user is there
        const check = await db.query("SELECT * FROM users WHERE id = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e'");
        console.log("Check user:", check.rows);
        
        process.exit(0);
    } catch (e) {
        console.error("Error:", e.message);
        process.exit(1);
    }
}

fix();
