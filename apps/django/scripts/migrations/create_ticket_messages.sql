-- Migration: create ticket_messages table
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS ticket_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id),
    author_type VARCHAR(20) NOT NULL DEFAULT 'user',  -- 'user' or 'admin'
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_complaint_id
    ON ticket_messages(complaint_id);
