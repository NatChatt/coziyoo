# Auto-generated from inspectdb — managed=False, do not run migrations against these.
from django.db import models
from django.utils.translation import gettext_lazy as _

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
    created_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    revoked_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_api_tokens'
        verbose_name = "Admin API Token"
        verbose_name_plural = "Admin API Tokens"



class AdminAuditLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    actor_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
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
        verbose_name = "Admin Audit Log"
        verbose_name_plural = "Admin Audit Logs"



class AdminAuthAudit(models.Model):
    id = models.UUIDField(primary_key=True)
    admin_user = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, blank=True, null=True)
    event_type = models.TextField()
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_auth_audit'



class AdminAuthSessions(models.Model):
    id = models.UUIDField(primary_key=True)
    admin_user = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
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
    created_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_sales_commission_settings'
        verbose_name = "Sales Commission Setting"
        verbose_name_plural = "Admin Sales Commission Settings"



class AdminTablePreferences(models.Model):
    id = models.UUIDField(primary_key=True)
    admin_user = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
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
        verbose_name = "Admin User"
        verbose_name_plural = "Admin Users"



class AuthAudit(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    event_type = models.TextField()
    ip = models.TextField(blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'auth_audit'



class AuthSessions(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
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
        verbose_name = "Security Login Event"
        verbose_name_plural = "Security Login Events"



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



class SchemaMigrations(models.Model):
    filename = models.TextField(primary_key=True)
    applied_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'schema_migrations'



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



class UserLoginLocations(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    session = models.ForeignKey('authentication.AuthSessions', models.DO_NOTHING, blank=True, null=True)
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
    is_active = models.BooleanField(verbose_name=_("Active"))
    country_code = models.TextField(blank=True, null=True)
    language = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(verbose_name=_("Created At"))
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
        verbose_name = "User"
        verbose_name_plural = "Users"


class BuyerUsers(Users):
    """Proxy model for the buyer-only admin view."""
    class Meta:
        proxy = True
        verbose_name = "Buyer"
        verbose_name_plural = "Buyers"


class SellerUsers(Users):
    """Proxy model for the seller-only admin view."""
    class Meta:
        proxy = True
        verbose_name = "Seller"
        verbose_name_plural = "Sellers"


class AllUsers(Users):
    """Proxy model for viewing all users including inactive ones."""
    class Meta:
        proxy = True
        verbose_name = "All Users"
        verbose_name_plural = "All Users"


class SmsLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    message = models.TextField()
    status = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'sms_logs'



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



class MediaAssets(models.Model):
    id = models.UUIDField(primary_key=True)
    owner_user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
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



class BuyerNotes(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    note = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'buyer_notes'



class BuyerTags(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    tag = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'buyer_tags'
        unique_together = (('buyer', 'tag'),)



class SellerNotes(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    note = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'seller_notes'



class SellerTags(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    tag = models.TextField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'seller_tags'
        unique_together = (('seller', 'tag'),)


