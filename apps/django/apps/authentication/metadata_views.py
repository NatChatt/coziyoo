import re
import subprocess
from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response

from .admin_views import _require_admin

TABLE_MAP = {
    "users": "users",
    "adminUsers": "admin_users",
    "foods": "foods",
    "categories": "categories",
    "orders": "orders",
    "complaints": "complaints",
    "orderItems": "order_items",
    "orderEvents": "order_events",
    "paymentAttempts": "payment_attempts",
    "complianceDocumentsList": "compliance_documents_list",
    "sellerComplianceDocuments": "seller_compliance_documents",
    "productionLots": "production_lots",
    "lotEvents": "lot_events",
    "orderItemLotAllocations": "order_item_lot_allocations",
    "paymentDisputeCases": "payment_dispute_cases",
    "orderFinance": "order_finance",
    "sellerBankAccounts": "seller_bank_accounts",
    "sellerLedgerEntries": "seller_ledger_entries",
    "sellerPayoutBatches": "seller_payout_batches",
    "adminAuditLogs": "admin_audit_logs",
    "idempotencyKeys": "idempotency_keys",
    "outboxEvents": "outbox_events",
}

SENSITIVE_EXACT = {"password_hash", "refresh_token_hash", "pin_hash", "checksum", "signature"}
SENSITIVE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in [r"password", r"token", r"secret", r"hash", r"signature", r"otp", r"pin"]]
INTERNAL_PATTERNS = [re.compile(p, re.IGNORECASE) for p in [r"ip$", r"user_agent$", r"metadata_json$", r"payload_json$"]]
EXCLUDED_COLS = {"short_id"}

TABLE_EXCLUDED_COLUMNS = {
    "orderItems": {"id", "order_id"},
}

_column_cache = {}


def _sensitivity(name):
    if name in SENSITIVE_EXACT:
        return "secret"
    if any(p.search(name) for p in SENSITIVE_PATTERNS):
        return "secret"
    if any(p.search(name) for p in INTERNAL_PATTERNS):
        return "internal"
    return "public"


def _load_columns(table_name):
    if table_name in _column_cache:
        return _column_cache[table_name]
    with connection.cursor() as cur:
        cur.execute(
            """SELECT column_name, data_type, is_nullable
               FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = %s
               ORDER BY ordinal_position""",
            [table_name],
        )
        rows = cur.fetchall()
    result = [
        {"name": r[0], "type": r[1], "nullable": r[2] == "YES", "sensitivity": _sensitivity(r[0])}
        for r in rows
    ]
    _column_cache[table_name] = result
    return result


def _visible_columns(fields):
    return [f["name"] for f in fields if f["sensitivity"] != "secret" and f["name"] not in EXCLUDED_COLS]


def _quote_ident(name):
    return '"' + name.replace('"', '""') + '"'


class AdminSystemVersionView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        try:
            commit = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
            ).decode().strip()
        except Exception:
            commit = "unknown"
        return Response({"data": {"commit": commit, "environment": "production"}})


class AdminMetadataEntitiesView(APIView):
    def get(self, request):
        err = _require_admin(request)
        if err:
            return err
        entities = [{"tableKey": k, "tableName": v} for k, v in TABLE_MAP.items()]
        return Response({"data": entities})


class AdminMetadataFieldsView(APIView):
    def get(self, request, table_key):
        err = _require_admin(request)
        if err:
            return err
        if table_key not in TABLE_MAP:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Invalid tableKey"}}, status=400)
        table_name = TABLE_MAP[table_key]
        fields = _load_columns(table_name)

        with connection.cursor() as cur:
            cur.execute(
                """SELECT a.attname
                   FROM pg_index i
                   JOIN pg_class c ON c.oid = i.indrelid
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
                   WHERE i.indisprimary AND n.nspname = 'public' AND c.relname = %s""",
                [table_name],
            )
            primary_keys = {r[0] for r in cur.fetchall()}

            cur.execute(f"SELECT row_to_json(t) FROM (SELECT * FROM public.{_quote_ident(table_name)} LIMIT 1) t")
            row = cur.fetchone()
        raw_record = row[0] if row else None

        visible = _visible_columns(fields)
        raw_fallback = (
            {k: v for k, v in raw_record.items() if k in visible} if raw_record else None
        )

        return Response({
            "data": {
                "tableKey": table_key,
                "tableName": table_name,
                "fields": [
                    {
                        "name": f["name"],
                        "type": f["type"],
                        "nullable": f["nullable"],
                        "sensitivity": f["sensitivity"],
                        "displayable": f["sensitivity"] != "secret",
                        "sortable": True,
                        "filterable": True,
                        "isPrimaryKey": f["name"] in primary_keys,
                    }
                    for f in fields
                    if f["name"] not in EXCLUDED_COLS
                ],
                "rawRecordFallback": raw_fallback,
            }
        })


class AdminMetadataRecordsView(APIView):
    def get(self, request, table_key):
        err = _require_admin(request)
        if err:
            return err
        if table_key not in TABLE_MAP:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Invalid tableKey"}}, status=400)
        table_name = TABLE_MAP[table_key]

        try:
            page = max(1, int(request.query_params.get("page", 1)))
            page_size = min(100, max(1, int(request.query_params.get("pageSize", 20))))
        except (ValueError, TypeError):
            return Response({"error": {"code": "PAGINATION_INVALID"}}, status=400)

        sort_dir = "DESC" if request.query_params.get("sortDir", "desc") == "desc" else "ASC"
        search = request.query_params.get("search", "").strip() or None

        fields = _load_columns(table_name)
        excluded = TABLE_EXCLUDED_COLUMNS.get(table_key, set())
        columns = [c for c in _visible_columns(fields) if c not in excluded]
        if not columns:
            return Response({"error": {"code": "TABLE_NOT_FOUND"}}, status=404)

        default_sort = "created_at" if "created_at" in columns else columns[0]
        sort_by_input = request.query_params.get("sortBy", default_sort)
        if sort_by_input not in columns:
            sort_by_input = default_sort
        sort_col = _quote_ident(sort_by_input)
        offset = (page - 1) * page_size

        with connection.cursor() as cur:
            if search:
                where = "WHERE row_to_json(t)::text ILIKE %s"
                params_count = [f"%{search}%"]
                params_list = [f"%{search}%", page_size, offset]
            else:
                where = ""
                params_count = []
                params_list = [page_size, offset]

            cur.execute(
                f"SELECT count(*)::text FROM (SELECT * FROM public.{_quote_ident(table_name)}) t {where}",
                params_count,
            )
            total = int(cur.fetchone()[0])

            cur.execute(
                f"""SELECT * FROM (SELECT * FROM public.{_quote_ident(table_name)}) t
                    {where}
                    ORDER BY {sort_col} {sort_dir}
                    LIMIT %s OFFSET %s""",
                params_list,
            )
            col_names = [d[0] for d in cur.description]
            rows = [
                {col_names[i]: row[i] for i in range(len(col_names)) if col_names[i] in columns}
                for row in cur.fetchall()
            ]

        return Response({
            "data": {"tableKey": table_key, "tableName": table_name, "rows": rows, "columns": columns},
            "pagination": {
                "mode": "offset",
                "page": page,
                "pageSize": page_size,
                "total": total,
                "totalPages": -(-total // page_size),
            },
        })


class AdminTablePreferencesView(APIView):
    def get(self, request, table_key):
        err = _require_admin(request)
        if err:
            return err
        if table_key not in TABLE_MAP:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Invalid tableKey"}}, status=400)

        fields = _load_columns(TABLE_MAP[table_key])
        defaults = _visible_columns(fields)

        with connection.cursor() as cur:
            cur.execute(
                """SELECT visible_columns, column_order, updated_at::text
                   FROM admin_table_preferences
                   WHERE admin_user_id = %s AND table_key = %s""",
                [str(request.user.id), table_key],
            )
            row = cur.fetchone()

        if not row:
            return Response({"data": {"tableKey": table_key, "visibleColumns": defaults, "columnOrder": defaults, "isDefault": True}})

        visible = row[0] if isinstance(row[0], list) else defaults
        order = row[1] if isinstance(row[1], list) else visible
        return Response({"data": {"tableKey": table_key, "visibleColumns": visible, "columnOrder": order, "updatedAt": row[2], "isDefault": False}})

    def put(self, request, table_key):
        err = _require_admin(request)
        if err:
            return err
        if table_key not in TABLE_MAP:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Invalid tableKey"}}, status=400)

        visible = request.data.get("visibleColumns", [])
        order = request.data.get("columnOrder", visible)
        if not isinstance(visible, list) or not visible:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "visibleColumns required"}}, status=400)

        fields = _load_columns(TABLE_MAP[table_key])
        allowed = set(_visible_columns(fields))
        visible = [c for c in visible if c in allowed] or list(allowed)
        order = [c for c in order if c in set(visible)] or visible

        with connection.cursor() as cur:
            import json
            cur.execute(
                """INSERT INTO admin_table_preferences (admin_user_id, table_key, visible_columns, column_order, updated_at)
                   VALUES (%s, %s, %s::jsonb, %s::jsonb, NOW())
                   ON CONFLICT (admin_user_id, table_key)
                   DO UPDATE SET visible_columns = EXCLUDED.visible_columns,
                                 column_order = EXCLUDED.column_order,
                                 updated_at = NOW()""",
                [str(request.user.id), table_key, json.dumps(visible), json.dumps(order)],
            )
        return Response({"data": {"tableKey": table_key, "visibleColumns": visible, "columnOrder": order}})
