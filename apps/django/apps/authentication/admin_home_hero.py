import uuid

from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.utils import timezone

from apps.authentication.models import AdminSalesCommissionSettings, AdminUsers


def _normalize_hero_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    return ""


@staff_member_required
def home_hero_view(request: HttpRequest) -> HttpResponse:
    latest = AdminSalesCommissionSettings.objects.order_by("-created_at").first()

    if request.method == "POST":
        next_url = _normalize_hero_url(request.POST.get("mobile_home_header_image_url", ""))
        action = str(request.POST.get("action") or "").strip().lower()
        if action == "approve":
            if request.POST.get("mobile_home_header_image_url", "").strip() and not next_url:
                messages.error(request, "Geçerli bir görsel URL gir. (http:// veya https://)")
            else:
                if latest is None:
                    admin_user = AdminUsers.objects.filter(email__iexact=getattr(request.user, "email", "")).first()
                    if admin_user is None:
                        admin_user = AdminUsers.objects.order_by("created_at").first()
                    if admin_user is None:
                        messages.error(request, "Admin kullanıcı kaydı bulunamadı.")
                    else:
                        latest = AdminSalesCommissionSettings.objects.create(
                            id=uuid.uuid4(),
                            commission_rate_percent=0,
                            mobile_home_header_image_url=next_url or None,
                            created_by_admin=admin_user,
                            created_at=timezone.now(),
                        )
                        messages.success(request, "Home Hero kaydedildi.")
                else:
                    latest.mobile_home_header_image_url = next_url or None
                    latest.save(update_fields=["mobile_home_header_image_url"])
                    messages.success(request, "Home Hero güncellendi.")
                return redirect(f"{request.path}?saved=1")
        elif action == "edit":
            return redirect(request.path)

    current_url = ""
    if latest and latest.mobile_home_header_image_url:
        current_url = str(latest.mobile_home_header_image_url).strip()

    context = {
        "title": "Home Hero",
        "current_url": current_url,
        "saved": request.GET.get("saved") == "1",
        "opts": AdminSalesCommissionSettings._meta,
    }
    return TemplateResponse(request, "admin/authentication/home_hero.html", context)
