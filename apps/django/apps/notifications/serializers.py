"""Notifications app serializers — dict builders for API responses.

API sözleşmesinde alan adları camelCase'tir, DB sütun adları snake_case.
"""


def serialize_chat_message(row: dict) -> dict:
    """Tek bir chat mesajını API formatına çevirir.

    Beklenen row anahtarları: id, sender_id, sender_type, message, message_type,
    is_read, created_at (datetime or None).
    """
    return {
        "id": str(row["id"]),
        "senderId": str(row["sender_id"]),
        "senderType": row["sender_type"],
        "message": row["message"],
        "messageType": row["message_type"],
        "isRead": bool(row["is_read"]),
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
    }
