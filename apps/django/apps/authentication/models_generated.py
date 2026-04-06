# This is an auto-generated Django model module.
# You'll have to do the following manually to clean this up:
#   * Rearrange models' order
#   * Make sure each model has one field with primary_key=True
#   * Make sure each ForeignKey and OneToOneField has `on_delete` set to the desired behavior
#   * Remove `managed = False` lines if you wish to allow Django to create, modify, and delete the table
# Feel free to rename the models, but don't rename db_table values or field names.
from django.db import models


class AbuseRiskEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    subject_type = models.TextField()
    subject_id = models.TextField()
    flow = models.TextField()
    risk_score = models.DecimalField(max_digits=5, decimal_places=2)
    decision = models.TextField()
    reason_codes_json = models.JSONField(blank=True, null=True)
    request_fingerprint = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'abuse_risk_events'


class AdminApiTokens(models.Model):
    id = models.UUIDField(primary_key=True)
    session_id = models.TextField(unique=True)
    label = models.TextField()
    role = models.TextField()
    token_hash = models.TextField()
    token_preview = models.TextField()
    claims_json = models.JSONField(blank=True, null=True)
    created_by_admin = models.ForeignKey('AdminUsers', models.DO_NOTHING)
    revoked_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_api_tokens'


class AdminAuditLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    actor_admin = models.ForeignKey('AdminUsers', models.DO_NOTHING)
    actor_email = models.TextField()
    actor_role = models.TextField()
    action = models.TextField()
    entity_type = models.TextField()
    entity_id = models.TextField(blank=True, null=True)
    before_json = models.JSONField(blank=True, null=True)
    after_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_audit_logs'


class AdminAuthAudit(models.Model):
    id = models.UUIDField(primary_key=True)
    admin_user = models.ForeignKey('AdminUsers', models.DO_NOTHING, blank=True, null=True)
    event_type = models.TextField()
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_auth_audit'


class AdminAuthSessions(models.Model):
    id = models.UUIDField(primary_key=True)
    admin_user = models.ForeignKey('AdminUsers', models.DO_NOTHING)
    refresh_token_hash = models.TextField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(blank=True, null=True)
    device_info = models.TextField(blank=True, null=True)
    ip = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    last_used_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'admin_auth_sessions'


class AdminSalesCommissionSettings(models.Model):
    id = models.UUIDField(primary_key=True)
    commission_rate_percent = models.DecimalField(max_digits=5, decimal_places=2)
    created_by_admin = models.ForeignKey('AdminUsers', models.DO_NOTHING)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_sales_commission_settings'


class AdminTablePreferences(models.Model):
    id = models.UUIDField(primary_key=True)
    admin_user = models.ForeignKey('AdminUsers', models.DO_NOTHING)
    table_key = models.TextField()
    visible_columns = models.JSONField()
    column_order = models.JSONField(blank=True, null=True)
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_table_preferences'
        unique_together = (('admin_user', 'table_key'),)


class AdminUsers(models.Model):
    id = models.UUIDField(primary_key=True)
    email = models.TextField(unique=True)
    password_hash = models.TextField()
    role = models.TextField()
    is_active = models.BooleanField()
    last_login_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_users'


class AgentCallLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    room_name = models.TextField()
    profile = models.ForeignKey('AgentProfiles', models.DO_NOTHING, blank=True, null=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()
    duration_seconds = models.IntegerField()
    outcome = models.TextField()
    summary = models.TextField(blank=True, null=True)
    device_id = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'agent_call_logs'


class AgentProfiles(models.Model):
    id = models.UUIDField(primary_key=True)
    name = models.TextField()
    is_active = models.BooleanField(unique=True)
    speaks_first = models.BooleanField()
    system_prompt = models.TextField(blank=True, null=True)
    greeting_enabled = models.BooleanField()
    greeting_instruction = models.TextField(blank=True, null=True)
    voice_language = models.TextField()
    llm_config = models.JSONField()
    stt_config = models.JSONField()
    tts_config = models.JSONField()
    n8n_config = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'agent_profiles'


class AllergenDisclosureRecords(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    buyer = models.ForeignKey('Users', models.DO_NOTHING, related_name='allergendisclosurerecords_buyer_set')
    food = models.ForeignKey('Foods', models.DO_NOTHING)
    phase = models.TextField()
    allergen_snapshot_json = models.JSONField()
    disclosure_method = models.TextField()
    buyer_confirmation = models.TextField()
    evidence_ref = models.TextField(blank=True, null=True)
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'allergen_disclosure_records'
        unique_together = (('order', 'phase'),)


class AuthAudit(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('Users', models.DO_NOTHING, blank=True, null=True)
    event_type = models.TextField()
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'auth_audit'


class AuthSessions(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('Users', models.DO_NOTHING)
    refresh_token_hash = models.TextField()
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(blank=True, null=True)
    device_info = models.TextField(blank=True, null=True)
    ip = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    last_used_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'auth_sessions'


class BuyerNotes(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    admin = models.ForeignKey(AdminUsers, models.DO_NOTHING)
    note = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'buyer_notes'


class BuyerTags(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    tag = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'buyer_tags'
        unique_together = (('buyer', 'tag'),)


class Categories(models.Model):
    id = models.UUIDField(primary_key=True)
    name_tr = models.TextField()
    name_en = models.TextField()
    sort_order = models.IntegerField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'categories'


class Chats(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING, related_name='chats_seller_set')
    order = models.ForeignKey('Orders', models.DO_NOTHING, blank=True, null=True)
    last_message = models.TextField(blank=True, null=True)
    last_message_time = models.DateTimeField(blank=True, null=True)
    last_message_sender = models.TextField(blank=True, null=True)
    buyer_unread_count = models.IntegerField()
    seller_unread_count = models.IntegerField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'chats'


class CommissionSettings(models.Model):
    id = models.UUIDField(primary_key=True)
    commission_rate = models.DecimalField(max_digits=5, decimal_places=4)
    is_active = models.BooleanField()
    effective_from = models.DateTimeField()
    created_by = models.ForeignKey(AdminUsers, models.DO_NOTHING, db_column='created_by', blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'commission_settings'


class ComplaintAdminNotes(models.Model):
    id = models.UUIDField(primary_key=True)
    complaint = models.ForeignKey('Complaints', models.DO_NOTHING)
    note = models.TextField()
    created_by_admin = models.ForeignKey(AdminUsers, models.DO_NOTHING)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'complaint_admin_notes'


class ComplaintCategories(models.Model):
    id = models.UUIDField(primary_key=True)
    code = models.TextField(unique=True)
    name = models.TextField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'complaint_categories'


class Complaints(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    complainant_buyer = models.ForeignKey('Users', models.DO_NOTHING, blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField()
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey(ComplaintCategories, models.DO_NOTHING, blank=True, null=True)
    priority = models.TextField()
    resolved_at = models.DateTimeField(blank=True, null=True)
    resolution_note = models.TextField(blank=True, null=True)
    assigned_admin = models.ForeignKey(AdminUsers, models.DO_NOTHING, blank=True, null=True)
    complainant_type = models.TextField()
    complainant_user = models.ForeignKey('Users', models.DO_NOTHING, related_name='complaints_complainant_user_set')
    ticket_no = models.AutoField()

    class Meta:
        managed = False
        db_table = 'complaints'


class ComplianceDocumentsList(models.Model):
    id = models.UUIDField(primary_key=True)
    code = models.TextField(unique=True)
    name = models.TextField()
    description = models.TextField(blank=True, null=True)
    source_info = models.TextField(blank=True, null=True)
    details = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    is_required_default = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    validity_years = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'compliance_documents_list'


class DeliveryProofRecords(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.OneToOneField('Orders', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    buyer = models.ForeignKey('Users', models.DO_NOTHING, related_name='deliveryproofrecords_buyer_set')
    proof_mode = models.TextField()
    pin_hash = models.TextField()
    pin_sent_at = models.DateTimeField(blank=True, null=True)
    pin_sent_channel = models.TextField()
    pin_verified_at = models.DateTimeField(blank=True, null=True)
    verification_attempts = models.IntegerField()
    status = models.TextField()
    metadata_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'delivery_proof_records'


class Favorites(models.Model):
    user = models.OneToOneField('Users', models.DO_NOTHING, primary_key=True)  # The composite primary key (user_id, food_id) found, that is not supported. The first column is selected.
    food = models.ForeignKey('Foods', models.DO_NOTHING)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'favorites'
        unique_together = (('user', 'food'),)


class FinanceAdjustments(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    dispute_case = models.ForeignKey('PaymentDisputeCases', models.DO_NOTHING, blank=True, null=True)
    type = models.TextField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'finance_adjustments'


class FinanceReconciliationReports(models.Model):
    id = models.UUIDField(primary_key=True)
    actor_type = models.TextField()
    actor_id = models.UUIDField()
    report_type = models.TextField()
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.TextField()
    file_url = models.TextField(blank=True, null=True)
    checksum = models.TextField(blank=True, null=True)
    generated_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'finance_reconciliation_reports'


class Foods(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    category = models.ForeignKey(Categories, models.DO_NOTHING, blank=True, null=True)
    name = models.TextField()
    card_summary = models.TextField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    recipe = models.TextField(blank=True, null=True)
    country_code = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    image_url = models.TextField(blank=True, null=True)
    ingredients_json = models.JSONField(blank=True, null=True)
    allergens_json = models.JSONField(blank=True, null=True)
    preparation_time_minutes = models.IntegerField(blank=True, null=True)
    serving_size = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    rating = models.DecimalField(max_digits=3, decimal_places=2)
    review_count = models.IntegerField()
    favorite_count = models.IntegerField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    cuisine = models.TextField(blank=True, null=True)
    image_urls_json = models.JSONField(blank=True, null=True)
    menu_items_json = models.JSONField(blank=True, null=True)
    secondary_category_ids_json = models.JSONField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'foods'


class IdempotencyKeys(models.Model):
    id = models.UUIDField(primary_key=True)
    scope = models.TextField()
    key_hash = models.TextField()
    request_hash = models.TextField()
    response_status = models.IntegerField(blank=True, null=True)
    response_body_json = models.JSONField(blank=True, null=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'idempotency_keys'
        unique_together = (('scope', 'key_hash'),)


class LongTermMemory(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.OneToOneField('Users', models.DO_NOTHING)
    dietary_preferences = models.JSONField()
    personal_details = models.JSONField()
    order_history_summary = models.JSONField()
    conversation_style = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'long_term_memory'


class LotEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    lot = models.ForeignKey('ProductionLots', models.DO_NOTHING)
    event_type = models.TextField()
    event_payload_json = models.JSONField(blank=True, null=True)
    created_by = models.ForeignKey('Users', models.DO_NOTHING, db_column='created_by', blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'lot_events'


class MediaAssets(models.Model):
    id = models.UUIDField(primary_key=True)
    owner_user = models.ForeignKey('Users', models.DO_NOTHING)
    provider = models.TextField()
    object_key = models.TextField()
    public_url = models.TextField(blank=True, null=True)
    content_type = models.TextField(blank=True, null=True)
    size_bytes = models.BigIntegerField(blank=True, null=True)
    checksum = models.TextField(blank=True, null=True)
    related_entity_type = models.TextField(blank=True, null=True)
    related_entity_id = models.UUIDField(blank=True, null=True)
    status = models.TextField()
    metadata_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'media_assets'


class Messages(models.Model):
    id = models.UUIDField(primary_key=True)
    chat = models.ForeignKey(Chats, models.DO_NOTHING)
    sender = models.ForeignKey('Users', models.DO_NOTHING)
    sender_type = models.TextField()
    message = models.TextField(blank=True, null=True)
    message_type = models.TextField()
    order_data_json = models.JSONField(blank=True, null=True)
    is_read = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'messages'


class NotificationEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('Users', models.DO_NOTHING)
    type = models.TextField()
    title = models.TextField()
    body = models.TextField()
    data_json = models.JSONField(blank=True, null=True)
    is_read = models.BooleanField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'notification_events'


class OrderDeliveryTracking(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    seller_user = models.ForeignKey('Users', models.DO_NOTHING)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy_m = models.IntegerField(blank=True, null=True)
    captured_at = models.DateTimeField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_delivery_tracking'


class OrderEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    actor_user = models.ForeignKey('Users', models.DO_NOTHING, blank=True, null=True)
    event_type = models.TextField()
    from_status = models.TextField(blank=True, null=True)
    to_status = models.TextField(blank=True, null=True)
    payload_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_events'


class OrderFinance(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.OneToOneField('Orders', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    gross_amount = models.DecimalField(max_digits=12, decimal_places=2)
    commission_rate_snapshot = models.DecimalField(max_digits=5, decimal_places=4)
    commission_amount = models.DecimalField(max_digits=12, decimal_places=2)
    seller_net_amount = models.DecimalField(max_digits=12, decimal_places=2)
    finalized_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_finance'


class OrderItemLotAllocations(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    order_item = models.ForeignKey('OrderItems', models.DO_NOTHING)
    lot = models.ForeignKey('ProductionLots', models.DO_NOTHING)
    quantity_allocated = models.IntegerField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_item_lot_allocations'


class OrderItems(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    lot = models.ForeignKey('ProductionLots', models.DO_NOTHING, blank=True, null=True)
    food_id = models.UUIDField()
    quantity = models.IntegerField()
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField()
    selected_addons_json = models.JSONField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'order_items'
        unique_together = (('order', 'lot'),)


class OrderNotificationMilestones(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('Orders', models.DO_NOTHING)
    milestone_type = models.TextField()
    sent_at = models.DateTimeField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_notification_milestones'
        unique_together = (('order', 'milestone_type'),)


class Orders(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING, related_name='orders_seller_set')
    status = models.TextField()
    delivery_type = models.TextField()
    delivery_address_json = models.JSONField(blank=True, null=True)
    total_price = models.DecimalField(max_digits=12, decimal_places=2)
    requested_at = models.DateTimeField(blank=True, null=True)
    estimated_delivery_time = models.DateTimeField(blank=True, null=True)
    payment_completed = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    requested_delivery_type = models.TextField()
    active_delivery_type = models.TextField()
    seller_decision_state = models.TextField()
    seller_eta_minutes = models.IntegerField(blank=True, null=True)
    seller_promised_at = models.DateTimeField(blank=True, null=True)
    seller_delivery_note = models.TextField(blank=True, null=True)
    seller_delivery_terms_snapshot = models.TextField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    payment_captured_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'orders'


class OutboxDeadLetters(models.Model):
    id = models.UUIDField(primary_key=True)
    outbox_event = models.ForeignKey('OutboxEvents', models.DO_NOTHING, blank=True, null=True)
    event_type = models.TextField()
    aggregate_type = models.TextField()
    aggregate_id = models.TextField()
    payload_json = models.JSONField()
    last_error = models.TextField(blank=True, null=True)
    failed_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'outbox_dead_letters'


class OutboxEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    event_type = models.TextField()
    aggregate_type = models.TextField()
    aggregate_id = models.TextField()
    payload_json = models.JSONField()
    status = models.TextField()
    attempt_count = models.IntegerField()
    next_attempt_at = models.DateTimeField()
    last_error = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    processed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'outbox_events'


class PaymentAttempts(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey(Orders, models.DO_NOTHING)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    provider = models.TextField()
    provider_session_id = models.TextField(unique=True, blank=True, null=True)
    provider_reference_id = models.TextField(unique=True, blank=True, null=True)
    status = models.TextField()
    callback_payload_json = models.JSONField(blank=True, null=True)
    signature_valid = models.BooleanField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'payment_attempts'


class PaymentDisputeCases(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey(Orders, models.DO_NOTHING)
    payment_attempt = models.ForeignKey(PaymentAttempts, models.DO_NOTHING)
    provider_case_id = models.TextField(unique=True, blank=True, null=True)
    case_type = models.TextField()
    reason_code = models.TextField(blank=True, null=True)
    liability_party = models.TextField()
    liability_ratio_json = models.JSONField(blank=True, null=True)
    status = models.TextField()
    evidence_bundle_json = models.JSONField(blank=True, null=True)
    opened_at = models.DateTimeField()
    resolved_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'payment_dispute_cases'


class ProductionLots(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    food_id = models.UUIDField()
    lot_number = models.TextField(unique=True)
    produced_at = models.DateTimeField()
    use_by = models.DateTimeField(blank=True, null=True)
    best_before = models.DateTimeField(blank=True, null=True)
    quantity_produced = models.IntegerField()
    quantity_available = models.IntegerField()
    status = models.TextField()
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    sale_starts_at = models.DateTimeField()
    sale_ends_at = models.DateTimeField()
    recipe_snapshot = models.TextField(blank=True, null=True)
    ingredients_snapshot_json = models.JSONField(blank=True, null=True)
    allergens_snapshot_json = models.JSONField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'production_lots'


class Reviews(models.Model):
    id = models.UUIDField(primary_key=True)
    food = models.ForeignKey(Foods, models.DO_NOTHING)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    seller = models.ForeignKey('Users', models.DO_NOTHING, related_name='reviews_seller_set')
    order = models.ForeignKey(Orders, models.DO_NOTHING)
    rating = models.IntegerField()
    comment = models.TextField(blank=True, null=True)
    images_json = models.JSONField(blank=True, null=True)
    helpful_count = models.IntegerField()
    report_count = models.IntegerField()
    is_verified_purchase = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'reviews'
        unique_together = (('buyer', 'food', 'order'),)


class SchemaMigrations(models.Model):
    filename = models.TextField(primary_key=True)
    applied_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'schema_migrations'


class SecurityLoginEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    realm = models.TextField()
    actor_user_id = models.UUIDField(blank=True, null=True)
    identifier = models.TextField()
    success = models.BooleanField()
    failure_reason = models.TextField(blank=True, null=True)
    device_id = models.TextField(blank=True, null=True)
    device_name = models.TextField(blank=True, null=True)
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'security_login_events'


class SecurityLoginState(models.Model):
    realm = models.TextField(primary_key=True)  # The composite primary key (realm, identifier) found, that is not supported. The first column is selected.
    identifier = models.TextField()
    consecutive_failed_count = models.IntegerField()
    last_failed_at = models.DateTimeField(blank=True, null=True)
    last_success_at = models.DateTimeField(blank=True, null=True)
    last_device_id = models.TextField(blank=True, null=True)
    last_device_name = models.TextField(blank=True, null=True)
    last_ip = models.TextField(blank=True, null=True)
    soft_locked = models.BooleanField()
    soft_locked_at = models.DateTimeField(blank=True, null=True)
    unlock_token = models.TextField(blank=True, null=True)
    unlock_token_expires_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'security_login_state'
        unique_together = (('realm', 'identifier'),)


class SellerComplianceDocuments(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    document_list = models.ForeignKey(ComplianceDocumentsList, models.DO_NOTHING)
    is_required = models.BooleanField()
    status = models.TextField()
    file_url = models.TextField(blank=True, null=True)
    uploaded_at = models.DateTimeField(blank=True, null=True)
    reviewed_at = models.DateTimeField(blank=True, null=True)
    reviewed_by_admin = models.ForeignKey(AdminUsers, models.DO_NOTHING, blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    version = models.IntegerField()
    is_current = models.BooleanField()
    expires_at = models.DateTimeField(blank=True, null=True)
    expired = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'seller_compliance_documents'
        unique_together = (('seller', 'document_list'), ('seller', 'document_list'),)


class SellerNotes(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    admin = models.ForeignKey(AdminUsers, models.DO_NOTHING)
    note = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'seller_notes'


class SellerOptionalUploads(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    document_list = models.ForeignKey(ComplianceDocumentsList, models.DO_NOTHING, blank=True, null=True)
    custom_title = models.TextField(blank=True, null=True)
    custom_description = models.TextField(blank=True, null=True)
    file_url = models.TextField()
    status = models.TextField()
    reviewed_at = models.DateTimeField(blank=True, null=True)
    reviewed_by_admin = models.ForeignKey(AdminUsers, models.DO_NOTHING, blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    expires_at = models.DateTimeField(blank=True, null=True)
    expired = models.BooleanField()

    class Meta:
        managed = False
        db_table = 'seller_optional_uploads'


class SellerTags(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('Users', models.DO_NOTHING)
    tag = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'seller_tags'
        unique_together = (('seller', 'tag'),)


class SessionMemory(models.Model):
    id = models.UUIDField(primary_key=True)
    room_id = models.TextField(unique=True)
    user = models.ForeignKey('Users', models.DO_NOTHING, blank=True, null=True)
    data = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'session_memory'


class SmsLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('Users', models.DO_NOTHING)
    admin = models.ForeignKey(AdminUsers, models.DO_NOTHING)
    message = models.TextField()
    status = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'sms_logs'


class StarterAgentSettings(models.Model):
    device_id = models.TextField(primary_key=True)
    agent_name = models.TextField()
    voice_language = models.TextField()
    tts_enabled = models.BooleanField()
    stt_enabled = models.BooleanField()
    system_prompt = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    greeting_enabled = models.BooleanField()
    greeting_instruction = models.TextField(blank=True, null=True)
    tts_engine = models.TextField()
    tts_config_json = models.JSONField(blank=True, null=True)
    ollama_model = models.TextField()
    tts_servers_json = models.JSONField(blank=True, null=True)
    active_tts_server_id = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(unique=True)

    class Meta:
        managed = False
        db_table = 'starter_agent_settings'


class UserAddresses(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.OneToOneField('Users', models.DO_NOTHING)
    title = models.TextField()
    address_line = models.TextField()
    is_default = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_addresses'


class UserDeviceTokens(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('Users', models.DO_NOTHING)
    token = models.TextField(unique=True)
    platform = models.TextField()
    app_version = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    last_seen_at = models.DateTimeField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_device_tokens'


class UserLoginLocations(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('Users', models.DO_NOTHING)
    session = models.ForeignKey(AuthSessions, models.DO_NOTHING, blank=True, null=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy_m = models.IntegerField(blank=True, null=True)
    source = models.TextField()
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_login_locations'


class UserPresenceEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    subject_type = models.TextField()
    subject_id = models.UUIDField()
    session_id = models.UUIDField(blank=True, null=True)
    event_type = models.TextField()
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    happened_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_presence_events'


class Users(models.Model):
    id = models.UUIDField(primary_key=True)
    email = models.TextField(unique=True)
    password_hash = models.TextField()
    display_name = models.TextField()
    display_name_normalized = models.TextField()
    full_name = models.TextField(blank=True, null=True)
    user_type = models.TextField()
    is_active = models.BooleanField()
    country_code = models.TextField(blank=True, null=True)
    language = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    latitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True)
    profile_image_url = models.TextField(blank=True, null=True)
    phone = models.TextField(blank=True, null=True)
    dob = models.DateField(blank=True, null=True)
    legal_hold_state = models.BooleanField()
    kitchen_title = models.TextField(blank=True, null=True)
    kitchen_description = models.TextField(blank=True, null=True)
    delivery_radius_km = models.DecimalField(max_digits=8, decimal_places=2, blank=True, null=True)
    working_hours_json = models.JSONField(blank=True, null=True)
    seller_profile_status = models.TextField()
    kitchen_specialties = models.JSONField(blank=True, null=True)
    username = models.TextField(unique=True)
    username_normalized = models.TextField(unique=True)
    national_id = models.TextField(blank=True, null=True)
    delivery_enabled = models.BooleanField()
    delivery_terms = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'users'
