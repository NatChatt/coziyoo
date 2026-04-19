import json
import uuid

from django.contrib import admin, messages
from django.core.exceptions import ObjectDoesNotExist
from django.db import connection
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from apps.authentication.models import AdminUsers, Users
from apps.orders.models import Orders
from .models import Complaints, ComplaintCategories, ComplaintAdminNotes


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


def _resolve_admin_actor(request):
    email = (getattr(request.user, "email", "") or "").strip()
    if not email:
        return None

    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT
                id::text,
                email,
                COALESCE(NULLIF(trim(concat_ws(' ', name, surname)), ''), email) AS display_name
            FROM admin_users
            WHERE lower(email) = lower(%s) AND is_active = TRUE
            LIMIT 1
            """,
            [email],
        )
        row = cur.fetchone()

    if not row:
        return None

    return {
        "id": row[0],
        "email": row[1],
        "display_name": row[2],
    }


def _admin_display_name(admin_obj):
    if not admin_obj:
        return None
    full = " ".join(part for part in [getattr(admin_obj, "name", None), getattr(admin_obj, "surname", None)] if part)
    return full or getattr(admin_obj, "email", None) or None


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
            path(
                "<uuid:complaint_id>/take-over/",
                self.admin_site.admin_view(self.take_over_view),
                name="complaints_complaints_take_over",
            ),
            path(
                "<uuid:complaint_id>/send-message/",
                self.admin_site.admin_view(self.send_message_view),
                name="complaints_complaints_send_message",
            ),
            path(
                "<uuid:complaint_id>/add-note/",
                self.admin_site.admin_view(self.add_note_view),
                name="complaints_complaints_add_note",
            ),
            path(
                "<uuid:complaint_id>/resolve/",
                self.admin_site.admin_view(self.resolve_view),
                name="complaints_complaints_resolve",
            ),
        ]
        return extra + urls

    def _detail_url(self, complaint_id):
        return reverse("admin:complaints_complaints_detail", args=[str(complaint_id)])

    def _ticket_messages_schema_v2(self):
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_name = 'ticket_messages'
                      AND column_name = 'author_admin_id'
                )
                """
            )
            return bool(cur.fetchone()[0])

    def _fetch_ticket_messages(self, complaint_id):
        if not self._ticket_messages_schema_v2():
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        tm.id,
                        tm.author_type,
                        tm.author_id,
                        tm.body,
                        tm.created_at,
                        COALESCE(au.display_name, au.email, 'Kullanıcı') AS author_user_name
                    FROM ticket_messages tm
                    LEFT JOIN users au ON au.id = tm.author_id
                    WHERE tm.complaint_id = %s
                    ORDER BY tm.created_at ASC
                    """,
                    [str(complaint_id)],
                )
                rows = cur.fetchall()

            items = []
            for row in rows:
                items.append({
                    "id": str(row[0]),
                    "author_type": row[1],
                    "author_user_id": str(row[2]) if row[2] else None,
                    "author_admin_id": None,
                    "recipient_user_id": None,
                    "recipient_role": "admin",
                    "recipient_label": "Admin",
                    "body": row[3],
                    "created_at": row[4],
                    "author_name": row[5],
                    "recipient_user_name": None,
                })
            return items

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT
                    tm.id,
                    tm.author_type,
                    tm.author_user_id,
                    tm.author_admin_id,
                    tm.recipient_user_id,
                    tm.recipient_role,
                    tm.body,
                    tm.created_at,
                    COALESCE(au.display_name, au.email, 'Kullanıcı') AS author_user_name,
                    COALESCE(NULLIF(trim(concat_ws(' ', aa.name, aa.surname)), ''), aa.email, 'Admin') AS author_admin_name,
                    COALESCE(ru.display_name, ru.email, 'Kullanıcı') AS recipient_user_name
                FROM ticket_messages tm
                LEFT JOIN users au ON au.id = tm.author_user_id
                LEFT JOIN admin_users aa ON aa.id = tm.author_admin_id
                LEFT JOIN users ru ON ru.id = tm.recipient_user_id
                WHERE tm.complaint_id = %s
                ORDER BY tm.created_at ASC
                """,
                [str(complaint_id)],
            )
            rows = cur.fetchall()

        role_labels = {
            "complainant": "Şikayetçi",
            "buyer": "Alıcı",
            "seller": "Satıcı",
            "admin": "Admin",
        }

        items = []
        for row in rows:
            recipient_role = (row[5] or "").strip().lower()
            items.append({
                "id": str(row[0]),
                "author_type": row[1],
                "author_user_id": str(row[2]) if row[2] else None,
                "author_admin_id": str(row[3]) if row[3] else None,
                "recipient_user_id": str(row[4]) if row[4] else None,
                "recipient_role": recipient_role,
                "recipient_label": role_labels.get(recipient_role, recipient_role or "-"),
                "body": row[6],
                "created_at": row[7],
                "author_name": row[9] if row[1] == "admin" else row[8],
                "recipient_user_name": row[10],
            })
        return items

    def _fetch_order_items(self, order_id):
        if not order_id:
            return []

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT
                    oi.id,
                    oi.food_id,
                    oi.quantity,
                    oi.unit_price,
                    oi.line_total,
                    oi.created_at,
                    f.name
                FROM order_items oi
                LEFT JOIN foods f ON f.id = oi.food_id
                WHERE oi.order_id = %s
                ORDER BY oi.created_at ASC
                """,
                [str(order_id)],
            )
            rows = cur.fetchall()

        return [
            {
                "id": str(r[0]),
                "food_id": str(r[1]) if r[1] else None,
                "food_name": r[6] or "Bilinmeyen ürün",
                "quantity": int(r[2] or 0),
                "unit_price": r[3],
                "line_total": r[4],
                "created_at": r[5],
            }
            for r in rows
        ]

    def take_over_view(self, request, complaint_id):
        if request.method != "POST":
            return redirect(self._detail_url(complaint_id))

        admin_actor = _resolve_admin_actor(request)
        if not admin_actor:
            messages.error(request, "Admin kullanıcısı eşleştirilemedi.")
            return redirect(self._detail_url(complaint_id))

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE complaints
                SET assigned_admin_id = %s,
                    status = 'in_review'
                WHERE id = %s
                  AND status = 'open'
                  AND assigned_admin_id IS NULL
                RETURNING id
                """,
                [admin_actor["id"], str(complaint_id)],
            )
            row = cur.fetchone()

        if row:
            messages.success(request, "Şikayet işleme alındı.")
        else:
            messages.info(request, "Bu şikayet daha önce işleme alınmış veya durumu değişmiş.")

        return redirect(self._detail_url(complaint_id))

    def send_message_view(self, request, complaint_id):
        if request.method != "POST":
            return redirect(self._detail_url(complaint_id))

        admin_actor = _resolve_admin_actor(request)
        if not admin_actor:
            messages.error(request, "Admin kullanıcısı eşleştirilemedi.")
            return redirect(self._detail_url(complaint_id))

        message_body = (request.POST.get("message") or "").strip()
        recipient_role = (request.POST.get("recipient_role") or "complainant").strip().lower()

        if not message_body:
            messages.error(request, "Mesaj boş olamaz.")
            return redirect(self._detail_url(complaint_id))

        if recipient_role not in {"complainant", "buyer", "seller"}:
            messages.error(request, "Geçersiz alıcı seçimi.")
            return redirect(self._detail_url(complaint_id))

        complaint = get_object_or_404(Complaints, pk=complaint_id)
        order = Orders.objects.filter(pk=complaint.order_id).first() if complaint.order_id else None

        recipient_user_id = None
        if recipient_role == "complainant":
            recipient_user_id = complaint.complainant_user_id or complaint.complainant_buyer_id
        elif recipient_role == "buyer" and order:
            recipient_user_id = order.buyer_id
        elif recipient_role == "seller" and order:
            recipient_user_id = order.seller_id

        if not recipient_user_id:
            messages.error(request, "Seçilen alıcı bulunamadı.")
            return redirect(self._detail_url(complaint_id))

        if not self._ticket_messages_schema_v2():
            messages.error(
                request,
                "Mesaj gönderimi için ticket_messages v2 migration gerekli (alter_ticket_messages_to_v2.sql).",
            )
            return redirect(self._detail_url(complaint_id))

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ticket_messages (
                    id,
                    complaint_id,
                    author_type,
                    author_user_id,
                    author_admin_id,
                    recipient_user_id,
                    recipient_role,
                    body,
                    created_at
                )
                VALUES (%s, %s, 'admin', NULL, %s, %s, %s, %s, now())
                """,
                [
                    str(uuid.uuid4()),
                    str(complaint_id),
                    admin_actor["id"],
                    str(recipient_user_id),
                    recipient_role,
                    message_body,
                ],
            )

            cur.execute(
                """
                INSERT INTO notification_events (
                    id,
                    user_id,
                    type,
                    title,
                    body,
                    data_json,
                    is_read,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, FALSE, now())
                """,
                [
                    str(uuid.uuid4()),
                    str(recipient_user_id),
                    "complaint_message",
                    f"Şikayet #{complaint.ticket_no}",
                    message_body,
                    json.dumps({
                        "complaintId": str(complaint.id),
                        "ticketNo": complaint.ticket_no,
                        "recipientRole": recipient_role,
                    }, ensure_ascii=False),
                ],
            )

        messages.success(request, "Mesaj gönderildi.")
        return redirect(self._detail_url(complaint_id))

    def add_note_view(self, request, complaint_id):
        if request.method != "POST":
            return redirect(self._detail_url(complaint_id))

        admin_actor = _resolve_admin_actor(request)
        if not admin_actor:
            messages.error(request, "Admin kullanıcısı eşleştirilemedi.")
            return redirect(self._detail_url(complaint_id))

        note = (request.POST.get("note") or "").strip()
        if not note:
            messages.error(request, "Not boş olamaz.")
            return redirect(self._detail_url(complaint_id))

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO complaint_admin_notes (
                    id,
                    complaint_id,
                    note,
                    created_by_admin_id,
                    created_at
                )
                VALUES (%s, %s, %s, %s, now())
                """,
                [
                    str(uuid.uuid4()),
                    str(complaint_id),
                    note,
                    admin_actor["id"],
                ],
            )

        messages.success(request, "Admin notu eklendi.")
        return redirect(self._detail_url(complaint_id))

    def resolve_view(self, request, complaint_id):
        if request.method != "POST":
            return redirect(self._detail_url(complaint_id))

        resolution_note = (request.POST.get("resolution_note") or "").strip()

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE complaints
                SET status = 'closed',
                    resolved_at = COALESCE(resolved_at, now()),
                    resolution_note = COALESCE(NULLIF(%s, ''), resolution_note)
                WHERE id = %s
                  AND status <> 'closed'
                RETURNING id, status
                """,
                [resolution_note, str(complaint_id)],
            )
            row = cur.fetchone()

        if row:
            messages.success(request, "Şikayet kapatıldı.")
        else:
            messages.info(request, "Şikayet zaten kapalı.")

        return redirect(self._detail_url(complaint_id))

    def complaint_detail_view(self, request, complaint_id):
        complaint = get_object_or_404(
            Complaints.objects.select_related(
                "category",
            ),
            pk=complaint_id,
        )

        ticket_messages = self._fetch_ticket_messages(complaint_id)

        admin_notes = list(
            ComplaintAdminNotes.objects
            .filter(complaint_id=complaint_id)
            .order_by("-created_at")
        )

        order = Orders.objects.filter(pk=complaint.order_id).first() if complaint.order_id else None
        order_items = self._fetch_order_items(complaint.order_id)

        complainant_id = complaint.complainant_user_id or complaint.complainant_buyer_id
        complainant = Users.objects.filter(pk=complainant_id).first() if complainant_id else None
        buyer = Users.objects.filter(pk=order.buyer_id).first() if order and getattr(order, "buyer_id", None) else None
        seller = Users.objects.filter(pk=order.seller_id).first() if order and getattr(order, "seller_id", None) else None
        assigned_admin = (
            AdminUsers.objects.filter(pk=complaint.assigned_admin_id).first()
            if complaint.assigned_admin_id
            else None
        )
        assigned_admin_display_name = _admin_display_name(assigned_admin)
        if complaint.assigned_admin_id and not assigned_admin_display_name:
            assigned_admin_display_name = f"Admin #{str(complaint.assigned_admin_id)[:8]}"

        admin_ids = [n.created_by_admin_id for n in admin_notes if n.created_by_admin_id]
        admins = {
            adm.id: adm
            for adm in AdminUsers.objects.filter(id__in=admin_ids)
        }
        for note in admin_notes:
            note.created_by_admin_obj = admins.get(note.created_by_admin_id)

        can_take_over = complaint.status == "open" and complaint.assigned_admin_id is None
        seller_thread_opened = any(
            msg.get("author_type") == "admin" and msg.get("recipient_role") == "seller"
            for msg in ticket_messages
        )

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
            "ticket_messages": ticket_messages,
            "admin_notes": admin_notes,
            "complainant": complainant,
            "buyer": buyer,
            "seller": seller,
            "order": order,
            "order_items": order_items,
            "assigned_admin": assigned_admin,
            "assigned_admin_display_name": assigned_admin_display_name,
            "can_take_over": can_take_over,
            "seller_thread_opened": seller_thread_opened,
            "take_over_url": reverse("admin:complaints_complaints_take_over", args=[str(complaint.id)]),
            "send_message_url": reverse("admin:complaints_complaints_send_message", args=[str(complaint.id)]),
            "add_note_url": reverse("admin:complaints_complaints_add_note", args=[str(complaint.id)]),
            "resolve_url": reverse("admin:complaints_complaints_resolve", args=[str(complaint.id)]),
            "can_resolve": complaint.status not in ("resolved", "closed"),
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
