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

export async function parseReceiptImage(imageBase64: string): Promise<ParsedReceipt> {
  const apiKey = process.env["MINDEE_API_KEY"];

  if (!apiKey) {
    logger.info("MINDEE_API_KEY not set — returning mock receipt data");
    return MOCK_RECEIPT;
  }

  try {
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: "image/jpeg" });
    formData.append("document", blob, "receipt.jpg");

    const response = await fetch(
      "https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict",
      {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}` },
        body: formData,
      },
    );

    if (!response.ok) {
      logger.warn({ status: response.status }, "Mindee API error, using mock data");
      return MOCK_RECEIPT;
    }

    const data = await response.json() as Record<string, unknown>;
    return parseMindeeResponse(data);
  } catch (err) {
    logger.error({ err }, "Failed to call Mindee API, using mock data");
    return MOCK_RECEIPT;
  }
}

function parseMindeeResponse(data: Record<string, unknown>): ParsedReceipt {
  try {
    const doc = data as {
      document?: {
        inference?: {
          prediction?: {
            supplier_name?: { value?: string };
            taxes?: Array<{ value?: number }>;
            tip?: { value?: number };
            line_items?: Array<{
              description?: string;
              unit_price?: number;
              quantity?: number;
            }>;
            total_tax?: { value?: number };
          };
        };
      };
    };

    const prediction = doc.document?.inference?.prediction;
    if (!prediction) return MOCK_RECEIPT;

    const merchantName = prediction.supplier_name?.value ?? null;
    const taxTotal = prediction.total_tax?.value ?? 0;
    const tip = prediction.tip?.value ?? 0;

    const items: ParsedItem[] = (prediction.line_items ?? []).map((item) => ({
      name: item.description ?? "Unknown Item",
      unitPrice: String((item.unit_price ?? 0).toFixed(2)),
      quantity: item.quantity ?? 1,
    }));

    return {
      merchantName,
      items,
      tax: taxTotal.toFixed(2),
      tip: tip.toFixed(2),
      otherFees: "0.00",
    };
  } catch {
    return MOCK_RECEIPT;
  }
}
