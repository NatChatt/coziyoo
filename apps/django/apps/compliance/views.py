import base64
import binascii

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.common.responses import error_response
from coziyoo import s3 as s3_utils


# ── Permission helpers ────────────────────────────────────────────────────────

def _require_app(request):
    if not request.user.is_authenticated or request.user.realm != 'app':
        return error_response("UNAUTHORIZED", "Authentication required", 401)
    return None


# ── Seller Compliance ─────────────────────────────────────────────────────────

_ALLOWED_UPLOAD_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def _decode_base64_upload(data_base64, content_type):
    normalized_type = str(content_type or "image/jpeg").lower().strip()
    if normalized_type not in _ALLOWED_UPLOAD_TYPES:
        return None, normalized_type, "Unsupported document type"

    raw = str(data_base64 or "").strip()
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        content = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        return None, normalized_type, "Invalid document data"
    if not content or len(content) > 12 * 1024 * 1024:
        return None, normalized_type, "Document is empty or too large"
    return content, normalized_type, None


def _status_counts(documents):
    required_docs = [doc for doc in documents if doc["is_required"]]
    return {
        "status": "in_progress",
        "required_count": len(required_docs),
        "approved_required_count": sum(1 for doc in required_docs if doc.get("status") == "approved"),
        "uploaded_required_count": sum(1 for doc in required_docs if doc.get("status") in ("uploaded", "approved", "rejected", "requested")),
        "requested_required_count": sum(1 for doc in required_docs if doc.get("status") in (None, "", "requested")),
        "rejected_required_count": sum(1 for doc in required_docs if doc.get("status") == "rejected"),
    }


def _serialize_document(row):
    cols = [
        "id", "code", "name", "description", "validity_years", "is_required",
        "doc_id", "status", "uploaded_at", "expires_at", "rejection_reason", "file_url",
    ]
    doc = dict(zip(cols, row))
    uploaded_at = doc.get("uploaded_at")
    expires_at = doc.get("expires_at")
    file_url = s3_utils.hydrate_file_url(doc.get("file_url"))
    is_required = bool(doc.get("is_required"))
    return {
        "id": str(doc["id"]) if doc.get("id") else None,
        "code": doc.get("code"),
        "name": doc.get("name"),
        "description": doc.get("description"),
        "validity_years": doc.get("validity_years"),
        "validityYears": doc.get("validity_years"),
        "is_required": is_required,
        "isRequired": is_required,
        "doc_id": str(doc["doc_id"]) if doc.get("doc_id") else None,
        "docId": str(doc["doc_id"]) if doc.get("doc_id") else None,
        "status": doc.get("status") or "requested",
        "uploaded_at": uploaded_at.isoformat() if uploaded_at else None,
        "uploadedAt": uploaded_at.isoformat() if uploaded_at else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "expiresAt": expires_at.isoformat() if expires_at else None,
        "rejection_reason": doc.get("rejection_reason"),
        "rejectionReason": doc.get("rejection_reason"),
        "file_url": file_url,
        "fileUrl": file_url,
    }


def _load_compliance_documents(seller_id):
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT cdl.id, cdl.code, cdl.name, cdl.description, cdl.validity_years, cdl.is_required_default,
                   scd.id as doc_id, scd.status, scd.uploaded_at, scd.expires_at, scd.rejection_reason, scd.file_url
            FROM compliance_documents_list cdl
            LEFT JOIN seller_compliance_documents scd
                ON scd.document_list_id = cdl.id AND scd.seller_id = %s AND scd.is_current = TRUE
            WHERE cdl.is_active = TRUE
            ORDER BY cdl.is_required_default DESC, cdl.name
            """,
            [seller_id],
        )
        return [_serialize_document(row) for row in cur.fetchall()]

class SellerComplianceProfileView(APIView):
    """GET /v1/seller/compliance/profile"""

    def get(self, request):
        err = _require_app(request)
        if err:
            return err

        documents = _load_compliance_documents(request.user.id)
        profile = _status_counts(documents)
        return Response({"data": {"profile": profile, "documents": documents, "status": profile["status"]}})


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
            return error_response("NO_DOCUMENTS", "Upload at least one document first", 400)

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
        doc_type = request.data.get("docType")
        file_url = request.data.get("fileUrl")  # s3:// pointer after direct upload
        notes = request.data.get("notes", "")
        is_required = True

        if not document_list_id and doc_type:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT id, is_required_default FROM compliance_documents_list WHERE code = %s AND is_active = TRUE",
                    [doc_type],
                )
                row = cur.fetchone()
            if not row:
                return error_response("DOCUMENT_TYPE_NOT_FOUND", "Document type not found", 404)
            document_list_id = row[0]
            is_required = bool(row[1])
        elif document_list_id:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT is_required_default FROM compliance_documents_list WHERE id = %s AND is_active = TRUE",
                    [document_list_id],
                )
                row = cur.fetchone()
            if not row:
                return error_response("DOCUMENT_TYPE_NOT_FOUND", "Document type not found", 404)
            is_required = bool(row[0])

        if not file_url and request.data.get("dataBase64"):
            content, content_type, decode_error = _decode_base64_upload(
                request.data.get("dataBase64"),
                request.data.get("contentType"),
            )
            if decode_error:
                return error_response("VALIDATION_ERROR", decode_error, 400)
            if s3_utils.is_configured():
                bucket = settings.S3_BUCKET_SELLER_DOCS
                ext = _ALLOWED_UPLOAD_TYPES[content_type]
                key = s3_utils.build_seller_document_key(str(request.user.id), str(doc_type or document_list_id), f"document.{ext}")
                try:
                    file_url = s3_utils.put_bytes(bucket, key, content, content_type)
                except (RuntimeError, BotoCoreError, ClientError, OSError):
                    return error_response(
                        "STORAGE_UPLOAD_FAILED",
                        "Belge depolama servisine ulasilamadi. Lutfen daha sonra tekrar deneyin.",
                        503,
                    )
            else:
                encoded = base64.b64encode(content).decode("ascii")
                file_url = f"data:{content_type};base64,{encoded}"

        if not document_list_id or not file_url:
            return error_response("VALIDATION_ERROR", "documentListId/fileUrl or docType/dataBase64 are required", 400)

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO seller_compliance_documents
                    (seller_id, document_list_id, file_url, status, notes, uploaded_at, is_required, version, is_current, expired)
                VALUES (%s, %s, %s, 'uploaded', %s, now(), %s, 1, TRUE, FALSE)
                ON CONFLICT (seller_id, document_list_id)
                DO UPDATE SET file_url=%s, status='uploaded', notes=%s, uploaded_at=now(), updated_at=now(),
                              rejection_reason=NULL, is_required=%s, is_current=TRUE, expired=FALSE
                RETURNING id
                """,
                [request.user.id, document_list_id, file_url, notes, is_required, file_url, notes, is_required],
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
            return error_response("STORAGE_NOT_CONFIGURED", "S3 storage is not configured", 503)

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
            return error_response("VALIDATION_ERROR", "docType is required", 400)

        ext = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        if ext not in _ALLOWED_EXTENSIONS:
            return error_response("VALIDATION_ERROR", "Desteklenmeyen dosya türü. İzin verilenler: PDF, JPG, PNG, DOC, DOCX", 400)
        content_type = _ALLOWED_EXTENSIONS[ext]

        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM compliance_documents_list WHERE code = %s AND is_active = TRUE",
                [doc_type],
            )
            if cur.fetchone() is None:
                return error_response("DOCUMENT_TYPE_NOT_FOUND", "Document type not found", 404)

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
            return error_response("VALIDATION_ERROR", "name and fileUrl are required", 400)

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
