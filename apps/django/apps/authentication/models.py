# Auto-generated from inspectdb — managed=False, do not run migrations against these.
from django.db import models
from django.utils.translation import gettext_lazy as _

class AbuseRiskEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    subject_type = models.CharField(max_length=50)
    subject_id = models.CharField(max_length=255)
    flow = models.CharField(max_length=50)
    risk_score = models.DecimalField(max_digits=5, decimal_places=2)
    decision = models.CharField(max_length=30)
    reason_codes_json = models.JSONField(blank=True, null=True)
    request_fingerprint = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'abuse_risk_events'



class AdminApiTokens(models.Model):
    id = models.UUIDField(primary_key=True)
    session_id = models.CharField(max_length=255, unique=True)
    label = models.CharField(max_length=255)
    role = models.CharField(max_length=50)
    token_hash = models.CharField(max_length=255)
    token_preview = models.CharField(max_length=50)
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
    actor_email = models.CharField(max_length=255)
    actor_role = models.CharField(max_length=50)
    action = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=255, blank=True, null=True)
    before_json = models.JSONField(blank=True, null=True)
    after_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_audit_logs'
        verbose_name = "Admin Audit Log"
        verbose_name_plural = "Admin Audit Logs"



class AdminSalesCommissionSettings(models.Model):
    id = models.UUIDField(primary_key=True)
    commission_rate_percent = models.DecimalField(max_digits=5, decimal_places=2)
    mobile_home_header_image_url = models.TextField(blank=True, null=True, verbose_name="Home Hero")
    created_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_sales_commission_settings'
        verbose_name = "Sales Commission Setting"
        verbose_name_plural = "Admin Sales Commission Settings"



class AdminUsers(models.Model):
    id = models.UUIDField(primary_key=True)
    email = models.CharField(max_length=255, unique=True)
    password_hash = models.CharField(max_length=255)
    role = models.CharField(max_length=50)
    is_active = models.BooleanField()
    username = models.CharField(max_length=100, blank=True, null=True)
    name = models.CharField(max_length=100, blank=True, null=True)
    surname = models.CharField(max_length=100, blank=True, null=True)
    last_login_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'admin_users'
        verbose_name = "Admin User"
        verbose_name_plural = "Admin Users"

    def __str__(self):
        if self.name and self.surname:
            return f"{self.name} {self.surname}"
        return self.email


class RolePermissions(models.Model):
    id = models.UUIDField(primary_key=True)
    role = models.CharField(max_length=50)
    permission_key = models.CharField(max_length=100)
    is_allowed = models.BooleanField(default=False)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'role_permissions'
        unique_together = [('role', 'permission_key')]

    def __str__(self):
        return f"{self.role}:{self.permission_key} = {self.is_allowed}"


class AuthAudit(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    event_type = models.CharField(max_length=50)
    ip = models.CharField(max_length=45, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'auth_audit'



class AuthSessions(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    refresh_token_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(blank=True, null=True)
    device_info = models.CharField(max_length=255, blank=True, null=True)
    ip = models.CharField(max_length=45, blank=True, null=True)
    created_at = models.DateTimeField()
    last_used_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'auth_sessions'



class SecurityLoginEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    realm = models.CharField(max_length=20)
    actor_user_id = models.UUIDField(blank=True, null=True)
    identifier = models.CharField(max_length=255)
    success = models.BooleanField()
    failure_reason = models.CharField(max_length=100, blank=True, null=True)
    device_id = models.CharField(max_length=255, blank=True, null=True)
    device_name = models.CharField(max_length=255, blank=True, null=True)
    ip = models.CharField(max_length=45, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'security_login_events'
        verbose_name = "Security Login Event"
        verbose_name_plural = "Security Login Events"



class SecurityLoginState(models.Model):
    realm = models.CharField(max_length=20, primary_key=True)  # The composite primary key (realm, identifier) found, that is not supported. The first column is selected.
    identifier = models.CharField(max_length=255)
    consecutive_failed_count = models.IntegerField()
    last_failed_at = models.DateTimeField(blank=True, null=True)
    last_success_at = models.DateTimeField(blank=True, null=True)
    last_device_id = models.CharField(max_length=255, blank=True, null=True)
    last_device_name = models.CharField(max_length=255, blank=True, null=True)
    last_ip = models.CharField(max_length=45, blank=True, null=True)
    soft_locked = models.BooleanField()
    soft_locked_at = models.DateTimeField(blank=True, null=True)
    unlock_token = models.CharField(max_length=255, blank=True, null=True)
    unlock_token_expires_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'security_login_state'
        unique_together = (('realm', 'identifier'),)



class SchemaMigrations(models.Model):
    filename = models.CharField(max_length=255, primary_key=True)
    applied_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'schema_migrations'



class UserAddresses(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.OneToOneField('Users', models.DO_NOTHING)
    title = models.CharField(max_length=100)
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
    source = models.CharField(max_length=30)
    ip = models.CharField(max_length=45, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_login_locations'



class UserPresenceEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    subject_type = models.CharField(max_length=50)
    subject_id = models.UUIDField()
    session_id = models.UUIDField(blank=True, null=True)
    event_type = models.CharField(max_length=50)
    ip = models.CharField(max_length=45, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    happened_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'user_presence_events'



class Users(models.Model):
    id = models.UUIDField(primary_key=True)
    email = models.CharField(max_length=255, unique=True)
    password_hash = models.CharField(max_length=255)
    display_name = models.CharField(max_length=255)
    display_name_normalized = models.CharField(max_length=255)
    full_name = models.CharField(max_length=255, blank=True, null=True)
    user_type = models.CharField(max_length=20)
    is_active = models.BooleanField(verbose_name=_("Active"))
    country_code = models.CharField(max_length=10, blank=True, null=True)
    language = models.CharField(max_length=10, blank=True, null=True)
    created_at = models.DateTimeField(verbose_name=_("Created At"))
    updated_at = models.DateTimeField()
    latitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True)
    profile_image_url = models.URLField(max_length=2048, blank=True, null=True)
    phone = models.CharField(max_length=20, blank=True, null=True)
    dob = models.DateField(blank=True, null=True)
    legal_hold_state = models.BooleanField()
    kitchen_title = models.CharField(max_length=255, blank=True, null=True)
    kitchen_description = models.TextField(blank=True, null=True)
    delivery_radius_km = models.DecimalField(max_digits=8, decimal_places=2, blank=True, null=True)
    working_hours_json = models.JSONField(blank=True, null=True)
    seller_profile_status = models.CharField(max_length=30)
    kitchen_specialties = models.JSONField(blank=True, null=True)
    username = models.CharField(max_length=100, unique=True)
    username_normalized = models.CharField(max_length=100, unique=True)
    national_id = models.CharField(max_length=50, blank=True, null=True)
    delivery_enabled = models.BooleanField()
    delivery_terms = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.display_name or self.full_name or self.username or str(self.id)

    class Meta:
        managed = False
        db_table = 'users'
        verbose_name = _("User")
        verbose_name_plural = _("Users")


class BuyerUsers(Users):
    """Proxy model for the buyer-only admin view."""
    class Meta:
        proxy = True
        verbose_name = _("Buyer")
        verbose_name_plural = _("Buyers")


class SellerUsers(Users):
    """Proxy model for the seller-only admin view."""
    class Meta:
        proxy = True
        verbose_name = _("Seller")
        verbose_name_plural = _("Sellers")


class AllUsers(Users):
    """Proxy model for viewing all users including inactive ones."""
    class Meta:
        proxy = True
        verbose_name = _("All Users")
        verbose_name_plural = _("All Users")


class SmsLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    message = models.TextField()
    status = models.CharField(max_length=30)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'sms_logs'



class IdempotencyKeys(models.Model):
    id = models.UUIDField(primary_key=True)
    scope = models.CharField(max_length=50)
    key_hash = models.CharField(max_length=255)
    request_hash = models.CharField(max_length=255)
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
    provider = models.CharField(max_length=50)
    object_key = models.CharField(max_length=500)
    public_url = models.URLField(max_length=2048, blank=True, null=True)
    content_type = models.CharField(max_length=100, blank=True, null=True)
    size_bytes = models.BigIntegerField(blank=True, null=True)
    checksum = models.CharField(max_length=255, blank=True, null=True)
    related_entity_type = models.CharField(max_length=50, blank=True, null=True)
    related_entity_id = models.UUIDField(blank=True, null=True)
    status = models.CharField(max_length=30)
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
    tag = models.CharField(max_length=100)
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
    tag = models.CharField(max_length=100)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'seller_tags'
        unique_together = (('seller', 'tag'),)
