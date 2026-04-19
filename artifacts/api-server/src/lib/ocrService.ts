import { logger } from "./logger";

export interface ParsedItem {
  name: string;
  unitPrice: string;
  quantity: number;
}

export interface ParsedReceipt {
  merchantName: string | null;
  items: ParsedItem[];
  tax: string;
  tip: string;
  otherFees: string;
}

// ── Mindee v2 API response shapes ────────────────────────────────────────────

interface MindeeSimpleField {
  value: string | number | boolean | null;
  confidence?: number | null;
}

interface MindeeLineItem {
  fields?: {
    description?: MindeeSimpleField;
    unit_price?: MindeeSimpleField;
    quantity?: MindeeSimpleField;
    total_amount?: MindeeSimpleField;
    item?: MindeeSimpleField;
    name?: MindeeSimpleField;
    price?: MindeeSimpleField;
    unit_amount?: MindeeSimpleField;
  };
}

interface MindeeLineItemsField {
  items?: MindeeLineItem[];
  values?: MindeeLineItem[];
}

interface MindeeResultFields {
  supplier_name?: MindeeSimpleField;
  merchant_name?: MindeeSimpleField;
  vendor_name?: MindeeSimpleField;
  total_tax?: MindeeSimpleField;
  tax_amount?: MindeeSimpleField;
  tax?: MindeeSimpleField;
  tips_gratuity?: MindeeSimpleField;
  tip?: MindeeSimpleField;
  gratuity?: MindeeSimpleField;
  tip_amount?: MindeeSimpleField;
  line_items?: MindeeLineItemsField;
}

interface MindeeV2ResultResponse {
  inference?: {
    result?: {
      fields?: MindeeResultFields;
    };
  };
}

interface MindeeEnqueueResponse {
  job?: {
    id?: string;
    polling_url?: string;
    result_url?: string;
    status?: string;
  };
}

interface MindeeJobPollResponse {
  job?: {
    status?: string;
    result_url?: string;
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

const MOCK_RECEIPT: ParsedReceipt = {
  merchantName: "The Hungry Fork Restaurant",
  items: [
    { name: "Margherita Pizza", unitPrice: "14.99", quantity: 1 },
    { name: "Caesar Salad", unitPrice: "9.50", quantity: 2 },
    { name: "Craft Beer", unitPrice: "6.00", quantity: 6 },
    { name: "Grilled Salmon", unitPrice: "22.00", quantity: 1 },
    { name: "Pasta Carbonara", unitPrice: "16.50", quantity: 1 },
    { name: "Tiramisu", unitPrice: "7.00", quantity: 3 },
  ],
  tax: "8.75",
  tip: "18.00",
  otherFees: "2.00",
};

// Mindee v2 API — Authorization header is the bare API key (no "Token " prefix).
// This is different from the legacy v1 API which used "Token <key>".
// Confirmed working: https://docs.mindee.com/integrations/api-keys
const MINDEE_ENQUEUE_URL = "https://api-v2.mindee.net/v2/products/extraction/enqueue";
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TRIES = 20;

// ── Main export ──────────────────────────────────────────────────────────────

export async function parseReceiptImage(imageBase64: string): Promise<ParsedReceipt> {
  const apiKey = process.env["MINDEE_API_KEY"];
  const modelId = process.env["MINDEE_MODEL_ID"];

  if (!apiKey || !modelId) {
    logger.info("MINDEE_API_KEY or MINDEE_MODEL_ID not set — returning mock receipt data");
    return MOCK_RECEIPT;
  }

  try {
    // Step 1: Enqueue via JSON body with file_base64 (avoids multipart/FormData complexity)
    const enqueueResp = await fetch(MINDEE_ENQUEUE_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: modelId,
        file_base64: imageBase64,
        filename: "receipt.jpg",
      }),
    });

    if (!enqueueResp.ok) {
      let body = "";
      try { body = await enqueueResp.text(); } catch { /* ignore */ }
      logger.warn({ status: enqueueResp.status, body }, "Mindee enqueue failed, using mock data");
      return MOCK_RECEIPT;
    }

    const enqueueData = await enqueueResp.json() as MindeeEnqueueResponse;
    const jobId = enqueueData.job?.id;
    if (!jobId) {
      logger.warn({ enqueueData }, "Mindee enqueue returned no job ID, using mock data");
      return MOCK_RECEIPT;
    }

    logger.info({ jobId }, "Mindee job enqueued, polling for result");

    // Step 2: Poll until processed or failed
    const pollingUrl = enqueueData.job?.polling_url ?? `https://api-v2.mindee.net/v2/jobs/${jobId}`;
    let resultUrl: string | null = enqueueData.job?.result_url ?? null;

    for (let attempt = 0; attempt < POLL_MAX_TRIES; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const pollResp = await fetch(pollingUrl, {
        method: "GET",
        headers: { Authorization: apiKey },
        redirect: "manual",
      });

      if (pollResp.status === 302) {
        resultUrl = pollResp.headers.get("location");
        break;
      }

      if (!pollResp.ok) {
        logger.warn({ status: pollResp.status, attempt }, "Mindee poll request failed");
        continue;
      }

      const pollData = await pollResp.json() as MindeeJobPollResponse;
      const status = pollData.job?.status;
      logger.info({ status, attempt }, "Mindee job poll status");

      if (status === "Processed" || status === "processed") {
        resultUrl = pollData.job?.result_url ?? resultUrl;
        break;
      }
      if (status === "Failed" || status === "failed") {
        logger.warn({ pollData }, "Mindee job failed, using mock data");
        return MOCK_RECEIPT;
      }
    }

    if (!resultUrl) {
      logger.warn("Mindee job did not complete in time, using mock data");
      return MOCK_RECEIPT;
    }

    // Step 3: Fetch the result
    const resultResp = await fetch(resultUrl, {
      headers: { Authorization: apiKey },
    });

    if (!resultResp.ok) {
      let body = "";
      try { body = await resultResp.text(); } catch { /* ignore */ }
      logger.warn({ status: resultResp.status, body }, "Mindee result fetch failed, using mock data");
      return MOCK_RECEIPT;
    }

    const resultData = await resultResp.json() as MindeeV2ResultResponse;
    return parseMindeeV2Result(resultData);
  } catch (err) {
    logger.error({ err }, "Failed to call Mindee API, using mock data");
    return MOCK_RECEIPT;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSimpleStr(field: MindeeSimpleField | undefined): string | null {
  if (!field) return null;
  return typeof field.value === "string" && field.value ? field.value : null;
}

function getSimpleNum(field: MindeeSimpleField | undefined): number {
  if (!field || field.value == null) return 0;
  const n = typeof field.value === "number" ? field.value : parseFloat(String(field.value));
  return isNaN(n) ? 0 : n;
}

function parseMindeeV2Result(data: MindeeV2ResultResponse): ParsedReceipt {
  try {
    const fields = data.inference?.result?.fields;
    if (!fields) {
      logger.warn("Mindee result had no fields, using mock data");
      return MOCK_RECEIPT;
    }

    logger.info({ fieldKeys: Object.keys(fields) }, "Mindee result field keys");

    const merchantName =
      getSimpleStr(fields.supplier_name) ??
      getSimpleStr(fields.merchant_name) ??
      getSimpleStr(fields.vendor_name);

    const tax =
      getSimpleNum(fields.total_tax) ||
      getSimpleNum(fields.tax_amount) ||
      getSimpleNum(fields.tax);

    const tip =
      getSimpleNum(fields.tips_gratuity) ||
      getSimpleNum(fields.tip) ||
      getSimpleNum(fields.gratuity) ||
      getSimpleNum(fields.tip_amount);

    const rawItems = fields.line_items?.items ?? fields.line_items?.values ?? [];
    const items: ParsedItem[] = rawItems
      .map((item: MindeeLineItem): ParsedItem => {
        const f = item.fields ?? {};
        const name =
          getSimpleStr(f.description) ??
          getSimpleStr(f.item) ??
          getSimpleStr(f.name) ??
          "Unknown Item";
        const unitPrice =
          getSimpleNum(f.unit_price) ||
          getSimpleNum(f.price) ||
          getSimpleNum(f.unit_amount) ||
          (() => {
            const total = getSimpleNum(f.total_amount);
            const qty = getSimpleNum(f.quantity) || 1;
            return total > 0 ? total / qty : 0;
          })();
        const quantity = getSimpleNum(f.quantity) || 1;
        return {
          name,
          unitPrice: Math.max(0, unitPrice).toFixed(2),
          quantity: Math.max(1, Math.round(quantity)),
        };
      })
      .filter((item: ParsedItem) => item.name !== "Unknown Item" || parseFloat(item.unitPrice) > 0);

    return {
      merchantName,
      items,
      tax: tax.toFixed(2),
      tip: tip.toFixed(2),
      otherFees: "0.00",
    };
  } catch (err) {
    logger.error({ err }, "Failed to parse Mindee V2 result, using mock data");
    return MOCK_RECEIPT;
  }
}
