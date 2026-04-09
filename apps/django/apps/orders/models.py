# Auto-generated from inspectdb — managed=False, do not run migrations against these.
from django.db import models

class AllergenDisclosureRecords(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='allergendisclosurerecords_buyer_set')
    food = models.ForeignKey('menu.Foods', models.DO_NOTHING)
    phase = models.CharField(max_length=30)
    allergen_snapshot_json = models.JSONField()
    disclosure_method = models.CharField(max_length=50)
    buyer_confirmation = models.CharField(max_length=30)
    evidence_ref = models.CharField(max_length=255, blank=True, null=True)
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'allergen_disclosure_records'
        unique_together = (('order', 'phase'),)



class DeliveryProofRecords(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.OneToOneField('Orders', models.DO_NOTHING)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='deliveryproofrecords_buyer_set')
    proof_mode = models.CharField(max_length=30)
    pin_hash = models.CharField(max_length=255)
    pin_sent_at = models.DateTimeField(blank=True, null=True)
    pin_sent_channel = models.CharField(max_length=20)
    pin_verified_at = models.DateTimeField(blank=True, null=True)
    verification_attempts = models.IntegerField()
    status = models.CharField(max_length=30)
    metadata_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'delivery_proof_records'



class OrderDeliveryTracking(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    seller_user = models.ForeignKey('authentication.Users', models.DO_NOTHING)
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
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    actor_user = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    event_type = models.CharField(max_length=50)
    from_status = models.CharField(max_length=30, blank=True, null=True)
    to_status = models.CharField(max_length=30, blank=True, null=True)
    payload_json = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_events'



class OrderFinance(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.OneToOneField('Orders', models.DO_NOTHING)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
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
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    order_item = models.ForeignKey('orders.OrderItems', models.DO_NOTHING)
    lot = models.ForeignKey('menu.ProductionLots', models.DO_NOTHING)
    quantity_allocated = models.IntegerField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_item_lot_allocations'



class OrderItems(models.Model):
    id = models.UUIDField(primary_key=True)
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    lot = models.ForeignKey('menu.ProductionLots', models.DO_NOTHING, blank=True, null=True)
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
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
    milestone_type = models.CharField(max_length=50)
    sent_at = models.DateTimeField()
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'order_notification_milestones'
        unique_together = (('order', 'milestone_type'),)



class Orders(models.Model):
    id = models.UUIDField(primary_key=True)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='orders_seller_set')
    status = models.CharField(max_length=30)
    delivery_type = models.CharField(max_length=30)
    delivery_address_json = models.JSONField(blank=True, null=True)
    total_price = models.DecimalField(max_digits=12, decimal_places=2)
    requested_at = models.DateTimeField(blank=True, null=True)
    estimated_delivery_time = models.DateTimeField(blank=True, null=True)
    payment_completed = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    requested_delivery_type = models.CharField(max_length=30)
    active_delivery_type = models.CharField(max_length=30)
    seller_decision_state = models.CharField(max_length=30)
    seller_eta_minutes = models.IntegerField(blank=True, null=True)
    seller_promised_at = models.DateTimeField(blank=True, null=True)
    seller_delivery_note = models.TextField(blank=True, null=True)
    seller_delivery_terms_snapshot = models.TextField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    payment_captured_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'orders'
        verbose_name = "Order"
        verbose_name_plural = "Orders"



class OutboxDeadLetters(models.Model):
    id = models.UUIDField(primary_key=True)
    outbox_event = models.ForeignKey('orders.OutboxEvents', models.DO_NOTHING, blank=True, null=True)
    event_type = models.CharField(max_length=100)
    aggregate_type = models.CharField(max_length=50)
    aggregate_id = models.CharField(max_length=255)
    payload_json = models.JSONField()
    last_error = models.TextField(blank=True, null=True)
    failed_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'outbox_dead_letters'



class OutboxEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    event_type = models.CharField(max_length=100)
    aggregate_type = models.CharField(max_length=50)
    aggregate_id = models.CharField(max_length=255)
    payload_json = models.JSONField()
    status = models.CharField(max_length=30)
    attempt_count = models.IntegerField()
    next_attempt_at = models.DateTimeField()
    last_error = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    processed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'outbox_events'



class Reviews(models.Model):
    id = models.UUIDField(primary_key=True)
    food = models.ForeignKey('menu.Foods', models.DO_NOTHING)
    buyer = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING, related_name='reviews_seller_set')
    order = models.ForeignKey('orders.Orders', models.DO_NOTHING)
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
        verbose_name = "Review"
        verbose_name_plural = "Reviews"


