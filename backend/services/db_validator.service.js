const db = require('../config/db');
const schemaConfig = require('../config/schema.config');
const initialManifest = require('../config/schema_manifest.json');

class DBValidatorService {
    constructor() {
        this.isValid = true;
        this.validationResult = {
            isValid: true,
            schemaVersion: '0.0.0',
            classification: 'OK',
            missingTables: [],
            missingColumns: [],
            missingIndexes: [],
            invalidIndexes: [],
            missingForeignKeys: [],
            missingConstraints: [],
            failedMigrations: [],
            pendingMigrations: [],
            warnings: [],
            optionalFeatureStatus: {},
            validatedAt: null,
            durationMs: 0
        };
        this.registeredRequirements = [];
        this.lastLoggedAt = 0;
    }

    /**
     * Registers schema requirements from external modules dynamically
     */
    registerSchemaRequirements(requirements) {
        if (!requirements) return;
        this.registeredRequirements.push(requirements);
        // Force revalidation after new rules are registered
        this.isValid = false;
    }

    /**
     * Builds the unified manifest by merging static config and registered runtime requirements
     */
    _buildManifest() {
        const manifest = JSON.parse(JSON.stringify(initialManifest));

        for (const req of this.registeredRequirements) {
            if (req.tables) {
                for (const [tbl, tblSpec] of Object.entries(req.tables)) {
                    if (!manifest.tables[tbl]) {
                        manifest.tables[tbl] = tblSpec;
                    } else {
                        // Merge columns
                        manifest.tables[tbl].columns = {
                            ...manifest.tables[tbl].columns,
                            ...tblSpec.columns
                        };
                        // Merge constraints
                        if (tblSpec.constraints) {
                            manifest.tables[tbl].constraints = {
                                ...manifest.tables[tbl].constraints,
                                ...tblSpec.constraints
                            };
                        }
                        // Merge foreign keys
                        if (tblSpec.foreign_keys) {
                            manifest.tables[tbl].foreign_keys = [
                                ...(manifest.tables[tbl].foreign_keys || []),
                                ...tblSpec.foreign_keys
                            ];
                        }
                    }
                }
            }
            if (req.indexes) {
                manifest.indexes = {
                    ...manifest.indexes,
                    ...req.indexes
                };
            }
        }
        return manifest;
    }

    /**
     * Reads the migration tracking table managed by migration_runner.service.js.
     * Does NOT create or seed — that is migration_runner's responsibility.
     * Returns an empty result safely if the table doesn't exist yet.
     */
    async _readMigrationsTable() {
        try {
            return await db.query("SELECT version::text, name FROM schema_migrations ORDER BY version ASC");
        } catch (e) {
            // Table might not exist yet on a fresh deploy — treat as no migrations applied
            return { rows: [] };
        }
    }

    /**
     * Performs error classification based on postgres client error details
     */
    _classifyError(err) {
        if (err.code === 'ECONNREFUSED' || err.message.includes('connect')) {
            return schemaConfig.errorClasses.DATABASE_UNAVAILABLE;
        }
        if (err.code === '42501' || err.message.includes('permission')) {
            return schemaConfig.errorClasses.PERMISSION_DENIED;
        }
        return schemaConfig.errorClasses.UNKNOWN_FAILURE;
    }

    /**
     * Executes the comprehensive schema validation
     */
    async validateSchema() {
        const startTime = Date.now();
        let classification = 'OK';
        
        const missingTables = [];
        const missingColumns = [];
        const missingIndexes = [];
        const invalidIndexes = [];
        const missingForeignKeys = [];
        const missingConstraints = [];
        const pendingMigrations = [];
        const warnings = [];
        const optionalFeatureStatus = {};

        try {
            // 1. Fetch all structural and migration metadata concurrently (parallelized round trips)
            const [
                tableRes,
                columnRes,
                indexRes,
                fkRes,
                constraintRes,
                migrationRes
            ] = await Promise.all([
                db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"),
                db.query("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public'"),
                db.query(`
                    SELECT 
                        t.relname AS table_name,
                        i.relname AS index_name,
                        ix.indisunique AS is_unique,
                        ix.indisvalid AS is_valid,
                        am.amname AS index_type,
                        a.attname AS column_name
                    FROM 
                        pg_class t
                        JOIN pg_index ix ON t.oid = ix.indrelid
                        JOIN pg_class i ON i.oid = ix.indexrelid
                        LEFT JOIN pg_attribute a ON t.oid = a.attrelid AND a.attnum = ANY(ix.indkey)
                        JOIN pg_am am ON i.relam = am.oid
                    WHERE 
                        t.relkind = 'r' 
                        AND t.relnamespace = 'public'::regnamespace
                `),
                db.query(`
                    SELECT
                        tc.table_name, 
                        kcu.column_name, 
                        ccu.table_name AS referenced_table_name,
                        ccu.column_name AS referenced_column_name
                    FROM 
                        information_schema.table_constraints AS tc 
                        JOIN information_schema.key_column_usage AS kcu
                          ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
                        JOIN information_schema.referential_constraints AS rc
                          ON tc.constraint_name = rc.constraint_name
                        JOIN information_schema.constraint_column_usage AS ccu
                          ON rc.unique_constraint_name = ccu.constraint_name
                          AND rc.unique_constraint_schema = ccu.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
                `),
                db.query(`
                    SELECT 
                        tc.table_name,
                        tc.constraint_name,
                        tc.constraint_type,
                        kcu.column_name
                    FROM 
                        information_schema.table_constraints AS tc
                        LEFT JOIN information_schema.key_column_usage AS kcu
                          ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
                    WHERE tc.table_schema = 'public'
                `),
                this._readMigrationsTable()
            ]);

            // Map PG metadata arrays into indexed lookup sets/objects for fast in-memory validation
            const dbTables = new Set(tableRes.rows.map(r => r.table_name));
            
            const dbColumns = {};
            columnRes.rows.forEach(r => {
                if (!dbColumns[r.table_name]) dbColumns[r.table_name] = {};
                dbColumns[r.table_name][r.column_name] = {
                    type: r.data_type,
                    nullable: r.is_nullable === 'YES'
                };
            });

            const dbIndexes = {};
            indexRes.rows.forEach(r => {
                if (!dbIndexes[r.index_name]) {
                    dbIndexes[r.index_name] = {
                        tableName: r.table_name,
                        columns: [],
                        isUnique: r.is_unique,
                        isValid: r.is_valid,
                        indexType: r.index_type
                    };
                }
                if (r.column_name) {
                    dbIndexes[r.index_name].columns.push(r.column_name);
                }
            });

            const dbForeignKeys = {};
            fkRes.rows.forEach(r => {
                const key = `${r.table_name}:${r.column_name}`;
                dbForeignKeys[key] = {
                    refTable: r.referenced_table_name,
                    refCol: r.referenced_column_name
                };
            });

            const dbConstraints = {};
            constraintRes.rows.forEach(r => {
                if (!dbConstraints[r.table_name]) dbConstraints[r.table_name] = {};
                if (!dbConstraints[r.table_name][r.constraint_type]) {
                    dbConstraints[r.table_name][r.constraint_type] = new Set();
                }
                if (r.column_name) {
                    dbConstraints[r.table_name][r.constraint_type].add(r.column_name);
                }
            });

            const dbMigrations = new Map(migrationRes.rows.map(r => [r.version, r.name]));

            // Compile the current requirements manifest
            const manifest = this._buildManifest();

            // 2. Validate Migration / Schema Version Compatibility
            manifest.migrations.forEach(m => {
                if (!dbMigrations.has(m.version)) {
                    pendingMigrations.push(m);
                }
            });

            if (pendingMigrations.length > 0) {
                classification = schemaConfig.errorClasses.MIGRATION_MISMATCH;
            }

            // 3. Validate tables, columns, and constraints
            for (const [tableName, tblSpec] of Object.entries(manifest.tables)) {
                if (!dbTables.has(tableName)) {
                    if (tblSpec.required) {
                        missingTables.push(tableName);
                    } else {
                        warnings.push(`Optional table '${tableName}' is missing.`);
                        optionalFeatureStatus[tableName] = 'MISSING';
                    }
                    continue;
                }

                optionalFeatureStatus[tableName] = 'ACTIVE';

                // Columns check
                if (tblSpec.columns) {
                    for (const [colName, colSpec] of Object.entries(tblSpec.columns)) {
                        const dbCol = dbColumns[tableName]?.[colName];
                        if (!dbCol) {
                            if (!colSpec.optional) {
                                missingColumns.push(`${tableName}.${colName}`);
                            } else {
                                warnings.push(`Optional column '${tableName}.${colName}' is missing.`);
                            }
                            continue;
                        }

                        // Type check warnings (relaxed but alerts developers)
                        if (colSpec.type && dbCol.type !== colSpec.type) {
                            // Map aliases (e.g., varchar vs character varying)
                            const typeMap = {
                                'integer': ['integer', 'int4'],
                                'character varying': ['character varying', 'varchar'],
                                'timestamp with time zone': ['timestamp with time zone', 'timestamptz'],
                                'jsonb': ['jsonb', 'json']
                            };
                            const match = typeMap[colSpec.type]?.includes(dbCol.type) || dbCol.type === colSpec.type;
                            if (!match) {
                                warnings.push(`Type mismatch on '${tableName}.${colName}': Expected '${colSpec.type}', got '${dbCol.type}'.`);
                            }
                        }
                    }
                }

                // Foreign Keys check
                if (tblSpec.foreign_keys) {
                    tblSpec.foreign_keys.forEach(fk => {
                        fk.columns.forEach(col => {
                            const fkKey = `${tableName}:${col}`;
                            const dbFk = dbForeignKeys[fkKey];
                            if (!dbFk || dbFk.refTable !== fk.referenced_table || !fk.referenced_columns.includes(dbFk.refCol)) {
                                missingForeignKeys.push(`${tableName}.${col} -> ${fk.referenced_table}`);
                            }
                        });
                    });
                }

                // Primary Key constraints check
                if (tblSpec.constraints?.primary_key) {
                    const pkCols = tblSpec.constraints.primary_key;
                    const dbPks = dbConstraints[tableName]?.['PRIMARY KEY'];
                    pkCols.forEach(col => {
                        if (!dbPks || !dbPks.has(col)) {
                            missingConstraints.push(`${tableName}.PRIMARY_KEY(${col})`);
                        }
                    });
                }
            }

            // 4. Validate Indexes (definitions, validity, types)
            for (const [idxName, idxSpec] of Object.entries(manifest.indexes)) {
                const dbIdx = dbIndexes[idxName];
                if (!dbIdx) {
                    missingIndexes.push(idxName);
                    continue;
                }

                // Index corruption/validity check
                if (!dbIdx.isValid) {
                    invalidIndexes.push(idxName);
                    continue;
                }

                // Type Check
                if (idxSpec.type && dbIdx.indexType !== idxSpec.type) {
                    warnings.push(`Index '${idxName}' type mismatch: Expected '${idxSpec.type}', got '${dbIdx.indexType}'.`);
                }

                // Unique constraint verification
                if (idxSpec.unique && !dbIdx.isUnique) {
                    warnings.push(`Index '${idxName}' expected to be UNIQUE but is not.`);
                }
            }

            // Assess validity state
            // isValid = true means the DB is structurally sound and safe to run against.
            // Pending migrations are a WARNING (schema stamps may lag) — not a fatal blocker.
            const currentSchemaVersion = migrationRes.rows[migrationRes.rows.length - 1]?.version || '0';
            const hasFatalMissingObjects = missingTables.length > 0 || missingColumns.length > 0 || missingIndexes.length > 0;
            const hasCorruption = invalidIndexes.length > 0;
            
            this.isValid = (!hasFatalMissingObjects && !hasCorruption);

            // Demote pending migrations to warnings instead of blocking crons
            if (pendingMigrations.length > 0) {
                warnings.push(`${pendingMigrations.length} migration(s) pending: ${pendingMigrations.map(m => `v${m.version}(${m.name})`).join(', ')}. Run migration_runner to apply.`);
                if (classification === 'OK') {
                    classification = schemaConfig.errorClasses.MIGRATION_MISMATCH;
                }
            }

            if (!this.isValid && classification === 'OK') {
                classification = schemaConfig.errorClasses.SCHEMA_MISSING;
            }

            this.validationResult = {
                isValid: this.isValid,
                schemaVersion: currentSchemaVersion,
                classification,
                missingTables,
                missingColumns,
                missingIndexes,
                invalidIndexes,
                missingForeignKeys,
                missingConstraints,
                pendingMigrations,
                warnings,
                optionalFeatureStatus,
                validatedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime
            };

            // Structured logging with logging cooldown intervals
            const now = Date.now();
            if (!this.isValid && (now - this.lastLoggedAt > schemaConfig.loggingCooldownMs)) {
                console.error(`🚨 [DB-VALIDATION-FAILED] Policy: ${schemaConfig.startupPolicy}. Result:`);
                console.error(JSON.stringify(this.validationResult, null, 2));
                this.lastLoggedAt = now;

                // Handle Startup Policies (fail fast if configured)
                if (schemaConfig.startupPolicy === 'FAIL_FAST') {
                    console.error("FATAL: Startup policy set to FAIL_FAST. Stopping backend process.");
                    process.exit(1);
                }
            }

        } catch (e) {
            this.isValid = false;
            classification = this._classifyError(e);

            this.validationResult = {
                isValid: false,
                schemaVersion: '0.0.0',
                classification,
                error: e.message,
                missingTables,
                missingColumns,
                missingIndexes,
                invalidIndexes,
                missingForeignKeys,
                missingConstraints,
                pendingMigrations,
                warnings,
                optionalFeatureStatus,
                validatedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime
            };

            if (Date.now() - this.lastLoggedAt > schemaConfig.loggingCooldownMs) {
                console.error(`🚨 [DB-VALIDATION-ERROR] Code: ${classification}. Message: ${e.message}`);
                this.lastLoggedAt = Date.now();
                if (schemaConfig.startupPolicy === 'FAIL_FAST') {
                    process.exit(1);
                }
            }
        }
    }

    getStatus() {
        return this.validationResult;
    }
}

module.exports = new DBValidatorService();
