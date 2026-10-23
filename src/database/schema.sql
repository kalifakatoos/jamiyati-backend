-- ============================================================================
-- Jamiyati (جمعيتي) - SQLite Database Schema DDL
-- Pure P2P Islamic ROSCA Management Platform
-- Version: 1.0.0
-- Architecture: SQLite3 with WAL Mode and Foreign Keys Enforced
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000; -- 64MB Cache

-- ----------------------------------------------------------------------------
-- 1. USERS & IDENTITY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    national_id TEXT,
    iban TEXT,
    bank_name TEXT,
    payment_handle TEXT, -- e.g., InstaPay Address, STC Pay handle, CliQ Alias
    trust_score INTEGER NOT NULL DEFAULT 80 CHECK (trust_score BETWEEN 0 AND 100),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_trust_score ON users(trust_score);

-- ----------------------------------------------------------------------------
-- 2. GUARANTORS (الكفالة الشرعية)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guarantors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guarantor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
    relationship TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, guarantor_user_id),
    CHECK(user_id != guarantor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_guarantors_user_id ON guarantors(user_id);
CREATE INDEX IF NOT EXISTS idx_guarantors_guarantor_id ON guarantors(guarantor_user_id);

-- ----------------------------------------------------------------------------
-- 3. ROSCA CIRCLES (الجمعيات)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT,
    monthly_amount REAL NOT NULL CHECK (monthly_amount > 0),
    currency TEXT NOT NULL DEFAULT 'LYD',
    total_members INTEGER NOT NULL CHECK (total_members >= 2),
    frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'biweekly')),
    start_date DATE NOT NULL,
    payment_day_of_month INTEGER NOT NULL CHECK (payment_day_of_month BETWEEN 1 AND 31),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'ready_for_draw', 'active', 'completed', 'cancelled')),
    turn_determination_method TEXT NOT NULL DEFAULT 'random_draw' CHECK (turn_determination_method IN ('random_draw', 'mutual_agreement')),
    invite_code TEXT UNIQUE NOT NULL,
    draw_seed TEXT,
    draw_executed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_circles_creator ON circles(creator_id);
CREATE INDEX IF NOT EXISTS idx_circles_invite_code ON circles(invite_code);
CREATE INDEX IF NOT EXISTS idx_circles_status ON circles(status);

-- ----------------------------------------------------------------------------
-- 4. CIRCLE MEMBERS (أعضاء الجمعية)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS circle_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    join_status TEXT NOT NULL DEFAULT 'joined' CHECK (join_status IN ('invited', 'joined', 'active', 'left', 'removed')),
    assigned_turn INTEGER DEFAULT NULL,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_circle ON circle_members(circle_id);
CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id);

-- ----------------------------------------------------------------------------
-- 5. TURNS (جدول الأدوار والقرعة)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL CHECK (round_number >= 1),
    assigned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    payout_date DATE NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    is_mutual_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_mutual_priority IN (0, 1)),
    priority_reason TEXT,
    swap_pending_with_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(circle_id, round_number),
    UNIQUE(circle_id, assigned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_turns_circle_round ON turns(circle_id, round_number);
CREATE INDEX IF NOT EXISTS idx_turns_user ON turns(assigned_user_id);

-- ----------------------------------------------------------------------------
-- 6. ROUNDS (الدورات الشهرية)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL CHECK (round_number >= 1),
    beneficiary_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    expected_pool_amount REAL NOT NULL CHECK (expected_pool_amount >= 0),
    collected_amount REAL NOT NULL DEFAULT 0.0 CHECK (collected_amount >= 0),
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'collecting', 'delivered', 'round_closed')),
    closed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(circle_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_rounds_circle ON rounds(circle_id);
CREATE INDEX IF NOT EXISTS idx_rounds_beneficiary ON rounds(beneficiary_user_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);

-- ----------------------------------------------------------------------------
-- 7. PAYMENTS (سجلات السداد المباشر P2P)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    payer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    beneficiary_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    expected_amount REAL NOT NULL CHECK (expected_amount > 0),
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'receipt_uploaded', 'confirmed', 'disputed')),
    paid_at DATETIME,
    confirmed_at DATETIME,
    admin_notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(round_id, payer_id),
    CHECK(payer_id != beneficiary_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_round ON payments(round_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_beneficiary ON payments(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ----------------------------------------------------------------------------
-- 8. RECEIPTS (إيصالات التحويل البنكي الإلكترونية)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    transaction_ref TEXT NOT NULL,
    transfer_date DATETIME NOT NULL,
    notes TEXT,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(payment_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_payment_id ON receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_receipts_transaction_ref ON receipts(transaction_ref);

-- ----------------------------------------------------------------------------
-- 9. TRUST LOGS (سجل درجات الثقة الأخلاقية)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    change_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    circle_id INTEGER REFERENCES circles(id) ON DELETE SET NULL,
    round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trust_logs_user ON trust_logs(user_id);

-- ----------------------------------------------------------------------------
-- 10. AUDIT LOGS (سجل الرقابة والعمليات الحساسة)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    old_values TEXT, -- JSON format
    new_values TEXT, -- JSON format
    ip_address TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);

-- ----------------------------------------------------------------------------
-- 11. NOTIFICATIONS (الإشعارات والتذكيرات الشرعية بالمعروف)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('reminder', 'receipt_uploaded', 'receipt_confirmed', 'draw_completed', 'turn_swap', 'round_closed', 'trust_update', 'system')),
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    metadata TEXT, -- JSON payload
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

-- ----------------------------------------------------------------------------
-- 12. TRIGGERS (الأتمتة وتكامل البيانات)
-- ----------------------------------------------------------------------------

-- Trigger 1: Auto-update user trust score when trust_logs entry is inserted
CREATE TRIGGER IF NOT EXISTS trg_apply_trust_score
AFTER INSERT ON trust_logs
BEGIN
    UPDATE users
    SET trust_score = MAX(0, MIN(100, trust_score + NEW.change_amount)),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.user_id;
END;

-- Trigger 2: Recalculate collected amount in round when payment is confirmed
CREATE TRIGGER IF NOT EXISTS trg_update_round_collected
AFTER UPDATE OF status ON payments
WHEN NEW.status = 'confirmed' OR OLD.status = 'confirmed'
BEGIN
    UPDATE rounds
    SET collected_amount = (
        SELECT COALESCE(SUM(expected_amount), 0.0)
        FROM payments
        WHERE round_id = NEW.round_id AND status = 'confirmed'
    ),
    updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.round_id;
END;

-- Trigger 3: Automatically mark round as 'delivered' when total pool is collected
CREATE TRIGGER IF NOT EXISTS trg_auto_deliver_round
AFTER UPDATE OF collected_amount ON rounds
WHEN NEW.collected_amount >= NEW.expected_pool_amount AND NEW.status = 'collecting'
BEGIN
    UPDATE rounds
    SET status = 'delivered',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- Trigger 4: Audit log for circle status changes
CREATE TRIGGER IF NOT EXISTS trg_audit_circle_status
AFTER UPDATE OF status ON circles
BEGIN
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
    VALUES (
        NEW.creator_id,
        'CIRCLE_STATUS_CHANGED',
        'circles',
        NEW.id,
        json_object('status', OLD.status),
        json_object('status', NEW.status)
    );
END;
