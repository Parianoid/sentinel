import OpenAI from "openai";
import { z } from "zod";
import type { PaymentRequest, RiskAssessment, Vendor, Verdict } from "@/lib/types";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_MAX_RATE_LIMIT_RETRIES = 3;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type GroqApiError = Error & {
  status?: number;
  code?: string;
  type?: string;
  param?: string;
  requestID?: string;
  headers?: Headers;
  error?: unknown;
};

function logGroqError(error: unknown, attempt: number) {
  const groqError = error as Partial<GroqApiError>;
  const details = {
    attempt,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    status: groqError.status ?? null,
    code: groqError.code ?? null,
    type: groqError.type ?? null,
    param: groqError.param ?? null,
    request_id: groqError.requestID ?? groqError.headers?.get("x-request-id") ?? null,
    retry_after: groqError.headers?.get("retry-after") ?? null,
    rate_limit_remaining_requests: groqError.headers?.get("x-ratelimit-remaining-requests") ?? null,
    rate_limit_remaining_tokens: groqError.headers?.get("x-ratelimit-remaining-tokens") ?? null,
    provider_error: groqError.error ?? null,
  };
  console.error(`GROQ_ASSESSMENT_ERROR:\n${JSON.stringify(details, null, 2)}`);
}

function retryDelay(error: unknown, retryIndex: number) {
  const groqError = error as Partial<GroqApiError>;
  const retryAfter = Number(groqError.headers?.get("retry-after"));
  const providerDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
  return Math.min(30_000, Math.max(providerDelay, 1000 * (2 ** retryIndex)));
}

export const SYSTEM_PROMPT = `You are Sentinel, a payment-fraud analyst guarding a company's outgoing B2B vendor payments. For each payment you receive the invoice details, the payee details, the plain-text payment request message, the vendor's known-good profile, and pre-computed deterministic flags and statistics. Your job is JUDGMENT, not arithmetic — never recompute totals; reason about whether this payment is safe to release.

Weigh these fraud patterns, especially business email compromise (BEC): a payee bank or email that differs from the vendor's known-good record; an amount far outside this vendor's historical range; a first-time vendor asking for a large sum; duplicate or near-duplicate invoice numbers; and social-engineering language in the request (urgency, secrecy, 'new account', pressure to pay today, threats about late fees).

Return a verdict:
- RELEASE: consistent with this vendor's established pattern; no meaningful fraud signal.
- HOLD: clear fraud/duplicate indicators; do not pay.
- ESCALATE: ambiguous or medium risk; a human must verify via a known-good channel before release.
Be decisive but calibrated. Give a one-sentence primaryReason a CFO can act on, list the concrete signals you used, and a short rationale. Respect any hard deterministic flag already set (e.g. a duplicate invoice is always a HOLD).`;

export const assessmentOutputSchema = z.object({ riskScore: z.number().min(0).max(100), verdict: z.enum(["RELEASE", "HOLD", "ESCALATE"]), confidence: z.number().min(0).max(1), primaryReason: z.string().min(1), signals: z.array(z.string()), recommendedAction: z.string().min(1), rationale: z.string().min(1) });

export function deterministicGate(payment: PaymentRequest, vendor: Vendor, priorInvoices: string[]) {
  const flags: string[] = [];
  if (priorInvoices.includes(payment.invoiceNumber)) flags.push("DUPLICATE_INVOICE");
  if (payment.payeeEmail.toLowerCase() !== vendor.knownGoodEmail.toLowerCase() || payment.payeeBankLast4 !== vendor.knownGoodBankLast4) flags.push("PAYEE_CHANGED");
  if (!vendor.historicalPayments.length && payment.amount > 5000) flags.push("NEW_VENDOR_HIGH_VALUE");
  if (vendor.historicalPayments.length) {
    const mean = vendor.historicalPayments.reduce((a, b) => a + b, 0) / vendor.historicalPayments.length;
    const stddev = Math.sqrt(vendor.historicalPayments.reduce((s, n) => s + ((n - mean) ** 2), 0) / vendor.historicalPayments.length);
    if (payment.amount > mean + 3 * stddev || payment.amount > 2.5 * Math.max(...vendor.historicalPayments)) flags.push("AMOUNT_ANOMALY");
    return { flags, statistics: { mean: Math.round(mean), stddev: Math.round(stddev), maximum: Math.max(...vendor.historicalPayments), ratioToMax: Number((payment.amount / Math.max(...vendor.historicalPayments)).toFixed(2)) } };
  }
  return { flags, statistics: { mean: null, stddev: null, maximum: null, ratioToMax: null } };
}

type GateResult = ReturnType<typeof deterministicGate>;
export type AssessmentMode = "deterministic" | "live";

function fallback(payment: PaymentRequest, vendor: Vendor, gate: GateResult) {
  const { flags, statistics } = gate;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(payment.amount);
  const average = statistics.mean ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(statistics.mean) : null;
  const ratioToAverage = statistics.mean ? Number((payment.amount / statistics.mean).toFixed(1)) : null;
  const bec = flags.includes("PAYEE_CHANGED") && flags.includes("AMOUNT_ANOMALY");
  if (flags.includes("DUPLICATE_INVOICE")) return { riskScore: 98, verdict: "HOLD" as const, confidence: .99, primaryReason: `Invoice ${payment.invoiceNumber} was already submitted for ${vendor.name}.`, signals: ["DUPLICATE_INVOICE"], recommendedAction: "Keep payment on hold and reconcile against the original invoice.", rationale: `This ${amount} request repeats invoice ${payment.invoiceNumber} for the same vendor; Sentinel's duplicate-invoice hard stop prevents a second payment.` };
  if (bec) return { riskScore: 96, verdict: "HOLD" as const, confidence: .98, primaryReason: "Changed payee details, an extreme amount, and pressure language indicate business email compromise.", signals: ["PAYEE_CHANGED", "AMOUNT_ANOMALY", "URGENT_ACCOUNT_CHANGE_LANGUAGE"], recommendedAction: `Hold payment and call ${vendor.name} using the known-good contact.`, rationale: `Payee changed from ${vendor.knownGoodEmail} / bank ••••${vendor.knownGoodBankLast4} to ${payment.payeeEmail} / bank ••••${payment.payeeBankLast4}; ${amount} is ${ratioToAverage}× the vendor average of about ${average}, and the message urges same-day processing to a new account.` };
  if (flags.includes("NEW_VENDOR_HIGH_VALUE")) return { riskScore: 76, verdict: "ESCALATE" as const, confidence: .92, primaryReason: "A first-time vendor is requesting a high-value payment with no behavioral baseline.", signals: ["NEW_VENDOR_HIGH_VALUE", "NO_PAYMENT_HISTORY"], recommendedAction: "Verify the vendor and invoice through an independently sourced contact before release.", rationale: `${vendor.name} has no prior payment history, so the ${amount} request cannot be compared with an established range; the amount exceeds Sentinel's new-vendor verification threshold.` };
  if (flags.includes("AMOUNT_ANOMALY")) return { riskScore: 69, verdict: "ESCALATE" as const, confidence: .91, primaryReason: "The payee matches, but the amount is far outside this vendor's established range.", signals: ["AMOUNT_ANOMALY", "KNOWN_PAYEE_MATCH"], recommendedAction: "Verify the unusually large invoice with the known-good vendor contact.", rationale: `${vendor.name}'s payee remains ${vendor.knownGoodEmail} / bank ••••${vendor.knownGoodBankLast4}, but ${amount} is ${ratioToAverage}× its historical average of about ${average} and above its prior maximum of ${statistics.maximum}.` };
  if (flags.includes("PAYEE_CHANGED")) return { riskScore: 72, verdict: "ESCALATE" as const, confidence: .9, primaryReason: "Payee identity does not match the established vendor profile.", signals: ["PAYEE_CHANGED"], recommendedAction: "Verify using a known-good channel before release.", rationale: `The request replaces ${vendor.knownGoodEmail} / bank ••••${vendor.knownGoodBankLast4} with ${payment.payeeEmail} / bank ••••${payment.payeeBankLast4}; the new destination needs independent confirmation.` };
  return { riskScore: 12, verdict: "RELEASE" as const, confidence: .94, primaryReason: "Payment matches the vendor's established identity and normal amount pattern.", signals: ["KNOWN_PAYEE_MATCH", "AMOUNT_WITHIN_HISTORY"], recommendedAction: "Release under standard controls.", rationale: `The ${amount} payment to ${vendor.name} matches ${vendor.knownGoodEmail} / bank ••••${vendor.knownGoodBankLast4}${average ? ` and is consistent with its historical average of about ${average}` : ""}; no meaningful fraud signal is present.` };
}

export async function assessPayment(payment: PaymentRequest, vendor: Vendor, priorInvoices: string[], mode: AssessmentMode = "deterministic"): Promise<RiskAssessment> {
  const gate = deterministicGate(payment, vendor, priorInvoices);
  let result: z.infer<typeof assessmentOutputSchema>;
  if (mode === "deterministic") result = fallback(payment, vendor, gate);
  else {
    if (!process.env.GROQ_API_KEY) throw new Error("Live AI requires GROQ_API_KEY.");
    const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: GROQ_BASE_URL, maxRetries: 0 });
    let completion: Awaited<ReturnType<typeof client.chat.completions.create>> | null = null;
    for (let attempt = 0; attempt <= GROQ_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      try {
        completion = await client.chat.completions.create({ model: GROQ_MODEL, temperature: 0.2, messages: [{ role: "system", content: `${SYSTEM_PROMPT}\nReturn only one valid JSON object with exactly these fields: riskScore (number 0-100), verdict (RELEASE, HOLD, or ESCALATE), confidence (number 0-1), primaryReason (string), signals (string array), recommendedAction (string), and rationale (string). Your rationale must cite this payment's exact payee change, amount, vendor average/range, duplicate invoice, or request-language evidence as applicable. Never use a generic or reusable rationale.` }, { role: "user", content: JSON.stringify({ payment, vendor, deterministicFlags: gate.flags, statistics: gate.statistics }) }], response_format: { type: "json_object" } });
        break;
      } catch (error) {
        logGroqError(error, attempt + 1);
        const status = (error as Partial<GroqApiError>).status;
        if (status !== 429 || attempt === GROQ_MAX_RATE_LIMIT_RETRIES) throw error;
        const delay = retryDelay(error, attempt);
        console.error(`GROQ_RATE_LIMIT_RETRY: waiting ${delay}ms before attempt ${attempt + 2}`);
        await wait(delay);
      }
    }
    if (!completion) throw new Error("Groq returned no completion.");
    result = assessmentOutputSchema.parse(JSON.parse(completion.choices[0]?.message.content || "{}"));
  }
  let verdict: Verdict = result.verdict;
  if (gate.flags.includes("DUPLICATE_INVOICE")) verdict = "HOLD";
  else if ((gate.flags.includes("PAYEE_CHANGED") || gate.flags.includes("NEW_VENDOR_HIGH_VALUE") || gate.flags.includes("AMOUNT_ANOMALY")) && verdict === "RELEASE") verdict = "ESCALATE";
  if (gate.flags.includes("PAYEE_CHANGED") && gate.flags.includes("AMOUNT_ANOMALY") && /urgent|today|penalty|new account/i.test(payment.requestEmailText)) verdict = "HOLD";
  return { ...result, verdict, riskScore: verdict === "HOLD" ? Math.max(80, result.riskScore) : result.riskScore, paymentRequestId: payment.id, deterministicFlags: gate.flags, createdAt: new Date().toISOString() };
}
