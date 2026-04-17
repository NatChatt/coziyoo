-- Migration: upgrade ticket_messages table to canonical v2 schema
-- Safe to run multiple times.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ticket_messages' AND column_name = 'author_id'
    ) THEN
        ALTER TABLE ticket_messages RENAME COLUMN author_id TO author_user_id;
    END IF;
END $$;

ALTER TABLE ticket_messages
    ALTER COLUMN author_user_id DROP NOT NULL;

ALTER TABLE ticket_messages
    ADD COLUMN IF NOT EXISTS author_admin_id UUID NULL REFERENCES admin_users(id),
    ADD COLUMN IF NOT EXISTS recipient_user_id UUID NULL REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(20) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'ticket_messages'
          AND constraint_name = 'ticket_messages_author_type_check'
    ) THEN
        ALTER TABLE ticket_messages
            ADD CONSTRAINT ticket_messages_author_type_check
            CHECK (author_type IN ('user', 'admin'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_messages_complaint_id
    ON ticket_messages(complaint_id);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_recipient_user_id
    ON ticket_messages(recipient_user_id);
