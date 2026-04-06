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



class PaymentAttempts(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
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
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    payment_attempt = models.ForeignKey('payments.PaymentAttempts', models.DO_NOTHING)
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


