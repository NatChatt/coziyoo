# Auto-generated from inspectdb — managed=False, do not run migrations against these.
from django.db import models

class Categories(models.Model):
    id = models.UUIDField(primary_key=True)
    name_tr = models.TextField()
    name_en = models.TextField()
    sort_order = models.IntegerField()
    is_active = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'categories'



class Favorites(models.Model):
    user = models.OneToOneField('authentication.Users', models.DO_NOTHING, primary_key=True)  # The composite primary key (user_id, food_id) found, that is not supported. The first column is selected.
    food = models.ForeignKey('foods.Foods', models.DO_NOTHING)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'favorites'
        unique_together = (('user', 'food'),)



class Foods(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    category = models.ForeignKey('foods.Categories', models.DO_NOTHING, blank=True, null=True)
    name = models.TextField()
    card_summary = models.TextField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    recipe = models.TextField(blank=True, null=True)
    country_code = models.TextField(blank=True, null=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    image_url = models.TextField(blank=True, null=True)
    ingredients_json = models.JSONField(blank=True, null=True)
    allergens_json = models.JSONField(blank=True, null=True)
    preparation_time_minutes = models.IntegerField(blank=True, null=True)
    serving_size = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    rating = models.DecimalField(max_digits=3, decimal_places=2)
    review_count = models.IntegerField()
    favorite_count = models.IntegerField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    cuisine = models.TextField(blank=True, null=True)
    image_urls_json = models.JSONField(blank=True, null=True)
    menu_items_json = models.JSONField(blank=True, null=True)
    secondary_category_ids_json = models.JSONField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'foods'



class LotEvents(models.Model):
    id = models.UUIDField(primary_key=True)
    lot = models.ForeignKey('foods.ProductionLots', models.DO_NOTHING)
    event_type = models.TextField()
    event_payload_json = models.JSONField(blank=True, null=True)
    created_by = models.ForeignKey('authentication.Users', models.DO_NOTHING, db_column='created_by', blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'lot_events'



class ProductionLots(models.Model):
    id = models.UUIDField(primary_key=True)
    seller = models.ForeignKey('authentication.Users', models.DO_NOTHING)
    food_id = models.UUIDField()
    lot_number = models.TextField(unique=True)
    produced_at = models.DateTimeField()
    use_by = models.DateTimeField(blank=True, null=True)
    best_before = models.DateTimeField(blank=True, null=True)
    quantity_produced = models.IntegerField()
    quantity_available = models.IntegerField()
    status = models.TextField()
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    sale_starts_at = models.DateTimeField()
    sale_ends_at = models.DateTimeField()
    recipe_snapshot = models.TextField(blank=True, null=True)
    ingredients_snapshot_json = models.JSONField(blank=True, null=True)
    allergens_snapshot_json = models.JSONField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'production_lots'



class AgentCallLogs(models.Model):
    id = models.UUIDField(primary_key=True)
    room_name = models.TextField()
    profile = models.ForeignKey('foods.AgentProfiles', models.DO_NOTHING, blank=True, null=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField()
    duration_seconds = models.IntegerField()
    outcome = models.TextField()
    summary = models.TextField(blank=True, null=True)
    device_id = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'agent_call_logs'



class AgentProfiles(models.Model):
    id = models.UUIDField(primary_key=True)
    name = models.TextField()
    is_active = models.BooleanField(unique=True)
    speaks_first = models.BooleanField()
    system_prompt = models.TextField(blank=True, null=True)
    greeting_enabled = models.BooleanField()
    greeting_instruction = models.TextField(blank=True, null=True)
    voice_language = models.TextField()
    llm_config = models.JSONField()
    stt_config = models.JSONField()
    tts_config = models.JSONField()
    n8n_config = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'agent_profiles'



class LongTermMemory(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.OneToOneField('authentication.Users', models.DO_NOTHING)
    dietary_preferences = models.JSONField()
    personal_details = models.JSONField()
    order_history_summary = models.JSONField()
    conversation_style = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'long_term_memory'



class SessionMemory(models.Model):
    id = models.UUIDField(primary_key=True)
    room_id = models.TextField(unique=True)
    user = models.ForeignKey('authentication.Users', models.DO_NOTHING, blank=True, null=True)
    data = models.JSONField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'session_memory'



class StarterAgentSettings(models.Model):
    device_id = models.TextField(primary_key=True)
    agent_name = models.TextField()
    voice_language = models.TextField()
    tts_enabled = models.BooleanField()
    stt_enabled = models.BooleanField()
    system_prompt = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    greeting_enabled = models.BooleanField()
    greeting_instruction = models.TextField(blank=True, null=True)
    tts_engine = models.TextField()
    tts_config_json = models.JSONField(blank=True, null=True)
    ollama_model = models.TextField()
    tts_servers_json = models.JSONField(blank=True, null=True)
    active_tts_server_id = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(unique=True)

    class Meta:
        managed = False
        db_table = 'starter_agent_settings'


