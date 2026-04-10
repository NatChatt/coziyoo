#!/usr/bin/env python3
import argparse
import sys
import uuid

from e2e_common import (
    DEFAULT_BASE_URL,
    DEFAULT_PASSWORD,
    DEFAULT_SELLER_EMAIL,
    E2EFailure,
    FlowConfig,
    FlowRunner,
    build_lot_timeline,
    normalize_base_url,
    request_json,
    require_data,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Seller E2E flow: login -> food create -> lot create -> sale-ready checks"
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="API base URL")
    parser.add_argument("--seller-email", default=DEFAULT_SELLER_EMAIL, help="Seller test email")
    parser.add_argument("--seller-password", default=DEFAULT_PASSWORD, help="Seller password")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")

    parser.add_argument("--interactive", dest="interactive", action="store_true", default=True)
    parser.add_argument("--no-interactive", dest="interactive", action="store_false")
    return parser.parse_args()


def main():
    args = parse_args()
    config = FlowConfig(
        base_url=normalize_base_url(args.base_url),
        interactive=args.interactive,
        timeout=args.timeout,
    )
    run = FlowRunner(config)

    state = {
        "sellerToken": None,
        "sellerId": None,
        "foodId": None,
        "lotId": None,
    }

    try:
        run.start_step("Seller login")
        _, body = request_json(
            config,
            "POST",
            "/v1/auth/login",
            json_body={
                "email": args.seller_email,
                "password": args.seller_password,
            },
            expected_status=200,
            require_key="data",
        )
        data = require_data(body)
        state["sellerToken"] = data["tokens"]["accessToken"]
        state["sellerId"] = data["user"]["id"]
        run.pass_step(f"Seller giriş başarılı: {state['sellerId']}")

        run.start_step("Food create")
        unique_tag = uuid.uuid4().hex[:8]
        food_name = f"E2E Seller Flow {unique_tag}"
        _, body = request_json(
            config,
            "POST",
            "/v1/seller/foods",
            token=state["sellerToken"],
            json_body={
                "name": food_name,
                "price": 180,
                "description": "E2E seller flow test yemeği",
                "cardSummary": "E2E test için oluşturuldu",
                "recipe": "Fırında kontrollü pişirme",
                "ingredients": ["Pirinç", "Tavuk", "Tuz"],
                "allergens": ["Gluten"],
                "isActive": True,
            },
            expected_status=201,
            require_key="data",
        )
        state["foodId"] = require_data(body)["foodId"]
        run.pass_step(f"Food oluşturuldu: {state['foodId']}")

        run.start_step("Lot create")
        timeline = build_lot_timeline()
        _, body = request_json(
            config,
            "POST",
            "/v1/seller/lots",
            token=state["sellerToken"],
            json_body={
                "foodId": state["foodId"],
                "producedAt": timeline["producedAt"],
                "saleStartsAt": timeline["saleStartsAt"],
                "saleEndsAt": timeline["saleEndsAt"],
                "quantityProduced": 15,
                "quantityAvailable": 15,
                "notes": "E2E test lot",
            },
            expected_status=201,
            require_key="data",
        )
        state["lotId"] = require_data(body)["lotId"]
        run.pass_step(f"Lot oluşturuldu: {state['lotId']}")

        run.start_step("Food status active")
        request_json(
            config,
            "PATCH",
            f"/v1/seller/foods/{state['foodId']}/status",
            token=state["sellerToken"],
            json_body={"isActive": True},
            expected_status=200,
            require_key="data",
        )
        run.pass_step("Food aktif duruma alındı")

        run.start_step("Sale-ready doğrulamaları")
        _, body = request_json(
            config,
            "GET",
            "/v1/seller/foods",
            token=state["sellerToken"],
            params={"foodId": state["foodId"]},
            expected_status=200,
            require_key="data",
        )
        foods = require_data(body)
        if not isinstance(foods, list) or len(foods) == 0:
            raise E2EFailure("Seller foods içinde yeni food bulunamadı")
        target_food = foods[0]
        if not target_food.get("is_active", target_food.get("isActive", False)):
            raise E2EFailure("Food aktif görünmüyor")

        _, body = request_json(
            config,
            "GET",
            "/v1/seller/lots",
            token=state["sellerToken"],
            expected_status=200,
            require_key="data",
        )
        lots = require_data(body)
        if not isinstance(lots, list):
            raise E2EFailure("Lot listesi beklenen formatta değil")
        lot_exists = any(str(item.get("id")) == str(state["lotId"]) for item in lots)
        if not lot_exists:
            raise E2EFailure("Oluşturulan lot seller listesinde görünmüyor")
        run.pass_step("Food + lot satışa hazır görünüyor")

    except E2EFailure as exc:
        run.fail_step(str(exc))
        return 1

    print("\n=== SELLER FLOW OUTPUT ===")
    print(f"baseUrl={config.base_url}")
    print(f"sellerId={state['sellerId']}")
    print(f"foodId={state['foodId']}")
    print(f"lotId={state['lotId']}")
    print(
        "next="
        f"python scripts/e2e_buyer_flow.py --base-url {config.base_url} "
        f"--seller-id {state['sellerId']} --food-id {state['foodId']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

