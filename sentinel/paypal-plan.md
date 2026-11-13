# Sentinel PayPal Payouts integration plan

## Repository survey

- Next.js 15 App Router, Node runtime routes, strict TypeScript, npm.
- Existing PayPal boundary: `lib/paypal.ts`; release orchestration: `app/api/release/route.ts`; SQLite claims/results: `lib/db.ts`.
- Installed Agent Toolkit 1.11 exposes `list_transactions` through `@paypal/agent-toolkit/ai-sdk` with optional `transaction_status`, ISO start/end dates, page and page size.
- Host is locked to `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com` and toolkit `{ sandbox: true }`.
- Checks: `npm run typecheck`, `npm run build`.

## Root cause and replacement

Orders create/capture collects money from a payer and can require payer approval. Sentinel disburses money to vendors, so release must use PayPal Payouts:

1. Agent Toolkit `list_transactions` reads the sender merchant's recent successful ledger as provider context; Sentinel combines that merchant context with each vendor's persisted history.
2. An application-owned, Zod-validated `disburse` tool creates one Payouts batch containing only effective `RELEASE` decisions.
3. The batch is polled immediately and subsequently reconciled by payout-item webhooks.

## Operation contracts

### Agent Toolkit `list_transactions`

- Enable with `actions: { transactions: { list: true } }`.
- Tool name: `list_transactions`.
- Execute input used: `{ transaction_status: "S", page_size: 100, page: 1 }`; toolkit defaults dates to the previous 31 days.
- Result is a JSON string normalized and retained as behavioral-baseline metadata. Failure is non-fatal because local vendor history remains available; it never authorizes or blocks payout alone.

### OAuth token

- `POST {PAYPAL_API_BASE}/v1/oauth2/token`.
- Basic client ID/secret, form body `grant_type=client_credentials`.
- Require a non-empty `access_token`; token acquisition failure means the payout was not sent.

### Create payout batch

- `POST {PAYPAL_API_BASE}/v1/payments/payouts`.
- Headers: Bearer token, JSON content type, deterministic `PayPal-Request-Id`.
- Body:
  - `sender_batch_header.sender_batch_id`: deterministic request ID derived from sorted payment IDs; protects duplicates for 30 days.
  - `sender_batch_header.recipient_type`: `EMAIL`.
  - `email_subject` / `email_message`: Sentinel payout notification.
  - `items` (1–15000): `amount.currency`, two-decimal `amount.value`, `receiver`, `note`, and stable `sender_item_id = paymentRequest.id`.
- Recipients come only from validated `PAYOUT_RECIPIENTS`; items are assigned round-robin when fewer recipient accounts than payments exist.
- Require `batch_header.payout_batch_id` and `batch_header.batch_status` in the response.

### Show payout batch

- `GET {PAYPAL_API_BASE}/v1/payments/payouts/{batchId}?fields=items&page_size=1000&total_required=true`.
- Response requires `batch_header.payout_batch_id`, `batch_status`, and item objects with `payout_item_id`, `transaction_status`, and original `payout_item.sender_item_id`.
- Statuses: `SUCCESS` settles the row; `FAILED`, `RETURNED`, `BLOCKED`, `REFUNDED`, or `REVERSED` fail it; `PENDING`, `UNCLAIMED`, and `ONHOLD` stay pending.
- Diagnostics log the raw create-payout response and each GET batch response's HTTP status, `batch_status`, and normalized `batch_header.errors` (`name`, `message`, `details`) under the searchable `PAYPAL_PAYOUT_ERROR:` prefix. OAuth tokens and authorization headers are never logged.

### Payout webhooks

- Verify through `/v1/notifications/verify-webhook-signature`.
- Handle `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` as terminal `SETTLED` and `.FAILED`/`.BLOCKED`/`.RETURNED`/`.REFUNDED` as `FAILED`.
- Match on `resource.payout_item_id` or `resource.id`; store that ID as the row PayPal reference.

## Durable writes

| Write | Claim | Duplicate protection | Result |
| --- | --- | --- | --- |
| Payout batch | `payout_batches.fingerprint` primary key plus `payout_items.payment_request_id` primary key, inserted before network | SQLite constraint and PayPal `sender_batch_id`/`PayPal-Request-Id` | Provider batch ID and item IDs are stored, then statuses reconciled |

Legacy Order claims are ignored by the new payout tables. A row with effective verdict `RELEASE` and legacy status `FAILED` is eligible exactly once if it has no `payout_items` record.

## Unknown outcomes

| Write | Re-read | Reference | Application outcome |
| --- | --- | --- | --- |
| Create payout batch | GET batch details when a batch ID is known; repeated POST is safe with identical `sender_batch_id` after timeout/5xx | deterministic `sender_batch_id` and local batch claim | `PROCESSING`, never `FAILED`, until reconciled |

If Payouts is not enabled, credentials/recipients are missing, or PayPal rejects entitlement before returning a batch ID, rows are recorded as `SANDBOX_PENDING` with a stable local reference and status `PROCESSING`; they are never falsely marked settled or failed.

## Cross-operation invariants

| Invariant | Enforced where |
| --- | --- |
| Only effective `RELEASE` decisions may be included | `/api/release` before the payout claim and in the disburse Zod schema |
| `HOLD` and `ESCALATE` are excluded | release selection and server validation |
| Already-settled or already-claimed payout items cannot be paid twice | `payout_items.payment_request_id` primary key |
| Recipient email belongs to configured demo accounts | parsed `PAYOUT_RECIPIENTS` set |

## Error mapping

| Provider outcome | Sentinel behavior |
| --- | --- |
| 401/403 or missing recipients | `PROCESSING` / `SANDBOX_PENDING`, setup action required |
| 429/5xx/transport unknown | `PROCESSING`; retain claim/reference for reconciliation |
| item `FAILED` webhook/poll result | row `FAILED`, no released amount counted |
| item `SUCCESS` | row `SETTLED`, amount included in released total |

Queue and results reads reconcile every provider-backed batch that is not terminal. The browser refreshes while rows remain `PROCESSING`, so item status and `payout_item_id` become visible without a manual reload. A missing recipient configuration remains `SANDBOX_PENDING` and is never counted as settled.

## Required reading completed

- `typescript-integrate-paypal`
- `typescript-getting-started`
- `typescript-authentication`
- `typescript-calling-endpoints`
- `typescript-error-handling`

## Assumptions

- `PAYOUT_RECIPIENTS` is a comma-separated list of one to three PayPal Sandbox personal-account emails.
- Sandbox Payouts access and balance are external prerequisites documented in `SETUP.md`.
- The Agent Toolkit transaction search is merchant-wide rather than vendor-filtered; Sentinel uses it as provider context and retains its local per-vendor histories as the actual vendor baseline.
