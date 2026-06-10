# Originally inspectdb output; now Django-managed (managed=True) — schema owned by migrations.
import uuid
from django.db import models

class NotificationEvents(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    type = models.CharField(max_length=50)
    title = models.CharField(max_length=255)
    body = models.TextField()
    data_json = models.JSONField(blank=True, null=True)
    is_read = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'notification_events'



class UserDeviceTokens(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    token = models.TextField(unique=True)
    platform = models.CharField(max_length=20)
    app_version = models.CharField(max_length=30, blank=True, null=True)
    is_active = models.BooleanField()
    last_seen_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'user_device_tokens'



class Chats(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='buyer_chats')
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='seller_chats')
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING, blank=True, null=True, related_name='delivery_chats')
    last_message = models.TextField(blank=True, null=True)
    last_message_time = models.DateTimeField(blank=True, null=True)
    last_message_sender = models.CharField(max_length=50, blank=True, null=True)
    buyer_unread_count = models.IntegerField()
    seller_unread_count = models.IntegerField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'chats'



class Messages(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chat = models.ForeignKey('notifications.Chats', models.DO_NOTHING, related_name='messages')
    sender = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='sent_chat_messages')
    sender_type = models.CharField(max_length=20)
    message = models.TextField(blank=True, null=True)
    message_type = models.CharField(max_length=20)
    order_data_json = models.JSONField(blank=True, null=True)
    is_read = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'messages'

