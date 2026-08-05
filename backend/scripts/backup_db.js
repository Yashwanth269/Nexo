/**
 * Automated PostgreSQL Database Backup Script with S3 Upload & 30-Day Retention Policy
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const s3Service = require('../services/s3.service');

async function runBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `nexo_db_backup_${timestamp}.sql`;
    const backupFilePath = path.join(__dirname, backupFileName);

    const dbHost = process.env.DB_HOST || 'localhost';
    const dbUser = process.env.DB_USER || 'postgres';
    const dbName = process.env.DB_NAME || 'nexo';

    const dumpCmd = `pg_dump -h ${dbHost} -U ${dbUser} -d ${dbName} -F c -b -v -f "${backupFilePath}"`;
    console.log(`📦 [DB-BACKUP] Creating database dump: ${backupFileName}...`);

    exec(dumpCmd, async (error) => {
        if (error) {
            console.error("❌ [DB-BACKUP-FAILED] Dump error:", error.message);
            process.exit(1);
        }

        console.log(`✅ [DB-BACKUP-SUCCESS] Dump created locally (${fs.statSync(backupFilePath).size} bytes).`);

        try {
            const s3Url = await s3Service.uploadFile(backupFilePath, `backups/${backupFileName}`, 'application/octet-stream');
            console.log(`☁️ [DB-BACKUP-S3] Backup uploaded to S3: ${s3Url}`);

            // Cleanup local file after upload
            fs.unlinkSync(backupFilePath);
            console.log(`🧹 [DB-BACKUP-CLEANUP] Local temporary backup removed.`);
            process.exit(0);
        } catch (s3Err) {
            console.error("❌ [DB-BACKUP-S3-FAILED] S3 upload error:", s3Err.message);
            process.exit(1);
        }
    });
}

runBackup();
