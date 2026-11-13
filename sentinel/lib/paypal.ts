import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";

const paypalEnvSchema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_SECRET: z.string().min(1),
  PAYPAL_API_BASE: z.string().url().default("https://api-m.sandbox.paypal.com"),
});

const recipientsSchema = z.string().transform((value, context) => {
  const emails = value.split(",").map((email) => email.trim()).filter(Boolean);
  const parsed = z.array(z.string().email()).min(1).max(3).safeParse(emails);
  if (!parsed.success) { context.addIssue({ code: z.ZodIssueCode.custom, message: "PAYOUT_RECIPIENTS must contain one to three comma-separated Sandbox emails." }); return z.NEVER; }
  return parsed.data;
});

const payoutStatusSchema = z.enum(["SUCCESS", "FAILED", "PENDING", "UNCLAIMED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED"]);
const batchStatusSchema = z.enum(["DENIED", "PENDING", "PROCESSING", "SUCCESS", "CANCELED"]);
const createPayoutResponseSchema = z.object({ batch_header: z.object({ payout_batch_id: z.string().min(1), batch_status: batchStatusSchema }) });
export const payoutBatchDetailsSchema = z.object({
  batch_header: z.object({ payout_batch_id: z.string().min(1), batch_status: batchStatusSchema }),
  items: z.array(z.object({
    payout_item_id: z.string().min(1),
    transaction_status: payoutStatusSchema,
    payout_item: z.object({ sender_item_id: z.string().min(1), receiver: z.string().optional(), amount: z.object({ currency: z.string(), value: z.string() }).optional() }),
  })).default([]),
});

export const disburseInputSchema = z.object({
  requestId: z.string().min(1).max(256),
  currency: z.string().length(3),
  items: z.array(z.object({ paymentId: z.string().min(1).max(63), invoiceNumber: z.string().min(1), vendorName: z.string().min(1), amount: z.number().positive(), receiver: z.string().email() })).min(1).max(15000),
});

export type DisburseInput = z.infer<typeof disburseInputSchema>;
export type PayoutBatchDetails = z.infer<typeof payoutBatchDetailsSchema>;

export class PayPalPayoutError extends Error {
  status?: number;
  providerBody?: unknown;
  constructor(message: string, status?: number, providerBody?: unknown, options?: ErrorOptions) { super(message, options); this.name = "PayPalPayoutError"; this.status = status; this.providerBody = providerBody; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function payoutBatchDiagnostics(body: unknown) {
  const root = asRecord(body);
  const header = asRecord(root?.batch_header);
  const rawErrors = header?.errors;
  const errors = (Array.isArray(rawErrors) ? rawErrors : rawErrors ? [rawErrors] : []).map((value) => {
    const error = asRecord(value);
    return error ? { name: error.name ?? null, message: error.message ?? null, details: error.details ?? null } : { name: null, message: String(value), details: null };
  });
  return { batch_status: header?.batch_status ?? null, errors };
}

function logPayoutResponse(stage: string, value: unknown) {
  console.error(`PAYPAL_PAYOUT_ERROR: ${stage}\n${JSON.stringify(value, null, 2)}`);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function getPayPalEnv() {
  return paypalEnvSchema.parse({ PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID, PAYPAL_SECRET: process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE: process.env.PAYPAL_API_BASE });
}

export function getPayoutRecipients() {
  if (!process.env.PAYOUT_RECIPIENTS) throw new Error("Add one to three PayPal Sandbox personal-account emails to PAYOUT_RECIPIENTS.");
  return recipientsSchema.parse(process.env.PAYOUT_RECIPIENTS);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const env = getPayPalEnv();
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store" });
  } catch (error) {
    throw new PayPalPayoutError("PayPal token request did not return a response.", undefined, undefined, { cause: error });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PayPalPayoutError("PayPal Sandbox credentials were rejected.", response.status, body);
  const token = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().default(300) }).parse(body);
  cachedToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

function parseToolResult(result: unknown) {
  if (typeof result === "string") return JSON.parse(result);
  if (result && typeof result === "object" && "content" in result) {
    const text = (result as { content?: Array<{ type?: string; text?: string }> }).content?.find((item) => item.type === "text")?.text;
    if (text) return JSON.parse(text);
  }
  return result;
}

export async function getTransactionBaseline(requestId: string) {
  const env = getPayPalEnv();
  try {
    const toolkit = new PayPalAgentToolkit({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_SECRET, configuration: { context: { sandbox: true, request_id: `${requestId}-history` }, actions: { transactions: { list: true } } } });
    const listTransactions = toolkit.getTools().list_transactions;
    if (!listTransactions?.execute) return { source: "agent-toolkit:list_transactions", available: false, reason: "Tool unavailable" };
    const raw = await listTransactions.execute({ transaction_status: "S", page_size: 100, page: 1 }, { toolCallId: `sentinel-history-${requestId}`, messages: [] });
    const data = parseToolResult(raw) as { transaction_details?: unknown[]; total_items?: number; error?: unknown };
    return { source: "agent-toolkit:list_transactions", available: !data?.error, recentTransactionCount: data?.transaction_details?.length ?? data?.total_items ?? 0, providerResult: data?.error ? { error: data.error } : { total_items: data?.total_items } };
  } catch (error) {
    return { source: "agent-toolkit:list_transactions", available: false, reason: error instanceof Error ? error.message : "Transaction baseline unavailable" };
  }
}

async function executeDisbursement(input: DisburseInput) {
  const validated = disburseInputSchema.parse(input);
  const env = getPayPalEnv();
  const token = await getAccessToken();
  const payload = {
    sender_batch_header: { sender_batch_id: validated.requestId, recipient_type: "EMAIL", email_subject: "Sentinel vendor payment", email_message: "Your approved vendor payment was released through PayPal Sandbox." },
    items: validated.items.map((item) => ({ recipient_type: "EMAIL", amount: { value: item.amount.toFixed(2), currency: validated.currency }, receiver: item.receiver, note: `${item.vendorName} invoice ${item.invoiceNumber}`, sender_item_id: item.paymentId })),
  };
  let response: Response;
  try {
    response = await fetch(`${env.PAYPAL_API_BASE}/v1/payments/payouts`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": validated.requestId }, body: JSON.stringify(payload), cache: "no-store" });
  } catch (error) {
    throw new PayPalPayoutError("Payout creation outcome is unknown.", undefined, undefined, { cause: error });
  }
  const body = await response.json().catch(() => ({}));
  logPayoutResponse("create-payout response", { http_status: response.status, http_status_text: response.statusText, response: body });
  if (!response.ok) throw new PayPalPayoutError("PayPal rejected the Payouts batch.", response.status, body);
  return createPayoutResponseSchema.parse(body);
}

export const disburseTool = { name: "disburse", description: "Disburse a human-approved Sentinel payment batch through PayPal Payouts.", schema: disburseInputSchema, execute: executeDisbursement };

export async function showPayoutBatch(batchId: string): Promise<PayoutBatchDetails> {
  const id = z.string().min(1).max(1000).parse(batchId);
  const env = getPayPalEnv();
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${env.PAYPAL_API_BASE}/v1/payments/payouts/${encodeURIComponent(id)}?fields=items&page_size=1000&total_required=true`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store" });
  } catch (error) {
    throw new PayPalPayoutError("Payout status request did not return a response.", undefined, undefined, { cause: error });
  }
  const body = await response.json().catch(() => ({}));
  const diagnostics = payoutBatchDiagnostics(body);
  logPayoutResponse("get-payout-batch response", { payout_batch_id: id, http_status: response.status, http_status_text: response.statusText, batch_status: diagnostics.batch_status, errors: diagnostics.errors, ...(!response.ok ? { response: body } : {}) });
  if (!response.ok) throw new PayPalPayoutError("PayPal could not return the Payouts batch.", response.status, body);
  return payoutBatchDetailsSchema.parse(body);
}

export async function verifyWebhook(headers: Headers, event: unknown) {
  const env = paypalEnvSchema.extend({ PAYPAL_WEBHOOK_ID: z.string().min(1) }).parse({ PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID, PAYPAL_SECRET: process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE: process.env.PAYPAL_API_BASE, PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID });
  const token = await getAccessToken();
  const response = await fetch(`${env.PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ auth_algo: headers.get("paypal-auth-algo"), cert_url: headers.get("paypal-cert-url"), transmission_id: headers.get("paypal-transmission-id"), transmission_sig: headers.get("paypal-transmission-sig"), transmission_time: headers.get("paypal-transmission-time"), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event }), cache: "no-store" });
  if (!response.ok) return false;
  return z.object({ verification_status: z.string() }).parse(await response.json()).verification_status === "SUCCESS";
}
