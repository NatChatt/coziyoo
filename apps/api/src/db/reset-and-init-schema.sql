--
-- PostgreSQL database dump
--

\restrict 1qxUnALlESTKbYz6AdxVhwtuYSIKdaC0AbjzNRmEtWf0xxFm3tMK4dsSMblD1HT

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: prevent_production_lot_mutating_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.prevent_production_lot_mutating_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'production_lots records are immutable and cannot be deleted';
END;
$$;


--
-- Name: seed_seller_compliance_documents_on_user_upsert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.seed_seller_compliance_documents_on_user_upsert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.user_type IN ('seller', 'both') THEN
    INSERT INTO seller_compliance_documents (
      seller_id,
      document_list_id,
      is_required,
      status,
      version,
      is_current,
      created_at,
      updated_at
    )
    SELECT
      NEW.id,
      cdl.id,
      cdl.is_required_default,
      'requested',
      1,
      TRUE,
      now(),
      now()
    FROM compliance_documents_list cdl
    WHERE cdl.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM seller_compliance_documents scd
        WHERE scd.seller_id = NEW.id
          AND scd.document_list_id = cdl.id
          AND scd.is_current = TRUE
      );
  END IF;

  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: abuse_risk_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abuse_risk_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    flow text NOT NULL,
    risk_score numeric(5,2) DEFAULT 0 NOT NULL,
    decision text NOT NULL,
    reason_codes_json jsonb,
    request_fingerprint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT abuse_risk_events_decision_check CHECK ((decision = ANY (ARRAY['allow'::text, 'challenge'::text, 'deny'::text, 'review'::text]))),
    CONSTRAINT abuse_risk_events_subject_type_check CHECK ((subject_type = ANY (ARRAY['user'::text, 'device'::text, 'ip'::text, 'session'::text, 'order'::text])))
);


--
-- Name: admin_api_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_api_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    label text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    token_preview text NOT NULL,
    claims_json jsonb,
    created_by_admin_id uuid NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_api_tokens_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'super_admin'::text])))
);


--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_admin_id uuid NOT NULL,
    actor_email text NOT NULL,
    actor_role text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    before_json jsonb,
    after_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_auth_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_auth_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid,
    event_type text NOT NULL,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    device_info text,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: admin_table_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_table_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    table_key text NOT NULL,
    visible_columns jsonb NOT NULL,
    column_order jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT admin_users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'super_admin'::text])))
);


--
-- Name: allergen_disclosure_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allergen_disclosure_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    food_id uuid NOT NULL,
    phase text NOT NULL,
    allergen_snapshot_json jsonb NOT NULL,
    disclosure_method text NOT NULL,
    buyer_confirmation text NOT NULL,
    evidence_ref text,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT allergen_disclosure_records_phase_check CHECK ((phase = ANY (ARRAY['pre_order'::text, 'handover'::text])))
);


--
-- Name: auth_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type text NOT NULL,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    device_info text,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: buyer_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyer_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: buyer_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buyer_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    tag text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name_tr text NOT NULL,
    name_en text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    order_id uuid,
    last_message text,
    last_message_time timestamp with time zone,
    last_message_sender text,
    buyer_unread_count integer DEFAULT 0 NOT NULL,
    seller_unread_count integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    commission_rate numeric(5,4) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_settings_commission_rate_check CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (1)::numeric)))
);


--
-- Name: complaint_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaint_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    complainant_buyer_id uuid,
    complainant_type text NOT NULL,
    complainant_user_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    category_id uuid,
    priority text DEFAULT 'medium'::text NOT NULL,
    resolved_at timestamp with time zone,
    resolution_note text,
    assigned_admin_id uuid,
    CONSTRAINT complaints_complainant_type_check CHECK ((complainant_type = ANY (ARRAY['buyer'::text, 'seller'::text]))),
    CONSTRAINT complaints_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT complaints_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: compliance_documents_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_documents_list (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    source_info text,
    details text,
    validity_years integer,
    is_active boolean DEFAULT true NOT NULL,
    is_required_default boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compliance_documents_list_validity_years_check CHECK (((validity_years IS NULL) OR (validity_years > 0)))
);


--
-- Name: delivery_proof_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_proof_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    proof_mode text DEFAULT 'pin'::text NOT NULL,
    pin_hash text NOT NULL,
    pin_sent_at timestamp with time zone,
    pin_sent_channel text DEFAULT 'in_app'::text NOT NULL,
    pin_verified_at timestamp with time zone,
    verification_attempts integer DEFAULT 0 NOT NULL,
    status text NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT delivery_proof_records_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'failed'::text, 'expired'::text])))
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    user_id uuid NOT NULL,
    food_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: finance_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    dispute_case_id uuid,
    type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: finance_reconciliation_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_reconciliation_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid NOT NULL,
    report_type text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text NOT NULL,
    file_url text,
    checksum text,
    generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT finance_reconciliation_reports_actor_type_check CHECK ((actor_type = ANY (ARRAY['seller'::text, 'admin'::text]))),
    CONSTRAINT finance_reconciliation_reports_report_type_check CHECK ((report_type = ANY (ARRAY['payout_summary'::text, 'order_settlement'::text, 'refund_chargeback'::text, 'tax_base'::text]))),
    CONSTRAINT finance_reconciliation_reports_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: foods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    category_id uuid,
    name text NOT NULL,
    card_summary text,
    description text,
    recipe text,
    cuisine text,
    country_code text,
    price numeric(12,2) NOT NULL,
    image_url text,
    image_urls_json jsonb,
    ingredients_json jsonb,
    allergens_json jsonb,
    preparation_time_minutes integer,
    serving_size text,
    is_active boolean DEFAULT true NOT NULL,
    rating numeric(3,2) DEFAULT 0 NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    favorite_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    key_hash text NOT NULL,
    request_hash text NOT NULL,
    response_status integer,
    response_body_json jsonb,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lot_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lot_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    event_type text NOT NULL,
    event_payload_json jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    provider text NOT NULL,
    object_key text NOT NULL,
    public_url text,
    content_type text,
    size_bytes bigint,
    checksum text,
    related_entity_type text,
    related_entity_id uuid,
    status text NOT NULL,
    metadata_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    chat_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_type text NOT NULL,
    message text,
    message_type text NOT NULL,
    order_data_json jsonb,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_message_type_check CHECK ((message_type = ANY (ARRAY['text'::text, 'image'::text, 'order_update'::text])))
);


--
-- Name: notification_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data_json jsonb,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    actor_user_id uuid,
    event_type text NOT NULL,
    from_status text,
    to_status text,
    payload_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_finance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_finance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    gross_amount numeric(12,2) NOT NULL,
    commission_rate_snapshot numeric(5,4) NOT NULL,
    commission_amount numeric(12,2) NOT NULL,
    seller_net_amount numeric(12,2) NOT NULL,
    finalized_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_item_lot_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_item_lot_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    lot_id uuid NOT NULL,
    quantity_allocated integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_item_lot_allocations_quantity_allocated_check CHECK ((quantity_allocated > 0))
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    lot_id uuid,
    food_id uuid NOT NULL,
    quantity integer NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    line_total numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    status text NOT NULL,
    delivery_type text NOT NULL,
    delivery_address_json jsonb,
    total_price numeric(12,2) NOT NULL,
    requested_at timestamp with time zone,
    estimated_delivery_time timestamp with time zone,
    payment_completed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox_dead_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_dead_letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    outbox_event_id uuid,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    payload_json jsonb NOT NULL,
    last_error text,
    failed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    payload_json jsonb NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT outbox_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text])))
);


--
-- Name: payment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    provider text NOT NULL,
    provider_session_id text,
    provider_reference_id text,
    status text NOT NULL,
    callback_payload_json jsonb,
    signature_valid boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_dispute_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_dispute_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    payment_attempt_id uuid NOT NULL,
    provider_case_id text,
    case_type text NOT NULL,
    reason_code text,
    liability_party text NOT NULL,
    liability_ratio_json jsonb,
    status text NOT NULL,
    evidence_bundle_json jsonb,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_dispute_cases_case_type_check CHECK ((case_type = ANY (ARRAY['refund'::text, 'chargeback'::text]))),
    CONSTRAINT payment_dispute_cases_liability_party_check CHECK ((liability_party = ANY (ARRAY['seller'::text, 'platform'::text, 'provider'::text, 'shared'::text]))),
    CONSTRAINT payment_dispute_cases_status_check CHECK ((status = ANY (ARRAY['opened'::text, 'under_review'::text, 'won'::text, 'lost'::text, 'closed'::text])))
);


--
-- Name: production_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    food_id uuid NOT NULL,
    lot_number text NOT NULL,
    produced_at timestamp with time zone NOT NULL,
    use_by timestamp with time zone,
    best_before timestamp with time zone,
    quantity_produced integer NOT NULL,
    quantity_available integer NOT NULL,
    status text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sale_starts_at timestamp with time zone NOT NULL,
    sale_ends_at timestamp with time zone NOT NULL,
    recipe_snapshot text,
    ingredients_snapshot_json jsonb,
    allergens_snapshot_json jsonb,
    CONSTRAINT production_lots_produced_before_sale_start_check CHECK ((produced_at <= sale_starts_at)),
    CONSTRAINT production_lots_quantity_available_check CHECK ((quantity_available >= 0)),
    CONSTRAINT production_lots_quantity_produced_check CHECK ((quantity_produced >= 0)),
    CONSTRAINT production_lots_sale_window_check CHECK ((sale_starts_at <= sale_ends_at)),
    CONSTRAINT production_lots_status_check CHECK ((status = ANY (ARRAY['open'::text, 'locked'::text, 'depleted'::text, 'recalled'::text, 'discarded'::text, 'expired'::text])))
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    food_id uuid NOT NULL,
    buyer_id uuid NOT NULL,
    seller_id uuid NOT NULL,
    order_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    images_json jsonb,
    helpful_count integer DEFAULT 0 NOT NULL,
    report_count integer DEFAULT 0 NOT NULL,
    is_verified_purchase boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: seller_compliance_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_compliance_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    document_list_id uuid NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    status text NOT NULL,
    file_url text,
    uploaded_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by_admin_id uuid,
    rejection_reason text,
    notes text,
    expires_at timestamp with time zone,
    expired boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_compliance_documents_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'uploaded'::text, 'approved'::text, 'rejected'::text, 'expired'::text]))),
    CONSTRAINT seller_compliance_documents_version_check CHECK ((version > 0))
);


--
-- Name: seller_optional_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seller_optional_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seller_id uuid NOT NULL,
    document_list_id uuid,
    custom_title text,
    custom_description text,
    file_url text NOT NULL,
    status text DEFAULT 'uploaded'::text NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by_admin_id uuid,
    rejection_reason text,
    expires_at timestamp with time zone,
    expired boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT seller_optional_uploads_check CHECK (((document_list_id IS NOT NULL) OR ((custom_title IS NOT NULL) AND (length(TRIM(BOTH FROM custom_title)) > 0)))),
    CONSTRAINT seller_optional_uploads_status_check CHECK ((status = ANY (ARRAY['uploaded'::text, 'approved'::text, 'rejected'::text, 'archived'::text, 'expired'::text])))
);


--
-- Name: sms_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    message text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sms_logs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: starter_agent_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.starter_agent_settings (
    device_id text NOT NULL,
    agent_name text NOT NULL,
    voice_language text NOT NULL,
    tts_enabled boolean DEFAULT true NOT NULL,
    stt_enabled boolean DEFAULT true NOT NULL,
    system_prompt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    greeting_enabled boolean DEFAULT true NOT NULL,
    greeting_instruction text,
    tts_engine text DEFAULT 'f5-tts'::text NOT NULL,
    tts_config_json jsonb,
    ollama_model text DEFAULT 'llama3.1'::text NOT NULL,
    tts_servers_json jsonb,
    active_tts_server_id text,
    is_active boolean DEFAULT false NOT NULL
);


--
-- Name: user_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    address_line text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_login_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_login_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    accuracy_m integer,
    source text DEFAULT 'app'::text NOT NULL,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_presence_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_presence_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    session_id uuid,
    event_type text NOT NULL,
    ip text,
    user_agent text,
    happened_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_presence_events_event_type_check CHECK ((event_type = ANY (ARRAY['login'::text, 'refresh'::text, 'logout'::text]))),
    CONSTRAINT user_presence_events_subject_type_check CHECK ((subject_type = ANY (ARRAY['app_user'::text, 'admin_user'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    display_name_normalized text NOT NULL,
    username text NOT NULL,
    username_normalized text NOT NULL,
    full_name text,
    user_type text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    country_code text,
    language text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latitude numeric(9,6),
    longitude numeric(9,6),
    profile_image_url text,
    home_card_image_url text,
    phone text,
    dob date,
    legal_hold_state boolean DEFAULT false NOT NULL,
    CONSTRAINT users_latitude_range_check CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))),
    CONSTRAINT users_longitude_range_check CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))),
    CONSTRAINT users_user_type_check CHECK ((user_type = ANY (ARRAY['buyer'::text, 'seller'::text, 'both'::text])))
);


--
-- Name: abuse_risk_events abuse_risk_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abuse_risk_events
    ADD CONSTRAINT abuse_risk_events_pkey PRIMARY KEY (id);


--
-- Name: admin_api_tokens admin_api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_api_tokens
    ADD CONSTRAINT admin_api_tokens_pkey PRIMARY KEY (id);


--
-- Name: admin_api_tokens admin_api_tokens_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_api_tokens
    ADD CONSTRAINT admin_api_tokens_session_id_key UNIQUE (session_id);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_auth_audit admin_auth_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_auth_audit
    ADD CONSTRAINT admin_auth_audit_pkey PRIMARY KEY (id);


--
-- Name: admin_auth_sessions admin_auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_auth_sessions
    ADD CONSTRAINT admin_auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: admin_table_preferences admin_table_preferences_admin_user_id_table_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_table_preferences
    ADD CONSTRAINT admin_table_preferences_admin_user_id_table_key_key UNIQUE (admin_user_id, table_key);


--
-- Name: admin_table_preferences admin_table_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_table_preferences
    ADD CONSTRAINT admin_table_preferences_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: allergen_disclosure_records allergen_disclosure_records_order_id_phase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergen_disclosure_records
    ADD CONSTRAINT allergen_disclosure_records_order_id_phase_key UNIQUE (order_id, phase);


--
-- Name: allergen_disclosure_records allergen_disclosure_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergen_disclosure_records
    ADD CONSTRAINT allergen_disclosure_records_pkey PRIMARY KEY (id);


--
-- Name: auth_audit auth_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit
    ADD CONSTRAINT auth_audit_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: buyer_notes buyer_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_notes
    ADD CONSTRAINT buyer_notes_pkey PRIMARY KEY (id);


--
-- Name: buyer_tags buyer_tags_buyer_id_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_tags
    ADD CONSTRAINT buyer_tags_buyer_id_tag_key UNIQUE (buyer_id, tag);


--
-- Name: buyer_tags buyer_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_tags
    ADD CONSTRAINT buyer_tags_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: chats chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_pkey PRIMARY KEY (id);


--
-- Name: commission_settings commission_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_settings
    ADD CONSTRAINT commission_settings_pkey PRIMARY KEY (id);


--
-- Name: complaint_categories complaint_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_categories
    ADD CONSTRAINT complaint_categories_code_key UNIQUE (code);


--
-- Name: complaint_categories complaint_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaint_categories
    ADD CONSTRAINT complaint_categories_pkey PRIMARY KEY (id);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);


--
-- Name: compliance_documents_list compliance_documents_list_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_documents_list
    ADD CONSTRAINT compliance_documents_list_code_key UNIQUE (code);


--
-- Name: compliance_documents_list compliance_documents_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_documents_list
    ADD CONSTRAINT compliance_documents_list_pkey PRIMARY KEY (id);


--
-- Name: delivery_proof_records delivery_proof_records_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_proof_records
    ADD CONSTRAINT delivery_proof_records_order_id_key UNIQUE (order_id);


--
-- Name: delivery_proof_records delivery_proof_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_proof_records
    ADD CONSTRAINT delivery_proof_records_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (user_id, food_id);


--
-- Name: finance_adjustments finance_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_adjustments
    ADD CONSTRAINT finance_adjustments_pkey PRIMARY KEY (id);


--
-- Name: finance_reconciliation_reports finance_reconciliation_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_reconciliation_reports
    ADD CONSTRAINT finance_reconciliation_reports_pkey PRIMARY KEY (id);


--
-- Name: foods foods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foods
    ADD CONSTRAINT foods_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_scope_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_scope_key_hash_key UNIQUE (scope, key_hash);


--
-- Name: lot_events lot_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot_events
    ADD CONSTRAINT lot_events_pkey PRIMARY KEY (id);


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notification_events notification_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_finance order_finance_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_finance
    ADD CONSTRAINT order_finance_order_id_key UNIQUE (order_id);


--
-- Name: order_finance order_finance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_finance
    ADD CONSTRAINT order_finance_pkey PRIMARY KEY (id);


--
-- Name: order_item_lot_allocations order_item_lot_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_lot_allocations
    ADD CONSTRAINT order_item_lot_allocations_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_order_id_lot_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_lot_id_key UNIQUE (order_id, lot_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: outbox_dead_letters outbox_dead_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_dead_letters
    ADD CONSTRAINT outbox_dead_letters_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: payment_attempts payment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_pkey PRIMARY KEY (id);


--
-- Name: payment_attempts payment_attempts_provider_reference_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_provider_reference_id_key UNIQUE (provider_reference_id);


--
-- Name: payment_attempts payment_attempts_provider_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_provider_session_id_key UNIQUE (provider_session_id);


--
-- Name: payment_dispute_cases payment_dispute_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dispute_cases
    ADD CONSTRAINT payment_dispute_cases_pkey PRIMARY KEY (id);


--
-- Name: payment_dispute_cases payment_dispute_cases_provider_case_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dispute_cases
    ADD CONSTRAINT payment_dispute_cases_provider_case_id_key UNIQUE (provider_case_id);


--
-- Name: production_lots production_lots_lot_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lots
    ADD CONSTRAINT production_lots_lot_number_key UNIQUE (lot_number);


--
-- Name: production_lots production_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lots
    ADD CONSTRAINT production_lots_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_buyer_id_food_id_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_buyer_id_food_id_order_id_key UNIQUE (buyer_id, food_id, order_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: seller_compliance_documents seller_compliance_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_documents
    ADD CONSTRAINT seller_compliance_documents_pkey PRIMARY KEY (id);


--
-- Name: seller_optional_uploads seller_optional_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_optional_uploads
    ADD CONSTRAINT seller_optional_uploads_pkey PRIMARY KEY (id);


--
-- Name: sms_logs sms_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_pkey PRIMARY KEY (id);


--
-- Name: starter_agent_settings starter_agent_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.starter_agent_settings
    ADD CONSTRAINT starter_agent_settings_pkey PRIMARY KEY (device_id);


--
-- Name: user_addresses user_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_pkey PRIMARY KEY (id);


--
-- Name: user_login_locations user_login_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_locations
    ADD CONSTRAINT user_login_locations_pkey PRIMARY KEY (id);


--
-- Name: user_presence_events user_presence_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_presence_events
    ADD CONSTRAINT user_presence_events_pkey PRIMARY KEY (id);


-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: users users_username_normalized_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_normalized_key UNIQUE (username_normalized);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_admin_api_tokens_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_api_tokens_active ON public.admin_api_tokens USING btree (created_at DESC) WHERE (revoked_at IS NULL);


--
-- Name: idx_admin_api_tokens_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_api_tokens_created_by ON public.admin_api_tokens USING btree (created_by_admin_id, created_at DESC);


--
-- Name: idx_admin_auth_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_auth_sessions_active ON public.admin_auth_sessions USING btree (admin_user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_admin_auth_sessions_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_auth_sessions_exp ON public.admin_auth_sessions USING btree (expires_at);


--
-- Name: idx_admin_auth_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_auth_sessions_user ON public.admin_auth_sessions USING btree (admin_user_id);


--
-- Name: idx_auth_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_active ON public.auth_sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_auth_sessions_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_exp ON public.auth_sessions USING btree (expires_at);


--
-- Name: idx_auth_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_user ON public.auth_sessions USING btree (user_id);


--
-- Name: idx_buyer_notes_buyer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyer_notes_buyer_created ON public.buyer_notes USING btree (buyer_id, created_at DESC);


--
-- Name: idx_buyer_tags_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buyer_tags_buyer ON public.buyer_tags USING btree (buyer_id);


--
-- Name: idx_complaint_categories_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaint_categories_is_active ON public.complaint_categories USING btree (is_active);


--
-- Name: idx_complaints_assigned_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_assigned_admin ON public.complaints USING btree (assigned_admin_id);


--
-- Name: idx_complaints_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_buyer ON public.complaints USING btree (complainant_buyer_id);


--
-- Name: idx_complaints_complainant_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_complainant_actor ON public.complaints USING btree (complainant_type, complainant_user_id);


--
-- Name: idx_complaints_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_category ON public.complaints USING btree (category_id);


--
-- Name: idx_complaints_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_created_at ON public.complaints USING btree (created_at DESC);


--
-- Name: idx_complaints_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_order ON public.complaints USING btree (order_id);


--
-- Name: idx_complaints_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_priority ON public.complaints USING btree (priority);


--
-- Name: idx_complaints_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_status ON public.complaints USING btree (status);


--
-- Name: idx_compliance_documents_list_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_documents_list_active ON public.compliance_documents_list USING btree (is_active);


--
-- Name: idx_foods_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foods_active ON public.foods USING btree (is_active);


--
-- Name: idx_foods_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foods_category ON public.foods USING btree (category_id);


--
-- Name: idx_foods_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foods_seller ON public.foods USING btree (seller_id);


--
-- Name: idx_messages_chat_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_chat_created ON public.messages USING btree (chat_id, created_at DESC);


--
-- Name: idx_orders_buyer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_buyer ON public.orders USING btree (buyer_id);


--
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at);


--
-- Name: idx_orders_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_seller ON public.orders USING btree (seller_id);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_pending ON public.outbox_events USING btree (status, next_attempt_at);


--
-- Name: idx_seller_compliance_documents_list_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_compliance_documents_list_id ON public.seller_compliance_documents USING btree (document_list_id);


--
-- Name: idx_seller_compliance_documents_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_compliance_documents_seller ON public.seller_compliance_documents USING btree (seller_id);


--
-- Name: idx_seller_compliance_documents_seller_document_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_seller_compliance_documents_seller_document_current ON public.seller_compliance_documents USING btree (seller_id, document_list_id) WHERE (is_current = true);


--
-- Name: idx_seller_compliance_documents_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_compliance_documents_status ON public.seller_compliance_documents USING btree (status);


--
-- Name: idx_seller_optional_uploads_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_optional_uploads_created_at ON public.seller_optional_uploads USING btree (created_at DESC);


--
-- Name: idx_seller_optional_uploads_document_list_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_optional_uploads_document_list_id ON public.seller_optional_uploads USING btree (document_list_id);


--
-- Name: idx_seller_optional_uploads_seller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_optional_uploads_seller ON public.seller_optional_uploads USING btree (seller_id);


--
-- Name: idx_seller_optional_uploads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seller_optional_uploads_status ON public.seller_optional_uploads USING btree (status);


--
-- Name: idx_sms_logs_buyer_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_logs_buyer_created ON public.sms_logs USING btree (buyer_id, created_at DESC);


--
-- Name: idx_user_login_locations_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_login_locations_user_created ON public.user_login_locations USING btree (user_id, created_at DESC);


--
-- Name: idx_user_presence_happened; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_presence_happened ON public.user_presence_events USING btree (happened_at DESC);


--
-- Name: idx_user_presence_subject_happened; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_presence_subject_happened ON public.user_presence_events USING btree (subject_type, subject_id, happened_at DESC);


--
-- Name: idx_users_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_country ON public.users USING btree (country_code);


--
-- Name: idx_users_user_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_user_type ON public.users USING btree (user_type);


--
-- Name: starter_agent_settings_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX starter_agent_settings_one_active_idx ON public.starter_agent_settings USING btree (is_active) WHERE (is_active = true);


--
-- Name: uniq_user_default_address; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_user_default_address ON public.user_addresses USING btree (user_id) WHERE (is_default = true);


--
-- Name: production_lots trg_prevent_production_lot_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_production_lot_delete BEFORE DELETE ON public.production_lots FOR EACH ROW EXECUTE FUNCTION public.prevent_production_lot_mutating_delete();


--
-- Name: production_lots trg_prevent_production_lot_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_production_lot_truncate BEFORE TRUNCATE ON public.production_lots FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_production_lot_mutating_delete();


--
-- Name: users trg_seed_seller_compliance_documents_on_users; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_seller_compliance_documents_on_users AFTER INSERT OR UPDATE OF user_type ON public.users FOR EACH ROW EXECUTE FUNCTION public.seed_seller_compliance_documents_on_user_upsert();


--
-- Name: admin_api_tokens admin_api_tokens_created_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_api_tokens
    ADD CONSTRAINT admin_api_tokens_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: admin_audit_logs admin_audit_logs_actor_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_actor_admin_id_fkey FOREIGN KEY (actor_admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: admin_auth_audit admin_auth_audit_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_auth_audit
    ADD CONSTRAINT admin_auth_audit_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: admin_auth_sessions admin_auth_sessions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_auth_sessions
    ADD CONSTRAINT admin_auth_sessions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: admin_table_preferences admin_table_preferences_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_table_preferences
    ADD CONSTRAINT admin_table_preferences_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.admin_users(id) ON DELETE CASCADE;


--
-- Name: allergen_disclosure_records allergen_disclosure_records_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergen_disclosure_records
    ADD CONSTRAINT allergen_disclosure_records_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: allergen_disclosure_records allergen_disclosure_records_food_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergen_disclosure_records
    ADD CONSTRAINT allergen_disclosure_records_food_id_fkey FOREIGN KEY (food_id) REFERENCES public.foods(id) ON DELETE RESTRICT;


--
-- Name: allergen_disclosure_records allergen_disclosure_records_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergen_disclosure_records
    ADD CONSTRAINT allergen_disclosure_records_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: allergen_disclosure_records allergen_disclosure_records_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergen_disclosure_records
    ADD CONSTRAINT allergen_disclosure_records_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: auth_audit auth_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit
    ADD CONSTRAINT auth_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: buyer_notes buyer_notes_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_notes
    ADD CONSTRAINT buyer_notes_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: buyer_notes buyer_notes_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_notes
    ADD CONSTRAINT buyer_notes_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: buyer_tags buyer_tags_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buyer_tags
    ADD CONSTRAINT buyer_tags_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chats chats_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: chats chats_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: chats chats_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chats
    ADD CONSTRAINT chats_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: commission_settings commission_settings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_settings
    ADD CONSTRAINT commission_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: complaints complaints_assigned_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_assigned_admin_id_fkey FOREIGN KEY (assigned_admin_id) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.complaint_categories(id) ON DELETE SET NULL;


--
-- Name: complaints complaints_complainant_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_complainant_buyer_id_fkey FOREIGN KEY (complainant_buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: complaints complaints_complainant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_complainant_user_id_fkey FOREIGN KEY (complainant_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: complaints complaints_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: delivery_proof_records delivery_proof_records_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_proof_records
    ADD CONSTRAINT delivery_proof_records_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: delivery_proof_records delivery_proof_records_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_proof_records
    ADD CONSTRAINT delivery_proof_records_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: delivery_proof_records delivery_proof_records_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_proof_records
    ADD CONSTRAINT delivery_proof_records_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: favorites favorites_food_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_food_id_fkey FOREIGN KEY (food_id) REFERENCES public.foods(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: finance_adjustments finance_adjustments_dispute_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_adjustments
    ADD CONSTRAINT finance_adjustments_dispute_case_id_fkey FOREIGN KEY (dispute_case_id) REFERENCES public.payment_dispute_cases(id) ON DELETE SET NULL;


--
-- Name: finance_adjustments finance_adjustments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_adjustments
    ADD CONSTRAINT finance_adjustments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: finance_adjustments finance_adjustments_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_adjustments
    ADD CONSTRAINT finance_adjustments_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: foods foods_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foods
    ADD CONSTRAINT foods_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;


--
-- Name: foods foods_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foods
    ADD CONSTRAINT foods_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: lot_events lot_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot_events
    ADD CONSTRAINT lot_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: lot_events lot_events_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lot_events
    ADD CONSTRAINT lot_events_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE CASCADE;


--
-- Name: media_assets media_assets_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: messages messages_chat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: notification_events notification_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_events
    ADD CONSTRAINT notification_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: order_events order_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_finance order_finance_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_finance
    ADD CONSTRAINT order_finance_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: order_finance order_finance_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_finance
    ADD CONSTRAINT order_finance_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: order_item_lot_allocations order_item_lot_allocations_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_lot_allocations
    ADD CONSTRAINT order_item_lot_allocations_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE RESTRICT;


--
-- Name: order_item_lot_allocations order_item_lot_allocations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_lot_allocations
    ADD CONSTRAINT order_item_lot_allocations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_item_lot_allocations order_item_lot_allocations_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_lot_allocations
    ADD CONSTRAINT order_item_lot_allocations_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE RESTRICT;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: orders orders_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: outbox_dead_letters outbox_dead_letters_outbox_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_dead_letters
    ADD CONSTRAINT outbox_dead_letters_outbox_event_id_fkey FOREIGN KEY (outbox_event_id) REFERENCES public.outbox_events(id) ON DELETE SET NULL;


--
-- Name: payment_attempts payment_attempts_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: payment_attempts payment_attempts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: payment_dispute_cases payment_dispute_cases_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dispute_cases
    ADD CONSTRAINT payment_dispute_cases_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: payment_dispute_cases payment_dispute_cases_payment_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dispute_cases
    ADD CONSTRAINT payment_dispute_cases_payment_attempt_id_fkey FOREIGN KEY (payment_attempt_id) REFERENCES public.payment_attempts(id) ON DELETE RESTRICT;


--
-- Name: production_lots production_lots_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lots
    ADD CONSTRAINT production_lots_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_food_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_food_id_fkey FOREIGN KEY (food_id) REFERENCES public.foods(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: reviews reviews_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: seller_compliance_documents seller_compliance_documents_document_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_documents
    ADD CONSTRAINT seller_compliance_documents_document_list_id_fkey FOREIGN KEY (document_list_id) REFERENCES public.compliance_documents_list(id) ON DELETE RESTRICT;


--
-- Name: seller_compliance_documents seller_compliance_documents_reviewed_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_documents
    ADD CONSTRAINT seller_compliance_documents_reviewed_by_admin_id_fkey FOREIGN KEY (reviewed_by_admin_id) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: seller_compliance_documents seller_compliance_documents_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_compliance_documents
    ADD CONSTRAINT seller_compliance_documents_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: seller_optional_uploads seller_optional_uploads_document_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_optional_uploads
    ADD CONSTRAINT seller_optional_uploads_document_list_id_fkey FOREIGN KEY (document_list_id) REFERENCES public.compliance_documents_list(id) ON DELETE SET NULL;


--
-- Name: seller_optional_uploads seller_optional_uploads_reviewed_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_optional_uploads
    ADD CONSTRAINT seller_optional_uploads_reviewed_by_admin_id_fkey FOREIGN KEY (reviewed_by_admin_id) REFERENCES public.admin_users(id) ON DELETE SET NULL;


--
-- Name: seller_optional_uploads seller_optional_uploads_seller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seller_optional_uploads
    ADD CONSTRAINT seller_optional_uploads_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sms_logs sms_logs_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;


--
-- Name: sms_logs sms_logs_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_logs
    ADD CONSTRAINT sms_logs_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: user_addresses user_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_login_locations user_login_locations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_locations
    ADD CONSTRAINT user_login_locations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.auth_sessions(id) ON DELETE SET NULL;


--
-- Name: user_login_locations user_login_locations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_login_locations
    ADD CONSTRAINT user_login_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.ensure_user_default_address_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.user_addresses
       SET is_default = FALSE,
           updated_at = now()
     WHERE user_id = NEW.user_id
       AND id IS DISTINCT FROM NEW.id
       AND is_default = TRUE;
  ELSE
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1
          FROM public.user_addresses
         WHERE user_id = NEW.user_id
           AND is_default = TRUE
      ) THEN
        NEW.is_default := TRUE;
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
          FROM public.user_addresses
         WHERE user_id = NEW.user_id
           AND is_default = TRUE
           AND id <> NEW.id
      ) THEN
        NEW.is_default := TRUE;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_user_has_default_address(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_addresses WHERE user_id = p_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.user_addresses WHERE user_id = p_user_id AND is_default = TRUE) THEN
    UPDATE public.user_addresses
       SET is_default = TRUE,
           updated_at = now()
     WHERE id = (
       SELECT id
         FROM public.user_addresses
        WHERE user_id = p_user_id
        ORDER BY created_at ASC, id ASC
        LIMIT 1
     );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_user_default_address_after_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.ensure_user_has_default_address(OLD.user_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.ensure_user_has_default_address(OLD.user_id);
      PERFORM public.ensure_user_has_default_address(NEW.user_id);
    ELSIF OLD.is_default = TRUE AND NEW.is_default = FALSE THEN
      PERFORM public.ensure_user_has_default_address(NEW.user_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_addresses_default_before_write ON public.user_addresses;
CREATE TRIGGER trg_user_addresses_default_before_write
BEFORE INSERT OR UPDATE OF user_id, is_default ON public.user_addresses
FOR EACH ROW
EXECUTE FUNCTION public.ensure_user_default_address_before_write();

DROP TRIGGER IF EXISTS trg_user_addresses_default_after_write ON public.user_addresses;
CREATE TRIGGER trg_user_addresses_default_after_write
AFTER UPDATE OF user_id, is_default OR DELETE ON public.user_addresses
FOR EACH ROW
EXECUTE FUNCTION public.ensure_user_default_address_after_write();

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn,
    bool_or(is_default) OVER (PARTITION BY user_id) AS has_default
  FROM public.user_addresses
)
UPDATE public.user_addresses ua
   SET is_default = TRUE,
       updated_at = now()
  FROM ranked r
 WHERE ua.id = r.id
   AND r.rn = 1
   AND r.has_default = FALSE;


--
-- PostgreSQL database dump complete
--

\unrestrict 1qxUnALlESTKbYz6AdxVhwtuYSIKdaC0AbjzNRmEtWf0xxFm3tMK4dsSMblD1HT
