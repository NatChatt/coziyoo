from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class FoodsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.foods"
    label = "menu"
    verbose_name = _("Foods")
