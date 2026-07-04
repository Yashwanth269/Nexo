const db = require('../config/db');

class SettlementService {
    async recordEntry(walletId, entryType, amount, balanceBefore, balanceAfter, options = {}) {
        const { cashHeldBefore = 0, cashHeldAfter = 0, referenceType = null, referenceId = null, description = null, metadata = {} } = options;
        const res = await db.query(
            `INSERT INTO settlement_ledger (wallet_id, entry_type, amount, balance_before, balance_after, cash_held_before, cash_held_after, reference_type, reference_id, description, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [walletId, entryType, amount, balanceBefore, balanceAfter, cashHeldBefore, cashHeldAfter, referenceType, referenceId, description, JSON.stringify(metadata)]
        );
        return res.rows[0];
    }

    async getLedger(walletId, limit = 50, offset = 0) {
        const res = await db.query(
            `SELECT * FROM settlement_ledger WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [walletId, limit, offset]
        );
        return res.rows;
    }

    async getLedgerByReference(referenceType, referenceId) {
        const res = await db.query(
            `SELECT * FROM settlement_ledger WHERE reference_type = $1 AND reference_id = $2 ORDER BY created_at`,
            [referenceType, referenceId]
        );
        return res.rows;
    }
}

module.exports = new SettlementService();
