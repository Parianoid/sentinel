# Sentinel

Sentinel is an AI trust layer for outgoing B2B payments. It combines non-bypassable deterministic controls, an OpenAI judgment layer, human approval, and real PayPal Sandbox order/capture tools.

## Quick start

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open `http://localhost:3000/queue`. The database seeds itself on first use. Without an OpenAI key, the app enters deterministic demo mode so the presentation remains usable; with a key, the same flow uses structured OpenAI output validated by Zod.

## Architecture

```text
Seeded vendor + invoice data
           │
           ▼
   SQLite payment queue ──────────────┐
           │                          │
           ▼                          │
 Deterministic gate                   │
 duplicate / payee / amount / new     │
           │                          │
           ▼                          │
 OpenAI structured judgment           │
           │  Zod validation          │
           ▼                          │
 AG Grid approval queue ◄── human override
           │ RELEASE only
           ▼
 PayPal Agent Toolkit transaction baseline
           │
           ▼
 Zod-validated disburse tool → one PayPal Payouts batch
           │
           ▼
 Verified PayPal webhooks → audit ledger → CSV
```

The hard duplicate hold can never be downgraded. Payee changes and high-value new vendors cannot be auto-released. A combined payee change, extreme amount anomaly, and urgent account-change language is held as likely business email compromise.

## Three-minute demo

1. Open **Payment queue**. Point out the $34,500 Acme payment hidden among 14 routine invoices.
2. Click **Run Sentinel**. Fourteen rows turn green. Acme turns red with `PAYEE_CHANGED` and `AMOUNT_ANOMALY`.
3. Click the Acme invoice. Show the known-good vs requested payee, BEC rationale, and amount-history bars.
4. Click **Release approved (14)**. Only release decisions enter the PayPal Agent Toolkit path; the held Acme request never does.
5. Open **Results & audit**. Show the released references and “$34,500 money saved,” then export the CSV.
6. Optional finale: click **Inject attack**. Sentinel creates and assesses a fresh attack live.

## Important Sandbox behavior

PayPal Orders normally require payer approval before capture. Sentinel creates the real Sandbox order and immediately attempts capture. If the Sandbox account requires approval, the item stays `PROCESSING` with its order reference rather than being falsely marked failed or released. A capture-completed webhook settles it as `RELEASED`.

## Enabled modules

- Core deterministic + AI assessment flow
- First-visit welcome and replayable 60-second `driver.js` tour
- Genuine AG Grid queue with vendor-group presentation, pinned totals, quick filter, custom risk/verdict renderers, row tint, and inline evidence drawer
- Human release/hold override
- PayPal Agent Toolkit `list_transactions` behavioral context
- One-batch PayPal Payouts disbursement and polling
- Verified PayPal payout-item webhook handling
- Results dashboard and CSV audit export
- Stretch B: live **Inject attack**
- OpenAPI 3.0 contract at `/api/openapi` for APIMatic import
- Agent-vs-agent row initiated by an autonomous Procurement Agent

AG Grid Enterprise row grouping and native `masterDetail` are not enabled because no Enterprise license key was supplied; the Community build uses a vendor-group renderer and inline evidence drawer with no watermark or license risk.

Not enabled: Payouts batch release, automatic PayPal negative-testing proof, PDF audit export, or email drafting.

## APIMatic SDK and portal

Sentinel publishes its OpenAPI 3.0 contract at `/api/openapi`; the source is `openapi.yaml`. In APIMatic, create a new API, import `openapi.yaml`, validate it, then generate the TypeScript SDK or hosted developer portal. Paste the generated portal link here before judging:

**APIMatic portal:** _add generated portal URL_

## Validation

```bash
npm run typecheck
npm run build
```

See [SETUP.md](./SETUP.md) for PayPal and OpenAI configuration.
