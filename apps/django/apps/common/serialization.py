import json


def json_dumps(value):
    return json.dumps(value, ensure_ascii=False)


def json_object(value):
    """Best-effort dict coercion. Returns {} on non-dict / parse errors."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}
