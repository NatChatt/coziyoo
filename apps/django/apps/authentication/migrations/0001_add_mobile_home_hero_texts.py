from django.db import migrations


class Migration(migrations.Migration):
    dependencies = []

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_hero_question_text TEXT;

                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_hero_slogan_title TEXT;

                ALTER TABLE admin_sales_commission_settings
                  ADD COLUMN IF NOT EXISTS mobile_home_hero_slogan_subtitle TEXT;
            """,
            reverse_sql="""
                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_hero_slogan_subtitle;

                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_hero_slogan_title;

                ALTER TABLE admin_sales_commission_settings
                  DROP COLUMN IF EXISTS mobile_home_hero_question_text;
            """,
        ),
    ]
