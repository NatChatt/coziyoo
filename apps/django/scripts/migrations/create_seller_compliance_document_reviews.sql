-- Migration: store seller compliance review history.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS seller_compliance_document_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NULL REFERENCES seller_compliance_documents(id) ON DELETE SET NULL,
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_list_id UUID NOT NULL REFERENCES compliance_documents_list(id) ON DELETE CASCADE,
    action VARCHAR(30) NOT NULL,
    rejection_reason TEXT NULL,
    reviewed_by_admin_id UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    file_url_snapshot TEXT NULL,
    CONSTRAINT seller_compliance_document_reviews_action_check
        CHECK (action IN ('approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_seller_compliance_document_reviews_document_id
    ON seller_compliance_document_reviews(document_id);

CREATE INDEX IF NOT EXISTS idx_seller_compliance_document_reviews_seller_document
    ON seller_compliance_document_reviews(seller_id, document_list_id, reviewed_at DESC);
