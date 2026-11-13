import { createHash } from "node:crypto";
import { beginPayoutBatch, getPayoutBatch, getPayoutItems, getQueue, hasPayoutItem, listOpenPayoutBatches, markSandboxPending, recordPayoutItem, updatePayoutBatch } from "@/lib/db";
import { disburseTool, getPayoutRecipients, getTransactionBaseline, showPayoutBatch, type PayoutBatchDetails } from "@/lib/paypal";
import type { QueueItem } from "@/lib/types";

const terminalItemStates = new Set(["SUCCESS", "FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requestIdFor(paymentIds: string[]) {
  const fingerprint = createHash("sha256").update([...paymentIds].sort().join("|")).digest("hex");
  return { fingerprint, requestId: `sentinel-payout-${fingerprint.slice(0, 32)}` };
}

function applyDetails(fingerprint: string, details: PayoutBatchDetails) {
  updatePayoutBatch(fingerprint, details.batch_header.payout_batch_id, details.batch_header.batch_status);
  for (const item of details.items) recordPayoutItem(item.payout_item.sender_item_id, details.batch_header.payout_batch_id, item.payout_item_id, item.transaction_status, item);
  if (["DENIED", "CANCELED"].includes(details.batch_header.batch_status)) {
    for (const item of getPayoutItems(fingerprint)) if (!details.items.some((providerItem) => providerItem.payout_item.sender_item_id === item.payment_request_id)) recordPayoutItem(item.payment_request_id, details.batch_header.payout_batch_id, item.payout_item_id, "FAILED", details.batch_header);
  }
}

async function pollBatch(fingerprint: string, batchId: string, expectedItems: number) {
  let latest: PayoutBatchDetails | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await wait(attempt * 1000);
    latest = await showPayoutBatch(batchId);
    applyDetails(fingerprint, latest);
    if (latest.items.length >= expectedItems && latest.items.every((item) => terminalItemStates.has(item.transaction_status))) break;
  }
  return latest;
}

function currentResults(paymentIds: string[]) {
  const queue = new Map(getQueue().map((payment) => [payment.id, payment]));
  return paymentIds.map((paymentId) => {
    const payment = queue.get(paymentId);
    return { paymentId, state: ["SETTLED", "RELEASED"].includes(payment?.status ?? "") ? "SUCCESS" : payment?.status === "FAILED" ? "FAILED" : "PROCESSING", paypalRef: payment?.paypalRef ?? null };
  });
}

export async function releasePayoutBatch(requestedIds: string[]) {
  const byId = new Map(getQueue().map((payment) => [payment.id, payment]));
  const excluded: Array<{ paymentId: string; state: "SKIPPED"; reason: string }> = [];
  const candidates: QueueItem[] = [];
  for (const id of requestedIds) {
    const payment = byId.get(id);
    if (!payment || payment.effectiveVerdict !== "RELEASE") { excluded.push({ paymentId: id, state: "SKIPPED", reason: "Payment is held, escalated, or missing." }); continue; }
    if (["SETTLED", "RELEASED"].includes(payment.status)) { excluded.push({ paymentId: id, state: "SKIPPED", reason: "Payment already settled." }); continue; }
    candidates.push(payment);
  }
  const approved = candidates.filter((payment) => !hasPayoutItem(payment.id));
  if (!approved.length) return { batchId: null, results: [...currentResults(candidates.map((payment) => payment.id)), ...excluded], excludedCount: excluded.length };

  let recipients: string[];
  try { recipients = getPayoutRecipients(); }
  catch (error) {
    const reason = error instanceof Error ? error.message : "Payout recipient accounts are not configured.";
    for (const payment of approved) markSandboxPending(payment.id, `SANDBOX-PENDING-${payment.id}`, reason);
    return { batchId: null, results: [...currentResults(approved.map((payment) => payment.id)), ...excluded], excludedCount: excluded.length, pendingReason: reason };
  }

  const { fingerprint, requestId } = requestIdFor(approved.map((payment) => payment.id));
  const assignments = approved.map((payment, index) => ({ paymentId: payment.id, recipientEmail: recipients[index % recipients.length] }));
  beginPayoutBatch(fingerprint, requestId, assignments);
  const existing = getPayoutBatch(fingerprint);
  if (existing?.payout_batch_id) {
    try { await pollBatch(fingerprint, existing.payout_batch_id, approved.length); } catch { /* webhook or later results polling will reconcile */ }
    return { batchId: existing.payout_batch_id, results: [...currentResults(approved.map((payment) => payment.id)), ...excluded], excludedCount: excluded.length };
  }

  const baseline = await getTransactionBaseline(requestId);
  updatePayoutBatch(fingerprint, null, "BASELINE_READY", baseline);
  try {
    const created = await disburseTool.execute({
      requestId,
      currency: process.env.CURRENCY || "USD",
      items: approved.map((payment, index) => ({ paymentId: payment.id, invoiceNumber: payment.invoiceNumber, vendorName: payment.vendor.name, amount: payment.amount, receiver: recipients[index % recipients.length] })),
    });
    const batchId = created.batch_header.payout_batch_id;
    updatePayoutBatch(fingerprint, batchId, created.batch_header.batch_status, baseline);
    for (const payment of approved) recordPayoutItem(payment.id, batchId, null, "PENDING", { batch: created.batch_header, baseline });
    try { await pollBatch(fingerprint, batchId, approved.length); } catch { /* keep PROCESSING; results polling and webhooks reconcile */ }
    return { batchId, results: [...currentResults(approved.map((payment) => payment.id)), ...excluded], excludedCount: excluded.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "PayPal Payouts is not available for this Sandbox account.";
    updatePayoutBatch(fingerprint, null, "SETUP_REQUIRED", baseline);
    for (const payment of approved) markSandboxPending(payment.id, `SANDBOX-PENDING-${requestId.slice(-12)}-${payment.id}`, reason);
    return { batchId: null, results: [...currentResults(approved.map((payment) => payment.id)), ...excluded], excludedCount: excluded.length, pendingReason: reason };
  }
}

export async function reconcileOpenPayoutBatches() {
  for (const batch of listOpenPayoutBatches()) {
    if (!batch.payout_batch_id) continue;
    try { applyDetails(batch.fingerprint, await showPayoutBatch(batch.payout_batch_id)); }
    catch { /* leave the last known state intact */ }
  }
}
