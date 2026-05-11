"""Cursor → dict yardımcıları. psycopg cursor'larında `col.name` kullanır."""


def rows_as_dicts(cursor):
    """Convert cursor results to list of dicts using cursor.description."""
    cols = [col.name for col in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def row_as_dict(cursor):
    """Return first row as dict, or None if no rows."""
    cols = [col.name for col in cursor.description]
    row = cursor.fetchone()
    return dict(zip(cols, row)) if row else None


def stringify_uuids(obj, fields):
    """Convert UUID fields to strings in-place. Returns same dict."""
    for f in fields:
        if obj.get(f) is not None:
            obj[f] = str(obj[f])
    return obj
