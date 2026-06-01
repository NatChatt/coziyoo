from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0003_home_hero_edit_json_asset_key"),
    ]

    operations = [
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
                        TRUE,
                        FALSE,
                        now(),
                        now(),
                        NULL
                    ),
                    (
                        '2c3bbaf2-5a34-4276-b5a7-967d3c787968',
                        'national_id_back',
                        'Kimlik kartı arka yüzü',
                        'Satıcının kimlik kartının arka yüz fotoğrafı.',
                        'seller_profile',
                        'Kimlik doğrulama gerektiğinde admin tarafından Compliance sekmesinden incelenir.',
                        TRUE,
                        FALSE,
                        now(),
                        now(),
                        NULL
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
