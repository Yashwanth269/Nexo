const db = require('../config/db');
const settlementService = require('./settlement.service');

class WalletService {
    async getOrCreateWallet(ownerId, ownerType, client = db) {
        const res = await client.query(
            `SELECT * FROM wallets WHERE owner_id = $1 AND owner_type = $2`,
            [ownerId, ownerType]
        );

        if (res.rowCount > 0) {
            return res.rows[0];
        }

        try {
            const insertRes = await client.query(
                `INSERT INTO wallets (owner_id, owner_type, balance, hold_balance, cash_held)
                 VALUES ($1, $2, 0.00, 0.00, 0.00)
                 ON CONFLICT (owner_id, owner_type) DO UPDATE SET updated_at = NOW()
                 RETURNING *`,
                [ownerId, ownerType]
            );
            return insertRes.rows[0];
        } catch (e) {
            const retryRes = await client.query(
                `SELECT * FROM wallets WHERE owner_id = $1 AND owner_type = $2`,
                [ownerId, ownerType]
            );
            return retryRes.rows[0];
        }
    }

    async getBalance(ownerId, ownerType) {
        const wallet = await this.getOrCreateWallet(ownerId, ownerType);
        return {
            balance: parseFloat(wallet.balance),
            holdBalance: parseFloat(wallet.hold_balance),
            cashHeld: parseFloat(wallet.cash_held || 0),
            withdrawable: parseFloat(wallet.balance) - parseFloat(wallet.cash_held || 0),
        };
    }

    async addFunds(ownerId, ownerType, amount, type, referenceId = null, description = null, client = db) {
        const wallet = await this.getOrCreateWallet(ownerId, ownerType, client);
        const oldBalance = parseFloat(wallet.balance);
        const newBalance = oldBalance + parseFloat(amount);

        const updateRes = await client.query(
            `UPDATE wallets
             SET balance = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [newBalance, wallet.id]
        );

        await client.query(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, status, reference_id, description)
             VALUES ($1, $2, $3, 'SUCCESS', $4, $5)`,
            [wallet.id, type, amount, referenceId, description]
        );

        await settlementService.recordEntry(wallet.id, type, amount, oldBalance, newBalance, {
            referenceType: type,
            referenceId,
            description,
        });

        return updateRes.rows[0];
    }

    async deductFunds(ownerId, ownerType, amount, type, referenceId = null, description = null, client = db) {
        const wallet = await this.getOrCreateWallet(ownerId, ownerType, client);
        const currentBalance = parseFloat(wallet.balance);

        if (currentBalance < parseFloat(amount)) {
            throw new Error("Insufficient wallet balance");
        }

        const oldBalance = currentBalance;
        const newBalance = currentBalance - parseFloat(amount);

        const updateRes = await client.query(
            `UPDATE wallets
             SET balance = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [newBalance, wallet.id]
        );

        await client.query(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, status, reference_id, description)
             VALUES ($1, $2, $3, 'SUCCESS', $4, $5)`,
            [wallet.id, type, amount, referenceId, description]
        );

        await settlementService.recordEntry(wallet.id, type, -Math.abs(amount), oldBalance, newBalance, {
            referenceType: type,
            referenceId,
            description,
        });

        return updateRes.rows[0];
    }

    async holdFunds(ownerId, ownerType, amount, referenceId = null, description = null, client = db) {
        const wallet = await this.getOrCreateWallet(ownerId, ownerType, client);
        const currentBalance = parseFloat(wallet.balance);

        if (currentBalance < parseFloat(amount)) {
            throw new Error("Insufficient balance to hold funds");
        }

        const newBalance = currentBalance - parseFloat(amount);
        const newHoldBalance = parseFloat(wallet.hold_balance) + parseFloat(amount);

        const updateRes = await client.query(
            `UPDATE wallets
             SET balance = $1, hold_balance = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [newBalance, newHoldBalance, wallet.id]
        );

        await client.query(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, status, reference_id, description)
             VALUES ($1, 'HOLD', $2, 'SUCCESS', $3, $4)`,
            [wallet.id, amount, referenceId, description]
        );

        await settlementService.recordEntry(wallet.id, 'HOLD', -Math.abs(amount), currentBalance, newBalance, {
            referenceType: 'HOLD',
            referenceId,
            description,
        });

        return updateRes.rows[0];
    }

    async releaseFunds(ownerId, ownerType, amount, referenceId = null, description = null, client = db) {
        const wallet = await this.getOrCreateWallet(ownerId, ownerType, client);
        const currentHold = parseFloat(wallet.hold_balance);

        if (currentHold < parseFloat(amount)) {
            throw new Error("Requested release amount exceeds held funds");
        }

        const oldBalance = parseFloat(wallet.balance);
        const newBalance = oldBalance + parseFloat(amount);
        const newHoldBalance = currentHold - parseFloat(amount);

        const updateRes = await client.query(
            `UPDATE wallets
             SET balance = $1, hold_balance = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [newBalance, newHoldBalance, wallet.id]
        );

        await client.query(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, status, reference_id, description)
             VALUES ($1, 'RELEASE', $2, 'SUCCESS', $3, $4)`,
            [wallet.id, amount, referenceId, description]
        );

        await settlementService.recordEntry(wallet.id, 'RELEASE', amount, oldBalance, newBalance, {
            referenceType: 'RELEASE',
            referenceId,
            description,
        });

        return updateRes.rows[0];
    }

    async creditCash(ownerId, amount, referenceId = null, description = null, client = db) {
        const wallet = await this.getOrCreateWallet(ownerId, 'WORKER', client);
        const oldCashHeld = parseFloat(wallet.cash_held || 0);
        const newCashHeld = oldCashHeld + parseFloat(amount);

        const updateRes = await client.query(
            `UPDATE wallets
             SET cash_held = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [newCashHeld, wallet.id]
        );

        await settlementService.recordEntry(wallet.id, 'CASH_CREDIT', amount, parseFloat(wallet.balance), parseFloat(wallet.balance), {
            cashHeldBefore: oldCashHeld,
            cashHeldAfter: newCashHeld,
            referenceType: 'CASH',
            referenceId,
            description,
        });

        return updateRes.rows[0];
    }

    async confirmCashRelease(ownerId, amount, referenceId = null, description = null, client = db) {
        const wallet = await this.getOrCreateWallet(ownerId, 'WORKER', client);
        const oldCashHeld = parseFloat(wallet.cash_held || 0);
        const oldBalance = parseFloat(wallet.balance);

        if (oldCashHeld < parseFloat(amount)) {
            throw new Error("Cash held amount is less than release amount");
        }

        const newCashHeld = oldCashHeld - parseFloat(amount);
        const newBalance = oldBalance + parseFloat(amount);

        const updateRes = await client.query(
            `UPDATE wallets
             SET balance = $1, cash_held = $2, updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
            [newBalance, newCashHeld, wallet.id]
        );

        await client.query(
            `INSERT INTO wallet_transactions (wallet_id, type, amount, status, reference_id, description)
             VALUES ($1, 'CASH_RELEASE', $2, 'SUCCESS', $3, $4)`,
            [wallet.id, amount, referenceId, description]
        );

        await settlementService.recordEntry(wallet.id, 'CASH_RELEASE', amount, oldBalance, newBalance, {
            cashHeldBefore: oldCashHeld,
            cashHeldAfter: newCashHeld,
            referenceType: 'CASH_CONFIRM',
            referenceId,
            description,
        });

        return updateRes.rows[0];
    }

    async getTransactions(ownerId, ownerType) {
        const wallet = await this.getOrCreateWallet(ownerId, ownerType);
        const res = await db.query(
            `SELECT * FROM wallet_transactions
             WHERE wallet_id = $1
             ORDER BY created_at DESC`,
            [wallet.id]
        );
        return res.rows;
    }

    async getWorkerEarningsSummary(workerId) {
        const wallet = await this.getOrCreateWallet(workerId, 'WORKER');

        const onlineEarningsRes = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payments
             WHERE worker_id = $1 AND payment_status = 'SUCCESS' AND payment_mode IN ('ONLINE', 'WALLET', 'ADVANCE')`,
            [workerId]
        );
        const onlineEarnings = parseFloat(onlineEarningsRes.rows[0].total);

        const cashEarningsRes = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payments
             WHERE worker_id = $1 AND payment_status = 'SUCCESS' AND payment_mode = 'CASH'`,
            [workerId]
        );
        const cashEarnings = parseFloat(cashEarningsRes.rows[0].total);

        const pendingEarningsRes = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payments
             WHERE worker_id = $1 AND payment_status IN ('PENDING', 'DISPUTED') AND payment_mode IN ('ONLINE', 'WALLET', 'ADVANCE')`,
            [workerId]
        );
        const pendingEarnings = parseFloat(pendingEarningsRes.rows[0].total);

        const cashPendingRes = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM cash_confirmations
             WHERE worker_id = $1 AND status = 'PENDING'`,
            [workerId]
        );
        const cashPendingConfirmation = parseFloat(cashPendingRes.rows[0].total);

        const withdrawalsRes = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as total
             FROM payouts
             WHERE worker_id = $1 AND status = 'SUCCESS'`,
            [workerId]
        );
        const totalWithdrawn = parseFloat(withdrawalsRes.rows[0].total);

        const cashHeld = parseFloat(wallet.cash_held || 0);
        const totalBalance = parseFloat(wallet.balance);
        const holdBalance = parseFloat(wallet.hold_balance);

        return {
            totalEarnings: onlineEarnings + cashEarnings,
            cashEarnings,
            onlineEarnings,
            pendingEarnings,
            cashPendingConfirmation,
            withdrawableBalance: totalBalance - cashHeld,
            cashHeld,
            holdBalance,
            totalBalance,
            totalWithdrawn,
        };
    }
}

module.exports = new WalletService();
