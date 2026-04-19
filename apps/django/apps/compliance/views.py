from django.conf import settings
from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response

from coziyoo import s3 as s3_utils


# ── Permission helpers ────────────────────────────────────────────────────────

def _require_app(request):
    if not request.user.is_authenticated or request.user.realm != 'app':
        return Response({"error": {"code": "UNAUTHORIZED", "message": "Authentication required"}}, status=401)
    return None


# ── Seller Compliance ─────────────────────────────────────────────────────────

class SellerComplianceProfileView(APIView):
    """GET /v1/seller/compliance/profile"""

    def get(self, request):
        err = _require_app(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT cdl.id, cdl.code, cdl.name, cdl.description, cdl.validity_years, cdl.is_required_default,
                       scd.id as doc_id, scd.status, scd.uploaded_at, scd.expires_at
                FROM compliance_documents_list cdl
                LEFT JOIN seller_compliance_documents scd
                    ON scd.document_list_id = cdl.id AND scd.seller_id = %s
                WHERE cdl.is_active = TRUE
                ORDER BY cdl.is_required_default DESC, cdl.name
                """,
                [request.user.id],
            )
            cols = ["id", "code", "name", "description", "validityYears", "isRequired",
                    "docId", "status", "uploadedAt", "expiresAt"]
            documents = []
            for row in cur.fetchall():
                doc = dict(zip(cols, row))
                doc["id"] = str(doc["id"]) if doc["id"] else None
                doc["docId"] = str(doc["docId"]) if doc["docId"] else None
                doc["uploadedAt"] = doc["uploadedAt"].isoformat() if doc["uploadedAt"] else None
                doc["expiresAt"] = doc["expiresAt"].isoformat() if doc["expiresAt"] else None
                if "fileUrl" in doc:
                    doc["fileUrl"] = s3_utils.hydrate_file_url(doc["fileUrl"])
                documents.append(doc)

        return Response({"data": {"documents": documents, "status": "in_progress"}})


class SellerComplianceSubmitView(APIView):
    """POST /v1/seller/compliance/submit"""

    def post(self, request):
        err = _require_app(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM seller_compliance_documents WHERE seller_id=%s AND status='uploaded'",
                [request.user.id],
            )
            count = cur.fetchone()[0]

        if count == 0:
            return Response(
                {"error": {"code": "NO_DOCUMENTS", "message": "Upload at least one document first"}},
                status=400,
            )

        return Response({"data": {"success": True, "status": "under_review"}})


class SellerDocumentListView(APIView):
    """GET /documents — list requirements, POST /documents — upload/link a document"""

    def get(self, request):
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, description, validity_years, is_required_default
                FROM compliance_documents_list
                WHERE is_active = TRUE
                ORDER BY is_required_default DESC, name
                """,
            )
            cols = ["id", "code", "name", "description", "validityYears", "isRequired"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                rows.append(d)

        return Response({"data": rows})

    def post(self, request):
        err = _require_app(request)
        if err:
            return err

        document_list_id = request.data.get("documentListId")
        file_url = request.data.get("fileUrl")  # s3:// pointer after direct upload
        notes = request.data.get("notes", "")

        if not document_list_id or not file_url:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "documentListId and fileUrl are required"}},
                status=400,
            )

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO seller_compliance_documents
                    (seller_id, document_list_id, file_url, status, notes, uploaded_at)
                VALUES (%s, %s, %s, 'uploaded', %s, now())
                ON CONFLICT (seller_id, document_list_id)
                DO UPDATE SET file_url=%s, status='uploaded', notes=%s, uploaded_at=now(), updated_at=now()
                RETURNING id
                """,
                [request.user.id, document_list_id, file_url, notes, file_url, notes],
            )
            row = cur.fetchone()

        return Response({"data": {"id": str(row[0]), "status": "uploaded"}}, status=201)


class SellerDocumentPresignView(APIView):
    """POST /v1/seller/compliance/documents/presign — get a presigned PUT URL for direct upload."""

    def post(self, request):
        err = _require_app(request)
        if err:
            return err

        if not s3_utils.is_configured():
            return Response(
                {"error": {"code": "STORAGE_NOT_CONFIGURED", "message": "S3 storage is not configured"}},
                status=503,
            )

        _ALLOWED_EXTENSIONS = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".doc": "application/msword",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }

        doc_type = request.data.get("docType")
        file_name = request.data.get("fileName", "document.bin")

        if not doc_type:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "docType is required"}},
                status=400,
            )

        ext = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        if ext not in _ALLOWED_EXTENSIONS:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Desteklenmeyen dosya türü. İzin verilenler: PDF, JPG, PNG, DOC, DOCX"}},
                status=400,
            )
        content_type = _ALLOWED_EXTENSIONS[ext]

        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM compliance_documents_list WHERE code = %s AND is_active = TRUE",
                [doc_type],
            )
            if cur.fetchone() is None:
                return Response(
                    {"error": {"code": "DOCUMENT_TYPE_NOT_FOUND", "message": "Document type not found"}},
                    status=404,
                )

        seller_id = str(request.user.id)
        bucket = settings.S3_BUCKET_SELLER_DOCS
        key = s3_utils.build_seller_document_key(seller_id, doc_type, file_name)
        upload_url = s3_utils.presign_put(bucket, key, content_type)

        return Response({
            "data": {
                "uploadUrl": upload_url,
                "fileUrl": s3_utils.to_storage_pointer(bucket, key),
                "objectKey": key,
                "expiresInSeconds": getattr(settings, "S3_SIGNED_URL_TTL_SECONDS", 900),
            }
        })


class SellerOptionalUploadsView(APIView):
    """GET /optional-uploads — list, POST /optional-uploads — create"""

    def get(self, request):
        err = _require_app(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, custom_title, file_url, status, created_at
                FROM seller_optional_uploads
                WHERE seller_id=%s AND status != 'archived'
                ORDER BY created_at DESC
                """,
                [request.user.id],
            )
            cols = ["id", "name", "fileUrl", "status", "createdAt"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                d["fileUrl"] = s3_utils.hydrate_file_url(d.get("fileUrl"))
                rows.append(d)

        return Response({"data": rows})

    def post(self, request):
        err = _require_app(request)
        if err:
            return err

        name = request.data.get("name")
        file_url = request.data.get("fileUrl")
        notes = request.data.get("notes", "")

        if not name or not file_url:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "name and fileUrl are required"}},
                status=400,
            )

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO seller_optional_uploads (seller_id, custom_title, file_url, status)
                VALUES (%s, %s, %s, 'uploaded') RETURNING id
                """,
                [request.user.id, name, file_url],
            )
            row = cur.fetchone()

        return Response({"data": {"id": str(row[0]), "status": "uploaded"}}, status=201)


