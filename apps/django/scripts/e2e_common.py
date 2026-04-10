#!/usr/bin/env python3
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from urllib import parse, request
from urllib.error import HTTPError, URLError


DEFAULT_BASE_URL = "https://api.coziyoo.com"
DEFAULT_SELLER_EMAIL = "seller@test.com"
DEFAULT_BUYER_EMAIL = "buyer@test.com"
DEFAULT_PASSWORD = "Test12345"


class E2EFailure(RuntimeError):
    pass


@dataclass
class FlowConfig:
    base_url: str
    interactive: bool
    timeout: int


class FlowRunner:
    def __init__(self, config: FlowConfig):
        self.config = config
        self.step_no = 0

    def start_step(self, title: str) -> None:
        self.step_no += 1
        print(f"\n[{self.step_no:02d}] {title}")
        if self.config.interactive:
            try:
                input("Devam etmek için Enter: ")
            except EOFError:
                pass

    def pass_step(self, message: str) -> None:
        print(f"PASS: {message}")

    def skip_step(self, message: str) -> None:
        print(f"SKIP: {message}")

    def fail_step(self, message: str) -> None:
        print(f"FAIL: {message}")


def normalize_base_url(value: str) -> str:
    return (value or DEFAULT_BASE_URL).strip().rstrip("/")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_lot_timeline():
    current = now_utc()
    produced_at = current - timedelta(minutes=5)
    sale_starts_at = current - timedelta(minutes=1)
    sale_ends_at = current + timedelta(hours=2)
    return {
        "producedAt": iso_z(produced_at),
        "saleStartsAt": iso_z(sale_starts_at),
        "saleEndsAt": iso_z(sale_ends_at),
    }


def _error_message_from_body(body):
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return err.get("message") or json.dumps(err, ensure_ascii=False)
        return json.dumps(body, ensure_ascii=False)
    return str(body)


def _as_expected(status_code: int, expected_status) -> bool:
    if isinstance(expected_status, int):
        return status_code == expected_status
    if isinstance(expected_status, Iterable):
        return status_code in expected_status
    return True


def request_json(
    config: FlowConfig,
    method: str,
    path: str,
    *,
    token: Optional[str] = None,
    json_body=None,
    params=None,
    expected_status=None,
    require_key: Optional[str] = None,
):
    url = f"{config.base_url}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    if params:
        query = parse.urlencode(params)
        if query:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{query}"

    payload = None
    if json_body is not None:
        payload = json.dumps(json_body).encode("utf-8")

    req = request.Request(url=url, data=payload, headers=headers, method=method.upper())

    try:
        with request.urlopen(req, timeout=config.timeout) as res:
            status_code = res.getcode()
            raw_body = res.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        status_code = exc.code
        raw_body = exc.read().decode("utf-8", errors="replace")
    except URLError as exc:
        raise E2EFailure(f"İstek başarısız: {method} {path} -> {exc}") from exc

    try:
        body = json.loads(raw_body) if raw_body else None
    except ValueError:
        body = None

    if expected_status is not None and not _as_expected(status_code, expected_status):
        detail = _error_message_from_body(body)
        raise E2EFailure(
            f"{method} {path} HTTP {status_code} (beklenen {expected_status}) - {detail}"
        )

    if require_key and (not isinstance(body, dict) or require_key not in body):
        raise E2EFailure(f"{method} {path} response içinde '{require_key}' yok")

    return status_code, body


def require_data(body):
    if not isinstance(body, dict) or "data" not in body:
        raise E2EFailure("Response içinde data alanı yok")
    return body["data"]
