import json

from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import path
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from .models import Orders, OrderItems, OrderEvents, Reviews


def _order_admin_detail(order_id_str):
    """Return a rich JSON dict for the admin order detail panel."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT
                o.id, o.status, o.delivery_type, o.total_price, o.created_at,
                o.delivery_address_json, o.seller_delivery_note, o.payment_completed,
                o.requested_delivery_type, o.active_delivery_type, o.seller_decision_state,
                o.seller_eta_minutes, o.seller_promised_at,
                o.buyer_id, o.seller_id,
                b.display_name AS buyer_name,
                s.display_name AS seller_name
            FROM orders o
            LEFT JOIN users b ON b.id = o.buyer_id
            LEFT JOIN users s ON s.id = o.seller_id
            WHERE o.id = %s
            """,
            [order_id_str],
        )
        row = cur.fetchone()

    if not row:
        return None

    (oid, status, delivery_type, total_price, created_at,
     addr_json, delivery_note, payment_completed,
     requested_delivery_type, active_delivery_type, seller_decision_state,
     seller_eta_minutes, seller_promised_at,
     buyer_id, seller_id,
     buyer_name, seller_name) = row

    addr = addr_json if isinstance(addr_json, dict) else (json.loads(addr_json) if addr_json else {})

    with connection.cursor() as cur:
        # Messages/notes from order_events
        cur.execute(
            """
            SELECT oe.event_type, oe.payload_json, oe.created_at, u.display_name
            FROM order_events oe
            LEFT JOIN users u ON u.id = oe.actor_user_id
            WHERE oe.order_id = %s AND oe.event_type IN ('buyer_note', 'seller_note')
            ORDER BY oe.created_at ASC
            """,
            [order_id_str],
        )
        note_rows = cur.fetchall()

        # Chat messages linked to this order (buyer <-> seller conversation)
        cur.execute(
            """
            SELECT
                COALESCE(NULLIF(m.sender_type, ''), '') AS sender_type,
                m.message,
                m.message_type,
                m.created_at,
                u.display_name
            FROM chats c
            JOIN messages m ON m.chat_id = c.id
            LEFT JOIN users u ON u.id = m.sender_id
            WHERE c.order_id = %s
            ORDER BY m.created_at ASC
            """,
            [order_id_str],
        )
        chat_rows = cur.fetchall()

        # Status timeline from order_events
        cur.execute(
            """
            SELECT to_status, created_at
            FROM order_events
            WHERE order_id = %s AND event_type LIKE 'status_changed_to_%%'
            ORDER BY created_at ASC
            """,
            [order_id_str],
        )
        status_rows = cur.fetchall()

        # PIN proof record
        cur.execute(
            """
            SELECT status, verification_attempts, pin_sent_at, pin_verified_at
            FROM delivery_proof_records
            WHERE order_id = %s
            """,
            [order_id_str],
        )
        proof_row = cur.fetchone()

    messages = []
    for event_type, payload_json, ts, display_name in note_rows:
        payload = payload_json if isinstance(payload_json, dict) else (json.loads(payload_json) if payload_json else {})
        messages.append({
            "role": "buyer" if event_type == "buyer_note" else "seller",
            "sender": display_name or "",
            "message": payload.get("message", ""),
            "_ts": ts,
        })

    for sender_type, message_text, message_type, ts, display_name in chat_rows:
        normalized_sender_type = str(sender_type or "").strip().lower()
        role = "seller" if normalized_sender_type == "seller" else "buyer"
        text = (message_text or "").strip()
        if not text:
            mt = str(message_type or "").strip()
            text = f"[{mt}]" if mt else ""
        messages.append({
            "role": role,
            "sender": display_name or "",
            "message": text,
            "_ts": ts,
        })

    messages.sort(key=lambda item: item.get("_ts") or 0)
    for item in messages:
        ts = item.pop("_ts", None)
        item["createdAt"] = ts.strftime("%d.%m.%Y %H:%M") if ts else None

    STATUS_STEPS = [
        ("preparing", "Hazırlanıyor"),
        ("ready", "Hazırladım"),
        ("in_delivery", "Yoldayım"),
        ("approaching", "Geliyorum"),
        ("at_door", "Kapıdayım"),
        ("delivered", "Teslim Edildi"),
        ("completed", "Tamamlandı"),
    ]
    reached = {s for s, _ in status_rows}
    timeline = [
        {"status": s, "label": label, "reached": s in reached}
        for s, label in STATUS_STEPS
    ]

    proof = None
    if proof_row:
        proof = {
            "status": proof_row[0],
            "verificationAttempts": proof_row[1],
            "pinSentAt": proof_row[2].strftime("%d.%m.%Y %H:%M") if proof_row[2] else None,
            "pinVerifiedAt": proof_row[3].strftime("%d.%m.%Y %H:%M") if proof_row[3] else None,
        }

    return {
        "id": str(oid),
        "status": status,
        "deliveryType": delivery_type,
        "requestedDeliveryType": requested_delivery_type,
        "activeDeliveryType": active_delivery_type,
        "sellerDecisionState": seller_decision_state,
        "totalPrice": str(total_price),
        "sellerEtaMinutes": seller_eta_minutes,
        "sellerPromisedAt": seller_promised_at.strftime("%d.%m.%Y %H:%M") if seller_promised_at else None,
        "paymentCompleted": payment_completed,
        "buyerName": buyer_name,
        "sellerName": seller_name,
        "deliveryAddress": {
            "title": addr.get("title"),
            "addressLine": addr.get("addressLine") or addr.get("line"),
            "distanceKm": addr.get("distanceKm"),
        } if addr else None,
        "deliveryNote": delivery_note,
        "messages": messages,
        "timeline": timeline,
        "proof": proof,
        "createdAt": created_at.strftime("%d.%m.%Y %H:%M") if created_at else None,
    }


class OrderItemsInline(TabularInline):
    model = OrderItems
    extra = 0
    can_delete = False
    readonly_fields = ["id", "food_id", "quantity", "unit_price", "line_total", "created_at"]
    fields = ["food_id", "quantity", "unit_price", "line_total"]

    def has_add_permission(self, request, obj=None):
        return False


class OrderEventsInline(TabularInline):
    model = OrderEvents
    extra = 0
    can_delete = False
    readonly_fields = ["event_type", "actor_user", "from_status", "to_status", "payload_json", "created_at"]
    fields = ["event_type", "from_status", "to_status", "actor_user", "created_at"]

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Orders)
class OrdersAdmin(ModelAdmin):
    list_display = [
        "full_order_id", "status_badge", "buyer", "seller",
        "total_price", "delivery_type", "payment_completed", "created_at",
    ]
    list_select_related = ["buyer", "seller"]
    list_filter = ["status", "delivery_type", "payment_completed", "seller_decision_state"]
    search_fields = ["buyer__email", "buyer__display_name", "seller__display_name"]
    readonly_fields = [
        "id", "buyer", "seller", "status", "total_price", "delivery_type",
        "payment_completed", "requested_delivery_type", "active_delivery_type",
        "seller_decision_state", "seller_eta_minutes", "seller_promised_at",
        "seller_delivery_note", "approved_at", "payment_captured_at",
        "created_at", "updated_at",
    ]
    ordering = ["-created_at"]
    inlines = [OrderItemsInline, OrderEventsInline]
    list_per_page = 50

    fieldsets = [
        ("Order", {"fields": ["id", "status", "buyer", "seller", "total_price"]}),
        ("Delivery", {"fields": ["delivery_type", "requested_delivery_type", "active_delivery_type",
                                 "seller_delivery_note", "seller_eta_minutes", "seller_promised_at"]}),
        ("Payment", {"fields": ["payment_completed", "payment_captured_at", "approved_at"]}),
        ("State", {"fields": ["seller_decision_state"]}),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]

    def has_add_permission(self, request):
        return False

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                "<uuid:order_id>/live-detail/",
                self.admin_site.admin_view(self._live_detail_view),
                name="orders_orders_live_detail",
            ),
        ]
        return custom + urls

    def _live_detail_view(self, request, order_id):
        data = _order_admin_detail(str(order_id))
        if data is None:
            return JsonResponse({"error": "Not found"}, status=404)
        return JsonResponse(data)

    @display(description="Sipariş No", ordering="id")
    def full_order_id(self, obj):
        return str(obj.id)

    @display(description="Status", ordering="status")
    def status_badge(self, obj):
        colors = {
            "pending": "#d97706", "preparing": "#2563eb", "ready": "#7c3aed",
            "in_delivery": "#0891b2", "delivered": "#16a34a",
            "completed": "#16a34a", "cancelled": "#dc2626",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.status,
        )


@admin.register(Reviews)
class ReviewsAdmin(ModelAdmin):
    list_display = ["buyer", "seller", "food", "rating_stars", "created_at"]
    list_select_related = ["buyer", "seller", "food"]
    list_filter = ["rating"]
    search_fields = ["buyer__email", "seller__display_name", "food__name"]
    readonly_fields = ["id", "buyer", "seller", "food", "order", "rating",
                       "comment", "helpful_count", "report_count", "created_at"]
    ordering = ["-created_at"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @display(description="Rating")
    def rating_stars(self, obj):
        stars = "★" * obj.rating + "☆" * (5 - obj.rating)
        return format_html('<span style="color:#d97706">{}</span>', stars)
