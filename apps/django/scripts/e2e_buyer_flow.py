#!/usr/bin/env python3
import argparse
import sys

from e2e_common import (
    DEFAULT_BASE_URL,
    DEFAULT_BUYER_EMAIL,
    DEFAULT_PASSWORD,
    E2EFailure,
    FlowConfig,
    FlowRunner,
    normalize_base_url,
    request_json,
    require_data,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Buyer E2E flow: login -> verify food -> create order -> payment"
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="API base URL")
    parser.add_argument("--buyer-email", default=DEFAULT_BUYER_EMAIL, help="Buyer test email")
    parser.add_argument("--buyer-password", default=DEFAULT_PASSWORD, help="Buyer password")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")
    parser.add_argument("--seller-id", default=None, help="Seller ID for order creation")
    parser.add_argument("--food-id", default=None, help="Food ID for order creation")
    parser.add_argument(
        "--search",
        default="E2E Seller Flow",
        help="Food search text when sellerId/foodId verilmezse fallback",
    )

    parser.add_argument("--interactive", dest="interactive", action="store_true", default=True)
    parser.add_argument("--no-interactive", dest="interactive", action="store_false")
    return parser.parse_args()


def _resolve_food_and_seller(config: FlowConfig, token: str, seller_id, food_id, search):
    _, body = request_json(
        config,
        "GET",
        "/v1/foods/",
        token=token,
        params={"search": search} if search else None,
        expected_status=200,
        require_key="data",
    )
    items = require_data(body)
    if not isinstance(items, list):
        raise E2EFailure("Public foods listesi beklenen formatta değil")

    if seller_id and food_id:
        match = next(
            (
                item
                for item in items
                if str(item.get("id")) == str(food_id)
                and str(item.get("seller", {}).get("id")) == str(seller_id)
            ),
            None,
        )
        if not match:
            raise E2EFailure("Verilen sellerId/foodId public listede bulunamadı")
        return str(seller_id), str(food_id), int(match.get("stock") or 0)

    first = next(
        (
            item
            for item in items
            if item.get("seller", {}).get("id") and item.get("id")
        ),
        None,
    )
    if not first:
        raise E2EFailure("Sipariş için uygun food bulunamadı")
    return (
        str(first["seller"]["id"]),
        str(first["id"]),
        int(first.get("stock") or 0),
    )


def main():
    args = parse_args()
    config = FlowConfig(
        base_url=normalize_base_url(args.base_url),
        interactive=args.interactive,
        timeout=args.timeout,
    )
    run = FlowRunner(config)

    state = {
        "buyerToken": None,
        "buyerId": None,
        "sellerId": args.seller_id,
        "foodId": args.food_id,
        "orderId": None,
        "attemptId": None,
    }

    try:
        run.start_step("Negatif login kontrolü (yanlış şifre)")
        _, body = request_json(
            config,
            "POST",
            "/v1/auth/login",
            json_body={
                "email": args.buyer_email,
                "password": f"{args.buyer_password}_wrong",
            },
            expected_status=(400, 401, 403),
            require_key="error",
        )
        if not isinstance(body, dict) or "error" not in body:
            raise E2EFailure("Yanlış login cevabı JSON error formatında değil")
        run.pass_step("Yanlış credential beklenen hata formatını döndü")

        run.start_step("Buyer login")
        _, body = request_json(
            config,
            "POST",
            "/v1/auth/login",
            json_body={
                "email": args.buyer_email,
                "password": args.buyer_password,
            },
            expected_status=200,
            require_key="data",
        )
        data = require_data(body)
        state["buyerToken"] = data["tokens"]["accessToken"]
        state["buyerId"] = data["user"]["id"]
        run.pass_step(f"Buyer giriş başarılı: {state['buyerId']}")

        run.start_step("Food doğrulama")
        seller_id, food_id, stock = _resolve_food_and_seller(
            config,
            state["buyerToken"],
            state["sellerId"],
            state["foodId"],
            args.search,
        )
        state["sellerId"] = seller_id
        state["foodId"] = food_id
        if stock <= 0:
            run.skip_step("Food bulundu ama stock 0 görünüyor, sipariş yine deneniyor")
        run.pass_step(f"Order hedefi hazır: sellerId={seller_id} foodId={food_id}")

        run.start_step("Order create")
        _, body = request_json(
            config,
            "POST",
            "/v1/orders/",
            token=state["buyerToken"],
            json_body={
                "sellerId": state["sellerId"],
                "items": [{"foodId": state["foodId"], "quantity": 1}],
                "deliveryType": "pickup",
            },
            expected_status=201,
            require_key="data",
        )
        order_data = require_data(body)
        state["orderId"] = order_data["orderId"]
        run.pass_step(f"Order oluşturuldu: {state['orderId']}")

        run.start_step("Negatif ödeme kontrolü (init öncesi mock-process)")
        _, body = request_json(
            config,
            "POST",
            "/v1/payments/mock-process",
            json_body={"orderId": state["orderId"], "result": "success"},
            expected_status=404,
            require_key="error",
        )
        err = body.get("error", {}) if isinstance(body, dict) else {}
        if err.get("code") != "NOT_FOUND":
            raise E2EFailure("Init öncesi mock-process için NOT_FOUND bekleniyordu")
        run.pass_step("Init öncesi mock-process beklenen NOT_FOUND döndü")

        run.start_step("Payment init")
        _, body = request_json(
            config,
            "POST",
            "/v1/payments/",
            token=state["buyerToken"],
            json_body={"orderId": state["orderId"]},
            expected_status=201,
            require_key="data",
        )
        payment_init = require_data(body)
        state["attemptId"] = payment_init.get("attemptId")
        run.pass_step(f"Payment attempt oluşturuldu: {state['attemptId']}")

        run.start_step("Payment status (pending) doğrulama")
        _, body = request_json(
            config,
            "GET",
            f"/v1/payments/{state['orderId']}/status",
            token=state["buyerToken"],
            expected_status=200,
            require_key="data",
        )
        attempts = require_data(body).get("attempts", [])
        if not attempts:
            raise E2EFailure("Payment status içinde attempt bulunamadı")
        latest = attempts[0]
        if latest.get("status") != "pending":
            raise E2EFailure(f"Pending bekleniyordu, gelen: {latest.get('status')}")
        run.pass_step("Payment attempt pending görünüyor")

        run.start_step("Mock ödeme success")
        request_json(
            config,
            "POST",
            "/v1/payments/mock-process",
            json_body={"orderId": state["orderId"], "result": "success"},
            expected_status=200,
            require_key="data",
        )
        run.pass_step("Mock ödeme success işlendi")

        run.start_step("Payment status (paid) doğrulama")
        _, body = request_json(
            config,
            "GET",
            f"/v1/payments/{state['orderId']}/status",
            token=state["buyerToken"],
            expected_status=200,
            require_key="data",
        )
        attempts = require_data(body).get("attempts", [])
        if not attempts:
            raise E2EFailure("Paid kontrolünde attempt bulunamadı")
        latest = attempts[0]
        if latest.get("status") != "paid":
            raise E2EFailure(f"Paid bekleniyordu, gelen: {latest.get('status')}")
        run.pass_step("Payment attempt paid görünüyor")

        run.start_step("Order status doğrulama")
        _, body = request_json(
            config,
            "GET",
            f"/v1/orders/{state['orderId']}",
            token=state["buyerToken"],
            expected_status=200,
            require_key="data",
        )
        order = require_data(body)
        if order.get("status") != "preparing":
            raise E2EFailure(f"Order status preparing bekleniyordu, gelen: {order.get('status')}")
        run.pass_step("Order status preparing olarak doğrulandı")

    except E2EFailure as exc:
        run.fail_step(str(exc))
        return 1

    print("\n=== BUYER FLOW OUTPUT ===")
    print(f"baseUrl={config.base_url}")
    print(f"buyerId={state['buyerId']}")
    print(f"sellerId={state['sellerId']}")
    print(f"foodId={state['foodId']}")
    print(f"orderId={state['orderId']}")
    print(f"attemptId={state['attemptId']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

