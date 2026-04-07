from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response


def _require_admin(request):
    if not request.user.is_authenticated or request.user.realm != 'admin':
        return Response({"error": {"code": "UNAUTHORIZED", "message": "Admin auth required"}}, status=401)
    return None


def _rows(cursor):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardOverviewView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute("""
                SELECT
                  (SELECT COUNT(*) FROM users) as total_users,
                  (SELECT COUNT(*) FROM users WHERE is_active=FALSE) as disabled_users,
                  (SELECT COUNT(*) FROM orders WHERE status NOT IN ('completed','cancelled')) as active_orders,
                  (SELECT COUNT(*) FROM orders WHERE status='pending') as pending_payment_orders,
                  (SELECT COUNT(*) FROM seller_compliance_documents WHERE status='uploaded') as compliance_queue_count,
                  (SELECT COUNT(*) FROM payment_dispute_cases WHERE status='open') as open_dispute_count
            """)
            row = cur.fetchone()
            cols = [d[0] for d in cur.description]
        return Response({"data": dict(zip(cols, row))})


class DashboardReviewQueueView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute("""
                SELECT scd.id::text, u.display_name as seller_name, cdl.name as doc_name,
                       scd.uploaded_at
                FROM seller_compliance_documents scd
                JOIN users u ON u.id=scd.seller_id
                JOIN compliance_documents_list cdl ON cdl.id=scd.document_list_id
                WHERE scd.status='uploaded' ORDER BY scd.uploaded_at LIMIT 10
            """)
            compliance = []
            for row in cur.fetchall():
                compliance.append({"id": row[0], "sellerName": row[1], "docName": row[2],
                                   "uploadedAt": row[3].isoformat() if row[3] else None})

            cur.execute("""
                SELECT id::text, status, priority, description, created_at
                FROM complaints WHERE status='open' ORDER BY created_at LIMIT 10
            """)
            complaints = []
            for row in cur.fetchall():
                complaints.append({"id": row[0], "status": row[1], "priority": row[2],
                                   "description": row[3], "createdAt": row[4].isoformat() if row[4] else None})

        return Response({"data": {"compliance": compliance, "complaints": complaints}})


# ── Users ─────────────────────────────────────────────────────────────────────

class AdminUserListView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        search = request.query_params.get("search", "").strip()
        user_type = (request.query_params.get("userType") or request.query_params.get("audience") or "").strip()
        is_active_param = request.query_params.get("isActive", "").strip()
        page = max(1, int(request.query_params.get("page", 1)))
        page_size = min(100, max(1, int(request.query_params.get("pageSize", 20))))
        offset = (page - 1) * page_size

        conditions, params = [], []
        if user_type:
            conditions.append("user_type = %s"); params.append(user_type)
        if is_active_param:
            conditions.append("is_active = %s"); params.append(is_active_param.lower() in ("true", "1"))
        if search:
            conditions.append("(email ILIKE %s OR display_name ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%"])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with connection.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM users {where}", params)
            total = cur.fetchone()[0]
            cur.execute(
                f"SELECT id, email, display_name, username, user_type, is_active, created_at "
                f"FROM users {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
                params + [page_size, offset]
            )
            rows = []
            for r in cur.fetchall():
                rows.append({"id": str(r[0]), "email": r[1], "displayName": r[2], "username": r[3],
                             "userType": r[4], "isActive": r[5],
                             "createdAt": r[6].isoformat() if r[6] else None})

        return Response({
            "data": rows,
            "pagination": {"page": page, "pageSize": page_size, "total": total, "totalPages": -(-total // page_size)},
        })


class AdminUserDetailView(APIView):
    def get(self, request, user_id):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id, email, display_name, username, user_type, is_active, created_at, kitchen_title "
                "FROM users WHERE id=%s", [user_id]
            )
            row = cur.fetchone()
        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "User not found"}}, status=404)
        return Response({"data": {
            "id": str(row[0]), "email": row[1], "displayName": row[2], "username": row[3],
            "userType": row[4], "isActive": row[5],
            "createdAt": row[6].isoformat() if row[6] else None,
            "kitchenTitle": row[7],
        }})


# ── Investigations ────────────────────────────────────────────────────────────

class InvestigationComplaintListView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        status_filter = request.query_params.get("status", "").strip()
        page = max(1, int(request.query_params.get("page", 1)))
        offset = (page - 1) * 20

        conditions, params = [], []
        if status_filter:
            conditions.append("c.status = %s"); params.append(status_filter)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with connection.cursor() as cur:
            cur.execute(f"""
                SELECT c.id, c.status, c.priority, c.description, c.created_at, c.ticket_no,
                       cc.name as category_name, u.display_name as complainant_name
                FROM complaints c
                LEFT JOIN complaint_categories cc ON cc.id=c.category_id
                LEFT JOIN users u ON u.id=c.complainant_user_id
                {where} ORDER BY c.created_at DESC LIMIT 20 OFFSET %s
            """, params + [offset])
            rows = []
            for r in cur.fetchall():
                rows.append({"id": str(r[0]), "status": r[1], "priority": r[2], "description": r[3],
                             "createdAt": r[4].isoformat() if r[4] else None, "ticketNo": r[5],
                             "categoryName": r[6], "complainantName": r[7]})

        return Response({"data": {"complaints": rows, "pagination": {"page": page}}})


class InvestigationComplaintDetailView(APIView):
    def get(self, request, complaint_id):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute("""
                SELECT c.id, c.status, c.priority, c.description, c.created_at, c.ticket_no,
                       c.resolution_note, cc.name as category_name, u.display_name as complainant_name
                FROM complaints c
                LEFT JOIN complaint_categories cc ON cc.id=c.category_id
                LEFT JOIN users u ON u.id=c.complainant_user_id
                WHERE c.id=%s
            """, [complaint_id])
            row = cur.fetchone()
        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "Complaint not found"}}, status=404)
        return Response({"data": {
            "id": str(row[0]), "status": row[1], "priority": row[2], "description": row[3],
            "createdAt": row[4].isoformat() if row[4] else None, "ticketNo": row[5],
            "resolutionNote": row[6], "categoryName": row[7], "complainantName": row[8],
        }})

    def patch(self, request, complaint_id):
        err = _require_admin(request)
        if err:
            return err

        fields, values = [], []
        if request.data.get("status"):
            fields.append("status=%s"); values.append(request.data["status"])
        if request.data.get("priority"):
            fields.append("priority=%s"); values.append(request.data["priority"])
        if "resolutionNote" in request.data:
            fields.append("resolution_note=%s"); values.append(request.data["resolutionNote"])

        if not fields:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "No fields to update"}}, status=400)

        fields.append("updated_at=now()")
        values.append(complaint_id)
        with connection.cursor() as cur:
            cur.execute(f"UPDATE complaints SET {', '.join(fields)} WHERE id=%s RETURNING id", values)
            row = cur.fetchone()
        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "Complaint not found"}}, status=404)
        return Response({"data": {"id": str(row[0])}})


class ComplaintCategoryView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute("SELECT id, code, name FROM complaint_categories WHERE is_active=TRUE ORDER BY name")
            rows = [{"id": str(r[0]), "code": r[1], "name": r[2]} for r in cur.fetchall()]
        return Response({"data": rows})

    def post(self, request):
        err = _require_admin(request)
        if err:
            return err
        name = request.data.get("name")
        code = request.data.get("code", name.lower().replace(" ", "_") if name else "")
        if not name:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "name required"}}, status=400)
        with connection.cursor() as cur:
            cur.execute("INSERT INTO complaint_categories (code, name) VALUES (%s, %s) RETURNING id", [code, name])
            new_id = cur.fetchone()[0]
        return Response({"data": {"id": str(new_id)}}, status=201)


# ── Audit ─────────────────────────────────────────────────────────────────────

class AuditEventsView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        page = max(1, int(request.query_params.get("page", 1)))
        limit = min(200, max(1, int(request.query_params.get("limit", 50))))
        offset = (page - 1) * limit
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id, actor_admin_id, actor_email, actor_role, action, entity_type, entity_id, created_at
                FROM admin_audit_logs ORDER BY created_at DESC LIMIT %s OFFSET %s
            """, [limit, offset])
            rows = []
            for r in cur.fetchall():
                rows.append({"id": str(r[0]), "actorAdminId": str(r[1]) if r[1] else None,
                             "actorEmail": r[2], "actorRole": r[3], "action": r[4],
                             "entityType": r[5], "entityId": str(r[6]) if r[6] else None,
                             "createdAt": r[7].isoformat() if r[7] else None})
        return Response({"data": {"events": rows, "pagination": {"page": page, "limit": limit}}})


# ── Security ──────────────────────────────────────────────────────────────────

class SecurityLoginEventsView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id, identifier, success, ip, created_at
                FROM security_login_events ORDER BY created_at DESC LIMIT 100
            """)
            rows = []
            for r in cur.fetchall():
                rows.append({"id": str(r[0]), "identifier": r[1], "success": r[2],
                             "ip": r[3], "createdAt": r[4].isoformat() if r[4] else None})
        return Response({"data": rows})


# ── Global Search ─────────────────────────────────────────────────────────────

class GlobalSearchView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        q = request.query_params.get("q", "").strip()
        limit = min(50, max(1, int(request.query_params.get("limit", 12))))
        if not q:
            return Response({"data": {"results": []}})
        like = f"%{q}%"
        results = []
        with connection.cursor() as cur:
            cur.execute("SELECT id::text, email, display_name FROM users WHERE email ILIKE %s OR display_name ILIKE %s LIMIT 4", [like, like])
            for r in cur.fetchall():
                results.append({"kind": "user", "id": r[0], "label": r[1], "sublabel": r[2]})
            cur.execute("SELECT id::text, status, total_price::text FROM orders WHERE id::text ILIKE %s LIMIT 4", [like])
            for r in cur.fetchall():
                results.append({"kind": "order", "id": r[0], "label": r[1], "sublabel": r[2]})
            cur.execute("SELECT id::text, name FROM foods WHERE name ILIKE %s LIMIT 4", [like])
            for r in cur.fetchall():
                results.append({"kind": "food", "id": r[0], "label": r[1], "sublabel": ""})
        return Response({"data": {"results": results[:limit]}})


# ── Sellers Daily Sales ───────────────────────────────────────────────────────

class SellersDailySalesView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        with connection.cursor() as cur:
            cur.execute("""
                SELECT COALESCE(sum(o.total_price), 0)::text AS daily_sales
                FROM orders o
                JOIN users s ON s.id = o.seller_id
                WHERE o.payment_completed = TRUE
                  AND o.created_at >= date_trunc('day', now())
                  AND o.created_at < (date_trunc('day', now()) + interval '1 day')
                  AND s.user_type IN ('seller', 'both')
            """)
            row = cur.fetchone()
        from datetime import date
        return Response({"data": {"dailySales": float(row[0] or 0), "currency": "TRY", "date": date.today().isoformat()}})


# ── Notifications Test ────────────────────────────────────────────────────────

class NotificationTestView(APIView):
    def post(self, request):
        err = _require_admin(request)
        if err:
            return err
        return Response({"data": {"success": True}})
