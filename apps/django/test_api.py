#!/usr/bin/env python3
"""
End-to-end API test against live Supabase.

Usage:
    python test_api.py [BASE_URL]
    BASE_URL defaults to http://localhost:9090

The server must be running: python manage.py runserver 9090
"""

import sys
import uuid
import requests

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:9090"

GREEN = "\033[92m"; RED = "\033[91m"; YELLOW = "\033[93m"
CYAN  = "\033[96m"; RESET = "\033[0m";  BOLD  = "\033[1m"

pass_count = fail_count = skip_count = 0
results = []


def ok(name):
    global pass_count
    pass_count += 1
    results.append((True, name, ""))
    print(f"  {GREEN}✓{RESET} {name}")


def fail(name, detail=""):
    global fail_count
    fail_count += 1
    results.append((False, name, detail))
    print(f"  {RED}✗ FAIL{RESET} {name}")
    if detail:
        print(f"         {RED}{detail[:200]}{RESET}")


def skip(name, reason=""):
    global skip_count
    skip_count += 1
    print(f"  {YELLOW}⊘ SKIP{RESET} {name}" + (f" — {reason}" if reason else ""))


def section(title):
    print(f"\n{BOLD}{CYAN}── {title} {'─'*(50-len(title))}{RESET}")


def req(method, path, *, headers=None, json=None, params=None):
    """Make a request; return (response, body_dict_or_none)."""
    try:
        r = requests.request(method, BASE + path, headers=headers, json=json,
                             params=params, timeout=30)
        try:
            body = r.json()
        except Exception:
            return r, None
        return r, body
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        print(f"  {RED}REQUEST ERROR: {e}{RESET}")
        return None, None


def check(name, path, *, method="GET", headers=None, json=None, params=None,
          expected_status=200, key="data"):
    """Make request, assert status and presence of top-level key."""
    r, body = req(method, path, headers=headers, json=json, params=params)
    if r is None:
        fail(name, "Connection refused")
        return None
    if r.status_code != expected_status:
        detail = ""
        if isinstance(body, dict):
            detail = body.get("error", {}).get("message", "") or str(body)[:120]
        elif body is None:
            detail = f"Empty body (HTTP {r.status_code})"
        fail(name, f"HTTP {r.status_code} (expected {expected_status}): {detail}")
        return None
    if key and isinstance(body, dict) and key not in body:
        fail(name, f"Missing '{key}' in response: {str(body)[:120]}")
        return None
    ok(name)
    return body


def get_tokens(path, email, password, realm_label):
    """Login and return (access_token, refresh_token, user_id) or (None, None, None)."""
    r, body = req("POST", path, json={"email": email, "password": password})
    if r is None or r.status_code != 200 or not body:
        print(f"  {YELLOW}⊘ SKIP{RESET} {realm_label} login — HTTP {r.status_code if r else 'N/A'}: "
              f"{body.get('error',{}).get('message','') if body else 'empty body'}")
        return None, None, None
    ok(f"POST {path} ({realm_label})")
    tokens = body["data"]["tokens"]
    user   = body["data"].get("user", {})
    return tokens["accessToken"], tokens["refreshToken"], user.get("id")


# ══════════════════════════════════════════════════════════════════════════════
# 1. Health
# ══════════════════════════════════════════════════════════════════════════════
section("Health")
check("GET /v1/health/", "/v1/health/", key="status")

# ══════════════════════════════════════════════════════════════════════════════
# 2. App Auth
# ══════════════════════════════════════════════════════════════════════════════
section("App Auth")

# Try to register a new throwaway user
test_email = f"test_{uuid.uuid4().hex[:8]}@example.com"
r, body = req("POST", "/v1/auth/register", json={
    "email": test_email,
    "password": "TestPass123!",
    "username": f"tester_{uuid.uuid4().hex[:6]}",
    "displayName": "Test Tester",
    "userType": "buyer",
})
if r is not None and r.status_code == 201 and body and "data" in body:
    ok("POST /v1/auth/register (new user)")
elif r is not None and r.status_code in (400, 409):
    skip("POST /v1/auth/register", f"HTTP {r.status_code}")
elif r is not None:
    fail("POST /v1/auth/register", f"HTTP {r.status_code}: {str(body)[:120] if body else 'empty body'}")
else:
    fail("POST /v1/auth/register", "Connection error")

# Login: try the new test user first, then fall back to seed credentials
if r is not None and r.status_code == 201 and body and "data" in body:
    APP_TOKEN   = body["data"]["tokens"]["accessToken"]
    APP_REFRESH = body["data"]["tokens"]["refreshToken"]
    APP_USER_ID = body["data"]["user"]["id"]
else:
    # Fall back: try seed buyer or any known buyer
    APP_TOKEN, APP_REFRESH, APP_USER_ID = get_tokens(
        "/v1/auth/login", "buyer@test.com", "Test12345", "buyer"
    )

if APP_TOKEN:
    ah = {"Authorization": f"Bearer {APP_TOKEN}"}

    check("GET /v1/auth/me", "/v1/auth/me", headers=ah)

    r, body = req("POST", "/v1/auth/refresh", json={"refreshToken": APP_REFRESH})
    if r and r.status_code == 200 and body:
        ok("POST /v1/auth/refresh")
        APP_TOKEN   = body["data"]["tokens"]["accessToken"]
        APP_REFRESH = body["data"]["tokens"]["refreshToken"]
        ah = {"Authorization": f"Bearer {APP_TOKEN}"}
    else:
        fail("POST /v1/auth/refresh", f"HTTP {r.status_code if r else 'N/A'}")

    check("GET /v1/auth/username/check?value=nobodyxyz",
          "/v1/auth/username/check", params={"value": "nobodyxyz"}, headers=ah)

    check("GET /v1/auth/display-name/check?value=NobodyXYZ",
          "/v1/auth/display-name/check", params={"value": "NobodyXYZ"}, headers=ah)
else:
    print(f"  {YELLOW}  → No app token; most app-realm tests will be skipped{RESET}")
    ah = {}

# ══════════════════════════════════════════════════════════════════════════════
# 3. Admin Auth
# ══════════════════════════════════════════════════════════════════════════════
section("Admin Auth")

ADMIN_TOKEN, ADMIN_REFRESH, _ = get_tokens(
    "/v1/admin/auth/login", "admin@coziyoo.com", "Admin12345", "admin"
)

if ADMIN_TOKEN:
    aah = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

    check("GET /v1/admin/auth/me", "/v1/admin/auth/me", headers=aah)

    r, body = req("POST", "/v1/admin/auth/refresh", json={"refreshToken": ADMIN_REFRESH})
    if r and r.status_code == 200 and body:
        ok("POST /v1/admin/auth/refresh")
        ADMIN_TOKEN   = body["data"]["tokens"]["accessToken"]
        ADMIN_REFRESH = body["data"]["tokens"]["refreshToken"]
        aah = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
    else:
        fail("POST /v1/admin/auth/refresh", f"HTTP {r.status_code if r else 'N/A'}")
else:
    aah = {}
    print(f"  {YELLOW}  → No admin token; admin tests will be skipped{RESET}")

# ══════════════════════════════════════════════════════════════════════════════
# 4. Foods (public app-realm)
# ══════════════════════════════════════════════════════════════════════════════
section("Foods")

SELLER_ID = FOOD_ID = None

if not APP_TOKEN:
    skip("Foods endpoints", "no app token")
else:
    body = check("GET /v1/foods/", "/v1/foods/", headers=ah)
    FOOD_SELLER_ID = None
    if body:
        items = body["data"].get("items", [])
        if items:
            FOOD_ID = items[0]["id"]
            FOOD_SELLER_ID = items[0].get("seller_id")
        else:
            FOOD_ID = None

    check("GET /v1/foods/?search=tavuk", "/v1/foods/", params={"search": "tavuk"}, headers=ah)
    check("GET /v1/foods/top-sold",   "/v1/foods/top-sold",  headers=ah)
    check("GET /v1/foods/categories", "/v1/foods/categories", headers=ah)

    body = check("GET /v1/foods/sellers", "/v1/foods/sellers", headers=ah)
    if body:
        sellers = body["data"]
        SELLER_ID = sellers[0]["id"] if sellers else None

    if SELLER_ID:
        check("GET /v1/foods/sellers/:id/foods",
              f"/v1/foods/sellers/{SELLER_ID}/foods", headers=ah)
        check("GET /v1/foods/sellers/:id/reviews",
              f"/v1/foods/sellers/{SELLER_ID}/reviews", headers=ah)
    else:
        skip("GET /v1/foods/sellers/:id/foods",   "no sellers in DB")
        skip("GET /v1/foods/sellers/:id/reviews",  "no sellers in DB")

# ══════════════════════════════════════════════════════════════════════════════
# 5. Seller profile & management
# ══════════════════════════════════════════════════════════════════════════════
section("Seller Profile & Foods")

# Register a throwaway seller if we have no seed seller
seller_email = f"seller_{uuid.uuid4().hex[:8]}@example.com"
r2, b2 = req("POST", "/v1/auth/register", json={
    "email": seller_email,
    "password": "TestPass123!",
    "username": f"seller_{uuid.uuid4().hex[:6]}",
    "displayName": "Test Seller",
    "userType": "seller",
})
if r2 and r2.status_code == 201 and b2 and "data" in b2:
    ok("POST /v1/auth/register (seller)")
    SELLER_TOKEN   = b2["data"]["tokens"]["accessToken"]
    SELLER_USER_ID = b2["data"]["user"]["id"]
else:
    SELLER_TOKEN, _, SELLER_USER_ID = get_tokens(
        "/v1/auth/login", "seller@test.com", "Test12345", "seller"
    )

MY_FOOD_ID = None
if SELLER_TOKEN:
    sh = {"Authorization": f"Bearer {SELLER_TOKEN}"}

    check("GET /v1/seller/profile",    "/v1/seller/profile",   headers=sh)

    body = check("GET /v1/seller/foods", "/v1/seller/foods", headers=sh)
    if body:
        foods = body["data"] if isinstance(body["data"], list) else body["data"].get("foods", [])
        MY_FOOD_ID = foods[0]["id"] if foods else None

    check("GET /v1/seller/orders",     "/v1/seller/orders",    headers=sh)
    check("GET /v1/seller/reviews",    "/v1/seller/reviews",   headers=sh)
    check("GET /v1/seller/categories", "/v1/seller/categories", headers=sh)
    check("GET /v1/seller/lots",       "/v1/seller/lots",      headers=sh)

    if MY_FOOD_ID:
        check("GET /v1/seller/foods/:id", f"/v1/seller/foods/{MY_FOOD_ID}", headers=sh)
    else:
        skip("GET /v1/seller/foods/:id", "no foods for seed seller")
else:
    sh = {}

# ══════════════════════════════════════════════════════════════════════════════
# 6. Orders
# ══════════════════════════════════════════════════════════════════════════════
section("Orders")

ORDER_ID = None

if not APP_TOKEN:
    skip("Orders endpoints", "no app token")
else:
    body = check("GET /v1/orders/", "/v1/orders/", headers=ah)
    if body:
        orders = body["data"] if isinstance(body["data"], list) else body["data"].get("orders", [])
        ORDER_ID = orders[0]["id"] if orders else None

    order_seller_id = FOOD_SELLER_ID or SELLER_ID
    if FOOD_ID and order_seller_id:
        r, body = req("POST", "/v1/orders/", headers=ah, json={
            "sellerId": order_seller_id,
            "items": [{"foodId": FOOD_ID, "quantity": 1}],
            "deliveryType": "pickup",
        })
        if r and r.status_code == 201 and body:
            ok("POST /v1/orders/ (create)")
            ORDER_ID = body["data"].get("orderId") or body["data"].get("id")
        elif r and r.status_code in (400, 409, 422):
            skip("POST /v1/orders/ (create)", f"HTTP {r.status_code}: {body.get('error',{}).get('message','') if body else ''}")
        else:
            fail("POST /v1/orders/ (create)", f"HTTP {r.status_code if r else 'N/A'}: {str(body)[:120] if body else 'empty'}")
    else:
        skip("POST /v1/orders/ (create)", "no food or seller in DB")

    if ORDER_ID:
        check("GET /v1/orders/:id", f"/v1/orders/{ORDER_ID}", headers=ah)

# ══════════════════════════════════════════════════════════════════════════════
# 7. Payments
# ══════════════════════════════════════════════════════════════════════════════
section("Payments")

if not APP_TOKEN:
    skip("Payment endpoints", "no app token")
elif ORDER_ID:
    check("GET /v1/payments/:order_id/status",
          f"/v1/payments/{ORDER_ID}/status", headers=ah)
else:
    skip("Payment endpoints", "no order available")

# ══════════════════════════════════════════════════════════════════════════════
# 8. Notifications
# ══════════════════════════════════════════════════════════════════════════════
section("Notifications")

if not APP_TOKEN:
    skip("Notifications endpoints", "no app token")
else:
    check("GET /v1/notifications/", "/v1/notifications/", headers=ah)

    r, body = req("PUT", "/v1/notifications/device-token", headers=ah, json={
        "token": f"test-expo-token-{uuid.uuid4().hex[:8]}",
        "platform": "ios",
    })
    if r and r.status_code == 200:
        ok("PUT /v1/notifications/device-token")
    else:
        fail("PUT /v1/notifications/device-token",
             f"HTTP {r.status_code if r else 'N/A'}: {str(body)[:120] if body else ''}")

# ══════════════════════════════════════════════════════════════════════════════
# 9. Complaints / Tickets
# ══════════════════════════════════════════════════════════════════════════════
section("Complaints / Tickets")

COMPLAINT_ID = None

if not APP_TOKEN:
    skip("Complaints endpoints", "no app token")
else:
    body = check("GET /v1/complaints/", "/v1/complaints/", headers=ah)
    if body:
        items = body["data"].get("items", [])
        COMPLAINT_ID = items[0]["id"] if items else None

    # Need a valid category id for POST
    cat_id = None
    if ADMIN_TOKEN:
        r, cbody = req("GET", "/v1/admin/investigations/complaint-categories", headers=aah)
        if r and r.status_code == 200 and cbody:
            cats = cbody.get("data", [])
            cat_id = cats[0]["id"] if cats else None

    if cat_id and ORDER_ID:
        r, body = req("POST", "/v1/complaints/", headers=ah, json={
            "categoryId": cat_id,
            "orderId": ORDER_ID,
            "description": "Automated test complaint — please ignore",
        })
        if r and r.status_code == 201 and body:
            ok("POST /v1/complaints/ (create)")
            COMPLAINT_ID = body["data"]["id"]
        else:
            fail("POST /v1/complaints/ (create)",
                 f"HTTP {r.status_code if r else 'N/A'}: {str(body)[:120] if body else ''}")
    elif not cat_id:
        skip("POST /v1/complaints/ (create)", "no complaint category in DB")
    else:
        skip("POST /v1/complaints/ (create)", "no order available for complaint")

    if COMPLAINT_ID:
        check("GET /v1/complaints/:id", f"/v1/complaints/{COMPLAINT_ID}", headers=ah)

# ══════════════════════════════════════════════════════════════════════════════
# 10. Finance
# ══════════════════════════════════════════════════════════════════════════════
section("Finance")

if SELLER_TOKEN and SELLER_USER_ID:
    check("GET /v1/finance/sellers/:id/summary",
          f"/v1/finance/sellers/{SELLER_USER_ID}/summary", headers=sh)
else:
    skip("GET /v1/finance/sellers/:id/summary", "no seller token")

# ══════════════════════════════════════════════════════════════════════════════
# 11. Seller Compliance
# ══════════════════════════════════════════════════════════════════════════════
section("Seller Compliance")

if SELLER_TOKEN:
    check("GET /v1/seller/compliance/profile",          "/v1/seller/compliance/profile",          headers=sh)
    check("GET /v1/seller/compliance/documents",        "/v1/seller/compliance/documents",        headers=sh)
    check("GET /v1/seller/compliance/optional-uploads", "/v1/seller/compliance/optional-uploads", headers=sh)
else:
    skip("Seller Compliance endpoints", "no seller token")

# ══════════════════════════════════════════════════════════════════════════════
# 12. Admin — Dashboard & Users
# ══════════════════════════════════════════════════════════════════════════════
section("Admin — Dashboard & Users")

SOME_USER_ID = None

if not ADMIN_TOKEN:
    skip("Admin endpoints", "no admin token")
else:
    check("GET /v1/admin/dashboard/overview",      "/v1/admin/dashboard/overview",      headers=aah)
    check("GET /v1/admin/dashboard/review-queue",  "/v1/admin/dashboard/review-queue",  headers=aah)

    body = check("GET /v1/admin/users", "/v1/admin/users", headers=aah)
    if body:
        users = body["data"].get("users", [])
        SOME_USER_ID = users[0]["id"] if users else None

    check("GET /v1/admin/users?search=test", "/v1/admin/users",
          params={"search": "test"}, headers=aah)
    check("GET /v1/admin/users?userType=buyer", "/v1/admin/users",
          params={"userType": "buyer"}, headers=aah)

    if SOME_USER_ID:
        check("GET /v1/admin/users/:id", f"/v1/admin/users/{SOME_USER_ID}", headers=aah)
    else:
        skip("GET /v1/admin/users/:id", "no users in DB")

# ══════════════════════════════════════════════════════════════════════════════
# 13. Admin — Investigations
# ══════════════════════════════════════════════════════════════════════════════
section("Admin — Investigations")

if ADMIN_TOKEN:
    body = check("GET /v1/admin/investigations/complaints",
                 "/v1/admin/investigations/complaints", headers=aah)
    ADMIN_COMPLAINT_ID = None
    if body:
        complaints = body["data"].get("complaints", [])
        ADMIN_COMPLAINT_ID = complaints[0]["id"] if complaints else None

    check("GET /v1/admin/investigations/complaint-categories",
          "/v1/admin/investigations/complaint-categories", headers=aah)

    if ADMIN_COMPLAINT_ID:
        check("GET /v1/admin/investigations/complaints/:id",
              f"/v1/admin/investigations/complaints/{ADMIN_COMPLAINT_ID}", headers=aah)
    else:
        skip("GET /v1/admin/investigations/complaints/:id", "no complaints in DB")

# ══════════════════════════════════════════════════════════════════════════════
# 14. Admin — Audit, Security, Search, Commission, Notifications
# ══════════════════════════════════════════════════════════════════════════════
section("Admin — Audit, Security, Search, Commission")

if ADMIN_TOKEN:
    check("GET /v1/admin/audit/events",         "/v1/admin/audit/events",         headers=aah)
    check("GET /v1/admin/security/login-events","/v1/admin/security/login-events",headers=aah)
    check("GET /v1/admin/search/global?q=test", "/v1/admin/search/global",
          params={"q": "test"}, headers=aah)

    r, body = req("GET", "/v1/admin/sales-commission-settings/latest", headers=aah)
    if r and r.status_code in (200, 404):
        ok("GET /v1/admin/sales-commission-settings/latest (200 or 404)")
    else:
        fail("GET /v1/admin/sales-commission-settings/latest",
             f"HTTP {r.status_code if r else 'N/A'}: {str(body)[:120] if body else ''}")

    r, body = req("POST", "/v1/admin/notifications/test", headers=aah)
    if r and r.status_code == 200:
        ok("POST /v1/admin/notifications/test")
    else:
        fail("POST /v1/admin/notifications/test",
             f"HTTP {r.status_code if r else 'N/A'}: {str(body)[:120] if body else ''}")

# ══════════════════════════════════════════════════════════════════════════════
# 15. Admin — Compliance Queue
# ══════════════════════════════════════════════════════════════════════════════
section("Admin — Compliance")

if ADMIN_TOKEN:
    check("GET /v1/admin/compliance/queue",         "/v1/admin/compliance/queue",         headers=aah)
    check("GET /v1/admin/compliance/document-list", "/v1/admin/compliance/document-list", headers=aah)

# ══════════════════════════════════════════════════════════════════════════════
# 16. Auth guards (no token → 401)
# ══════════════════════════════════════════════════════════════════════════════
section("Auth Guards")

check("GET /v1/foods/ without token → 401",
      "/v1/foods/", expected_status=401, key=None)
check("GET /v1/admin/dashboard/overview without token → 401",
      "/v1/admin/dashboard/overview", expected_status=401, key=None)

if APP_TOKEN:
    # App token must NOT pass admin check
    check("App token rejected on admin endpoint → 401",
          "/v1/admin/dashboard/overview", headers=ah, expected_status=401, key=None)

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
total = pass_count + fail_count + skip_count
print(f"\n{'═'*60}")
print(f"{BOLD}Results: {GREEN}{pass_count} passed{RESET}{BOLD}, "
      f"{RED}{fail_count} failed{RESET}{BOLD}, "
      f"{YELLOW}{skip_count} skipped{RESET}{BOLD} / {total} total{RESET}")

if fail_count:
    print(f"\n{RED}{BOLD}Failed tests:{RESET}")
    for passed, name, detail in results:
        if passed is False:
            print(f"  {RED}✗{RESET} {name}")
            if detail:
                print(f"    {detail}")
    sys.exit(1)
else:
    print(f"\n{GREEN}{BOLD}All tests passed!{RESET}")
