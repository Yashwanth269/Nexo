const db = require('../config/db');

class DBValidatorService {
    constructor() {
        this.isValid = true;
        this.validationResult = {
            isValid: true,
            missingTables: [],
            missingColumns: [],
            missingIndexes: [],
            validatedAt: null
        };
        this.hasLoggedError = false;
    }

    async validateSchema() {
        const missingTables = [];
        const missingColumns = [];
        const missingIndexes = [];

        try {
            // 1. Verify critical tables
            const requiredTables = [
                'users', 'workers', 'jobs', 'job_offers', 'job_cancellations',
                'event_logs', 'disputes', 'advanced_fatigue_scores',
                'dispatch_rejection_logs', 'worker_response_logs', 'search_analytics_logs',
                'dispatch_ranking_breakdowns', 'ml_model_monitoring', 'refresh_tokens',
                'ml_training_data', 'model_maturity', 'worker_calendar', 'marketplace_zones',
                'job_slas'
            ];

            const tableCheckRes = await db.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                  AND table_name = ANY($1)
            `, [requiredTables]);
            
            const existingTables = new Set(tableCheckRes.rows.map(r => r.table_name));
            for (const table of requiredTables) {
                if (!existingTables.has(table)) {
                    missingTables.push(table);
                }
            }

            // 2. Verify key columns if tables exist
            if (existingTables.has('workers')) {
                const cols = await this.getTableColumns('workers');
                if (!cols.has('availability_state')) missingColumns.push('workers.availability_state');
            }
            if (existingTables.has('disputes')) {
                const cols = await this.getTableColumns('disputes');
                if (!cols.has('evidence')) missingColumns.push('disputes.evidence');
                if (!cols.has('sla_deadline')) missingColumns.push('disputes.sla_deadline');
            }
            if (existingTables.has('advanced_fatigue_scores')) {
                const cols = await this.getTableColumns('advanced_fatigue_scores');
                if (!cols.has('acceptance_load_24h')) missingColumns.push('advanced_fatigue_scores.acceptance_load_24h');
                if (!cols.has('active_jobs_current')) missingColumns.push('advanced_fatigue_scores.active_jobs_current');
                if (!cols.has('stress_events_24h')) missingColumns.push('advanced_fatigue_scores.stress_events_24h');
                if (!cols.has('fatigue_score')) missingColumns.push('advanced_fatigue_scores.fatigue_score');
                if (!cols.has('fatigue_band')) missingColumns.push('advanced_fatigue_scores.fatigue_band');
            }
            if (existingTables.has('jobs')) {
                const cols = await this.getTableColumns('jobs');
                if (!cols.has('search_radius_km')) missingColumns.push('jobs.search_radius_km');
                if (!cols.has('search_state_stage')) missingColumns.push('jobs.search_state_stage');
                if (!cols.has('checklist')) missingColumns.push('jobs.checklist');
                if (!cols.has('payout_status')) missingColumns.push('jobs.payout_status');
            }

            // 3. Verify key indexes
            const requiredIndexes = [
                'idx_job_offers_pending_unique',
                'idx_workers_location_cube',
                'idx_jobs_location_cube'
            ];
            const indexCheckRes = await db.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE schemaname = 'public' 
                  AND indexname = ANY($1)
            `, [requiredIndexes]);

            const existingIndexes = new Set(indexCheckRes.rows.map(r => r.indexname));
            for (const idx of requiredIndexes) {
                if (!existingIndexes.has(idx)) {
                    missingIndexes.push(idx);
                }
            }

            this.isValid = (missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0);
            this.validationResult = {
                isValid: this.isValid,
                missingTables,
                missingColumns,
                missingIndexes,
                validatedAt: new Date().toISOString()
            };

            if (!this.isValid && !this.hasLoggedError) {
                console.error("🚨 [DB-VALIDATION-FAILED] Database schema validation failed!");
                console.error(JSON.stringify(this.validationResult, null, 2));
                this.hasLoggedError = true; // prevent log spam
            }

        } catch (e) {
            this.isValid = false;
            this.validationResult = {
                isValid: false,
                error: e.message,
                missingTables,
                missingColumns,
                missingIndexes,
                validatedAt: new Date().toISOString()
            };
            if (!this.hasLoggedError) {
                console.error("🚨 [DB-VALIDATION-ERROR] Failed to query database schema metadata:", e.message);
                this.hasLoggedError = true;
            }
        }
    }

    async getTableColumns(tableName) {
        const res = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = $1
        `, [tableName]);
        return new Set(res.rows.map(r => r.column_name));
    }

    getStatus() {
        return this.validationResult;
    }
}

module.exports = new DBValidatorService();
