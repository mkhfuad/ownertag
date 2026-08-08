# OwnerTag — Go-Live Guide (no technical background needed)

Your app is **already deployed** at https://ownertag-3sy5.onrender.com/ and the
Twilio code is **already written**. The only reason texts/calls aren't working
yet is that Twilio's secret keys haven't been pasted into Render. This guide
walks you through that, click by click. Budget ~20 minutes.

There is **no terminal and no coding** in this guide. Everything happens in two
websites: the **Twilio Console** and the **Render Dashboard**.

---

## Part A — Get your keys from Twilio (5 minutes)

1. Go to **https://www.twilio.com/console** and log in (or sign up — free trial
   works for testing).
2. On the **Console home page** you'll see a box called **"Account Info"**. Two
   values live there. Copy each one somewhere safe (e.g. a Notes file):
   - **Account SID** — a long code starting with **`AC`**.
   - **Auth Token** — click **"Show"** to reveal it, then copy. Treat it like a
     password; never share it.
3. Get a phone number to send texts from:
   - Left menu → **Phone Numbers** → **Manage** → **Buy a number**.
   - Pick one that has **SMS** capability, buy it (free trial gives you one).
   - Copy the number in full international form, e.g. **`+4930xxxxxxxx`**.
     This is your **`TWILIO_PHONE_NUMBER`**.

> **Recommended for verification codes — Twilio Verify.** Instead of managing
> codes yourself, Twilio can send and check them for you. To turn it on:
> left menu → **Verify** → **Services** → **Create new** → name it "OwnerTag" →
> **Create**. Copy the **Service SID** (starts with **`VA`**). That's your
> **`TWILIO_VERIFY_SERVICE_SID`**. This is optional — skip it and the app uses
> its own built-in SMS code instead.

You should now have copied **3 values** (or 4 with Verify):

| Copy this from Twilio | You'll paste it into Render as |
|---|---|
| Account SID (`AC…`) | `TWILIO_ACCOUNT_SID` |
| Auth Token | `TWILIO_AUTH_TOKEN` |
| Your Twilio number (`+…`) | `TWILIO_PHONE_NUMBER` |
| Verify Service SID (`VA…`) *(optional)* | `TWILIO_VERIFY_SERVICE_SID` |

---

## Part B — Paste the keys into Render (5 minutes)

1. Go to **https://dashboard.render.com** and log in.
2. Click your service named **`ownertag`** in the list.
3. In the left menu of that service, click **Environment**.
4. You'll see a list of "Environment Variables." For each row in the table
   below, click **"Add Environment Variable"** (or edit it if it already exists),
   type the **Key** exactly as shown, and paste the matching **Value** you
   copied from Twilio.

   | Key (type exactly) | Value (paste from Twilio) |
   |---|---|
   | `TWILIO_ACCOUNT_SID` | your `AC…` code |
   | `TWILIO_AUTH_TOKEN` | your Auth Token |
   | `TWILIO_PHONE_NUMBER` | your `+…` number |
   | `TWILIO_RELAY_NUMBERS` | your `+…` number (same one is fine to start) |
   | `TWILIO_VERIFY_SERVICE_SID` *(only if you made a Verify service)* | your `VA…` code |

   > Keys are **case-sensitive** and must have **no spaces**. Copy them exactly.

5. Click **Save Changes** at the bottom. Render will automatically start a new
   deploy with the new settings.

---

## Part C — Deploy and test (5 minutes)

1. Saving in Part B already triggers a deploy. To watch it: in your `ownertag`
   service, click **Logs** (or **Events**). Wait until you see the deploy marked
   **"Live"** (usually 1–3 minutes). If you ever want to force one, click
   **Manual Deploy → Deploy latest commit**.
2. Open **https://ownertag-3sy5.onrender.com/** in your browser. The homepage
   should load.
3. **Quick health test (no login):** open
   **https://ownertag-3sy5.onrender.com/healthz** — it should show a small "ok"
   response. That confirms the server and database are up.
4. **Test the text message:** go through the owner activation/login flow on the
   site (the **"Zum Dashboard"** link). When it asks for a code, you should
   receive an **SMS on your phone** within a few seconds. Enter it to confirm the
   whole loop works.

> **On the free plan the app "sleeps" after 15 minutes idle.** The first visit
> after a nap can take ~30–50 seconds to wake up — that's normal, not a crash.
> Upgrade the service to **Starter** to stop it sleeping before you launch for
> real.

---

## What happens if something goes wrong (already handled)

You don't need to do anything for these — the app is built to fail gracefully:

- **Someone enters an invalid phone number or the SMS fails** → the app does
  **not** crash. It logs the reason (Twilio's error code — never the person's
  number) and simply reports that the code couldn't be sent, so they can retry.
- **Twilio keys missing or wrong** → texting is skipped safely rather than
  crashing the site; the rest of the app keeps working.
- **Wrong or expired code entered** → the user just gets a "bad code" message and
  can try again (capped to stop guessing).

To see error details if a text won't send: Render → your service → **Logs**, and
look for lines starting with `twilio sms failed` — the code there (e.g. `21608`,
`21211`) tells you exactly what Twilio rejected.

---

## Common gotchas (plain English)

- **Twilio free trial only texts *verified* numbers.** On a trial account you
  can only send SMS to phone numbers you've added under **Verified Caller IDs**
  in the Twilio Console. Add your own number there to test. To text anyone,
  upgrade the Twilio account (add a little credit).
- **Country rules.** The default text "sender name" (`OWNERTAG`) works in Germany
  but is rejected in some countries. Setting **`TWILIO_PHONE_NUMBER`** to a real
  number (Part A step 3) makes texts work broadly — the app now prefers it
  automatically.
- **Never put keys in the code or share screenshots of the Auth Token.** They
  belong only in Render's Environment settings, which is exactly where you put
  them.

---

## Render settings reference (already configured — for your awareness)

These are already set correctly in `render.yaml`; you don't need to change them.

| Setting | Value |
|---|---|
| Environment | **Docker** |
| Build | handled by the `Dockerfile` (installs dependencies automatically) |
| Start command | `node src/migrate.js && node src/server.js` (runs DB setup, then the app) |
| Health Check Path | **`/healthz`** |
| Region | Frankfurt (EU) |

That's it. Once the Twilio variables are saved in Render and the deploy goes
**Live**, your app is fully operational.
