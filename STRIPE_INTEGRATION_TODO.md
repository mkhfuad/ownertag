# Stripe Integration — TODO

**Scenario A**: an existing Checkout Session call was found in [src/stripe.js](src/stripe.js) (`createSubscriptionCheckout`) and only its parameters were updated. No new files, routes, or refactors.

## ✅ Card payment for the €24.90 tag (added afterwards)

`/bestellen` now has a third option, **"Karte · Apple Pay · Google Pay"**. It only appears once `STRIPE_SECRET_KEY` **and** `STRIPE_WEBHOOK_SECRET` are set on the server. Until then the site keeps offering only Rechnung/Vorkasse.

**Flow:**
1. The customer submits the order form. `POST /api/orders` saves the order with `payment='karte'`, `status='new'`.
2. [src/stripe.js](src/stripe.js) `createOrderCheckout` creates a one-time session (`mode: "payment"`, `price_data` 24,90 € × qty, gross incl. VAT, `locale: de`). No Price ID is needed.
3. The customer pays on Stripe's hosted page and comes back to `/bestellen?bezahlt=<id>` (or `?abgebrochen=<id>`).
4. The webhook `checkout.session.completed` (or `checkout.session.async_payment_succeeded` for SEPA/Klarna) sets the order to **paid** once and sends the branded confirmation email, without the bank block.
5. The order appears in the **admin panel** as `karte · paid`. Use "Approve & send QR" as usual.

Abandoned checkouts stay `new`. You can cancel or delete them in admin.

**Server `.env` for card payments (only these two are required):**
```
STRIPE_SECRET_KEY=sk_test_…     # sk_live_… at launch
STRIPE_WEBHOOK_SECRET=whsec_…
```
**Webhook endpoint** `https://ownertag.de/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.async_payment_succeeded` (plus the subscription events below if you ever use the membership).

**Legal:** the Datenschutzerklärung (Stripe row, US transfer) and AGB §4 (payment methods) are already updated. Also sign Stripe's DPA in the Dashboard (Settings → Legal/Compliance).

---

## Subscription checkout (Checkout Studio parameters)

The original Checkout Session below is the owner **subscription** (€9.99/yr + €15 signup) behind `POST /api/subscribe`. It's separate from the €24.90 shop order and is not used by the current website.

## Values to Replace

The `sample_only` parameters already have real values in the code (kept unchanged). The only placeholders are the **environment variables** they read, which are empty in `.env.example`.

**Files containing placeholders:**
- [.env.example](.env.example) (copy the values into the server's `.env`)
- [src/stripe.js](src/stripe.js) (reads them via [src/config.js](src/config.js))

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `subscription` (kept — real value) | Correct for the yearly membership. Use `payment` only for a one-time charge (e.g. the €24.90 tag — see warning above). |
| success_url | `${BASE_URL}/owner?sub=success` (kept — real value) | No change needed if `BASE_URL=https://ownertag.de` is set on the server. |
| cancel_url | `${BASE_URL}/owner?sub=cancelled` (kept — real value) | No change needed if `BASE_URL` is set. |
| line_items[0].price | `STRIPE_PRICE_YEARLY` (empty) | Your recurring €9.99/yr Price ID (`price_…`) from https://dashboard.stripe.com/prices |
| line_items[1].price | `STRIPE_PRICE_SIGNUP` (empty) | Your one-time €15.00 Price ID (`price_…`). |

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [src/stripe.js](src/stripe.js)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted` (your SDK is `stripe@^16.6.0`; SDK ≥ 21.0.0 uses `hosted_page`) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` |
| payment_method_collection | `always` (included because mode is `subscription`) |
| submit_type | `auto` |
| integration_identifier | `hosted_web_0001` |
| origin_context | `web` |

**Kept on purpose (not Checkout Studio settings, but required app wiring):** `client_reference_id`, `customer_email`, `subscription_data.metadata`. The webhook uses these to link a payment to the right owner. Removing them would break the billing gate.

### Things to verify in test mode
- **SDK version vs. new parameters:** `integration_identifier` and `origin_context` are newer parameters. If Stripe rejects them as unknown on `stripe@16`, upgrade the SDK (`npm i stripe@latest`) and change `ui_mode` to `hosted_page`.
- **`submit_type` in subscription mode:** confirm Stripe accepts it. If it errors, that's the cause.
- **Tax:** `automatic_tax` is now **off**. You're under regular VAT, so your Stripe Prices must be created **tax-inclusive** (19 % included). Stripe won't add VAT for you.
- **Billing address:** changed from `required` to `auto`. Stripe now only asks for the address when needed. Make sure your invoices still meet German requirements.

## Setup and next steps

**Environment variables** (server `.env`, never in code or git):
```
STRIPE_SECRET_KEY=sk_test_…        # sk_live_… at launch
STRIPE_WEBHOOK_SECRET=whsec_…      # from the webhook endpoint below
STRIPE_PRICE_YEARLY=price_…
STRIPE_PRICE_SIGNUP=price_…
BASE_URL=https://ownertag.de
```
The API version is not pinned (the client uses the account default). Recreate the container after editing `.env`:
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate api`

**No new files** were created except this TODO.

**How it works:**
1. A logged-in owner calls `POST /api/subscribe` ([src/routes.js](src/routes.js)).
2. `createSubscriptionCheckout` creates a hosted Checkout Session and returns its URL. The owner pays on Stripe's page.
3. Stripe calls `POST /webhooks/stripe` ([src/server.js](src/server.js)). `stripeWebhook` verifies the signature and saves the subscription to the `subscriptions` table.
4. `billingActive()` checks that status live to unlock premium SMS and voice.

**Webhook:** in the Dashboard (https://dashboard.stripe.com/workbench/webhooks) add the endpoint `https://ownertag.de/webhooks/stripe` with these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

**Testing:** use test keys. Card `4242 4242 4242 4242` with any future date and any CVC pays successfully. `4000 0027 6000 3184` triggers 3-D Secure, and `4000 0000 0000 9995` gets declined. To test the webhook locally: `stripe listen --forward-to localhost:8080/webhooks/stripe`.

**Next steps:**
- Decide whether the subscription model is still needed at all, since the site now advertises a one-time payment with lifetime service. If not, a one-time `mode: "payment"` session for the €24.90 tag is what you actually need.
- **Legal:** the Datenschutzerklärung currently says Stripe is **not** used. Before going live with Stripe, add Stripe as a processor (DPA, EU→US transfer via SCCs) and update the compliance register.
- Fulfilment: card orders should create a row in `orders` so they show in the admin panel and trigger the QR email.

**Resources:** https://support.stripe.com · https://docs.stripe.com/mcp
