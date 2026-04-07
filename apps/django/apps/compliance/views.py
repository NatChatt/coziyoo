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


def _require_admin(request):
    if not request.user.is_authenticated or request.user.realm != 'admin':
        return Response({"error": {"code": "UNAUTHORIZED", "message": "Admin authentication required"}}, status=401)
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

        doc_type = request.data.get("docType")
        file_name = request.data.get("fileName", "document.bin")
        content_type = request.data.get("contentType", "application/octet-stream")

        if not doc_type:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "docType is required"}},
                status=400,
            )

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


# ── Admin Compliance ──────────────────────────────────────────────────────────

class AdminComplianceQueueView(APIView):
    """GET /v1/admin/compliance/queue"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT scd.id, scd.seller_id, scd.status, scd.uploaded_at,
                       u.display_name as seller_name, u.email as seller_email,
                       cdl.name as document_name, cdl.code as document_code,
                       scd.file_url
                FROM seller_compliance_documents scd
                JOIN users u ON u.id = scd.seller_id
                JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
                WHERE scd.status = 'uploaded'
                ORDER BY scd.uploaded_at ASC
                LIMIT 100
                """,
            )
            cols = ["id", "sellerId", "status", "uploadedAt",
                    "sellerName", "sellerEmail", "documentName", "documentCode", "fileUrl"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["sellerId"] = str(d["sellerId"])
                d["uploadedAt"] = d["uploadedAt"].isoformat() if d["uploadedAt"] else None
                d["fileUrl"] = s3_utils.hydrate_file_url(d["fileUrl"])
                rows.append(d)

        return Response({"data": rows})


class AdminDocumentListView(APIView):
    """GET /v1/admin/compliance/document-list, POST /v1/admin/compliance/document-list"""

    def get(self, request):
        err = _require_admin(request)
        if err:
            return err

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, code, name, description, validity_years, is_required_default, is_active, created_at
                FROM compliance_documents_list
                ORDER BY name
                """,
            )
            cols = ["id", "code", "name", "description", "validityYears", "isRequired", "isActive", "createdAt"]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["createdAt"] = d["createdAt"].isoformat() if d["createdAt"] else None
                rows.append(d)

        return Response({"data": rows})

    def post(self, request):
        err = _require_admin(request)
        if err:
            return err

        code = request.data.get("code")
        name = request.data.get("name")
        description = request.data.get("description", "")
        validity_years = request.data.get("validityYears", 1)
        is_required = request.data.get("isRequired", True)

        if not code or not name:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "code and name are required"}},
                status=400,
            )

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO compliance_documents_list (code, name, description, validity_years, is_required)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                [code, name, description, validity_years, is_required],
            )
            row = cur.fetchone()

        return Response({"data": {"id": str(row[0])}}, status=201)


class AdminDocumentDetailView(APIView):
    """PATCH /v1/admin/compliance/document-list/:document_id"""

    def patch(self, request, document_id):
        err = _require_admin(request)
        if err:
            return err

        fields = []
        values = []

        if "name" in request.data:
            fields.append("name = %s")
            values.append(request.data["name"])
        if "description" in request.data:
            fields.append("description = %s")
            values.append(request.data["description"])
        if "validityYears" in request.data:
            fields.append("validity_years = %s")
            values.append(request.data["validityYears"])
        if "isRequired" in request.data:
            fields.append("is_required = %s")
            values.append(request.data["isRequired"])
        if "isActive" in request.data:
            fields.append("is_active = %s")
            values.append(request.data["isActive"])

        if not fields:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "No fields to update"}},
                status=400,
            )

        fields.append("updated_at = now()")
        values.append(document_id)

        with connection.cursor() as cur:
            cur.execute(
                f"UPDATE compliance_documents_list SET {', '.join(fields)} WHERE id = %s RETURNING id",
                values,
            )
            row = cur.fetchone()

        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Document type not found"}},
                status=404,
            )

        return Response({"data": {"id": str(row[0])}})


class AdminReviewDocumentView(APIView):
    """PATCH /v1/admin/compliance/:seller_id/documents/:document_id"""

    def patch(self, request, seller_id, document_id):
        err = _require_admin(request)
        if err:
            return err

        status = request.data.get("status")
        notes = request.data.get("notes", "")

        if status not in ("approved", "rejected"):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "status must be 'approved' or 'rejected'"}},
                status=400,
            )

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE seller_compliance_documents
                SET status=%s, reviewer_notes=%s, reviewed_at=now()
                WHERE id=%s AND seller_id=%s
                RETURNING id
                """,
                [status, notes, document_id, seller_id],
            )
            row = cur.fetchone()

        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Document not found"}},
                status=404,
            )

        return Response({"data": {"id": str(row[0]), "status": status}})


class AdminPresignUploadView(APIView):
    """POST /v1/admin/compliance/:seller_id/documents/presign-upload"""

    def post(self, request, seller_id):
        err = _require_admin(request)
        if err:
            return err

        if not s3_utils.is_configured():
            return Response(
                {"error": {"code": "STORAGE_NOT_CONFIGURED", "message": "S3 storage is not configured"}},
                status=503,
            )

        doc_type = request.data.get("docType")
        file_name = request.data.get("fileName", "document.bin")
        content_type = request.data.get("contentType", "application/octet-stream")

        if not doc_type:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "docType is required"}},
                status=400,
            )

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

        bucket = settings.S3_BUCKET_SELLER_DOCS
        key = s3_utils.build_seller_document_key(str(seller_id), doc_type, file_name)
        upload_url = s3_utils.presign_put(bucket, key, content_type)

        return Response({
            "data": {
                "uploadUrl": upload_url,
                "fileUrl": s3_utils.to_storage_pointer(bucket, key),
                "objectKey": key,
                "expiresInSeconds": getattr(settings, "S3_SIGNED_URL_TTL_SECONDS", 900),
            }
        })


class AdminSellerComplianceView(APIView):
    """GET /v1/admin/compliance/:seller_id — full compliance profile for a seller"""

    def get(self, request, seller_id):
        err = _require_admin(request)
        if err:
            return err

        sid = str(seller_id)

        with connection.cursor() as cur:
            # All documents (all versions)
            cur.execute("""
                SELECT scd.id, scd.seller_id, scd.document_list_id,
                       cdl.code, cdl.name, cdl.description, cdl.validity_years,
                       cdl.is_active, cdl.code AS doc_type,
                       scd.is_required, scd.status, scd.file_url,
                       scd.uploaded_at, scd.reviewed_at, scd.rejection_reason,
                       scd.notes, scd.version, scd.is_current,
                       scd.updated_at
                FROM seller_compliance_documents scd
                JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
                WHERE scd.seller_id = %s
                ORDER BY cdl.name, scd.version DESC
            """, [sid])
            cols = ["id", "seller_id", "document_list_id", "code", "name", "description",
                    "validity_years", "is_active", "doc_type", "is_required", "status",
                    "file_url", "uploaded_at", "reviewed_at", "rejection_reason",
                    "notes", "version", "is_current", "updated_at"]
            all_docs = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                d["id"] = str(d["id"])
                d["seller_id"] = str(d["seller_id"])
                d["document_list_id"] = str(d["document_list_id"])
                d["file_url"] = s3_utils.hydrate_file_url(d["file_url"])
                for f in ("uploaded_at", "reviewed_at", "updated_at"):
                    d[f] = d[f].isoformat() if d[f] else None
                all_docs.append(d)

            # Optional uploads
            cur.execute("""
                SELECT sou.id, sou.seller_id, sou.document_list_id,
                       cdl.code AS catalog_doc_code, cdl.name AS catalog_doc_name,
                       sou.custom_title, sou.file_url, sou.status,
                       sou.uploaded_at, sou.reviewed_at, sou.rejection_reason, sou.updated_at
                FROM seller_optional_uploads sou
                LEFT JOIN compliance_documents_list cdl ON cdl.id = sou.document_list_id
                WHERE sou.seller_id = %s
                ORDER BY sou.uploaded_at DESC
            """, [sid])
            opt_cols = ["id", "seller_id", "document_list_id", "catalog_doc_code",
                        "catalog_doc_name", "custom_title", "file_url", "status",
                        "uploaded_at", "reviewed_at", "rejection_reason", "updated_at"]
            optional_uploads = []
            for row in cur.fetchall():
                d = dict(zip(opt_cols, row))
                d["id"] = str(d["id"])
                d["seller_id"] = str(d["seller_id"])
                if d["document_list_id"]:
                    d["document_list_id"] = str(d["document_list_id"])
                d["file_url"] = s3_utils.hydrate_file_url(d["file_url"])
                for f in ("uploaded_at", "reviewed_at", "updated_at"):
                    d[f] = d[f].isoformat() if d[f] else None
                optional_uploads.append(d)

        current_docs = [d for d in all_docs if d["is_current"]]

        # Compute profile stats
        required = [d for d in current_docs if d["is_required"]]
        profile_status = "pending"
        approved_req = sum(1 for d in required if d["status"] == "approved")
        uploaded_req = sum(1 for d in required if d["status"] == "uploaded")
        requested_req = sum(1 for d in required if d["status"] == "requested")
        rejected_req = sum(1 for d in required if d["status"] == "rejected")
        if required and approved_req == len(required):
            profile_status = "approved"
        elif rejected_req > 0:
            profile_status = "rejected"
        elif uploaded_req > 0 or requested_req > 0:
            profile_status = "in_review"

        updated_at = max((d["updated_at"] for d in current_docs), default=None)

        profile = {
            "seller_id": sid,
            "status": profile_status,
            "required_count": len(required),
            "approved_required_count": approved_req,
            "uploaded_required_count": uploaded_req,
            "requested_required_count": requested_req,
            "rejected_required_count": rejected_req,
            "review_notes": None,
            "updated_at": updated_at,
        }

        profile_documents = [
            {
                "id": d["id"],
                "seller_id": d["seller_id"],
                "doc_type": d["code"],
                "latest_document_id": d["id"],
                "status": d["status"],
                "required": d["is_required"],
                "updated_at": d["updated_at"],
            }
            for d in current_docs
        ]

        return Response({
            "data": {
                "profile": profile,
                "checks": [],
                "documents": all_docs,
                "profileDocuments": profile_documents,
                "optionalUploads": optional_uploads,
            }
        })
