"""Restore database-side column defaults lost in the inspectdb conversion.

The pre-managed (Supabase) schema declared database-side defaults on most
columns: ``id uuid DEFAULT gen_random_uuid()``, ``created_at DEFAULT now()``,
``is_active boolean DEFAULT true``, counters ``DEFAULT 0`` and so on. When the
schema was converted to Django-managed migrations via ``inspectdb``, those
database defaults were dropped. ORM inserts kept working (the models supply the
values app-side), but the codebase performs ~50 raw-SQL ``INSERT`` statements
(e.g. ``RegisterView`` in ``apps/authentication/views.py``) that omit these
columns and rely on the database default. Without the defaults every such insert
failed with ``NotNullViolation`` — user registration and most write paths were
broken on the fresh database.

This migration re-adds the defaults in two passes, scoped to ``public`` columns
that are NOT NULL, have no current default, and are not identity columns:

  Pass A — model-derived. For each managed model field that declares a default
  (``default=...``) or ``auto_now``/``auto_now_add``, set the matching SQL
  default. This covers UUID primary keys (``gen_random_uuid()``), ``created_at``/
  ``updated_at`` (``now()``), and any field with an explicit model default.

  Pass B — type rules for columns the inspectdb models left without a default:
  booleans → ``false`` (``is_active`` → ``true``), counter integers → ``0``,
  and ``users.seller_profile_status`` → ``'none'``.

Defaults are a fallback only: ORM inserts still pass explicit values, so there is
no behavioural conflict. The migration is idempotent (guarded on
``column_default IS NULL``) and re-derives everything from the live schema, so it
stays correct on a fresh deploy. PostgreSQL 13+ ships ``gen_random_uuid()`` in
core, so no ``pgcrypto`` extension is required.
"""
import json

from django.db import migrations


def _model_default_sql(field):
    """SQL default literal for a model field that declares one, else None."""
    if getattr(field, "auto_now", False) or getattr(field, "auto_now_add", False):
        return "now()"
    if not field.has_default():
        return None
    value = field.get_default()
    if value is None:
        return None
    internal = field.get_internal_type()
    if internal == "UUIDField":
        return "gen_random_uuid()"
    if internal == "BooleanField":
        return "true" if value else "false"
    if internal in (
        "IntegerField", "BigIntegerField", "SmallIntegerField",
        "PositiveIntegerField", "PositiveSmallIntegerField", "PositiveBigIntegerField",
        "FloatField", "DecimalField",
    ):
        return str(value)
    if internal == "JSONField":
        return "'%s'::jsonb" % json.dumps(value).replace("'", "''")
    if internal in ("DateTimeField", "DateField"):
        return "now()"
    return "'%s'" % str(value).replace("'", "''")


def _type_rule_sql(table, column, data_type):
    """Fallback default for columns whose model carries no default."""
    if data_type == "boolean":
        return "true" if column == "is_active" else "false"
    if data_type == "integer":
        if column.endswith("_count") or column in ("sort_order", "attempt_count", "verification_attempts"):
            return "0"
    if data_type == "character varying":
        if table == "users" and column == "seller_profile_status":
            return "'none'"
    return None


def _missing_columns(cursor):
    """{(table, column): data_type} for NOT NULL, no-default, non-identity cols."""
    cursor.execute(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND is_nullable = 'NO'
          AND column_default IS NULL
          AND is_identity = 'NO'
        """
    )
    return {(t, c): dt for t, c, dt in cursor.fetchall()}


def forwards(apps, schema_editor):
    cursor = schema_editor.connection.cursor()
    missing = _missing_columns(cursor)

    # Pass A: model-derived defaults.
    for model in apps.get_models():
        if not model._meta.managed:
            continue
        table = model._meta.db_table
        for field in model._meta.local_concrete_fields:
            key = (table, field.column)
            if key not in missing:
                continue
            sql_default = _model_default_sql(field)
            if sql_default:
                cursor.execute(
                    'ALTER TABLE public.%s ALTER COLUMN %s SET DEFAULT %s'
                    % (table, field.column, sql_default)
                )
                del missing[key]

    # Pass B: type rules for the remaining columns.
    for (table, column), data_type in list(missing.items()):
        sql_default = _type_rule_sql(table, column, data_type)
        if sql_default:
            cursor.execute(
                'ALTER TABLE public.%s ALTER COLUMN %s SET DEFAULT %s'
                % (table, column, sql_default)
            )


class Migration(migrations.Migration):
    # Depend on every app's latest migration so all model tables exist before we
    # scan information_schema and attach defaults (matters on a fresh deploy).
    dependencies = [
        ("authentication", "0002_legacy_raw_columns_and_seed"),
        ("complaints", "0002_initial"),
        ("compliance", "0001_initial"),
        ("menu", "0001_initial"),
        ("notifications", "0002_initial"),
        ("orders", "0001_initial"),
        ("payments", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
