from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("authentication", "0001_add_mobile_home_hero_texts"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
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
            """,
        ),
    ]
