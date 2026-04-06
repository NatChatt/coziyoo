from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response


# ── Permission helper ─────────────────────────────────────────────────────────

def _require_admin(request):
    if not request.user.is_authenticated or request.user.realm != 'admin':
        return Response({"error": {"code": "UNAUTHORIZED", "message": "Admin auth required"}}, status=401)
    return None


# ── Dashboard ─────────────────────────────────────────────────────────────────

class DashboardOverviewView(APIView):
    """GET /v1/admin/dashboard/overview"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT
                  (SELECT COUNT(*) FROM users WHERE is_active=TRUE) as total_users,
                  (SELECT COUNT(*) FROM users WHERE is_active=FALSE) as disabled_users,
                  (SELECT COUNT(*) FROM orders WHERE status NOT IN ('completed','cancelled')) as active_orders,
                  (SELECT COUNT(*) FROM orders WHERE status='pending') as pending_payment_orders,
                  (SELECT COUNT(*) FROM seller_compliance_documents WHERE status='uploaded') as compliance_queue_count,
                  (SELECT COUNT(*) FROM payment_dispute_cases WHERE status='open') as open_dispute_count
                """
            )
            row = cur.fetchone()

        return Response({"data": {
            "totalUsers": row[0],
            "disabledUsers": row[1],
            "activeOrders": row[2],
            "pendingPaymentOrders": row[3],
            "complianceQueueCount": row[4],
            "openDisputeCount": row[5],
        }})


class DashboardReviewQueueView(APIView):
    """GET /v1/admin/dashboard/review-queue"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT scd.id, u.display_name as seller_name, cdl.name as doc_name, scd.uploaded_at
                FROM seller_compliance_documents scd
                JOIN users u ON u.id=scd.seller_id
                JOIN compliance_documents_list cdl ON cdl.id=scd.document_list_id
                WHERE scd.status='uploaded'
                ORDER BY scd.uploaded_at
                LIMIT 10
                """
            )
            compliance_cols = ["id", "sellerName", "docName", "uploadedAt"]
            compliance = []
            for row in cur.fetchall():
                d = dict(zip(compliance_cols, row))
                d["id"] = str(d["id"])
                d["uploadedAt"] = d["uploadedAt"].isoformat() if d["uploadedAt"] else None
                compliance.append(d)

            cur.execute(
                """
                SELECT id, status, priority, description, created_at
                FROM complaints
                WHERE status='open'
                ORDER BY created_at
                LIMIT 10
                """
            )
            complaint_cols = ["id", "status", "priority", "description", "createdAt"]
            complaints = []
            for row in cur.fetchall():
                d = dict(zip(complaint_cols, row))
                d["id"] = str(d["id"])
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                complaints.append(d)

        return Response({"data": {"compliance": compliance, "complaints": complaints}})


# ── Users ─────────────────────────────────────────────────────────────────────

class AdminUserListView(APIView):
    """GET /v1/admin/users"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        search = request.query_params.get("search", "").strip()
        user_type = request.query_params.get("userType", "").strip()
        is_active = request.query_params.get("isActive", "").strip()
        page = max(1, int(request.query_params.get("page", 1)))
        page_size = min(100, max(1, int(request.query_params.get("pageSize", 20))))
        offset = (page - 1) * page_size

        conditions = []
        params = []

        if user_type:
            conditions.append("user_type = %s")
            params.append(user_type)

        if is_active != "":
            conditions.append("is_active = %s")
            params.append(is_active.lower() in ("true", "1", "yes"))

        if search:
            conditions.append("(email ILIKE %s OR display_name ILIKE %s)")
            like = f"%{search}%"
            params.extend([like, like])

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, email, display_name, username, user_type, is_active, created_at, last_login_at
                FROM users
                {where_clause}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                params + [page_size, offset],
            )
            cols = ["id", "email", "displayName", "username", "userType", "isActive", "createdAt", "lastLoginAt"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                d["lastLoginAt"] = d["lastLoginAt"].isoformat() if d["lastLoginAt"] else None
                rows.append(d)

            cur.execute(
                f"SELECT COUNT(*) FROM users {where_clause}",
                params,
            )
            total = cur.fetchone()[0]

        return Response({"data": {
            "users": rows,
            "pagination": {"page": page, "pageSize": page_size, "total": total},
        }})


class AdminUserDetailView(APIView):
    """GET /v1/admin/users/:user_id"""

    def get(self, request, user_id):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, display_name, username, user_type, is_active, created_at,
                       kitchen_title, average_rating, review_count
                FROM users WHERE id=%s
                """,
                [user_id],
            )
            row = cur.fetchone()

        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "User not found"}}, status=404)

        cols = ["id", "email", "displayName", "username", "userType", "isActive", "createdAt",
                "kitchenTitle", "averageRating", "reviewCount"]
        d = dict(zip(cols, row))
        d["id"] = str(d["id"])
        d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None

        return Response({"data": d})


# ── Investigations ────────────────────────────────────────────────────────────

class InvestigationComplaintListView(APIView):
    """GET /v1/admin/investigations/complaints"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        status_filter = request.query_params.get("status", "").strip()
        page = max(1, int(request.query_params.get("page", 1)))
        offset = (page - 1) * 20

        conditions = []
        params = []

        if status_filter:
            conditions.append("c.status = %s")
            params.append(status_filter)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT c.id, c.status, c.priority, c.description, c.created_at, c.ticket_no,
                       cc.name as category_name,
                       u.display_name as complainant_name
                FROM complaints c
                LEFT JOIN complaint_categories cc ON cc.id=c.category_id
                LEFT JOIN users u ON u.id=c.complainant_user_id
                {where_clause}
                ORDER BY c.created_at DESC
                LIMIT 20 OFFSET %s
                """,
                params + [offset],
            )
            cols = ["id", "status", "priority", "description", "createdAt",
                    "ticketNo", "categoryName", "complainantName"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                rows.append(d)

        return Response({"data": {"complaints": rows, "pagination": {"page": page}}})


class InvestigationComplaintDetailView(APIView):
    """GET /v1/admin/investigations/complaints/:id, PATCH /v1/admin/investigations/complaints/:id"""

    def get(self, request, complaint_id):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT c.*, cc.name as category_name, u.display_name as complainant_name
                FROM complaints c
                LEFT JOIN complaint_categories cc ON cc.id=c.category_id
                LEFT JOIN users u ON u.id=c.complainant_user_id
                WHERE c.id=%s
                """,
                [complaint_id],
            )
            row = cur.fetchone()
            if not row:
                return Response({"error": {"code": "NOT_FOUND", "message": "Complaint not found"}}, status=404)
            col_names = [desc[0] for desc in cur.description]

        d = dict(zip(col_names, row))
        d["id"] = str(d["id"])
        for key in ("created_at", "updated_at", "resolved_at"):
            if key in d and d[key]:
                d[key] = d[key].isoformat()

        return Response({"data": d})

    def patch(self, request, complaint_id):
        err = _require_admin(request)
        if err:
            return err

        status = request.data.get("status")
        priority = request.data.get("priority")
        resolution_notes = request.data.get("resolutionNotes", "")

        if not status and not priority:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Provide at least status or priority"}},
                status=400,
            )

        fields = []
        values = []

        if status:
            fields.append("status=%s")
            values.append(status)
        if priority:
            fields.append("priority=%s")
            values.append(priority)

        fields.append("resolution_notes=%s")
        values.append(resolution_notes)
        fields.append("updated_at=now()")
        values.append(complaint_id)

        with connection.cursor() as cur:
            cur.execute(
                f"UPDATE complaints SET {', '.join(fields)} WHERE id=%s RETURNING id",
                values,
            )
            row = cur.fetchone()

        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "Complaint not found"}}, status=404)

        return Response({"data": {"id": str(row[0])}})


class ComplaintCategoryView(APIView):
    """GET /v1/admin/investigations/complaint-categories, POST /v1/admin/investigations/complaint-categories"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                "SELECT id, name, description FROM complaint_categories ORDER BY name"
            )
            cols = ["id", "name", "description"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                rows.append(d)

        return Response({"data": rows})

    def post(self, request):
        err = _require_admin(request)
        if err:
            return err

        name = request.data.get("name")
        description = request.data.get("description", "")

        if not name:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "name is required"}},
                status=400,
            )

        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO complaint_categories (name, description) VALUES (%s, %s) RETURNING id",
                [name, description],
            )
            row = cur.fetchone()

        return Response({"data": {"id": str(row[0])}}, status=201)


# ── Audit ─────────────────────────────────────────────────────────────────────

class AuditEventsView(APIView):
    """GET /v1/admin/audit/events"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        page = max(1, int(request.query_params.get("page", 1)))
        limit = min(200, max(1, int(request.query_params.get("limit", 50))))
        offset = (page - 1) * limit

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, actor_type, actor_id, event_type, entity_type, entity_id, created_at
                FROM admin_audit_logs
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                [limit, offset],
            )
            cols = ["id", "actorType", "actorId", "eventType", "entityType", "entityId", "createdAt"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["actorId"] = str(d["actorId"]) if d["actorId"] else None
                d["entityId"] = str(d["entityId"]) if d["entityId"] else None
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                rows.append(d)

        return Response({"data": {"events": rows, "pagination": {"page": page, "limit": limit}}})


# ── Security ──────────────────────────────────────────────────────────────────

class SecurityLoginEventsView(APIView):
    """GET /v1/admin/security/login-events"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, identifier, ip_address, result, created_at
                FROM security_login_events
                ORDER BY created_at DESC
                LIMIT 100
                """
            )
            cols = ["id", "identifier", "ipAddress", "result", "createdAt"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                rows.append(d)

        return Response({"data": rows})


# ── Global Search ─────────────────────────────────────────────────────────────

class GlobalSearchView(APIView):
    """GET /v1/admin/search/global?q=...&limit=12"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        q = request.query_params.get("q", "").strip()
        limit = min(50, max(1, int(request.query_params.get("limit", 12))))

        if not q:
            return Response({"data": {"results": []}})

        like = f"%{q}%"

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT 'user' as kind, id::text, email as label, display_name as sublabel
                FROM users WHERE email ILIKE %s OR display_name ILIKE %s LIMIT 4

                UNION ALL

                SELECT 'order' as kind, id::text, status as label, total_price::text as sublabel
                FROM orders WHERE id::text ILIKE %s LIMIT 4

                UNION ALL

                SELECT 'food' as kind, id::text, name as label, '' as sublabel
                FROM foods WHERE name ILIKE %s LIMIT 4
                """,
                [like, like, like, like],
            )
            cols = ["kind", "id", "label", "sublabel"]
            results = [dict(zip(cols, row)) for row in cur.fetchall()]

        return Response({"data": {"results": results[:limit]}})


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationTestView(APIView):
    """POST /v1/admin/notifications/test"""

    def post(self, request):
        err = _require_admin(request)
        if err:
            return err

        return Response({"data": {"success": True}})
