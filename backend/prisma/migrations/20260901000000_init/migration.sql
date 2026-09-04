-- ============================================================================
-- Stock Opname System — initial schema
-- Phase 1: tables, enums, foreign keys, constraints, indexes, integrity triggers
-- ============================================================================

-- ---------------------------------------------------------------- enum types
CREATE TYPE "user_role" AS ENUM ('manager', 'staff');

CREATE TYPE "movement_type" AS ENUM (
    'opening', 'receipt', 'delivery', 'transfer_in', 'transfer_out',
    'adjustment', 'audit_adjustment'
);

CREATE TYPE "audit_program_status" AS ENUM ('draft', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "assignment_type"      AS ENUM ('product', 'location');
CREATE TYPE "assignment_status"    AS ENUM ('pending', 'in_progress', 'done', 'cancelled');
CREATE TYPE "audit_session_status" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'cancelled');
CREATE TYPE "posting_status"       AS ENUM ('pending', 'posted', 'failed');

-- ------------------------------------------------------------ shared helpers
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==================================================================== users
CREATE TABLE "users" (
    "id"            SERIAL PRIMARY KEY,
    "username"      TEXT        NOT NULL,
    "password_hash" TEXT        NOT NULL,
    "name"          TEXT        NOT NULL,
    "email"         TEXT        NOT NULL,
    "role"          "user_role" NOT NULL,
    "is_active"     BOOLEAN     NOT NULL DEFAULT true,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "users_username_key"  UNIQUE ("username"),
    CONSTRAINT "users_email_key"     UNIQUE ("email"),
    CONSTRAINT "users_username_len"  CHECK (char_length("username") BETWEEN 3 AND 64),
    CONSTRAINT "users_email_format"  CHECK ("email" ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX "users_role_is_active_idx" ON "users" ("role", "is_active");

CREATE TRIGGER "users_set_updated_at"
    BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================= products
CREATE TABLE "products" (
    "id"         SERIAL PRIMARY KEY,
    "sku"        TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "is_active"  BOOLEAN     NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "write_uid"  INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "products_sku_key" UNIQUE ("sku"),
    CONSTRAINT "products_sku_not_blank" CHECK (char_length(btrim("sku")) > 0),
    CONSTRAINT "products_create_uid_fkey" FOREIGN KEY ("create_uid") REFERENCES "users" ("id") ON DELETE SET NULL,
    CONSTRAINT "products_write_uid_fkey"  FOREIGN KEY ("write_uid")  REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE INDEX "products_is_active_idx" ON "products" ("is_active");
CREATE INDEX "products_name_idx"      ON "products" (lower("name"));

CREATE TRIGGER "products_set_updated_at"
    BEFORE UPDATE ON "products" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================ locations
CREATE TABLE "locations" (
    "id"         SERIAL PRIMARY KEY,
    "code"       TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "parent_id"  INTEGER,
    "is_active"  BOOLEAN     NOT NULL DEFAULT true,
    "create_uid" INTEGER,
    "write_uid"  INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "locations_code_key" UNIQUE ("code"),
    CONSTRAINT "locations_code_not_blank" CHECK (char_length(btrim("code")) > 0),
    CONSTRAINT "locations_no_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
    -- historical stock references must survive: never cascade a location removal
    CONSTRAINT "locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "locations" ("id") ON DELETE RESTRICT,
    CONSTRAINT "locations_create_uid_fkey" FOREIGN KEY ("create_uid") REFERENCES "users" ("id") ON DELETE SET NULL,
    CONSTRAINT "locations_write_uid_fkey"  FOREIGN KEY ("write_uid")  REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE INDEX "locations_parent_id_idx" ON "locations" ("parent_id");
CREATE INDEX "locations_is_active_idx" ON "locations" ("is_active");

CREATE TRIGGER "locations_set_updated_at"
    BEFORE UPDATE ON "locations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Guard against cycles in the location hierarchy (WH -> Stock -> Rack A -> WH).
CREATE OR REPLACE FUNCTION assert_location_no_cycle() RETURNS trigger AS $$
DECLARE
    cursor_id INTEGER := NEW.parent_id;
    hops      INTEGER := 0;
BEGIN
    WHILE cursor_id IS NOT NULL LOOP
        IF cursor_id = NEW.id THEN
            RAISE EXCEPTION 'location hierarchy cycle detected for location %', NEW.id
                USING ERRCODE = '23514';
        END IF;
        hops := hops + 1;
        IF hops > 64 THEN
            RAISE EXCEPTION 'location hierarchy too deep (possible cycle) for location %', NEW.id
                USING ERRCODE = '23514';
        END IF;
        SELECT parent_id INTO cursor_id FROM "locations" WHERE id = cursor_id;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "locations_no_cycle"
    AFTER INSERT OR UPDATE OF "parent_id" ON "locations"
    FOR EACH ROW EXECUTE FUNCTION assert_location_no_cycle();

-- Resolve a location and every descendant (inclusive) — used by location assignments.
CREATE OR REPLACE FUNCTION location_subtree_ids(root_ids INTEGER[])
RETURNS SETOF INTEGER AS $$
    WITH RECURSIVE tree AS (
        SELECT l.id FROM locations l WHERE l.id = ANY (root_ids)
        UNION
        SELECT c.id FROM locations c JOIN tree t ON c.parent_id = t.id
    )
    SELECT id FROM tree;
$$ LANGUAGE sql STABLE;

-- ============================================================ audit_program
CREATE TABLE "audit_program" (
    "id"               SERIAL PRIMARY KEY,
    "name"             TEXT                   NOT NULL,
    "description"      TEXT,
    "audit_date_from"  DATE                   NOT NULL,
    "audit_date_to"    DATE                   NOT NULL,
    "status"           "audit_program_status" NOT NULL DEFAULT 'draft',
    "created_by"       INTEGER                NOT NULL,
    "created_at"       TIMESTAMPTZ            NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ            NOT NULL DEFAULT now(),
    CONSTRAINT "audit_program_date_range" CHECK ("audit_date_to" >= "audit_date_from"),
    CONSTRAINT "audit_program_name_not_blank" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "audit_program_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT
);

CREATE INDEX "audit_program_status_idx" ON "audit_program" ("status");
CREATE INDEX "audit_program_dates_idx"  ON "audit_program" ("audit_date_from", "audit_date_to");

CREATE TRIGGER "audit_program_set_updated_at"
    BEFORE UPDATE ON "audit_program" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================= audit_assignment
CREATE TABLE "audit_assignment" (
    "audit_program_id"   INTEGER             NOT NULL,
    "id"                 SERIAL PRIMARY KEY,
    "assigned_user_ids"  INTEGER[]           NOT NULL DEFAULT '{}',
    "assignment_type"    "assignment_type"   NOT NULL,
    "product_ids"        INTEGER[]           NOT NULL DEFAULT '{}',
    "location_ids"       INTEGER[]           NOT NULL DEFAULT '{}',
    "status"             "assignment_status" NOT NULL DEFAULT 'pending',
    "notes"              TEXT,
    "created_by"         INTEGER             NOT NULL,
    "created_at"         TIMESTAMPTZ         NOT NULL DEFAULT now(),
    "updated_at"         TIMESTAMPTZ         NOT NULL DEFAULT now(),
    CONSTRAINT "audit_assignment_program_fkey"    FOREIGN KEY ("audit_program_id") REFERENCES "audit_program" ("id") ON DELETE RESTRICT,
    CONSTRAINT "audit_assignment_created_by_fkey" FOREIGN KEY ("created_by")       REFERENCES "users" ("id")         ON DELETE RESTRICT,
    -- at least one staff member must be assigned
    CONSTRAINT "audit_assignment_has_staff" CHECK (coalesce(array_length("assigned_user_ids", 1), 0) >= 1),
    -- no NULL elements inside the id arrays
    CONSTRAINT "audit_assignment_no_null_ids" CHECK (
        array_position("assigned_user_ids", NULL) IS NULL
        AND array_position("product_ids", NULL)   IS NULL
        AND array_position("location_ids", NULL)  IS NULL
    ),
    -- §10/§27: product assignment => products only, location assignment => locations only
    CONSTRAINT "audit_assignment_type_scope" CHECK (
        (
            "assignment_type" = 'product'
            AND coalesce(array_length("product_ids", 1), 0)  >= 1
            AND coalesce(array_length("location_ids", 1), 0)  = 0
        ) OR (
            "assignment_type" = 'location'
            AND coalesce(array_length("location_ids", 1), 0) >= 1
            AND coalesce(array_length("product_ids", 1), 0)   = 0
        )
    )
);

CREATE INDEX "audit_assignment_program_idx" ON "audit_assignment" ("audit_program_id");
CREATE INDEX "audit_assignment_status_idx"  ON "audit_assignment" ("status");
CREATE INDEX "audit_assignment_users_gin"     ON "audit_assignment" USING GIN ("assigned_user_ids");
CREATE INDEX "audit_assignment_products_gin"  ON "audit_assignment" USING GIN ("product_ids");
CREATE INDEX "audit_assignment_locations_gin" ON "audit_assignment" USING GIN ("location_ids");

CREATE TRIGGER "audit_assignment_set_updated_at"
    BEFORE UPDATE ON "audit_assignment" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Array columns cannot carry foreign keys: validate their contents with a trigger.
CREATE OR REPLACE FUNCTION assert_audit_assignment_refs() RETURNS trigger AS $$
DECLARE
    offending INTEGER;
BEGIN
    SELECT s.id INTO offending
      FROM unnest(NEW.assigned_user_ids) AS s(id)
     WHERE NOT EXISTS (
            SELECT 1 FROM users u
             WHERE u.id = s.id AND u.role = 'staff' AND u.is_active
     )
     LIMIT 1;
    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'assigned_user_ids: % is not an active staff user', offending
            USING ERRCODE = '23514';
    END IF;

    SELECT s.id INTO offending
      FROM unnest(NEW.product_ids) AS s(id)
     WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = s.id AND p.is_active)
     LIMIT 1;
    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'product_ids: % is not an active product', offending
            USING ERRCODE = '23514';
    END IF;

    SELECT s.id INTO offending
      FROM unnest(NEW.location_ids) AS s(id)
     WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = s.id AND l.is_active)
     LIMIT 1;
    IF offending IS NOT NULL THEN
        RAISE EXCEPTION 'location_ids: % is not an active location', offending
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_assignment_assert_refs"
    BEFORE INSERT OR UPDATE OF "assigned_user_ids", "product_ids", "location_ids"
    ON "audit_assignment"
    FOR EACH ROW EXECUTE FUNCTION assert_audit_assignment_refs();

-- ============================================================ audit_session
CREATE TABLE "audit_session" (
    "id"                  SERIAL PRIMARY KEY,
    "audit_assignment_id" INTEGER                NOT NULL,
    "staff_id"            INTEGER                NOT NULL,
    "status"              "audit_session_status" NOT NULL DEFAULT 'draft',
    "started_at"          TIMESTAMPTZ            NOT NULL DEFAULT now(),
    "submitted_at"        TIMESTAMPTZ,
    "approved_at"         TIMESTAMPTZ,
    "approved_by"         INTEGER,
    "rejected_at"         TIMESTAMPTZ,
    "rejected_by"         INTEGER,
    "rejection_reason"    TEXT,
    "notes"               TEXT,
    "created_at"          TIMESTAMPTZ            NOT NULL DEFAULT now(),
    "updated_at"          TIMESTAMPTZ            NOT NULL DEFAULT now(),
    CONSTRAINT "audit_session_assignment_fkey"  FOREIGN KEY ("audit_assignment_id") REFERENCES "audit_assignment" ("id") ON DELETE RESTRICT,
    CONSTRAINT "audit_session_staff_fkey"       FOREIGN KEY ("staff_id")            REFERENCES "users" ("id")            ON DELETE RESTRICT,
    CONSTRAINT "audit_session_approved_by_fkey" FOREIGN KEY ("approved_by")         REFERENCES "users" ("id")            ON DELETE RESTRICT,
    CONSTRAINT "audit_session_rejected_by_fkey" FOREIGN KEY ("rejected_by")         REFERENCES "users" ("id")            ON DELETE RESTRICT,
    CONSTRAINT "audit_session_approved_fields" CHECK (
        "status" <> 'approved' OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
    ),
    CONSTRAINT "audit_session_rejected_fields" CHECK (
        "status" <> 'rejected' OR ("rejected_at" IS NOT NULL AND "rejected_by" IS NOT NULL)
    ),
    CONSTRAINT "audit_session_submitted_fields" CHECK (
        "status" <> 'submitted' OR "submitted_at" IS NOT NULL
    )
);

CREATE INDEX "audit_session_assignment_status_idx" ON "audit_session" ("audit_assignment_id", "status");
CREATE INDEX "audit_session_staff_status_idx"      ON "audit_session" ("staff_id", "status");

-- §25: a staff member may only hold one open (draft) session per assignment ...
CREATE UNIQUE INDEX "audit_session_one_draft_per_staff"
    ON "audit_session" ("audit_assignment_id", "staff_id") WHERE "status" = 'draft';

-- ... and an assignment can never end up with two approved sessions (§21, §34.11/12).
CREATE UNIQUE INDEX "audit_session_one_approved_per_assignment"
    ON "audit_session" ("audit_assignment_id") WHERE "status" = 'approved';

CREATE TRIGGER "audit_session_set_updated_at"
    BEFORE UPDATE ON "audit_session" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ======================================================= audit_session_item
CREATE TABLE "audit_session_item" (
    "id"                SERIAL PRIMARY KEY,
    "audit_session_id"  INTEGER        NOT NULL,
    "product_id"        INTEGER        NOT NULL,
    "location_id"       INTEGER        NOT NULL,
    "system_quantity"   NUMERIC(18, 3) NOT NULL,
    "counted_quantity"  NUMERIC(18, 3) NOT NULL,
    -- §17: the database owns the arithmetic
    "difference"        NUMERIC(18, 3) NOT NULL GENERATED ALWAYS AS ("counted_quantity" - "system_quantity") STORED,
    "note"              TEXT,
    "counted_at"        TIMESTAMPTZ,
    "edited_by"         INTEGER,
    "edited_at"         TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT "audit_session_item_session_fkey"   FOREIGN KEY ("audit_session_id") REFERENCES "audit_session" ("id") ON DELETE CASCADE,
    CONSTRAINT "audit_session_item_product_fkey"   FOREIGN KEY ("product_id")       REFERENCES "products" ("id")      ON DELETE RESTRICT,
    CONSTRAINT "audit_session_item_location_fkey"  FOREIGN KEY ("location_id")      REFERENCES "locations" ("id")     ON DELETE RESTRICT,
    CONSTRAINT "audit_session_item_edited_by_fkey" FOREIGN KEY ("edited_by")        REFERENCES "users" ("id")         ON DELETE SET NULL,
    CONSTRAINT "audit_session_item_counted_non_negative" CHECK ("counted_quantity" >= 0),
    -- §17/§27: one row per session/product/location combination
    CONSTRAINT "audit_session_item_unique" UNIQUE ("audit_session_id", "product_id", "location_id")
);

CREATE INDEX "audit_session_item_session_idx"  ON "audit_session_item" ("audit_session_id");
CREATE INDEX "audit_session_item_product_idx"  ON "audit_session_item" ("product_id", "location_id");
CREATE INDEX "audit_session_item_diff_idx"     ON "audit_session_item" ("audit_session_id") WHERE "difference" <> 0;

CREATE TRIGGER "audit_session_item_set_updated_at"
    BEFORE UPDATE ON "audit_session_item" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =================================================== audit_session_item_log
-- §20: manager edits of audit results must be traceable (old/new/user/time/reason).
CREATE TABLE "audit_session_item_log" (
    "id"                    SERIAL PRIMARY KEY,
    "audit_session_item_id" INTEGER        NOT NULL,
    "field"                 TEXT           NOT NULL,
    "old_value"             TEXT,
    "new_value"             TEXT,
    "reason"                TEXT,
    "changed_by"            INTEGER        NOT NULL,
    "changed_at"            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT "audit_session_item_log_item_fkey"    FOREIGN KEY ("audit_session_item_id") REFERENCES "audit_session_item" ("id") ON DELETE CASCADE,
    CONSTRAINT "audit_session_item_log_user_fkey"    FOREIGN KEY ("changed_by")            REFERENCES "users" ("id")              ON DELETE RESTRICT
);

CREATE INDEX "audit_session_item_log_item_idx" ON "audit_session_item_log" ("audit_session_item_id", "changed_at" DESC);

-- ========================================================= stock_adjustment
CREATE TABLE "stock_adjustment" (
    "id"               SERIAL PRIMARY KEY,
    "audit_session_id" INTEGER          NOT NULL,
    "created_by"       INTEGER          NOT NULL,
    "notes"            TEXT,
    -- Phase 7: idempotency guard for asynchronous reconciliation
    "posting_status"   "posting_status" NOT NULL DEFAULT 'pending',
    "posted_at"        TIMESTAMPTZ,
    "posting_error"    TEXT,
    "created_at"       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    -- §22/§27: one audit session can produce at most one stock adjustment
    CONSTRAINT "stock_adjustment_audit_session_key" UNIQUE ("audit_session_id"),
    CONSTRAINT "stock_adjustment_session_fkey"    FOREIGN KEY ("audit_session_id") REFERENCES "audit_session" ("id") ON DELETE RESTRICT,
    CONSTRAINT "stock_adjustment_created_by_fkey" FOREIGN KEY ("created_by")       REFERENCES "users" ("id")         ON DELETE RESTRICT,
    CONSTRAINT "stock_adjustment_posted_fields" CHECK (
        "posting_status" <> 'posted' OR "posted_at" IS NOT NULL
    )
);

CREATE INDEX "stock_adjustment_posting_status_idx" ON "stock_adjustment" ("posting_status");

-- ============================================================== stock_quant
-- Immutable stock movement ledger — the historical source of truth (§7.1, §28).
CREATE TABLE "stock_quant" (
    "id"             SERIAL PRIMARY KEY,
    "product_id"     INTEGER         NOT NULL,
    "location_id"    INTEGER         NOT NULL,
    "quantity"       NUMERIC(18, 3)  NOT NULL,
    "movement_type"  "movement_type" NOT NULL,
    "reference_type" TEXT,
    "reference_id"   INTEGER,
    "adjustment_id"  INTEGER,
    "created_by"     INTEGER         NOT NULL,
    "created_at"     TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT "stock_quant_product_fkey"    FOREIGN KEY ("product_id")    REFERENCES "products" ("id")         ON DELETE RESTRICT,
    CONSTRAINT "stock_quant_location_fkey"   FOREIGN KEY ("location_id")   REFERENCES "locations" ("id")        ON DELETE RESTRICT,
    CONSTRAINT "stock_quant_adjustment_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustment" ("id") ON DELETE RESTRICT,
    CONSTRAINT "stock_quant_created_by_fkey" FOREIGN KEY ("created_by")    REFERENCES "users" ("id")            ON DELETE RESTRICT,
    -- §23: a zero difference must never create a movement
    CONSTRAINT "stock_quant_quantity_not_zero" CHECK ("quantity" <> 0),
    CONSTRAINT "stock_quant_audit_needs_adjustment" CHECK (
        "movement_type" <> 'audit_adjustment' OR "adjustment_id" IS NOT NULL
    )
);

CREATE INDEX "stock_quant_product_location_idx" ON "stock_quant" ("product_id", "location_id", "id" DESC);
CREATE INDEX "stock_quant_location_idx"         ON "stock_quant" ("location_id");
CREATE INDEX "stock_quant_created_at_idx"       ON "stock_quant" ("created_at" DESC);
CREATE INDEX "stock_quant_adjustment_idx"       ON "stock_quant" ("adjustment_id");
CREATE INDEX "stock_quant_movement_type_idx"    ON "stock_quant" ("movement_type");
CREATE INDEX "stock_quant_reference_idx"        ON "stock_quant" ("reference_type", "reference_id");

-- §26: stock history is append-only and must never be silently rewritten.
CREATE OR REPLACE FUNCTION forbid_stock_quant_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'stock_quant is an append-only ledger: % is not allowed. Post a compensating movement instead.',
        TG_OP
        USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_quant_append_only"
    BEFORE UPDATE OR DELETE ON "stock_quant"
    FOR EACH ROW EXECUTE FUNCTION forbid_stock_quant_mutation();

-- ============================================================ stock_balance
-- Performance cache of the current stock — always written in the same transaction
-- as the stock_quant rows that move it (§8, §16).
CREATE TABLE "stock_balance" (
    "id"          SERIAL PRIMARY KEY,
    "product_id"  INTEGER        NOT NULL,
    "location_id" INTEGER        NOT NULL,
    "quantity"    NUMERIC(18, 3) NOT NULL DEFAULT 0,
    "updated_at"  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT "stock_balance_product_location_key" UNIQUE ("product_id", "location_id"),
    CONSTRAINT "stock_balance_product_fkey"  FOREIGN KEY ("product_id")  REFERENCES "products" ("id")  ON DELETE RESTRICT,
    CONSTRAINT "stock_balance_location_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE RESTRICT
);

CREATE INDEX "stock_balance_location_idx" ON "stock_balance" ("location_id");
CREATE INDEX "stock_balance_nonzero_idx"  ON "stock_balance" ("location_id", "product_id") WHERE "quantity" <> 0;

-- Verification view: stock_balance must always equal the ledger (§28).
CREATE OR REPLACE VIEW "stock_balance_consistency" AS
SELECT
    coalesce(b.product_id, q.product_id)   AS product_id,
    coalesce(b.location_id, q.location_id) AS location_id,
    coalesce(b.quantity, 0)                AS balance_quantity,
    coalesce(q.ledger_quantity, 0)         AS ledger_quantity,
    coalesce(b.quantity, 0) - coalesce(q.ledger_quantity, 0) AS drift
FROM "stock_balance" b
FULL OUTER JOIN (
    SELECT product_id, location_id, sum(quantity) AS ledger_quantity
      FROM "stock_quant"
     GROUP BY product_id, location_id
) q ON q.product_id = b.product_id AND q.location_id = b.location_id;
