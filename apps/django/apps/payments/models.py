# Auto-generated from inspectdb — managed=False, do not run migrations against these.
from django.db import models

class CommissionSettings(models.Model):
    id = models.UUIDField(primary_key=True)
    commission_rate = models.DecimalField(max_digits=5, decimal_places=4)
    is_active = models.BooleanField()
    effective_from = models.DateTimeField()
    created_by = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, db_column='created_by', blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'commission_settings'



class FinanceAdjustments(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    dispute_case = models.ForeignKey('payments.PaymentDisputeCases', models.DO_NOTHING, blank=True, null=True)
    type = models.CharField(max_length=50)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'finance_adjustments'



class FinanceReconciliationReports(models.Model):
    id = models.UUIDField(primary_key=True)
    actor_type = models.CharField(max_length=30)
    actor_id = models.UUIDField()
    report_type = models.CharField(max_length=50)
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=30)
    file_url = models.URLField(max_length=2048, blank=True, null=True)
    checksum = models.CharField(max_length=255, blank=True, null=True)
    generated_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'finance_reconciliation_reports'



class PaymentAttempts(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    provider = models.CharField(max_length=50)
    provider_session_id = models.CharField(max_length=255, unique=True, blank=True, null=True)
    provider_reference_id = models.CharField(max_length=255, unique=True, blank=True, null=True)
    status = models.CharField(max_length=30)
    callback_payload_json = models.JSONField(blank=True, null=True)
    signature_valid = models.BooleanField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'payment_attempts'



class PaymentDisputeCases(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    payment_attempt = models.ForeignKey('payments.PaymentAttempts', models.DO_NOTHING)
    provider_case_id = models.CharField(max_length=255, unique=True, blank=True, null=True)
    case_type = models.CharField(max_length=50)
    reason_code = models.CharField(max_length=100, blank=True, null=True)
    liability_party = models.CharField(max_length=30)
    liability_ratio_json = models.JSONField(blank=True, null=True)
    status = models.CharField(max_length=30)
    evidence_bundle_json = models.JSONField(blank=True, null=True)
    opened_at = models.DateTimeField()
    resolved_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'payment_dispute_cases'


