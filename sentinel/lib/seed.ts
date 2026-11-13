import type { PaymentRequest, Vendor } from "@/lib/types";

export const vendors: Vendor[] = [
  { id: "v-acme", name: "Acme Steel Supply", knownGoodEmail: "billing@acmesteel.com", knownGoodBankLast4: "4821", historicalPayments: [8200, 9600, 10800, 11750, 10100, 8950, 11200, 9800], firstSeenDate: "2022-03-14", isSoleSource: true },
  { id: "v-northstar", name: "Northstar Logistics", knownGoodEmail: "ar@northstarlogistics.com", knownGoodBankLast4: "1904", historicalPayments: [4200, 4680, 4410, 4890, 4520], firstSeenDate: "2023-01-09", isSoleSource: false },
  { id: "v-bluepeak", name: "BluePeak Cloud", knownGoodEmail: "billing@bluepeak.io", knownGoodBankLast4: "7732", historicalPayments: [6400, 6400, 6800, 6800, 7100], firstSeenDate: "2023-05-18", isSoleSource: false },
  { id: "v-harbor", name: "Harbor Office Group", knownGoodEmail: "payments@harboroffice.com", knownGoodBankLast4: "6620", historicalPayments: [1180, 1260, 1325, 1210, 1290], firstSeenDate: "2021-08-11", isSoleSource: false },
  { id: "v-lumen", name: "Lumen Facilities", knownGoodEmail: "accounts@lumenfacilities.com", knownGoodBankLast4: "3188", historicalPayments: [7600, 8100, 7850, 8200, 7950], firstSeenDate: "2022-11-22", isSoleSource: false },
  { id: "v-apex", name: "Apex Industrial Parts", knownGoodEmail: "receivables@apexparts.com", knownGoodBankLast4: "5524", historicalPayments: [14400, 15100, 14750, 15900, 15300], firstSeenDate: "2020-06-05", isSoleSource: true },
  { id: "v-verde", name: "Verde Packaging", knownGoodEmail: "billing@verdepack.com", knownGoodBankLast4: "9071", historicalPayments: [3300, 3480, 3610, 3420, 3550], firstSeenDate: "2024-02-01", isSoleSource: false },
  { id: "v-cascade", name: "Cascade Safety Systems", knownGoodEmail: "ar@cascadesafety.com", knownGoodBankLast4: "2256", historicalPayments: [9200, 8900, 9550, 9100, 9400], firstSeenDate: "2021-12-16", isSoleSource: true },
  { id: "v-meridian", name: "Meridian Consulting", knownGoodEmail: "finance@meridianconsulting.co", knownGoodBankLast4: "6109", historicalPayments: [5200, 5500, 5350, 5700, 5450], firstSeenDate: "2023-09-07", isSoleSource: false },
  { id: "v-summit", name: "Summit Energy Services", knownGoodEmail: "invoices@summitenergy.com", knownGoodBankLast4: "7443", historicalPayments: [12600, 13100, 12850, 13400, 13050], firstSeenDate: "2020-10-29", isSoleSource: false },
  { id: "v-nova", name: "Nova Robotics", knownGoodEmail: "finance@novarobotics.ai", knownGoodBankLast4: "8306", historicalPayments: [], firstSeenDate: "2026-11-11", isSoleSource: false },
];

const clean = (id: string, vendorId: string, invoiceNumber: string, amount: number, submittedAt: string): PaymentRequest => {
  const vendor = vendors.find((item) => item.id === vendorId)!;
  return { id, vendorId, invoiceNumber, amount, payeeEmail: vendor.knownGoodEmail, payeeBankLast4: vendor.knownGoodBankLast4, requestEmailText: `Please process ${invoiceNumber} under our standard payment terms. Thank you.`, submittedAt, status: "PENDING", humanOverride: null };
};

export const payments: PaymentRequest[] = [
  clean("p-001", "v-northstar", "NS-10482", 4580, "2026-11-08T09:15:00.000Z"),
  clean("p-002", "v-bluepeak", "BP-88219", 6800, "2026-11-08T10:05:00.000Z"),
  clean("p-003", "v-harbor", "HG-44102", 1275, "2026-11-08T11:20:00.000Z"),
  clean("p-004", "v-lumen", "LF-20938", 8050, "2026-11-09T08:45:00.000Z"),
  { ...clean("p-005", "v-apex", "AP-77341", 15150, "2026-11-09T09:30:00.000Z"), initiatedBy: "Procurement Agent" },
  clean("p-006", "v-verde", "VP-55190", 3490, "2026-11-09T10:10:00.000Z"),
  clean("p-007", "v-cascade", "CS-39014", 9250, "2026-11-09T12:40:00.000Z"),
  clean("p-008", "v-meridian", "MC-12088", 5480, "2026-11-10T07:55:00.000Z"),
  clean("p-009", "v-summit", "SE-88420", 13050, "2026-11-10T08:20:00.000Z"),
  clean("p-010", "v-acme", "AC-26091", 10400, "2026-11-10T09:05:00.000Z"),
  clean("p-011", "v-northstar", "NS-10501", 4725, "2026-11-10T09:50:00.000Z"),
  clean("p-012", "v-bluepeak", "BP-88277", 6950, "2026-11-10T11:10:00.000Z"),
  clean("p-013", "v-harbor", "HG-44144", 1220, "2026-11-11T07:40:00.000Z"),
  clean("p-014", "v-verde", "VP-55218", 3575, "2026-11-11T08:05:00.000Z"),
  { id: "p-fraud-bec", vendorId: "v-acme", invoiceNumber: "AC-26107", amount: 34500, payeeEmail: "acme-steel-payments@gmail.com", payeeBankLast4: "9917", requestEmailText: "URGENT: Our account recently changed. Please process this today to the new account to avoid a 12% late penalty. Do not delay payment.", submittedAt: "2026-11-11T08:31:00.000Z", status: "PENDING", humanOverride: null },
  { id: "p-fraud-duplicate", vendorId: "v-northstar", invoiceNumber: "NS-10482", amount: 4580, payeeEmail: "ar@northstarlogistics.com", payeeBankLast4: "1904", requestEmailText: "Resubmitting invoice NS-10482 for payment under the usual terms.", submittedAt: "2026-11-11T08:36:00.000Z", status: "PENDING", humanOverride: null },
  { id: "p-fraud-new-vendor", vendorId: "v-nova", invoiceNumber: "NR-10001", amount: 12800, payeeEmail: "finance@novarobotics.ai", payeeBankLast4: "8306", requestEmailText: "Please process our first invoice for the automation pilot under the agreed terms.", submittedAt: "2026-11-11T08:41:00.000Z", status: "PENDING", humanOverride: null },
  { id: "p-fraud-amount", vendorId: "v-harbor", invoiceNumber: "HG-44159", amount: 9800, payeeEmail: "payments@harboroffice.com", payeeBankLast4: "6620", requestEmailText: "Please process HG-44159 using our normal remittance details.", submittedAt: "2026-11-11T08:46:00.000Z", status: "PENDING", humanOverride: null },
];
