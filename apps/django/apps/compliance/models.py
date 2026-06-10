# Originally inspectdb output; now Django-managed (managed=True) — schema owned by migrations.
import uuid
from django.db import models

class ComplianceDocumentsList(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    source_info = models.TextField(blank=True, null=True)
    details = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    is_required_default = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    validity_years = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = True
        db_table = 'compliance_documents_list'
        verbose_name = "Compliance Document"
        verbose_name_plural = "Compliance Documents List"



class SellerComplianceDocuments(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    document_list = models.ForeignKey('compliance.ComplianceDocumentsList', models.DO_NOTHING)
    is_required = models.BooleanField()
    status = models.CharField(max_length=30)
    file_url = models.URLField(max_length=2048, blank=True, null=True)
    uploaded_at = models.DateTimeField(blank=True, null=True)
    reviewed_at = models.DateTimeField(blank=True, null=True)
    reviewed_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    version = models.IntegerField()
    is_current = models.BooleanField()
    expires_at = models.DateTimeField(blank=True, null=True)
    expired = models.BooleanField()

    class Meta:
        managed = True
        db_table = 'seller_compliance_documents'
        unique_together = (('seller', 'document_list'), ('seller', 'document_list'),)
        verbose_name = "Seller Compliance Document"
        verbose_name_plural = "Seller Compliance Documents"



class SellerOptionalUploads(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    document_list = models.ForeignKey('compliance.ComplianceDocumentsList', models.DO_NOTHING, blank=True, null=True)
    custom_title = models.CharField(max_length=255, blank=True, null=True)
    custom_description = models.TextField(blank=True, null=True)
    file_url = models.URLField(max_length=2048)
    status = models.CharField(max_length=30)
    reviewed_at = models.DateTimeField(blank=True, null=True)
    reviewed_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(blank=True, null=True)
    expired = models.BooleanField()

    class Meta:
        managed = True
        db_table = 'seller_optional_uploads'


