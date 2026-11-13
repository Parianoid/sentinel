# Sentinel setup

## 1. Create PayPal Sandbox accounts

1. Sign in to the PayPal Developer Dashboard.
2. Open **Testing Tools → Sandbox Accounts**.
3. Create or reuse one **Business** account. This is the merchant account used by Sentinel's REST credentials.
4. Create one to three **Personal** Sandbox accounts as payout recipients and record their emails.
5. Open the Sandbox business account, enable **Payouts**, and make sure its Sandbox balance covers the approved demo batch. Payouts access can require approval on the account.

## 2. Create the REST app

1. Open **Apps & Credentials** and switch to **Sandbox**.
2. Click **Create App**, name it `Sentinel Demo`, and select the Sandbox business account.
3. Copy the **Client ID** and reveal/copy the **Secret**.
4. Enable **Payouts** and **Transaction Search** for the app. Sentinel uses Transaction Search through the PayPal Agent Toolkit and Payouts for server-to-server vendor disbursement.

## 3. Register the webhook

Your local app needs a public HTTPS URL. Use your preferred tunnel, pointing to port 3000, then register:

```text
https://YOUR-TUNNEL.example/api/webhooks/paypal
```

Subscribe to:

- `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`
- `PAYMENT.PAYOUTS-ITEM.FAILED`
- `PAYMENT.PAYOUTS-ITEM.BLOCKED`
- `PAYMENT.PAYOUTS-ITEM.RETURNED`
- `PAYMENT.PAYOUTSBATCH.SUCCESS`
- `PAYMENT.PAYOUTSBATCH.DENIED`

Save the webhook and copy its **Webhook ID**.

## 4. Configure `.env.local`

Copy `.env.example` to `.env.local` and fill the values:

```dotenv
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_SECRET=your_sandbox_secret
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
PAYPAL_WEBHOOK_ID=your_webhook_id
PAYOUT_RECIPIENTS=personal_account_1@example.com,personal_account_2@example.com
GROQ_API_KEY=your_groq_key
SENTINEL_SENDER_EMAIL=your_sandbox_business_email
CURRENCY=USD
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`PAYOUT_RECIPIENTS` must contain one to three comma-separated emails belonging to Sandbox personal accounts. The approved payments are assigned round-robin to those demo recipients. Sentinel accepts `PAYPAL_SECRET` or `PAYPAL_CLIENT_SECRET`. Keep all values server-side and never commit `.env.local`.

## 5. Run and verify

```bash
npm install
npm run dev
```

Open `http://localhost:3000/queue`, keep **Deterministic demo** selected, click **Run Sentinel**, and verify 14 `RELEASE`, 2 `HOLD`, and 2 `ESCALATE` decisions across the four distinct fraud patterns. Switch to **Live AI** only after setting `GROQ_API_KEY`; Sentinel calls Groq's OpenAI-compatible endpoint with `llama-3.1-8b-instant`, uses JSON Object Mode, validates every response with the same Zod schema, spaces requests by 400 ms, and retries HTTP 429 responses with provider-aware backoff.

Before the live demo, run one low-risk Sandbox batch and confirm each recipient account receives its payout. Visit `/results` to poll the batch; successful payout items change to terminal `SETTLED` and display their PayPal payout-item reference. No payer approval redirect is involved.

## Reset demo data

Stop the server, remove `sentinel-v2.db` (or the file named by `SENTINEL_DB_FILE`), and restart. The app recreates and reseeds the database. Do this only when you intentionally want to discard the local audit trail.

## Security notes

- The app is locked to PayPal Sandbox in the Agent Toolkit configuration.
- Webhook events are ignored unless PayPal signature verification succeeds.
- Only payments with an effective `RELEASE` decision can enter the money-moving route.
- The poisoned payment never enters that route unless a human explicitly overrides it.
- `sender_batch_id`, local batch claims, and unique payout-item claims prevent duplicate disbursement.
