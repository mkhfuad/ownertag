# OwnerTag (Germany) — Deploy on a Hostinger KVM 1 VPS

**Yes, KVM 1 is enough.** 1 vCPU / 4 GB RAM / 50 GB NVMe runs the whole stack —
app + Postgres + Redis + HTTPS proxy — as Docker containers. Budget ~30–45 min.

You run these over SSH to the VPS. I added two files for this — `Caddyfile` and
`docker-compose.prod.yml` — which give you automatic HTTPS and keep the database
off the public internet.

---

## 0. Before you SSH: DNS
Point your domain at the VPS. In your domain registrar, add an **A record** for
`ownertag.de` → your VPS's public IP (shown in the Hostinger panel). Do this first;
the TLS certificate in step 5 needs it to be live.

Then edit `Caddyfile` and replace `ownertag.de` with your real domain.

---

## 1. SSH in and install Docker
```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sh
```
(Hostinger also offers a one-click Docker template when you set up the VPS — either way is fine.)

## 2. Get the code onto the VPS
```bash
git clone https://github.com/mkhfuad/ownertag.git
cd ownertag
```
(If the repo is private, use a GitHub personal access token or `scp` the folder up.)

## 3. Create the `.env` with real secrets
```bash
cp .env.example .env
# generate three 32-byte keys and an admin key:
echo "MASTER_KEY=$(openssl rand -hex 32)" >> .env
echo "HMAC_KEY=$(openssl rand -hex 32)"   >> .env
echo "TOKEN_KEY=$(openssl rand -hex 32)"  >> .env
echo "ADMIN_KEY=$(openssl rand -hex 16)"  >> .env
nano .env   # set BASE_URL=https://YOURDOMAIN and fill Twilio when ready
```
Leave the `DATABASE_URL`/`REDIS_URL` lines as the compose sets them internally
(`db:5432`, `redis:6379`). The app **won't boot** if the three crypto keys are
missing — that's intentional.

## 4. Open the firewall for web traffic
```bash
ufw allow 80 && ufw allow 443 && ufw allow OpenSSH && ufw --force enable
```
Do **not** open 5432 or 6379 — the overlay keeps them private on purpose.

## 5. Launch
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
First start runs the DB migrations automatically, then Caddy fetches a TLS cert.
Give it ~60 seconds, then open `https://YOURDOMAIN` — you should see the shop.

Check health: `curl https://YOURDOMAIN/healthz`

---

## 6. Twilio (makes SMS/calls real)
Until this is set, activation codes only print to the server log. In the Twilio
console: verify your business, buy 1–2 **German** numbers, then add to `.env`:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_RELAY_NUMBERS` (comma-separated).
Point the number's **voice + messaging webhooks** at `https://YOURDOMAIN/webhooks/...`.
Then `docker compose ... up -d` again to restart. Germany/EU is well-supported by
Twilio — no DLT-style hurdle like India.

## 7. Germany legal (not optional before public launch)
- **Impressum** + **Datenschutzerklärung** — footer links exist but are placeholders. Generate compliant texts (e.g. eRecht24) and have them reviewed.
- **AGB + Widerrufsbelehrung** (14-day cancellation) for the shop.
- If shipping physical tags: **Verpackungsgesetz / LUCID** registration.

---

## Day-to-day
- **Orders:** `https://YOURDOMAIN/api/admin/orders?key=YOUR_ADMIN_KEY`
- **Mint tags for printing:** `docker compose exec api node scripts/mint-tags.js 100`
- **Logs:** `docker compose logs -f api`
- **Update code:** `git pull` then re-run the compose `up -d --build`.
- **Backups:** schedule `docker compose exec db pg_dump -U ownertag ownertag` to a file + off-VPS copy. Free Postgres here has no managed backups — this is on you.

## Cost
VPS ~$5/mo · domain ~€1/mo · Twilio 2 DE numbers + usage ~€5–15/mo. No Render fees.
Trade-off vs. Render: you own updates, backups, and security patching on the VPS.
