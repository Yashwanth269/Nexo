-- Migration: Add commission_history table for auditing and version control of commission configuration rates.

CREATE TABLE IF NOT EXISTS commission_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    previous_rate DECIMAL(5,2),
    new_rate DECIMAL(5,2) NOT NULL,
    previous_min_fee DECIMAL(10,2),
    new_min_fee DECIMAL(10,2) NOT NULL,
    previous_max_fee DECIMAL(10,2),
    new_max_fee DECIMAL(10,2),
    changed_by UUID,
    change_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_commission_history_category ON commission_history(category);
