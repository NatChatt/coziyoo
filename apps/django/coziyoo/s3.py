"""
S3 / S3-compatible storage utilities.

Storage pointers are stored in the DB as  s3://bucket/key
and resolved to presigned URLs at serve time.
"""
import re
import time
import uuid
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

def is_configured() -> bool:
    return bool(
        getattr(settings, "S3_ENDPOINT", "")
        and getattr(settings, "S3_BUCKET_SELLER_DOCS", "")
        and getattr(settings, "S3_ACCESS_KEY_ID", "")
        and getattr(settings, "S3_SECRET_ACCESS_KEY", "")
    )


@lru_cache(maxsize=1)
def _get_client():
    """Return a cached boto3 S3 client. Re-import clears the cache."""
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        region_name=getattr(settings, "S3_REGION", "us-east-1"),
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        config=Config(
            signature_version="s3v4",
            connect_timeout=getattr(settings, "S3_CONNECT_TIMEOUT_SECONDS", 5),
            read_timeout=getattr(settings, "S3_READ_TIMEOUT_SECONDS", 20),
            retries={"max_attempts": getattr(settings, "S3_MAX_RETRY_ATTEMPTS", 2)},
            s3={"addressing_style": "path" if getattr(settings, "S3_FORCE_PATH_STYLE", True) else "auto"},
        ),
    )


def get_client():
    if not is_configured():
        raise RuntimeError("S3_STORAGE_NOT_CONFIGURED")
    return _get_client()


# ---------------------------------------------------------------------------
# Storage pointer helpers
# ---------------------------------------------------------------------------

def to_storage_pointer(bucket: str, key: str) -> str:
    return f"s3://{bucket}/{key}"


def parse_storage_pointer(value: str | None) -> dict | None:
    """Parse  s3://bucket/key  → {"bucket": ..., "key": ...}"""
    if not value or not value.startswith("s3://"):
        return None
    raw = value[5:]
    idx = raw.index("/")
    if idx <= 0 or idx >= len(raw) - 1:
        return None
    return {"bucket": raw[:idx], "key": raw[idx + 1:]}


# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------

def _sanitize_filename(name: str) -> str:
    normalized = re.sub(r"[^\w.\-]+", "_", name).strip("_")[:120]
    return normalized or "document.bin"


def build_seller_document_key(seller_id: str, doc_type: str, file_name: str) -> str:
    safe_type = re.sub(r"[^a-z0-9_-]+", "_", doc_type.lower())
    uid = str(uuid.uuid4())[:8]
    ts = int(time.time() * 1000)
    return f"seller/{seller_id}/documents/{safe_type}/{ts}-{uid}-{_sanitize_filename(file_name)}"


# ---------------------------------------------------------------------------
# Presigned URL helpers
# ---------------------------------------------------------------------------

TTL = property(lambda self: getattr(settings, "S3_SIGNED_URL_TTL_SECONDS", 900))


def presign_get(storage_pointer: str | None, ttl: int | None = None) -> str | None:
    """Convert an  s3://bucket/key  pointer to a presigned GET URL.
    Returns None if pointer is absent; returns the original value if it's not
    an s3:// pointer (e.g. https:// URL stored directly).
    """
    if not storage_pointer:
        return None
    parsed = parse_storage_pointer(storage_pointer)
    if parsed is None:
        return storage_pointer  # already a plain URL
    client = get_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": parsed["bucket"], "Key": parsed["key"]},
        ExpiresIn=ttl or getattr(settings, "S3_SIGNED_URL_TTL_SECONDS", 900),
    )


def presign_put(bucket: str, key: str, content_type: str = "application/octet-stream", ttl: int | None = None) -> str:
    """Generate a presigned PUT URL for direct-to-S3 upload."""
    client = get_client()
    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=ttl or getattr(settings, "S3_SIGNED_URL_TTL_SECONDS", 900),
    )


def put_bytes(bucket: str, key: str, content: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload raw bytes and return the storage pointer."""
    client = get_client()
    client.put_object(Bucket=bucket, Key=key, Body=content, ContentType=content_type)
    return to_storage_pointer(bucket, key)


def delete_object(storage_pointer: str | None) -> bool:
    """Delete object pointed by s3://bucket/key. Returns False when not deletable."""
    parsed = parse_storage_pointer(storage_pointer)
    if parsed is None:
        return False
    try:
        client = get_client()
        client.delete_object(Bucket=parsed["bucket"], Key=parsed["key"])
        return True
    except (RuntimeError, BotoCoreError, ClientError, OSError):
        return False


def hydrate_file_url(value: str | None) -> str | None:
    """If value is an s3:// pointer, return a presigned GET URL; otherwise return as-is."""
    if not is_configured():
        return value
    return presign_get(value)


def hydrate_rows(rows: list[dict], field: str = "fileUrl") -> list[dict]:
    """Mutate each dict in rows, replacing field with a presigned URL."""
    if not is_configured():
        return rows
    for row in rows:
        if field in row:
            row[field] = presign_get(row[field])
    return rows
