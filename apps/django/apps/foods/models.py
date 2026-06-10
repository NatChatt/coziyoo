# Originally inspectdb output; now Django-managed (managed=True) — schema owned by migrations.
import uuid
from django.db import models


class IngredientTemplates(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    name_en = models.CharField(max_length=100, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

    class Meta:
        managed = True
        db_table = "ingredient_templates"
        verbose_name = "Ingredient Template"
        verbose_name_plural = "Ingredient Templates"
        ordering = ["sort_order", "name"]


class AddonTemplates(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=20)       # sauce | extra | appetizer
    pricing = models.CharField(max_length=10)    # free | paid
    default_price = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.kind}/{self.pricing})"

    class Meta:
        managed = True
        db_table = "addon_templates"
        verbose_name = "Addon Template"
        verbose_name_plural = "Addon Templates"
        ordering = ["sort_order", "name"]


class Categories(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name_tr = models.CharField(max_length=255)
    name_en = models.CharField(max_length=255)
    sort_order = models.IntegerField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name_tr or self.name_en or str(self.id)

    class Meta:
        managed = True
        db_table = 'categories'
        verbose_name = "Category"
        verbose_name_plural = "Categories"



class Favorites(models.Model):
    user = models.OneToOneField('authentication.Users', models.DO_NOTHING, primary_key=True)  # The composite primary key (user_id, food_id) found, that is not supported. The first column is selected.
    food = models.ForeignKey('menu.Foods', models.DO_NOTHING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'favorites'
        unique_together = (('user', 'food'),)



class Foods(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    category = models.ForeignKey('menu.Categories', models.DO_NOTHING, blank=True, null=True)
    name = models.CharField(max_length=255)
    card_summary = models.CharField(max_length=500, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    recipe = models.TextField(blank=True, null=True)
    country_code = models.CharField(max_length=10, blank=True, null=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    image_url = models.URLField(max_length=2048, blank=True, null=True)
    ingredients_json = models.JSONField(blank=True, null=True)
    allergens_json = models.JSONField(blank=True, null=True)
    preparation_time_minutes = models.IntegerField(blank=True, null=True)
    serving_size = models.CharField(max_length=100, blank=True, null=True)
    is_active = models.BooleanField()
    rating = models.DecimalField(max_digits=3, decimal_places=2)
    review_count = models.IntegerField()
    favorite_count = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cuisine = models.CharField(max_length=100, blank=True, null=True)
    image_urls_json = models.JSONField(blank=True, null=True)
    menu_items_json = models.JSONField(blank=True, null=True)
    paid_addons_json = models.JSONField(blank=True, null=True)
    secondary_category_ids_json = models.JSONField(blank=True, null=True)

    def __str__(self):
        return self.name or str(self.id)

    class Meta:
        managed = True
        db_table = 'foods'
        verbose_name = "Food"
        verbose_name_plural = "Foods"



class LotEvents(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lot = models.ForeignKey('menu.ProductionLots', models.DO_NOTHING)
    event_type = models.CharField(max_length=50)
    event_payload_json = models.JSONField(blank=True, null=True)
    created_by = models.ForeignKey('authentication.Users', models.DO_NOTHING, db_column='created_by', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'lot_events'



class ProductionLots(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    food_id = models.UUIDField()
    lot_number = models.CharField(max_length=100, unique=True)
    produced_at = models.DateTimeField()
    use_by = models.DateTimeField(blank=True, null=True)
    best_before = models.DateTimeField(blank=True, null=True)
    quantity_produced = models.IntegerField()
    quantity_available = models.IntegerField()
    status = models.CharField(max_length=30)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    sale_starts_at = models.DateTimeField()
    sale_ends_at = models.DateTimeField()
    recipe_snapshot = models.TextField(blank=True, null=True)
    ingredients_snapshot_json = models.JSONField(blank=True, null=True)
    allergens_snapshot_json = models.JSONField(blank=True, null=True)
    food_name_snapshot = models.CharField(max_length=255, blank=True, null=True)
    price_snapshot = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    menu_items_snapshot_json = models.JSONField(blank=True, null=True)
    paid_addons_snapshot_json = models.JSONField(blank=True, null=True)

    def __str__(self):
        return self.lot_number or str(self.id)

    class Meta:
        managed = True
        db_table = 'production_lots'
        verbose_name = "Production Lot"
        verbose_name_plural = "Production Lots"



class AgentCallLogs(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room_name = models.CharField(max_length=255)
    profile = models.ForeignKey('menu.AgentProfiles', models.DO_NOTHING, blank=True, null=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()
    duration_seconds = models.IntegerField()
    outcome = models.CharField(max_length=50)
    summary = models.TextField(blank=True, null=True)
    device_id = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = 'agent_call_logs'



class AgentProfiles(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(unique=True)
    speaks_first = models.BooleanField()
    system_prompt = models.TextField(blank=True, null=True)
    greeting_enabled = models.BooleanField()
    greeting_instruction = models.TextField(blank=True, null=True)
    voice_language = models.CharField(max_length=20)
    llm_config = models.JSONField()
    stt_config = models.JSONField()
    tts_config = models.JSONField()
    n8n_config = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'agent_profiles'



class LongTermMemory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField('authentication.Users', models.DO_NOTHING)
    dietary_preferences = models.JSONField()
    personal_details = models.JSONField()
    order_history_summary = models.JSONField()
    conversation_style = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'long_term_memory'



class SessionMemory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room_id = models.CharField(max_length=255, unique=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    data = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = 'session_memory'



class StarterAgentSettings(models.Model):
    device_id = models.CharField(max_length=255, primary_key=True)
    agent_name = models.CharField(max_length=255)
    voice_language = models.CharField(max_length=20)
    tts_enabled = models.BooleanField()
    stt_enabled = models.BooleanField()
    system_prompt = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    greeting_enabled = models.BooleanField()
    greeting_instruction = models.TextField(blank=True, null=True)
    tts_engine = models.CharField(max_length=50)
    tts_config_json = models.JSONField(blank=True, null=True)
    ollama_model = models.CharField(max_length=255)
    tts_servers_json = models.JSONField(blank=True, null=True)
    active_tts_server_id = models.CharField(max_length=255, blank=True, null=True)
    is_active = models.BooleanField(unique=True)

    class Meta:
        managed = True
        db_table = 'starter_agent_settings'

