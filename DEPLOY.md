# Railway Deployment Guide

Deploy Lumidian as two Railway services with a shared project.

## Prerequisites

1. [Railway account](https://railway.app)
2. Domain: `lumidian.ai` (DNS access required)
3. Environment variables ready (see `backend/.env.example`)

---

## Step 1: Create Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click "Empty Project"
3. Name it `lumidian`

---

## Step 2: Deploy Backend

1. In your project, click "New Service" → "GitHub Repo"
2. Select your Lumidian repo
3. Railway will auto-detect the monorepo. Set:
   - **Root Directory:** `backend`
4. Add a **Volume** for SQLite persistence:
   - Click the backend service → Settings → Volumes
   - Add Volume → Mount path: `/data`
5. Configure **Environment Variables** (Settings → Variables):

```
JWT_SECRET=<generate 32+ char random string>
DATABASE_URL=sqlite+aiosqlite:////data/lumidian.db
ENVIRONMENT=production
FRONTEND_URL=https://lumidian.ai
ALLOWED_ORIGINS=https://lumidian.ai

# LLM Keys
OPENAI_API_KEY=<your key>
ANTHROPIC_API_KEY=<your key>
PERPLEXITY_API_KEY=<your key>
GEMINI_API_KEY=<your key>
SERPER_API_KEY=<your key>

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BASIC_PRICE_ID=price_...    # "Starter" plan ($100/mo, internal key: basic)
STRIPE_STARTER_PRICE_ID=price_...  # "Growth"  plan ($300/mo, internal key: starter)
STRIPE_PRO_PRICE_ID=price_...      # "Pro"     plan ($500/mo, internal key: pro)

# Email (Resend HTTP API — no SMTP ports needed)
RESEND_API_KEY=re_...
EMAIL_FROM=Lumidian <noreply@lumidian.ai>
SUPPORT_EMAIL=support@lumidian.ai

# Monitoring (optional)
SENTRY_DSN=https://...

# Admin
ADMIN_EMAILS=<your email>
ADMIN_PASSWORD=<strong password>
ADMIN_NAME=Admin
```

6. Set up **Custom Domain**:
   - Settings → Networking → Custom Domain
   - Add `api.lumidian.ai`
   - Add the CNAME record to your DNS

---

## Step 3: Deploy Frontend

1. In same project, click "New Service" → "GitHub Repo"
2. Select your Lumidian repo again
3. Set **Root Directory:** `frontend`
4. Configure **Environment Variables**:

```
BACKEND_URL=https://api.lumidian.ai
```

   (Next.js rewrites `/api/*` requests to this URL server-side)

5. Set up **Custom Domain**:
   - Settings → Networking → Custom Domain
   - Add `lumidian.ai`
   - Add the CNAME record to your DNS

---

## Step 4: DNS Configuration

In your domain registrar (where you bought lumidian.ai):

| Type | Name | Value |
|------|------|-------|
| CNAME | `api` | `<backend-service>.up.railway.app` |
| CNAME | `@` or `www` | `<frontend-service>.up.railway.app` |

Railway provides the exact values in the Custom Domain setup.

---

## Step 5: Stripe Webhook

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://api.lumidian.ai/api/billing/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the signing secret → Update `STRIPE_WEBHOOK_SECRET` in Railway

---

## Post-Deploy Checklist

- [ ] Backend health check: `curl https://api.lumidian.ai/api/health`
- [ ] Frontend loads: `https://lumidian.ai`
- [ ] Register a test account
- [ ] Verify email flow works
- [ ] Create a brand and trigger a tracking run
- [ ] Test Stripe checkout (use test mode first)

---

## Troubleshooting

**502 Bad Gateway:** Backend crashed. Check Railway logs.

**CORS errors:** Verify `ALLOWED_ORIGINS` includes `https://lumidian.ai`

**Database empty after redeploy:** Volume not attached. Check Settings → Volumes.

**Emails not sending:** Verify `RESEND_API_KEY` is set and the sending domain is verified in the Resend dashboard. Check backend logs for errors.

**Scheduled jobs not running:** APScheduler runs in-process. If backend restarts, jobs reschedule automatically.

---

## Cost Estimate

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| Backend | ~$5-10 | Hobby plan |
| Frontend | ~$5-10 | Hobby plan |
| Volume (1GB) | Included | $0 |
| **Total** | | **~$10-20/mo** |

Scales automatically. Pay for what you use.
