# Originally inspectdb output; now Django-managed (managed=True) — schema owned by migrations.
import uuid
from django.db import models

class ComplaintAdminNotes(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    complaint = models.ForeignKey('complaints.Complaints', models.DO_NOTHING)
    note = models.TextField()
    created_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'complaint_admin_notes'



class ComplaintCategories(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    class Meta:
        managed = True
        db_table = 'complaint_categories'
        verbose_name = "Complaint Category"
        verbose_name_plural = "Complaint Categories"



class TicketMessages(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    complaint = models.ForeignKey('complaints.Complaints', models.DO_NOTHING, related_name='ticket_messages')
    author_type = models.CharField(max_length=20)  # 'user' or 'admin'
    author_user = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    author_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, blank=True, null=True)
    recipient_user = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='complaint_ticket_recipient_set', blank=True, null=True)
    recipient_role = models.CharField(max_length=20, blank=True, null=True)  # complainant|buyer|seller|admin
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'ticket_messages'
        ordering = ['created_at']


class Complaints(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    complainant_buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    status = models.CharField(max_length=30)
    created_at = models.DateTimeField(auto_now_add=True)
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey('complaints.ComplaintCategories', models.DO_NOTHING, blank=True, null=True)
    priority = models.CharField(max_length=20)
    resolved_at = models.DateTimeField(blank=True, null=True)
    resolution_note = models.TextField(blank=True, null=True)
    assigned_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, blank=True, null=True)
    complainant_type = models.CharField(max_length=20)
    complainant_user = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='complaints_complainant_user_set')
    ticket_no = models.IntegerField()

    class Meta:
        managed = True
        db_table = 'complaints'
        verbose_name = "Complaint"
        verbose_name_plural = "Complaints"

