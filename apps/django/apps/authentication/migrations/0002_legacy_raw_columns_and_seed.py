"""Legacy columns + seed data preserved from the pre-managed (Supabase) era.

The admin home-hero feature reads/writes these columns on
``admin_sales_commission_settings`` via raw SQL (see
``apps/authentication/admin_home_hero.py`` and ``apps/foods/views.py``), so they
are not part of the model but must exist in the database. The compliance seed
provides the national-ID document types used by the seller compliance flow.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0001_initial"),
        ("compliance", "0001_initial"),
    ]

    operations = [
        # Raw-SQL-only columns on admin_sales_commission_settings (home hero).
        migrations.RunSQL(
            sql="""
                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_hero_question_text TEXT;
                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_hero_slogan_title TEXT;
                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_hero_slogan_subtitle TEXT;
                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_header_edit_json TEXT;
                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_header_asset_key TEXT;
            """,
            reverse_sql="""
                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_header_asset_key;
                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_header_edit_json;
                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_hero_slogan_subtitle;
                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_hero_slogan_title;
                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_hero_question_text;
            """,
        ),
        # Seed: national-ID compliance document types.
        migrations.RunSQL(
            sql="""
                INSERT INTO compliance_documents_list
                    (id, code, name, description, source_info, details,
                     is_active, is_required_default, created_at, updated_at, validity_years)
                VALUES
                    (
                        '8bf7438f-a028-46df-8c2b-905fe90bafce',
                        'national_id_front',
                        'Kimlik kartı ön yüzü',
                        'Satıcının kimlik kartının ön yüz fotoğrafı.',
                        'seller_profile',
                        'Kimlik doğrulama gerektiğinde admin tarafından Compliance sekmesinden incelenir.',
                        TRUE, FALSE, now(), now(), NULL
                    ),
                    (
                        '2c3bbaf2-5a34-4276-b5a7-967d3c787968',
                        'national_id_back',
                        'Kimlik kartı arka yüzü',
                        'Satıcının kimlik kartının arka yüz fotoğrafı.',
                        'seller_profile',
                        'Kimlik doğrulama gerektiğinde admin tarafından Compliance sekmesinden incelenir.',
                        TRUE, FALSE, now(), now(), NULL
                    )
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    source_info = EXCLUDED.source_info,
                    details = EXCLUDED.details,
                    is_active = TRUE,
                    is_required_default = FALSE,
                    updated_at = now();
            """,
            reverse_sql="""
                UPDATE compliance_documents_list
                SET is_active = FALSE, updated_at = now()
                WHERE code IN ('national_id_front', 'national_id_back');
            """,
        ),
    ]
