import { GoogleGenerativeAI } from "@google/generative-ai";
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
  usedMock: boolean;
}

// Mock fallback — used when GEMINI_API_KEY is missing or the API call fails.
// Hosts see the 'usedMock' banner on host-setup so they know to enter items manually.
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
  usedMock: true,
};

const GEMINI_MODEL = "gemini-2.0-flash";

const EXTRACTION_PROMPT = `You are a precise receipt parser. Extract structured data from the provided restaurant receipt image. Return ONLY a JSON object matching this schema:

{
  "merchantName": string | null,
  "items": [{ "name": string, "unitPrice": string, "quantity": integer }],
  "tax": string,
  "tip": string,
  "otherFees": string
}

Rules:
- "name": the dish/drink, stripped of leading quantity numbers and trailing modifiers. E.g. "6 Guinness" -> "Guinness". Keep relevant descriptors like "Cheesesteak Egg Roll Fries" or "Mac N Cheese 4 pcs".
- "unitPrice": price PER UNIT as a 2-decimal string. If the line shows a line total against a quantity, divide. E.g. "6 Guinness $60.00" -> unit price "10.00", quantity 6. Always 2 decimals: "10.00" not "10".
- "quantity": integer from the leading number on the line, default 1.
- "tax": total tax as a 2-decimal string. "0.00" if absent.
- "tip": total tip/gratuity as a 2-decimal string. "0.00" if absent (auto-grat or service charge counts as tip).
- "otherFees": any service charges, delivery fees, surcharges not already counted in tax or tip. "0.00" if none.
- "merchantName": restaurant name from the top of the receipt. Skip POS-brand mentions ("Toast", "Square", "Clover") if there's a real restaurant name elsewhere. null if not clearly identifiable.
- Combine identical adjacent line items into one row by summing qty.
- Skip section headers, subtotal lines, payment lines, card numbers, authorization codes, anything that isn't an ordered item.
- If the image is not a receipt or no items are legible, return: {"merchantName": null, "items": [], "tax": "0.00", "tip": "0.00", "otherFees": "0.00"}.

Return ONLY the JSON object. No markdown fences, no commentary, no prose before or after.`;

// JPEG magic bytes: FF D8 FF (base64: /9j/)
// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A (base64: iVBORw0KGgo)
// WebP RIFF...WEBP (base64 prefix: UklGR + ...UEJQ within first ~30 chars)
function detectMimeType(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg"; // sensible default for phone-camera receipts
}

export async function parseReceiptImage(imageBase64: string): Promise<ParsedReceipt> {
  const apiKey = process.env["GEMINI_API_KEY"];

  if (!apiKey) {
    logger.info("GEMINI_API_KEY not set — returning mock receipt data");
    return MOCK_RECEIPT;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.0,
      },
    });

    const mimeType = detectMimeType(imageBase64);
    logger.info({ mimeType, model: GEMINI_MODEL }, "Calling Gemini for receipt parse");

    const result = await model.generateContent([
      { inlineData: { data: imageBase64, mimeType } },
      EXTRACTION_PROMPT,
    ]);

    const text = result.response.text();
    return parseGeminiResponse(text);
  } catch (err) {
    logger.error({ err }, "Failed to call Gemini API, using mock data");
    return MOCK_RECEIPT;
  }
}

interface GeminiReceiptShape {
  merchantName?: unknown;
  items?: Array<{ name?: unknown; unitPrice?: unknown; quantity?: unknown }>;
  tax?: unknown;
  tip?: unknown;
  otherFees?: unknown;
}

function parseGeminiResponse(raw: string): ParsedReceipt {
  try {
    // Strip markdown fences in case the model ignored the instruction
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const data = JSON.parse(cleaned) as GeminiReceiptShape;

    const items: ParsedItem[] = Array.isArray(data.items)
      ? data.items
          .map((it): ParsedItem => ({
            name: typeof it.name === "string" ? it.name : "Unknown Item",
            unitPrice: normalizeMoneyString(it.unitPrice),
            quantity: normalizeQuantity(it.quantity),
          }))
          .filter((it) => it.name !== "Unknown Item" || parseFloat(it.unitPrice) > 0)
      : [];

    return {
      merchantName: typeof data.merchantName === "string" && data.merchantName ? data.merchantName : null,
      items,
      tax: normalizeMoneyString(data.tax),
      tip: normalizeMoneyString(data.tip),
      otherFees: normalizeMoneyString(data.otherFees),
      usedMock: false,
    };
  } catch (err) {
    logger.error({ err, raw: raw.slice(0, 500) }, "Failed to parse Gemini response, using mock data");
    return MOCK_RECEIPT;
  }
}

function normalizeMoneyString(value: unknown): string {
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? "0.00" : n.toFixed(2);
  }
  if (typeof value === "number") {
    return isNaN(value) ? "0.00" : value.toFixed(2);
  }
  return "0.00";
}

function normalizeQuantity(value: unknown): number {
  if (typeof value === "number") return Math.max(1, Math.round(value));
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    return isNaN(n) ? 1 : Math.max(1, n);
  }
  return 1;
}
