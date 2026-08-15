# KORA

Shift planning, credential blocking, quoting and invoicing for German security firms (§ 34a),
with a proactive WhatsApp AI assistant. Built from the KORA product brief.

This app lives in `kora/` and is completely separate from the `classtap-attendance` app at the
repository root — different product, different audience, different deploy. Nothing here touches
the attendance app.

## What's included in this build

- **Dispatcher web app**: login, request intake, drag-and-drop shift planner with a live cost
  panel and margin slider, PDF quotes, PDF invoices with an audit record (Prüfprotokoll).
- **Hard credential blocking**, enforced twice: once in the UI (staff without a valid, unexpired
  credential can't be dragged in) and once in the database itself (a trigger rejects the
  assignment even if something bypasses the UI). KORA never claims to check an ID against the
  federal Bewacherregister in real time — no public API for that exists — it only works from what
  the register's own portal already confirmed to you.
- **Employee web link**: no login, no app store. Each guard gets a personal, unguessable URL
  (installable to their phone's home screen) showing their own credentials with expiry, hours
  worked this month, and shifts to accept/decline.
- **KORA AI assistant**: texts the dispatcher on WhatsApp when a request is quoted, when slots are
  unfilled, when a credential is about to expire, and when an invoice is ready — matching the
  four example messages in the product brief. It also answers dispatcher questions sent back over
  WhatsApp ("what's still open for Saturday?"), grounded in real database lookups, not guesses.
- **GDPR groundwork**: server in the EU (your Supabase project region), Row Level Security so one
  company can never see another's data, no credentials/IDs/documents ever placed in a WhatsApp
  message body (only text and, where needed, a link), a sub-processor disclosure page at
  `/legal/subprocessors`, and a database function to anonymise a guard's personal data on request.

## What you still need to do yourself (this is true of any real product, not a shortcut taken here)

- Get a **Meta WhatsApp Business API** account and a phone number for it — Claude Code cannot sign
  up for third-party services on your behalf.
- Get an **Anthropic API key** and set a budget alert — this is what powers the assistant's replies.
- Fill in your company's **rate cards** (tariff €/hour per federal state and qualification) — the
  brief's ~€22/26/34 figures are examples, not law; use your actual agreed rates.
- **WhatsApp template approval**: Meta only allows free-form text messages within 24 hours of the
  customer's last message to you. A cold, first-touch proactive message (e.g. "two slots still
  unfilled") needs a pre-approved *message template* outside that window. Submit one in Meta
  Business Manager once your number is live — until then, proactive messages will only deliver if
  the dispatcher texted KORA within the last 24 hours.
- Talk to the two large operators mentioned in the brief before building further — their
  complaints about their current software should reorder what gets built next.

## Architecture

```text
Vercel (free tier)                     Supabase (EU project, free/pro tier)
  React + TypeScript + Vite   ─────►      Postgres (RLS, hard-block trigger)
  Dispatcher app + employee              Edge Functions (Deno, serverless)
  portal, both static                      quote-calculate
          │                                available-guards
          │ WhatsApp deep link             invoice-generate
          ▼                                employee-portal
  Guard's phone browser                    whatsapp-webhook / whatsapp-outbound
          ▲                                ai-assistant  ──────►  Anthropic API
          │                                credential-expiry-scan (daily cron)
          └── WhatsApp (Meta Cloud API) ◄──┘
```

No server to patch or restart. Vercel and Supabase both deploy from `git push`; the only thing
you maintain by hand is the data inside the app (guards, rate cards, requests) and the three
third-party accounts (Supabase, Vercel, Meta, Anthropic).

## One-time setup

### 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → New project.
2. **Region: pick a Frankfurt/EU region** — the brief requires German/EU server location.
3. Project Settings → API → copy the **Project URL** and the **anon/publishable key**. You'll need
   these twice (frontend env vars, and the CLI deploy below reads the URL automatically once linked).
4. SQL Editor → New query → paste all of [`supabase/schema.sql`](supabase/schema.sql) → Run.

### 2. Deploy the Edge Functions (the backend logic)

Supabase Edge Functions need the Supabase CLI to deploy — there's no separate server to set up,
just this one command per function. You don't need to install anything permanently; `npx` downloads
it on demand.

```bash
cd kora
npx supabase login                          # opens a browser to authorize once
npx supabase link --project-ref YOUR_PROJECT_REF   # find this in your Supabase project URL
npx supabase functions deploy quote-calculate
npx supabase functions deploy available-guards
npx supabase functions deploy invoice-generate
npx supabase functions deploy employee-portal --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-outbound
npx supabase functions deploy ai-assistant --no-verify-jwt
npx supabase functions deploy credential-expiry-scan --no-verify-jwt
```

`--no-verify-jwt` is used on functions that are called by things other than a logged-in dispatcher
(the employee portal's own token, Meta's webhook, and internal server-to-server calls) — each of
those functions does its own authorization check in code instead (see the comments at the top of
each `index.ts`), so this isn't a security gap, just a different check.

### 3. Set the secrets the functions need

Supabase Dashboard → Project Settings → Edge Functions → Secrets (or via CLI, shown below).
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are already provided
automatically — you don't set those.

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5          # optional, this is the default
npx supabase secrets set WHATSAPP_TOKEN=...                       # from Meta Business Manager
npx supabase secrets set WHATSAPP_PHONE_NUMBER_ID=...
npx supabase secrets set WHATSAPP_APP_SECRET=...
npx supabase secrets set WHATSAPP_VERIFY_TOKEN=pick-any-random-string
npx supabase secrets set KORA_INTERNAL_SECRET=$(openssl rand -hex 32)
npx supabase secrets set KORA_APP_ORIGIN=https://your-kora-app.vercel.app
```

### 4. Point the WhatsApp webhook at Supabase

In Meta Developer Console → your app → WhatsApp → Configuration:

- Callback URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook`
- Verify token: the same value you set for `WHATSAPP_VERIFY_TOKEN` above
- Subscribe to the `messages` webhook field

### 5. Schedule the daily credential check

Dashboard → Edge Functions → `credential-expiry-scan` → Cron, schedule `0 6 * * *` (06:00 daily).
If your project doesn't show a Cron tab yet, run this SQL instead (SQL Editor):

```sql
select cron.schedule(
  'kora-credential-expiry-scan',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/credential-expiry-scan',
    headers := jsonb_build_object('X-Internal-Secret', 'THE_SAME_KORA_INTERNAL_SECRET_VALUE')
  );
  $$
);
```

### 6. Create your company and your dispatcher login

Dashboard → Authentication → Users → Add user (email + password) — this is your dispatcher login.
Then SQL Editor:

```sql
insert into companies (name, whatsapp_dispatcher_phone, vat_percent)
values ('Your Security GmbH', '+4915112345678', 19)
returning id;

-- copy the returned id, and the user's id from Authentication → Users, then:
insert into company_members (company_id, user_id, role)
values ('COMPANY_ID_HERE', 'USER_ID_HERE', 'owner');
```

Add rate cards the same way (Table editor → `rate_cards`, or SQL `insert`) for each federal state
and qualification you staff.

### 7. Deploy the frontend to Vercel

1. [vercel.com](https://vercel.com) → New Project → import this GitHub repository.
2. **Root Directory**: set it to `kora/app` (Vercel's import screen has this field).
3. Environment Variables:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
4. Deploy. Vercel gives you a URL immediately and redeploys automatically on every push to this
   branch — nothing to configure beyond this one-time setup.

## Run locally

```bash
cd kora/app
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm install
npm run dev
```

## Security summary

- Row Level Security on every table, scoped to `company_members` — one company's dispatcher can
  never query another company's data, even by guessing an ID.
- The service-role key (which bypasses RLS) is used only inside Edge Functions running on
  Supabase's servers, never sent to the browser. Each function that uses it checks the caller's
  authorization itself before touching data.
- Credential + double-booking rules are enforced by a **database trigger**, not just the UI, so
  they hold even if a request is sent directly to the API.
- The employee portal's security is its unguessable per-guard token (a random UUID), not a
  password — treat that link as a secret, the same as you would a password reset link.
- WhatsApp's webhook verifies Meta's HMAC signature on every inbound request before trusting it.
- No credential documents, Bewacher-IDs, or other personal documents are ever placed in a WhatsApp
  message body — only short text and, where needed, a link to data behind Supabase auth.
- Fonts are the system font stack — no Google Fonts or any other third-party font request, so no
  visitor IP is ever sent to a font CDN.

## Known simplifications in this MVP (be aware, not a hidden gap)

- One shift block per request (matching the brief's core `request → offer → job → shift plan →
  invoice` loop). Multi-day, multi-shift rosters for a single request would be a natural next
  step once real usage shows the need.
- The public holiday list used for invoice premiums covers the fixed nationwide holidays only
  (New Year, Labour Day, German Unity Day, Christmas). State-specific holidays (e.g. Epiphany in
  Bavaria) aren't in the list yet — add them in `supabase/functions/_shared/rates.ts` if a state
  you operate in needs them.
- No self-service company sign-up flow — new companies are added by you via SQL (step 6 above),
  which matches "sell directly to the two operators already in talks" rather than a public
  waitlist product.
