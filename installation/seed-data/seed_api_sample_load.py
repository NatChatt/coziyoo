#!/usr/bin/env python3
"""Seed rich Turkish sample data through Coziyoo HTTP API + PostgreSQL.

Flow:
- Create buyers/sellers/both-role users via /v1/auth/register
- Insert categories/foods directly into PostgreSQL
- Insert one active lot for each seeded food directly into PostgreSQL
- Backfill profile and GPS fields for created users
- Create orders via /v1/orders using lotId items
- Enrich generated rows for admin filter scenarios:
  complaints, payment attempts, login locations, and compliance docs
"""

from __future__ import annotations

import argparse
import json
import os
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


TURKISH_BUYER_NAMES: list[str] = [
    "Ahmet Yılmaz",
    "Mehmet Demir",
    "Ali Kaya",
    "Can Aydın",
    "Burak Şahin",
    "Murat Çelik",
    "Emre Arslan",
    "Deniz Koç",
    "Ece Yıldız",
    "Selin Öztürk",
]

# Portrait image URLs aligned with name order (gender-matched)
BUYER_PORTRAIT_URLS: list[str] = [
    "https://randomuser.me/api/portraits/men/32.jpg",    # Ahmet
    "https://randomuser.me/api/portraits/men/44.jpg",    # Mehmet
    "https://randomuser.me/api/portraits/men/11.jpg",    # Ali
    "https://randomuser.me/api/portraits/men/55.jpg",    # Can
    "https://randomuser.me/api/portraits/men/23.jpg",    # Burak
    "https://randomuser.me/api/portraits/men/67.jpg",    # Murat
    "https://randomuser.me/api/portraits/men/78.jpg",    # Emre
    "https://randomuser.me/api/portraits/men/5.jpg",     # Deniz
    "https://randomuser.me/api/portraits/women/19.jpg",  # Ece
    "https://randomuser.me/api/portraits/women/31.jpg",  # Selin
]

TURKISH_SELLER_NAMES: list[str] = [
    "Fatma Karaca",
    "Ayşe Güneş",
    "Zeynep Aksoy",
    "Elif Turan",
    "Merve Erdem",
    "Hakan İnce",
    "Yusuf Sarı",
    "Hasan Uçar",
    "Gamze Korkmaz",
    "İrem Kurt",
]

# Portrait image URLs aligned with name order (gender-matched)
SELLER_PORTRAIT_URLS: list[str] = [
    "https://randomuser.me/api/portraits/women/44.jpg",  # Fatma
    "https://randomuser.me/api/portraits/women/57.jpg",  # Ayşe
    "https://randomuser.me/api/portraits/women/26.jpg",  # Zeynep
    "https://randomuser.me/api/portraits/women/12.jpg",  # Elif
    "https://randomuser.me/api/portraits/women/65.jpg",  # Merve
    "https://randomuser.me/api/portraits/men/41.jpg",    # Hakan
    "https://randomuser.me/api/portraits/men/19.jpg",    # Yusuf
    "https://randomuser.me/api/portraits/men/52.jpg",    # Hasan
    "https://randomuser.me/api/portraits/women/33.jpg",  # Gamze
    "https://randomuser.me/api/portraits/women/48.jpg",  # İrem
]

CATEGORY_DEFS: list[dict[str, str]] = [
    {"tr": "Çorbalar", "en": "Soups"},
    {"tr": "Ana Yemekler", "en": "Main Dishes"},
    {"tr": "Zeytinyağlılar", "en": "Olive Oil Dishes"},
    {"tr": "Tatlılar", "en": "Desserts"},
    {"tr": "İçecekler", "en": "Beverages"},
]

FOOD_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "Çorbalar": [
        {
            "name": "Mercimek Çorbası",
            "card_summary": "Klasik kırmızı mercimek çorbası",
            "description": "Günlük hazırlanan, limonla servis edilen geleneksel mercimek çorbası.",
            "recipe": "Mercimek, soğan, havuç ve baharatlar ile 45 dakika pişirilir.",
            "ingredients": ["kırmızı mercimek", "soğan", "havuç", "tereyağı", "tuz"],
            "allergens": ["süt"],
        },
        {
            "name": "Ezogelin Çorbası",
            "card_summary": "Bulgur ve mercimekli baharatlı çorba",
            "description": "Nane ve pul biber ile tatlandırılmış yoğun kıvamlı ezogelin çorbası.",
            "recipe": "Mercimek ve bulgur kavrulur, salça ve baharatla kaynatılır.",
            "ingredients": ["mercimek", "ince bulgur", "salça", "nane", "soğan"],
            "allergens": [],
        },
    ],
    "Ana Yemekler": [
        {
            "name": "Karnıyarık",
            "card_summary": "Kıymalı patlıcan yemeği",
            "description": "Fırında pişmiş patlıcan içinde domatesli kıyma harcı ile hazırlanır.",
            "recipe": "Patlıcan kızartılır, kıymalı içle doldurulup fırınlanır.",
            "ingredients": ["patlıcan", "kıyma", "domates", "soğan", "biber"],
            "allergens": [],
        },
        {
            "name": "Tavuk Sote",
            "card_summary": "Sebzeli tavuk sote",
            "description": "Biber ve mantar ile wok tavada yüksek ateşte hazırlanır.",
            "recipe": "Jülyen tavuklar sebzelerle sotelenir ve baharatlanır.",
            "ingredients": ["tavuk", "biber", "mantar", "soğan", "zeytinyağı"],
            "allergens": [],
        },
    ],
    "Zeytinyağlılar": [
        {
            "name": "Zeytinyağlı Fasulye",
            "card_summary": "Soğuk servis yeşil fasulye",
            "description": "Domatesli ve zeytinyağlı klasik ev usulü tarif.",
            "recipe": "Fasulye, domates ve soğan ile kısık ateşte pişirilir.",
            "ingredients": ["yeşil fasulye", "domates", "soğan", "zeytinyağı", "sarımsak"],
            "allergens": [],
        },
        {
            "name": "Enginar Dolması",
            "card_summary": "İç baklalı enginar",
            "description": "Limonlu ve dereotlu hafif zeytinyağlı bir seçenek.",
            "recipe": "Enginar çanakları iç bakla harcıyla doldurulur ve pişirilir.",
            "ingredients": ["enginar", "iç bakla", "dereotu", "limon", "zeytinyağı"],
            "allergens": [],
        },
    ],
    "Tatlılar": [
        {
            "name": "Sütlaç",
            "card_summary": "Fırın üstü nar gibi sütlaç",
            "description": "Vanilya aromalı pirinçli süt tatlısı.",
            "recipe": "Pirinç süt ile kaynatılır, kaselerde fırınlanır.",
            "ingredients": ["süt", "pirinç", "şeker", "vanilya"],
            "allergens": ["süt"],
        },
        {
            "name": "Revani",
            "card_summary": "Şerbetli irmik tatlısı",
            "description": "Limon kabuğu aromalı yumuşak revani.",
            "recipe": "İrmik hamuru pişirilir, şerbet dökülerek dinlendirilir.",
            "ingredients": ["irmik", "yoğurt", "yumurta", "şeker", "un"],
            "allergens": ["gluten", "yumurta", "süt"],
        },
    ],
    "İçecekler": [
        {
            "name": "Ayran",
            "card_summary": "Soğuk ve köpüklü ayran",
            "description": "Günlük yoğurttan hazırlanmış serinletici içecek.",
            "recipe": "Yoğurt, su ve tuz yüksek devirde çırpılır.",
            "ingredients": ["yoğurt", "su", "tuz"],
            "allergens": ["süt"],
        },
        {
            "name": "Şalgam",
            "card_summary": "Acılı fermente içecek",
            "description": "Geleneksel Adana usulü mor havuç ve şalgam suyu.",
            "recipe": "Fermente şalgam suyu süzülerek soğuk servis edilir.",
            "ingredients": ["mor havuç", "şalgam", "su", "tuz"],
            "allergens": [],
        },
    ],
}

TURKEY_CITY_COORDS: list[tuple[str, float, float]] = [
    ("İstanbul", 41.0082, 28.9784),
    ("Ankara", 39.9334, 32.8597),
    ("İzmir", 38.4237, 27.1428),
    ("Bursa", 40.1950, 29.0600),
    ("Antalya", 36.8969, 30.7133),
    ("Adana", 37.0000, 35.3213),
    ("Konya", 37.8746, 32.4932),
    ("Gaziantep", 37.0662, 37.3833),
    ("Kayseri", 38.7225, 35.4875),
    ("Trabzon", 41.0015, 39.7178),
]

FOOD_IMAGE_BY_KEYWORD: list[tuple[str, str]] = [
    ("mercimek", "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80"),
    ("ezogelin", "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80"),
    ("corba", "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80"),
    ("karnıyarık", "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80"),
    ("karniyarik", "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80"),
    ("kuru fasulye", "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80"),
    ("fasulye", "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80"),
    ("tavuk", "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=900&q=80"),
    ("pilav", "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80"),
    ("enginar", "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80"),
    ("zeytinyagli", "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80"),
    ("zeytinyağlı", "https://images.unsplash.com/photo-1611584186769-0a53b5f7f350?auto=format&fit=crop&w=900&q=80"),
    ("sutlac", "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80"),
    ("sütlaç", "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80"),
    ("revani", "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80"),
    ("baklava", "https://images.unsplash.com/photo-1626803775151-61d756612f97?auto=format&fit=crop&w=900&q=80"),
    ("ayran", "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80"),
    ("salgam", "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80"),
    ("şalgam", "https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=900&q=80"),
]


@dataclass
class UserAccount:
    email: str
    password: str
    user_id: str
    access_token: str
    full_name: str


def short_id(value: str, n: int = 8) -> str:
    if not value:
        return value
    return value[:n]


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def rand_suffix(n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))


def normalize_ascii(text: str) -> str:
    table = str.maketrans(
        {
            "ç": "c",
            "Ç": "c",
            "ğ": "g",
            "Ğ": "g",
            "ı": "i",
            "İ": "i",
            "ö": "o",
            "Ö": "o",
            "ş": "s",
            "Ş": "s",
            "ü": "u",
            "Ü": "u",
        }
    )
    return text.translate(table)


def slugify_display(text: str) -> str:
    cleaned = normalize_ascii(text).lower().replace("'", " ")
    parts = [p for p in cleaned.replace("-", " ").split() if p]
    return "_".join(parts)


def camel_case_display(text: str) -> str:
    cleaned = normalize_ascii(text).replace("-", " ").replace("_", " ")
    parts = [p for p in cleaned.split() if p]
    return "".join(part[:1].upper() + part[1:].lower() for part in parts)


def compact_email_local(full_name: str, index: int, seed_id: str) -> str:
    base = camel_case_display(full_name).lower()
    tiny = seed_id[-2:].lower()
    return f"{base}{index:02d}{tiny}"


def http_json(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any]]:
    body: bytes | None = None
    req_headers = {"content-type": "application/json"}
    if headers:
        req_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url=url, data=body, headers=req_headers, method=method.upper())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read().decode("utf-8")
            return status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"error": {"code": "HTTP_ERROR", "message": raw}}
        return exc.code, parsed


def join_url(base_url: str, path: str, query: dict[str, Any] | None = None) -> str:
    base = base_url.rstrip("/")
    full = f"{base}{path}"
    if not query:
        return full
    return f"{full}?{urllib.parse.urlencode(query)}"


def register_user(
    base_url: str,
    *,
    email: str,
    password: str,
    display_name: str,
    full_name: str,
    user_type: str,
) -> UserAccount:
    status, body = http_json(
        "POST",
        join_url(base_url, "/v1/auth/register"),
        payload={
            "email": email,
            "password": password,
            "displayName": display_name,
            "fullName": full_name,
            "userType": user_type,
            "countryCode": "TR",
            "language": "tr",
        },
    )
    if status != 201:
        raise RuntimeError(f"register failed ({email}) status={status} body={body}")
    data = body["data"]
    return UserAccount(
        email=email,
        password=password,
        user_id=data["user"]["id"],
        access_token=data["tokens"]["accessToken"],
        full_name=full_name,
    )


def admin_login(base_url: str, *, email: str, password: str) -> str:
    status, body = http_json(
        "POST",
        join_url(base_url, "/v1/admin/auth/login"),
        payload={"email": email, "password": password},
    )
    if status != 200:
        raise RuntimeError(f"admin login failed status={status} body={body}")
    return body["data"]["tokens"]["accessToken"]


def create_order(
    base_url: str,
    *,
    buyer_token: str,
    seller_id: str,
    items: list[dict[str, Any]],
    delivery_address: dict[str, Any],
    idempotency_key: str,
    max_retries: int = 6,
) -> dict[str, Any]:
    attempt = 0
    while True:
        status, body = http_json(
            "POST",
            join_url(base_url, "/v1/orders"),
            payload={
                "sellerId": seller_id,
                "deliveryType": "delivery",
                "deliveryAddress": delivery_address,
                "items": items,
            },
            headers={
                "authorization": f"Bearer {buyer_token}",
                "Idempotency-Key": idempotency_key,
                "x-actor-role": "buyer",
            },
        )
        if status == 201:
            return body
        if status == 429 and attempt < max_retries:
            wait_s = 2**attempt
            print(f"rate limited, retrying in {wait_s}s (attempt {attempt + 1}/{max_retries})")
            time.sleep(wait_s)
            attempt += 1
            continue
        raise RuntimeError(f"order create failed status={status} body={body}")


def load_db_driver() -> tuple[str, Any]:
    try:
        import psycopg  # type: ignore

        return "psycopg", psycopg
    except ImportError:
        pass

    try:
        import psycopg2  # type: ignore

        return "psycopg2", psycopg2
    except ImportError as exc:
        raise RuntimeError(
            "PostgreSQL driver not found. Install 'psycopg' or 'psycopg2-binary' to run this seed script."
        ) from exc


def open_db(database_url: str) -> tuple[Any, str]:
    driver_name, driver = load_db_driver()
    if driver_name == "psycopg":
        conn = driver.connect(database_url)
        conn.autocommit = False
        return conn, driver_name

    conn = driver.connect(database_url)
    conn.autocommit = False
    return conn, driver_name


def user_coordinates(index: int) -> tuple[str, float, float]:
    city, lat, lon = TURKEY_CITY_COORDS[index % len(TURKEY_CITY_COORDS)]
    jitter_lat = random.uniform(-0.03, 0.03)
    jitter_lon = random.uniform(-0.03, 0.03)
    return city, round(lat + jitter_lat, 6), round(lon + jitter_lon, 6)


def build_food_payload(category_name_tr: str, seller_slot: int, food_slot: int) -> dict[str, Any]:
    options = FOOD_TEMPLATES[category_name_tr]
    base = options[(seller_slot + food_slot) % len(options)]
    price = round(random.uniform(70, 280), 2)
    prep_minutes = random.randint(15, 60)

    return {
        "name": f"{base['name']} ({seller_slot + 1}-{food_slot + 1})",
        "card_summary": base["card_summary"],
        "description": base["description"],
        "recipe": base["recipe"],
        "country_code": "TR",
        "price": price,
        "image_url": resolve_seed_food_image_url(base["name"]),
        "ingredients_json": base["ingredients"],
        "allergens_json": base["allergens"],
        "preparation_time_minutes": prep_minutes,
        "serving_size": "1 porsiyon",
        "is_active": True,
    }


def resolve_seed_food_image_url(food_name: str) -> str:
    normalized = normalize_ascii(food_name).lower()
    for keyword, url in FOOD_IMAGE_BY_KEYWORD:
        if keyword in normalized:
            return url
    return "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=80"


def seed_categories(conn: Any, *, count: int) -> list[dict[str, Any]]:
    categories: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        for idx in range(count):
            base = CATEGORY_DEFS[idx % len(CATEGORY_DEFS)]
            name_tr = base["tr"]
            name_en = base["en"]
            if idx >= len(CATEGORY_DEFS):
                suffix = idx - len(CATEGORY_DEFS) + 2
                name_tr = f"{name_tr} {suffix}"
                name_en = f"{name_en} {suffix}"
            cur.execute(
                """
                INSERT INTO categories (name_tr, name_en, sort_order, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, TRUE, now(), now())
                RETURNING id::text, name_tr, name_en
                """,
                (name_tr, name_en, idx),
            )
            row = cur.fetchone()
            categories.append({"id": row[0], "nameTr": row[1], "nameEn": row[2]})
    return categories


def ensure_user_gps_columns(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6)
            """
        )
        cur.execute(
            """
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6)
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'users_latitude_range_check'
              ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_latitude_range_check CHECK (latitude BETWEEN -90 AND 90);
              END IF;
            END $$;
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'users_longitude_range_check'
              ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_longitude_range_check CHECK (longitude BETWEEN -180 AND 180);
              END IF;
            END $$;
            """
        )


def backfill_users(conn: Any, users: list[UserAccount], *, role: str) -> dict[str, dict[str, Any]]:
    portrait_pool = SELLER_PORTRAIT_URLS if role == "seller" else BUYER_PORTRAIT_URLS
    out: dict[str, dict[str, Any]] = {}
    with conn.cursor() as cur:
        for idx, user in enumerate(users):
            city, lat, lon = user_coordinates(idx + (100 if role == "seller" else 0))
            profile_image_url = portrait_pool[idx % len(portrait_pool)]
            cur.execute(
                """
                UPDATE users
                SET full_name = %s,
                    profile_image_url = %s,
                    country_code = 'TR',
                    language = 'tr',
                    latitude = %s,
                    longitude = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (user.full_name, profile_image_url, lat, lon, user.user_id),
            )
            out[user.user_id] = {
                "city": city,
                "latitude": lat,
                "longitude": lon,
                "profileImageUrl": profile_image_url,
            }
    return out


def seed_foods(
    conn: Any,
    *,
    sellers: list[UserAccount],
    categories: list[dict[str, Any]],
    foods_per_seller: int,
) -> dict[str, list[dict[str, Any]]]:
    foods_by_seller: dict[str, list[dict[str, Any]]] = {}
    with conn.cursor() as cur:
        for seller_idx, seller in enumerate(sellers):
            rows: list[dict[str, Any]] = []
            for food_idx in range(foods_per_seller):
                category = categories[food_idx % len(categories)]
                payload = build_food_payload(category["nameTr"], seller_idx, food_idx)
                cur.execute(
                    """
                    INSERT INTO foods (
                      seller_id,
                      category_id,
                      name,
                      card_summary,
                      description,
                      recipe,
                      country_code,
                      price,
                      image_url,
                      ingredients_json,
                      allergens_json,
                      preparation_time_minutes,
                      serving_size,
                      is_active,
                      created_at,
                      updated_at
                    )
                    VALUES (
                      %s,
                      %s::uuid,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s::jsonb,
                      %s::jsonb,
                      %s,
                      %s,
                      %s,
                      now(),
                      now()
                    )
                    RETURNING id::text, seller_id::text, category_id::text, name, price::text
                    """,
                    (
                        seller.user_id,
                        category["id"],
                        payload["name"],
                        payload["card_summary"],
                        payload["description"],
                        payload["recipe"],
                        payload["country_code"],
                        payload["price"],
                        payload["image_url"],
                        json.dumps(payload["ingredients_json"], ensure_ascii=False),
                        json.dumps(payload["allergens_json"], ensure_ascii=False),
                        payload["preparation_time_minutes"],
                        payload["serving_size"],
                        payload["is_active"],
                    ),
                )
                inserted = cur.fetchone()
                rows.append(
                    {
                        "id": inserted[0],
                        "sellerId": inserted[1],
                        "categoryId": inserted[2],
                        "name": inserted[3],
                        "price": inserted[4],
                    }
                )
            foods_by_seller[seller.user_id] = rows
    return foods_by_seller


def seed_lots(
    conn: Any,
    *,
    foods_by_seller: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    lots_by_seller: dict[str, list[dict[str, Any]]] = {}
    with conn.cursor() as cur:
        for seller_id, foods in foods_by_seller.items():
            seller_lots: list[dict[str, Any]] = []
            for idx, food in enumerate(foods):
                lot_number = f"SEED-{short_id(food['id'], 6).upper()}-{now_stamp()}-{idx + 1:02d}-{rand_suffix(4).upper()}"
                quantity_produced = 500
                quantity_available = 500
                cur.execute(
                    """
                    INSERT INTO production_lots (
                      seller_id,
                      food_id,
                      lot_number,
                      produced_at,
                      sale_starts_at,
                      sale_ends_at,
                      recipe_snapshot,
                      ingredients_snapshot_json,
                      allergens_snapshot_json,
                      quantity_produced,
                      quantity_available,
                      status,
                      notes,
                      created_at,
                      updated_at
                    )
                    SELECT
                      f.seller_id,
                      f.id,
                      %s,
                      now() - interval '1 hour',
                      now(),
                      now() + interval '3 days',
                      f.recipe,
                      f.ingredients_json,
                      f.allergens_json,
                      %s,
                      %s,
                      'active',
                      'seed_api_sample_load',
                      now(),
                      now()
                    FROM foods f
                    WHERE f.id = %s::uuid
                    RETURNING id::text, food_id::text, quantity_available
                    """,
                    (lot_number, quantity_produced, quantity_available, food["id"]),
                )
                inserted = cur.fetchone()
                if not inserted:
                    raise RuntimeError(f"lot create failed for food={food['id']}")
                seller_lots.append(
                    {
                        "id": inserted[0],
                        "foodId": inserted[1],
                        "quantityAvailable": int(inserted[2]),
                    }
                )
            lots_by_seller[seller_id] = seller_lots
    return lots_by_seller


def build_items_for_seller(seller_lots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    count = min(len(seller_lots), random.randint(1, 3))
    picked = random.sample(seller_lots, k=count)
    return [{"lotId": row["id"], "quantity": random.randint(1, 3)} for row in picked]


def profile_for(index: int, names: list[str]) -> tuple[str, str]:
    full_name = names[index % len(names)]
    return slugify_display(full_name), full_name


def ensure_compliance_document_types(conn: Any) -> list[dict[str, Any]]:
    fallback_types = [
        {
            "code": "gida_isletme_kaydi",
            "name": "Gida Isletme Kayit Belgesi",
            "description": "TR gida mevzuatina uygun kayit belgesi",
            "source_info": "seed_api_sample_load fallback",
            "details": "Filter testing sample",
            "is_required_default": True,
        },
        {
            "code": "vergi_levhasi",
            "name": "Vergi Levhasi",
            "description": "Guncel vergi levhasi",
            "source_info": "seed_api_sample_load fallback",
            "details": "Filter testing sample",
            "is_required_default": True,
        },
        {
            "code": "kvkk_taahhut",
            "name": "KVKK Taahhut",
            "description": "KVKK sureclerine uyum taahhudu",
            "source_info": "seed_api_sample_load fallback",
            "details": "Filter testing sample",
            "is_required_default": False,
        },
        {
            "code": "hijyen_egitimi",
            "name": "Hijyen Egitimi Belgesi",
            "description": "Personel hijyen egitimi sertifikasi",
            "source_info": "seed_api_sample_load fallback",
            "details": "Filter testing sample",
            "is_required_default": True,
        },
    ]
    with conn.cursor() as cur:
        for row in fallback_types:
            cur.execute(
                """
                INSERT INTO compliance_documents_list (
                  code,
                  name,
                  description,
                  source_info,
                  details,
                  is_active,
                  is_required_default,
                  created_at,
                  updated_at
                )
                VALUES (%s, %s, %s, %s, %s, TRUE, %s, now(), now())
                ON CONFLICT (code)
                DO UPDATE SET
                  name = EXCLUDED.name,
                  description = EXCLUDED.description,
                  source_info = EXCLUDED.source_info,
                  details = EXCLUDED.details,
                  is_active = TRUE,
                  is_required_default = EXCLUDED.is_required_default,
                  updated_at = now()
                """,
                (
                    row["code"],
                    row["name"],
                    row["description"],
                    row["source_info"],
                    row["details"],
                    row["is_required_default"],
                ),
            )
        cur.execute(
            """
            SELECT id::text, code, is_required_default
            FROM compliance_documents_list
            WHERE is_active = TRUE
            ORDER BY code ASC
            """
        )
        rows = cur.fetchall()
    return [{"id": r[0], "code": r[1], "isRequiredDefault": bool(r[2])} for r in rows]


def ensure_complaint_categories(conn: Any) -> list[str]:
    categories = [
        ("teslimat_gecikmesi", "Teslimat Gecikmesi"),
        ("urun_kalitesi", "Urun Kalitesi"),
        ("yanlis_urun", "Yanlis Urun"),
        ("ucret_iadesi", "Ucret Iadesi"),
    ]
    category_ids: list[str] = []
    with conn.cursor() as cur:
        for code, name in categories:
            cur.execute(
                """
                INSERT INTO complaint_categories (code, name, is_active)
                VALUES (%s, %s, TRUE)
                ON CONFLICT (code)
                DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
                RETURNING id::text
                """,
                (code, name),
            )
            category_ids.append(cur.fetchone()[0])
    return category_ids


def enrich_seed_dataset(
    conn: Any,
    *,
    created_orders: list[dict[str, Any]],
    buyer_capable_users: list[UserAccount],
    seller_capable_users: list[UserAccount],
    sample_doc_url: str,
) -> dict[str, int]:
    if not created_orders:
        return {
            "ordersUpdated": 0,
            "paymentAttemptsCreated": 0,
            "complaintsCreated": 0,
            "loginLocationsCreated": 0,
            "complianceDocsUpserted": 0,
        }

    compliance_doc_types = ensure_compliance_document_types(conn)
    complaint_category_ids = ensure_complaint_categories(conn)
    now = datetime.now(timezone.utc)
    buyer_index = {u.user_id: idx for idx, u in enumerate(buyer_capable_users)}
    seller_ids = [u.user_id for u in seller_capable_users]
    risky_seller_ids = seller_ids[: min(3, len(seller_ids))]
    seller_id_set = set(seller_ids)
    suspicious_user_ids = [u.user_id for u in buyer_capable_users[: min(8, len(buyer_capable_users))]]
    same_ip_user_ids = [u.user_id for u in buyer_capable_users[: min(6, len(buyer_capable_users))]]

    orders_by_buyer: dict[str, list[dict[str, Any]]] = {}
    for row in created_orders:
        orders_by_buyer.setdefault(row["buyerId"], []).append(row)

    payment_attempts_created = 0
    complaints_created = 0
    login_locations_created = 0
    compliance_docs_upserted = 0
    orders_updated = 0

    with conn.cursor() as cur:
        cur.execute("SELECT id::text FROM admin_users ORDER BY created_at ASC LIMIT 1")
        admin_row = cur.fetchone()
        admin_id = admin_row[0] if admin_row else None

        complaint_seed_rows: list[dict[str, Any]] = []
        for user_id, rows in orders_by_buyer.items():
            rows.sort(key=lambda x: x["orderId"])
            idx = buyer_index.get(user_id, 0)
            trend = idx % 3  # 0: up, 1: down, 2: flat
            for pos, row in enumerate(rows):
                order_id = row["orderId"]
                seller_id = row["sellerId"]

                if trend == 0:
                    age_days = [46, 9, 0][pos % 3]
                elif trend == 1:
                    age_days = [54, 39, 5][pos % 3]
                else:
                    age_days = [50, 20, 2][pos % 3]

                if idx == 0 and pos >= 1:
                    age_days = 0  # force "daily buyer" winner

                created_at = now - timedelta(days=age_days, hours=(idx % 6), minutes=pos * 7)
                requested_at = created_at - timedelta(minutes=35)
                updated_at = created_at + timedelta(minutes=15)

                if pos == 0:
                    status = "completed"
                    payment_status = "confirmed"
                    payment_completed = True
                elif pos == 1 and idx % 4 == 0:
                    status = "cancelled"
                    payment_status = "failed"
                    payment_completed = False
                elif pos == 2 and idx % 5 == 0:
                    status = "awaiting_payment"
                    payment_status = "pending"
                    payment_completed = False
                elif pos == 2 and idx % 7 == 0:
                    status = "seller_approved"
                    payment_status = "pending"
                    payment_completed = False
                else:
                    status = "completed"
                    payment_status = "confirmed"
                    payment_completed = True

                boosted_total = 1200.0 + (idx * 5) if idx == 0 and age_days == 0 else 0.0
                if boosted_total > 0:
                    cur.execute(
                        "UPDATE orders SET total_price = %s WHERE id = %s::uuid",
                        (boosted_total, order_id),
                    )

                cur.execute(
                    """
                    UPDATE orders
                    SET status = %s,
                        payment_completed = %s,
                        requested_at = %s,
                        created_at = %s,
                        updated_at = %s
                    WHERE id = %s::uuid
                    """,
                    (status, payment_completed, requested_at, created_at, updated_at, order_id),
                )
                orders_updated += 1

                provider_session_id = f"seed-session-{short_id(order_id, 8)}-{idx:02d}-{pos:02d}"
                provider_reference_id = f"seed-ref-{short_id(order_id, 8)}-{idx:02d}-{pos:02d}"
                callback_payload = {
                    "seed": True,
                    "orderStatus": status,
                    "paymentStatus": payment_status,
                    "createdAt": created_at.isoformat(),
                }
                cur.execute(
                    """
                    INSERT INTO payment_attempts (
                      order_id,
                      buyer_id,
                      provider,
                      provider_session_id,
                      provider_reference_id,
                      status,
                      callback_payload_json,
                      signature_valid,
                      created_at,
                      updated_at
                    )
                    VALUES (%s::uuid, %s::uuid, 'seedpay', %s, %s, %s, %s::jsonb, TRUE, %s, %s)
                    """,
                    (
                        order_id,
                        user_id,
                        provider_session_id,
                        provider_reference_id,
                        payment_status,
                        json.dumps(callback_payload, ensure_ascii=False),
                        created_at,
                        updated_at,
                    ),
                )
                payment_attempts_created += 1

                if len(complaint_seed_rows) < 60 and (idx % 2 == 0 or seller_id in risky_seller_ids):
                    complaint_seed_rows.append(
                        {
                            "orderId": order_id,
                            "buyerId": user_id,
                            "sellerId": seller_id,
                            "createdAt": created_at,
                        }
                    )

        # ensure risky sellers have enough open complaints
        risky_rows = [r for r in complaint_seed_rows if r["sellerId"] in risky_seller_ids]
        while len(risky_rows) < 12:
            for row in created_orders:
                if row["sellerId"] in risky_seller_ids:
                    risky_rows.append(
                        {
                            "orderId": row["orderId"],
                            "buyerId": row["buyerId"],
                            "sellerId": row["sellerId"],
                            "createdAt": now - timedelta(days=(len(risky_rows) % 14)),
                        }
                    )
                if len(risky_rows) >= 12:
                    break
        complaint_rows = risky_rows[:12] + complaint_seed_rows[:48]
        for i, row in enumerate(complaint_rows):
            if i < 12:
                status = "open" if i % 2 == 0 else "in_review"
            else:
                status = ["open", "in_review", "resolved", "closed"][i % 4]
            priority = ["low", "medium", "high", "urgent"][i % 4]
            created_at = row["createdAt"] + timedelta(hours=2)
            resolved_at = created_at + timedelta(days=2) if status in ("resolved", "closed") else None
            resolution_note = "Seed resolution note" if resolved_at else None
            category_id = complaint_category_ids[i % len(complaint_category_ids)]
            cur.execute(
                """
                INSERT INTO complaints (
                  order_id,
                  complainant_buyer_id,
                  subject,
                  status,
                  created_at,
                  description,
                  category_id,
                  priority,
                  resolved_at,
                  resolution_note,
                  assigned_admin_id
                )
                VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::uuid, %s, %s, %s, %s::uuid)
                """,
                (
                    row["orderId"],
                    row["buyerId"],
                    f"Seed complaint #{i + 1}",
                    status,
                    created_at,
                    "Filter coverage complaint record",
                    category_id,
                    priority,
                    resolved_at,
                    resolution_note,
                    admin_id,
                ),
            )
            complaints_created += 1

        # login locations
        for idx, user in enumerate(buyer_capable_users):
            base_lat = 41.0 + ((idx % 10) * 0.03)
            base_lon = 29.0 + ((idx % 10) * 0.03)
            for j in range(2):
                created_at = now - timedelta(days=2 + j, hours=idx % 5)
                cur.execute(
                    """
                    INSERT INTO user_login_locations (
                      user_id, session_id, latitude, longitude, accuracy_m, source, ip, user_agent, created_at
                    )
                    VALUES (%s::uuid, NULL, %s, %s, %s, 'app', %s, %s, %s)
                    """,
                    (
                        user.user_id,
                        round(base_lat + (j * 0.01), 6),
                        round(base_lon + (j * 0.01), 6),
                        20 + j,
                        f"10.0.{idx % 200}.{j + 1}",
                        "seed-agent/buyer",
                        created_at,
                    ),
                )
                login_locations_created += 1

        for idx, user in enumerate(seller_capable_users):
            created_at = now - timedelta(days=3, hours=idx % 4)
            cur.execute(
                """
                INSERT INTO user_login_locations (
                  user_id, session_id, latitude, longitude, accuracy_m, source, ip, user_agent, created_at
                )
                VALUES (%s::uuid, NULL, %s, %s, %s, 'admin_seed', %s, %s, %s)
                """,
                (
                    user.user_id,
                    round(40.95 + (idx * 0.02), 6),
                    round(29.05 + (idx * 0.02), 6),
                    35,
                    f"172.16.{idx % 200}.10",
                    "seed-agent/seller",
                    created_at,
                ),
            )
            login_locations_created += 1

        for idx, user_id in enumerate(suspicious_user_ids):
            for j in range(2):
                created_at = now - timedelta(hours=3 + j)
                cur.execute(
                    """
                    INSERT INTO user_login_locations (
                      user_id, session_id, latitude, longitude, accuracy_m, source, ip, user_agent, created_at
                    )
                    VALUES (%s::uuid, NULL, %s, %s, %s, 'app', %s, %s, %s)
                    """,
                    (
                        user_id,
                        41.02 + (j * 1.25),
                        28.98 + (j * 1.25),
                        15,
                        f"203.0.113.{(idx * 2) + j + 1}",
                        "seed-agent/suspicious",
                        created_at,
                    ),
                )
                login_locations_created += 1

        pair_count = len(same_ip_user_ids) // 2
        for pair_idx in range(pair_count):
            shared_ip = f"198.51.100.{pair_idx + 10}"
            first = same_ip_user_ids[pair_idx * 2]
            second = same_ip_user_ids[(pair_idx * 2) + 1]
            for user_id, offset in ((first, 1), (second, 2)):
                created_at = now - timedelta(hours=offset)
                cur.execute(
                    """
                    INSERT INTO user_login_locations (
                      user_id, session_id, latitude, longitude, accuracy_m, source, ip, user_agent, created_at
                    )
                    VALUES (%s::uuid, NULL, %s, %s, %s, 'app', %s, %s, %s)
                    """,
                    (
                        user_id,
                        41.12 + pair_idx * 0.01,
                        29.12 + pair_idx * 0.01,
                        18,
                        shared_ip,
                        "seed-agent/shared-ip",
                        created_at,
                    ),
                )
                login_locations_created += 1

        # compliance docs with a single shared sample PDF URL
        doc_status_cycle = ["uploaded", "approved", "rejected", "requested"]
        for s_idx, seller in enumerate(seller_capable_users):
            if seller.user_id not in seller_id_set:
                continue
            for d_idx, doc in enumerate(compliance_doc_types):
                status = doc_status_cycle[(s_idx + d_idx) % len(doc_status_cycle)]
                reviewed_at = now - timedelta(days=(s_idx + d_idx) % 7) if status in ("approved", "rejected") else None
                reviewed_by = admin_id if reviewed_at else None
                rejection_reason = "Belge okunamadi" if status == "rejected" else None
                uploaded_at = now - timedelta(days=(s_idx + d_idx) % 10)
                is_required = doc["isRequiredDefault"] if (d_idx % 2 == 0) else (not doc["isRequiredDefault"])
                cur.execute(
                    """
                    INSERT INTO seller_compliance_documents (
                      seller_id,
                      document_list_id,
                      is_required,
                      status,
                      file_url,
                      uploaded_at,
                      reviewed_at,
                      reviewed_by_admin_id,
                      rejection_reason,
                      notes,
                      created_at,
                      updated_at
                    )
                    VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s, %s::uuid, %s, %s, now(), now())
                    ON CONFLICT (seller_id, document_list_id)
                    DO UPDATE SET
                      is_required = EXCLUDED.is_required,
                      status = EXCLUDED.status,
                      file_url = EXCLUDED.file_url,
                      uploaded_at = EXCLUDED.uploaded_at,
                      reviewed_at = EXCLUDED.reviewed_at,
                      reviewed_by_admin_id = EXCLUDED.reviewed_by_admin_id,
                      rejection_reason = EXCLUDED.rejection_reason,
                      notes = EXCLUDED.notes,
                      updated_at = now()
                    """,
                    (
                        seller.user_id,
                        doc["id"],
                        is_required,
                        status,
                        sample_doc_url,
                        uploaded_at,
                        reviewed_at,
                        reviewed_by,
                        rejection_reason,
                        "seed_api_sample_load compliance sample",
                    ),
                )
                compliance_docs_upserted += 1

    return {
        "ordersUpdated": orders_updated,
        "paymentAttemptsCreated": payment_attempts_created,
        "complaintsCreated": complaints_created,
        "loginLocationsCreated": login_locations_created,
        "complianceDocsUpserted": compliance_docs_upserted,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed buyers/sellers/categories/foods/orders via Coziyoo API + PostgreSQL.")
    parser.add_argument("--base-url", default="https://api.coziyoo.com", help="API base URL")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="PostgreSQL DSN (or use DATABASE_URL env)")
    parser.add_argument("--buyers", type=int, default=10, help="Buyer users to create")
    parser.add_argument("--sellers", type=int, default=10, help="Seller users to create")
    parser.add_argument("--both-users", type=int, default=0, help="Both-role users to create")
    parser.add_argument("--categories", type=int, default=5, help="Categories to create")
    parser.add_argument("--foods-per-seller", type=int, default=5, help="Foods to create for each new seller")
    parser.add_argument("--orders-per-buyer", type=int, default=5, help="Orders to create for each buyer")
    parser.add_argument("--admin-email", default="admin@coziyoo.com", help="Admin email for auth check")
    parser.add_argument("--admin-password", default="12345", help="Admin password for auth check")
    parser.add_argument("--buyer-password", default="Buyer12345!", help="Password used for new buyers")
    parser.add_argument("--seller-password", default="Seller12345!", help="Password used for new sellers")
    parser.add_argument("--both-password", default="Both12345!", help="Password used for new both-role users")
    parser.add_argument(
        "--sample-doc-url",
        default="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        help="Shared sample PDF URL used for seller compliance documents",
    )
    parser.add_argument(
        "--wide-profile",
        action="store_true",
        help="Apply wide filter-testing preset (24 buyers, 14 sellers, 6 both, 3 orders per buyer)",
    )
    parser.add_argument("--seed", default=None, help="Deterministic seed string")
    parser.add_argument("--order-interval-seconds", type=float, default=1.2, help="Delay between order requests")
    parser.add_argument(
        "--out",
        default="scripts/seed_api_sample_load_output.json",
        help="Path to write created account/food/order summary",
    )
    args = parser.parse_args()

    if args.wide_profile:
        args.buyers = 24
        args.sellers = 14
        args.both_users = 6
        args.orders_per_buyer = 3

    if not args.database_url:
        raise RuntimeError("DATABASE_URL is required. Pass --database-url or export DATABASE_URL.")

    seed_id = args.seed or f"{now_stamp()}-{rand_suffix()}"
    random.seed(seed_id)
    print(f"seed run: {seed_id}")
    print(
        f"target: buyers={args.buyers} sellers={args.sellers} both={args.both_users} "
        f"categories={args.categories} foods_per_seller={args.foods_per_seller} orders_per_buyer={args.orders_per_buyer}"
    )

    _admin_token = admin_login(args.base_url, email=args.admin_email, password=args.admin_password)

    buyers: list[UserAccount] = []
    sellers: list[UserAccount] = []
    both_users: list[UserAccount] = []

    for i in range(args.buyers):
        handle, full_name = profile_for(i, TURKISH_BUYER_NAMES)
        email_local = compact_email_local(full_name, i + 1, seed_id)
        email = f"{email_local}@coziyoo.local"
        display_name = f"{camel_case_display(full_name)}{seed_id[-2:]}{i + 1:02d}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.buyer_password,
            display_name=display_name,
            full_name=full_name,
            user_type="buyer",
        )
        buyers.append(account)
        print(f"[buyer {i + 1}/{args.buyers}] {account.email} ({short_id(account.user_id)})")

    for i in range(args.sellers):
        handle, full_name = profile_for(i, TURKISH_SELLER_NAMES)
        email_local = compact_email_local(full_name, i + 1, seed_id)
        email = f"{email_local}@coziyoo.local"
        display_name = f"{camel_case_display(full_name)}{seed_id[-2:]}{i + 1:02d}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.seller_password,
            display_name=display_name,
            full_name=full_name,
            user_type="seller",
        )
        sellers.append(account)
        print(f"[seller {i + 1}/{args.sellers}] {account.email} ({short_id(account.user_id)})")

    for i in range(args.both_users):
        handle, full_name = profile_for(i, TURKISH_BUYER_NAMES)
        email_local = compact_email_local(full_name, i + 1, seed_id)
        email = f"both_{email_local}@coziyoo.local"
        display_name = f"Both{camel_case_display(full_name)}{seed_id[-2:]}{i + 1:02d}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.both_password,
            display_name=display_name,
            full_name=full_name,
            user_type="both",
        )
        both_users.append(account)
        print(f"[both {i + 1}/{args.both_users}] {account.email} ({short_id(account.user_id)})")

    buyer_capable_users = buyers + both_users
    seller_capable_users = sellers + both_users

    conn, db_driver = open_db(args.database_url)
    print(f"connected to postgres with driver={db_driver}")
    try:
        ensure_user_gps_columns(conn)
        categories = seed_categories(conn, count=args.categories)
        buyer_geo = backfill_users(conn, buyer_capable_users, role="buyer")
        seller_geo = backfill_users(conn, seller_capable_users, role="seller")
        foods_by_seller = seed_foods(
            conn,
            sellers=seller_capable_users,
            categories=categories,
            foods_per_seller=args.foods_per_seller,
        )
        lots_by_seller = seed_lots(conn, foods_by_seller=foods_by_seller)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    seller_ids = [s.user_id for s in seller_capable_users if s.user_id in lots_by_seller]
    created_orders: list[dict[str, Any]] = []
    if not seller_ids:
        raise RuntimeError("No seller foods created; cannot create orders.")

    for buyer_idx, buyer in enumerate(buyer_capable_users):
        seller_rotation = random.sample(seller_ids, k=min(len(seller_ids), args.orders_per_buyer))
        while len(seller_rotation) < args.orders_per_buyer:
            seller_rotation.append(random.choice(seller_ids))

        b_geo = buyer_geo.get(buyer.user_id, {})
        for order_idx in range(args.orders_per_buyer):
            seller_id = seller_rotation[order_idx]
            items = build_items_for_seller(lots_by_seller[seller_id])
            idem_key = f"api-seed-order-{seed_id}-{buyer_idx + 1}-{order_idx + 1}"
            address = {
                "country": "TR",
                "city": b_geo.get("city", "İstanbul"),
                "district": "Merkez",
                "line": f"Deneme Sokak No:{order_idx + 1}",
                "postalCode": "34000",
                "latitude": b_geo.get("latitude"),
                "longitude": b_geo.get("longitude"),
            }
            result = create_order(
                args.base_url,
                buyer_token=buyer.access_token,
                seller_id=seller_id,
                items=items,
                delivery_address=address,
                idempotency_key=idem_key,
            )
            order_id = result["data"]["orderId"]
            created_orders.append(
                {
                    "orderId": order_id,
                    "buyerId": buyer.user_id,
                    "sellerId": seller_id,
                    "items": items,
                }
            )
            order_no = buyer_idx * args.orders_per_buyer + order_idx + 1
            total_orders = len(buyer_capable_users) * args.orders_per_buyer
            print(
                f"[order {order_no}/{total_orders}] orderId={short_id(order_id)} "
                f"buyer={short_id(buyer.user_id)} seller={short_id(seller_id)}"
            )
            time.sleep(max(0.0, args.order_interval_seconds))

    conn, _ = open_db(args.database_url)
    try:
        enrichment = enrich_seed_dataset(
            conn,
            created_orders=created_orders,
            buyer_capable_users=buyer_capable_users,
            seller_capable_users=seller_capable_users,
            sample_doc_url=args.sample_doc_url,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    summary = {
        "seedId": seed_id,
        "baseUrl": args.base_url,
        "counts": {
            "buyers": len(buyers),
            "sellers": len(sellers),
            "bothUsers": len(both_users),
            "categories": len(categories),
            "foods": sum(len(rows) for rows in foods_by_seller.values()),
            "lots": sum(len(rows) for rows in lots_by_seller.values()),
            "orders": len(created_orders),
            "paymentAttempts": enrichment["paymentAttemptsCreated"],
            "complaints": enrichment["complaintsCreated"],
            "loginLocations": enrichment["loginLocationsCreated"],
            "complianceDocs": enrichment["complianceDocsUpserted"],
        },
        "buyersCreated": [
            {
                "email": b.email,
                "userId": b.user_id,
                "fullName": b.full_name,
                "gps": buyer_geo.get(b.user_id),
            }
            for b in buyers
        ],
        "sellersCreated": [
            {
                "email": s.email,
                "userId": s.user_id,
                "fullName": s.full_name,
                "gps": seller_geo.get(s.user_id),
            }
            for s in sellers
        ],
        "bothUsersCreated": [
            {
                "email": u.email,
                "userId": u.user_id,
                "fullName": u.full_name,
                "gps": buyer_geo.get(u.user_id),
            }
            for u in both_users
        ],
        "categoriesCreated": categories,
        "foodsBySeller": foods_by_seller,
        "lotsBySeller": lots_by_seller,
        "ordersCreated": created_orders,
        "enrichment": enrichment,
        "sampleDocUrl": args.sample_doc_url,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)

    print(f"done. summary written to: {args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
