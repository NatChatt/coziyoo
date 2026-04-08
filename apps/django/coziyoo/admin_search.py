from django.contrib.admin.views.decorators import staff_member_required
from django.db import connection
from django.http import JsonResponse
from django.utils.translation import gettext as _

STATUS_TR = {
    "pending": "Beklemede", "processing": "Hazırlanıyor", "accepted": "Kabul Edildi",
    "delivered": "Teslim Edildi", "completed": "Tamamlandı", "cancelled": "İptal Edildi",
    "rejected": "Reddedildi", "failed": "Başarısız",
    "open": "Açık", "in_review": "İnceleniyor", "resolved": "Çözüldü", "closed": "Kapatıldı",
}

TYPE_TR = {"buyer": "Alıcı", "seller": "Satıcı", "both": "Her İkisi"}


@staff_member_required
def admin_global_search(request):
    q = request.GET.get("q", "").strip()
    if len(q) < 2:
        return JsonResponse({"groups": []})

    like = f"%{q}%"
    groups = []

    with connection.cursor() as cur:
        # ── Users ─────────────────────────────────────────────────────────────
        cur.execute("""
            SELECT id::text, display_name, email, user_type
            FROM users
            WHERE email ILIKE %s OR display_name ILIKE %s OR username ILIKE %s OR phone ILIKE %s
            LIMIT 6
        """, [like, like, like, like])
        users = cur.fetchall()
        if users:
            items = []
            for r in users:
                uid, name, email, utype = r
                if utype == "seller":
                    url = f"/admin/authentication/sellerusers/{uid}/seller-detail/"
                else:
                    url = f"/admin/authentication/buyerusers/{uid}/buyer-detail/"
                items.append({
                    "id": uid,
                    "label": name,
                    "sublabel": email,
                    "badge": TYPE_TR.get(utype, utype),
                    "url": url,
                })
            groups.append({"key": "users", "label": _("Users"), "color": "#2563eb", "items": items})

        # ── Orders ────────────────────────────────────────────────────────────
        cur.execute("""
            SELECT o.id::text, o.status, o.total_price::text,
                   b.display_name AS buyer, s.display_name AS seller
            FROM orders o
            LEFT JOIN users b ON b.id = o.buyer_id
            LEFT JOIN users s ON s.id = o.seller_id
            WHERE o.id::text ILIKE %s OR b.display_name ILIKE %s OR s.display_name ILIKE %s
            LIMIT 5
        """, [like, like, like])
        orders = cur.fetchall()
        if orders:
            items = []
            for r in orders:
                oid, status, price, buyer, seller = r
                items.append({
                    "id": oid,
                    "label": f"#{oid[:8]}… — ₺{price}",
                    "sublabel": f"{buyer or '?'} → {seller or '?'} · {STATUS_TR.get(status, status)}",
                    "badge": STATUS_TR.get(status, status),
                    "url": f"/admin/orders/orders/{oid}/change/",
                })
            groups.append({"key": "orders", "label": _("Orders"), "color": "#7c3aed", "items": items})

        # ── Foods ─────────────────────────────────────────────────────────────
        cur.execute("""
            SELECT f.id::text, f.name, f.price::text, u.display_name AS seller
            FROM foods f LEFT JOIN users u ON u.id = f.seller_id
            WHERE f.name ILIKE %s OR u.display_name ILIKE %s
            LIMIT 5
        """, [like, like])
        foods = cur.fetchall()
        if foods:
            items = []
            for r in foods:
                fid, name, price, seller = r
                items.append({
                    "id": fid,
                    "label": name,
                    "sublabel": f"₺{price} · {seller or '?'}",
                    "badge": "food",
                    "url": f"/admin/foods/foods/{fid}/change/",
                })
            groups.append({"key": "foods", "label": _("Foods"), "color": "#d97706", "items": items})

        # ── Complaints ────────────────────────────────────────────────────────
        cur.execute("""
            SELECT c.id::text, c.status, c.description, u.display_name AS complainant
            FROM complaints c
            LEFT JOIN users u ON u.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
            WHERE c.description ILIKE %s OR u.display_name ILIKE %s OR c.id::text ILIKE %s
            LIMIT 5
        """, [like, like, like])
        complaints = cur.fetchall()
        if complaints:
            items = []
            for r in complaints:
                cid, status, desc, complainant = r
                items.append({
                    "id": cid,
                    "label": (desc or "")[:60] or f"Şikayet #{cid[:8]}",
                    "sublabel": f"{complainant or '?'} · {STATUS_TR.get(status, status)}",
                    "badge": STATUS_TR.get(status, status),
                    "url": f"/admin/complaints/complaints/{cid}/change/",
                })
            groups.append({"key": "complaints", "label": _("Complaints"), "color": "#dc2626", "items": items})

    return JsonResponse({"groups": groups})
