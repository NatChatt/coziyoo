# Auto-generated from inspectdb — managed=False, do not run migrations against these.
from django.db import models

class ComplaintAdminNotes(models.Model):
    id = models.UUIDField(primary_key=True)
    complaint = models.ForeignKey('complaints.Complaints', models.DO_NOTHING)
    note = models.TextField()
    created_by_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING)
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

    def __str__(self):
        return self.name

    class Meta:
        managed = False
        db_table = 'complaint_categories'
        verbose_name = "Complaint Category"
        verbose_name_plural = "Complaint Categories"



class Complaints(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    complainant_buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    status = models.TextField()
    created_at = models.DateTimeField()
    description = models.TextField(blank=True, null=True)
    category = models.ForeignKey('complaints.ComplaintCategories', models.DO_NOTHING, blank=True, null=True)
    priority = models.TextField()
    resolved_at = models.DateTimeField(blank=True, null=True)
    resolution_note = models.TextField(blank=True, null=True)
    assigned_admin = models.ForeignKey('authentication.AdminUsers', models.DO_NOTHING, blank=True, null=True)
    complainant_type = models.TextField()
    complainant_user = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='complaints_complainant_user_set')
    ticket_no = models.IntegerField()

    class Meta:
        managed = False
        db_table = 'complaints'
        verbose_name = "Complaint"
        verbose_name_plural = "Complaints"


