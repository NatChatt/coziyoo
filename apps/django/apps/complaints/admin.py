from django.contrib import admin
from django.core.exceptions import ObjectDoesNotExist
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from apps.authentication.models import AdminUsers, Users
from apps.orders.models import Orders
from .models import Complaints, ComplaintCategories, ComplaintAdminNotes, TicketMessages


class ComplaintAdminNotesInline(TabularInline):
    model = ComplaintAdminNotes
    extra = 0
    readonly_fields = ["created_by_admin", "note", "created_at"]
    fields = ["note", "created_by_admin", "created_at"]
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(ComplaintCategories)
class ComplaintCategoriesAdmin(ModelAdmin):
    list_display = ["name", "code", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["name", "code"]
    readonly_fields = ["id", "created_at"]


STATUS_CHOICES = [
    ("open", "Açık"),
    ("in_review", "İnceleniyor"),
    ("awaiting_response", "Cevap Bekleniyor"),
    ("resolved", "Çözüldü"),
    ("closed", "Kapandı"),
]

PRIORITY_CHOICES = [
    ("low", "Düşük"),
    ("medium", "Orta"),
    ("high", "Yüksek"),
    ("urgent", "Acil"),
]


@admin.register(Complaints)
class ComplaintsAdmin(ModelAdmin):
    list_display = [
        "ticket_link", "complainant_link", "category_link", "status_badge_link",
        "priority_badge_link", "assigned_admin_link", "created_at_link",
    ]
    list_display_links = None
    list_select_related = ["complainant_user", "category", "assigned_admin"]
    list_filter = ["status", "priority", "category"]
    search_fields = ["complainant_user__email", "description"]
    readonly_fields = [
        "id", "order", "complainant_user", "complainant_buyer",
        "complainant_type", "ticket_no", "created_at", "resolved_at",
    ]
    ordering = ["-created_at"]
    inlines = [ComplaintAdminNotesInline]
    list_per_page = 50

    def has_add_permission(self, request):
        return False

    def get_urls(self):
        urls = super().get_urls()
        extra = [
            path(
                "<uuid:complaint_id>/detail/",
                self.admin_site.admin_view(self.complaint_detail_view),
                name="complaints_complaints_detail",
            ),
        ]
        return extra + urls

    def complaint_detail_view(self, request, complaint_id):
        complaint = get_object_or_404(
            Complaints.objects.select_related(
                "category",
            ),
            pk=complaint_id,
        )

        messages = list(
            TicketMessages.objects
            .filter(complaint_id=complaint_id)
            .order_by("created_at")
        )
        admin_notes = list(
            ComplaintAdminNotes.objects
            .filter(complaint_id=complaint_id)
            .order_by("-created_at")
        )

        order = Orders.objects.filter(pk=complaint.order_id).first() if complaint.order_id else None
        complainant_id = complaint.complainant_user_id or complaint.complainant_buyer_id
        complainant = Users.objects.filter(pk=complainant_id).first() if complainant_id else None
        buyer = Users.objects.filter(pk=order.buyer_id).first() if order and getattr(order, "buyer_id", None) else None
        seller = Users.objects.filter(pk=order.seller_id).first() if order and getattr(order, "seller_id", None) else None
        assigned_admin = (
            AdminUsers.objects.filter(pk=complaint.assigned_admin_id).first()
            if complaint.assigned_admin_id
            else None
        )
        author_ids = [m.author_id for m in messages if m.author_id]
        authors = {
            user.id: user
            for user in Users.objects.filter(id__in=author_ids)
        }
        for message in messages:
            message.author_obj = authors.get(message.author_id)
        admin_ids = [n.created_by_admin_id for n in admin_notes if n.created_by_admin_id]
        admins = {
            adm.id: adm
            for adm in AdminUsers.objects.filter(id__in=admin_ids)
        }
        for note in admin_notes:
            note.created_by_admin_obj = admins.get(note.created_by_admin_id)

        buyer_url = (
            f"{reverse('admin:authentication_buyerusers_buyer_detail', args=[buyer.id])}?tab=complaints"
            if buyer
            else None
        )
        seller_url = (
            f"{reverse('admin:authentication_sellerusers_seller_detail', args=[seller.id])}?tab=complaints"
            if seller
            else None
        )

        context = {
            **self.admin_site.each_context(request),
            "complaint": complaint,
            "category_name": (
                ComplaintCategories.objects.filter(pk=complaint.category_id).values_list("name", flat=True).first()
                if complaint.category_id
                else None
            ),
            "ticket_messages": messages,
            "admin_notes": admin_notes,
            "complainant": complainant,
            "buyer": buyer,
            "seller": seller,
            "order": order,
            "assigned_admin": assigned_admin,
            "buyer_url": buyer_url,
            "seller_url": seller_url,
            "order_url": f"/admin/orders/orders/{complaint.order_id}/change/" if complaint.order_id else None,
            "change_url": f"/admin/complaints/complaints/{complaint.id}/change/",
            "page_title": f"Şikayet #{complaint.ticket_no}",
            "title": f"Şikayet #{complaint.ticket_no}",
        }
        return TemplateResponse(request, "admin/complaints/complaints/complaint_detail.html", context)

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        if "status" in form.base_fields:
            from django import forms
            form.base_fields["status"].widget = forms.Select(choices=STATUS_CHOICES)
        if "priority" in form.base_fields:
            from django import forms
            form.base_fields["priority"].widget = forms.Select(choices=PRIORITY_CHOICES)
        return form

    fieldsets = [
        ("Ticket", {"fields": ["id", "ticket_no", "status", "priority", "category"]}),
        ("Complainant", {"fields": ["complainant_user", "complainant_type", "order"]}),
        ("Content", {"fields": ["description", "resolution_note"]}),
        ("Assignment", {"fields": ["assigned_admin"]}),
        ("Meta", {"fields": ["created_at", "resolved_at"]}),
    ]

    @display(description="Ticket", ordering="ticket_no")
    def ticket_link(self, obj):
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="font-medium text-primary-600 hover:underline">#{}</a>',
            obj.id,
            obj.ticket_no,
        )

    @display(description="Complainant", ordering="complainant_user")
    def complainant_link(self, obj):
        complainant = None
        try:
            complainant = getattr(obj, "complainant_user", None)
        except ObjectDoesNotExist:
            complainant = None
        if complainant is None:
            try:
                complainant = getattr(obj, "complainant_buyer", None)
            except ObjectDoesNotExist:
                complainant = None
        label = getattr(complainant, "display_name", None) or getattr(complainant, "email", None) or "-"
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="block w-full h-full text-base-800 dark:text-base-100 hover:underline">{}</a>',
            obj.id,
            label,
        )

    @display(description="Category", ordering="category")
    def category_link(self, obj):
        label = "-"
        try:
            category_obj = getattr(obj, "category", None)
            label = getattr(category_obj, "name", None) or "-"
        except ObjectDoesNotExist:
            label = "-"
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="block w-full h-full text-base-800 dark:text-base-100 hover:underline">{}</a>',
            obj.id,
            label,
        )

    @display(description="Status", ordering="status")
    def status_badge_link(self, obj):
        colors = {
            "open": "#2563eb", "in_review": "#d97706",
            "awaiting_response": "#9333ea",
            "resolved": "#16a34a", "closed": "#6b7280",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="block w-full h-full"><span style="color:{};font-weight:600">{}</span></a>',
            obj.id, color, obj.status,
        )

    @display(description="Priority", ordering="priority")
    def priority_badge_link(self, obj):
        colors = {
            "low": "#6b7280", "medium": "#d97706",
            "high": "#dc2626", "urgent": "#7c3aed",
        }
        color = colors.get(obj.priority, "#6b7280")
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="block w-full h-full"><span style="color:{};font-weight:600">{}</span></a>',
            obj.id, color, obj.priority,
        )

    @display(description="Assigned admin", ordering="assigned_admin")
    def assigned_admin_link(self, obj):
        try:
            admin_obj = getattr(obj, "assigned_admin", None)
        except ObjectDoesNotExist:
            admin_obj = None
        label = getattr(admin_obj, "email", None) or "-"
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="block w-full h-full text-base-800 dark:text-base-100 hover:underline">{}</a>',
            obj.id,
            label,
        )

    @display(description="Created at", ordering="created_at")
    def created_at_link(self, obj):
        if not obj.created_at:
            return "-"
        return format_html(
            '<a href="/admin/complaints/complaints/{}/detail/" class="block w-full h-full text-base-800 dark:text-base-100 hover:underline">{}</a>',
            obj.id,
            obj.created_at.strftime("%d.%m.%Y %H:%M"),
        )
