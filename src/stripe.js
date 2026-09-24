/* Stripe subscription billing for OwnerTag.
 *
 * Model: yearly membership (€9.99/yr recurring) + one-time signup surcharge
 * (€15.00) added to the FIRST invoice only → year 1 = €24.99, renewals = €9.99.
 * Create one Product with two Prices in Stripe and put their IDs in .env.
 *
 * Linking: a subscription is started by a logged-in owner, so we pass their
 * owner_id through Stripe metadata and store it on the subscription row.
 * Enforcement is LIVE via billingActive() in routes.js, which joins
 * tag → vehicle → owner → subscription and checks status='active'. A lapsed
 * payment simply blocks premium SMS/voice — the free web/email tier keeps
 * working, and we never mutate tag state for billing.
 *
 * Exports:
 *   createSubscriptionCheckout({ ownerId, email }) → Checkout URL (used by /api/subscribe)
 *   stripeWebhook → mounted in server.js with express.raw() BEFORE express.json.
 */
import Stripe from 'stripe';
import { config } from './config.js';
import { q } from './db.js';
import { encrypt } from './crypto.js';

const cfg = config.stripe;
const stripe = cfg.secretKey ? new Stripe(cfg.secretKey) : null;

/* ── Start a subscription (called by the authenticated owner route) ─────── */
export async function createSubscriptionCheckout({ ownerId, email }) {
  if (!stripe) { const e = new Error('billing_not_configured'); e.status = 503; throw e; }
  if (!cfg.priceYearly || !cfg.priceSignup) { const e = new Error('prices_not_configured'); e.status = 503; throw e; }

  const base = config.baseUrl;
  const session = await stripe.checkout.sessions.create({
    ui_mode: 'hosted',                                   // SDK < 21.0.0 → 'hosted' (21+ → 'hosted_page')
    mode: 'subscription',
    client_reference_id: String(ownerId),               // links the sub back to this owner
    ...(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { customer_email: email } : {}),
    line_items: [
      { price: cfg.priceYearly, quantity: 1 },           // €9.99/yr, recurring
      { price: cfg.priceSignup, quantity: 1 },           // €15.00 one-time → first invoice only
    ],
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    payment_method_collection: 'always',                 // subscription mode only
    submit_type: 'auto',
    integration_identifier: 'hosted_web_0001',
    origin_context: 'web',
    success_url: `${base}/owner?sub=success`,
    cancel_url: `${base}/owner?sub=cancelled`,
    subscription_data: { metadata: { app: 'ownertag', owner_id: String(ownerId) } },
  });
  return session.url;
}

/* Card checkout is offered only when the webhook can confirm payment. */
export const cardPaymentReady = () => Boolean(stripe && cfg.webhookSecret);

/* ── One-time card payment for a shop order (€24.90 × qty) ─────────────── */
export async function createOrderCheckout({ orderId, qty, unitCents, email }) {
  if (!cardPaymentReady()) { const e = new Error('card_unavailable'); e.status = 503; throw e; }
  const base = config.baseUrl;
  const session = await stripe.checkout.sessions.create({
    ui_mode: 'hosted',
    mode: 'payment',
    locale: 'de',
    client_reference_id: String(orderId),
    customer_email: email,
    line_items: [{
      quantity: qty,
      price_data: {
        currency: 'eur',
        unit_amount: unitCents,                          // gross price incl. 19 % VAT
        product_data: { name: 'OwnerTag – QR-Aufkleber Ø 80 mm (inkl. lebenslangem Service)' },
      },
    }],
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    allow_promotion_codes: false,
    submit_type: 'auto',
    integration_identifier: 'hosted_web_0001',
    origin_context: 'web',
    metadata: { app: 'ownertag', order_id: String(orderId) },
    success_url: `${base}/bestellen?bezahlt=${orderId}`,
    cancel_url: `${base}/bestellen?abgebrochen=${orderId}`,
  });
  await q(`UPDATE orders SET stripe_session_id=$1 WHERE id=$2`, [session.id, orderId]);
  return session.url;
}

/* Mark a card order paid (idempotent) and send the confirmation once. */
async function markOrderPaid(s) {
  const { rows: [o] } = await q(
    `UPDATE orders SET status='paid' WHERE id=$1 AND payment='karte' AND status='new'
     RETURNING id, name, qty, payment, email_enc`, [Number(s.metadata.order_id)]);
  if (!o) return;                                        // already paid / unknown → no double email
  const { sendOrderConfirmation } = await import('./shop.js');
  const { decrypt } = await import('./crypto.js');
  sendOrderConfirmation(o, decrypt(o.email_enc)).catch(() => {});
}

/* ── Webhook: keep our DB in sync with Stripe ───────────────────────────── */
export async function stripeWebhook(req, res) {
  if (!stripe || !cfg.webhookSecret) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], cfg.webhookSecret);
  } catch (err) {
    console.error('stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode === 'payment') {                      // shop order, not a subscription
          if (s.payment_status === 'paid' && s.metadata?.order_id) await markOrderPaid(s);
          break;
        }
        const email = s.customer_details?.email || s.customer_email || null;
        await upsertSub(s.subscription, s.customer, email, 'active', null, s.client_reference_id);
        break;
      }
      case 'checkout.session.async_payment_succeeded': { // delayed methods (SEPA, some Klarna)
        const s = event.data.object;
        if (s.mode === 'payment' && s.metadata?.order_id) await markOrderPaid(s);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await upsertSub(sub.id, sub.customer, null, mapStatus(sub.status), sub.current_period_end, sub.metadata?.owner_id);
        break;
      }
      case 'invoice.payment_failed': {
        const sub = event.data.object.subscription;
        if (sub) await setStatus(sub, 'past_due');
        break;
      }
      case 'customer.subscription.deleted': {
        await setStatus(event.data.object.id, 'canceled');
        break;
      }
      default: /* ignore the many events we don't need */ break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook handler error:', err);
    res.status(500).end();   // Stripe retries — handlers below are idempotent
  }
}

/* Idempotent upsert keyed on the Stripe subscription id (UNIQUE in the schema).
   Also links the owner's tags to this subscription so the live billingActive()
   gate can see it. Never touches tag STATE — enforcement is at request time. */
async function upsertSub(subId, customerId, email, status, periodEndUnix, ownerId) {
  if (!subId) return;
  const oid = ownerId ? Number(ownerId) : null;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
  // owner_id is all the gate needs — billingActive() joins tag→owner→subscription
  // live, so status changes take effect without touching any tag rows.
  await q(
    `INSERT INTO subscriptions
       (stripe_subscription_id, stripe_customer_id, owner_id, email_enc, status, current_period_end, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
       owner_id           = COALESCE(EXCLUDED.owner_id, subscriptions.owner_id),
       email_enc          = COALESCE(EXCLUDED.email_enc, subscriptions.email_enc),
       status             = EXCLUDED.status,
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
       updated_at         = now()`,
    [subId, customerId || null, oid, email ? encrypt(email) : null, status, periodEnd]);
}

const setStatus = (subId, status) =>
  q(`UPDATE subscriptions SET status=$1, updated_at=now() WHERE stripe_subscription_id=$2`, [status, subId]);

function mapStatus(s) {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  if (s === 'canceled' || s === 'incomplete_expired') return 'canceled';
  return 'incomplete';
}
