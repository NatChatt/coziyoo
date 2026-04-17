-- Migration: create ticket_messages table (canonical v2)
-- Run this in your SQL editor

CREATE TABLE IF NOT EXISTS ticket_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id      UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    author_type       VARCHAR(20) NOT NULL,
    author_user_id    UUID NULL REFERENCES users(id),
    author_admin_id   UUID NULL REFERENCES admin_users(id),
    recipient_user_id UUID NULL REFERENCES users(id),
    recipient_role    VARCHAR(20) NULL,
    body              TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ticket_messages_author_type_check CHECK (author_type IN ('user', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_complaint_id
    ON ticket_messages(complaint_id);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_recipient_user_id
    ON ticket_messages(recipient_user_id);
