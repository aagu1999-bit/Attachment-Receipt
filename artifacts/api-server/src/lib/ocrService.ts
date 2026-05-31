import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger";

// Normalized [0,1] bounding box of an item's line on the source image. If
// Gemini can't localize the line, this is null and the frontend skips the
// per-item crop strip but keeps the row functional.
export interface ItemBBox {
  imageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ParsedItem {
  name: string;
  unitPrice: string;
  quantity: number;
  // Gemini's self-reported confidence for this row (0–1). Used by the frontend
  // to decide which rows need the "low confidence" highlight + acknowledgment.
  confidence: number;
  bbox: ItemBBox | null;
}

export interface ParsedReceipt {
  merchantName: string | null;
  merchantNameConfidence: number;
  items: ParsedItem[];
  tax: string;
  taxConfidence: number;
  tip: string;
  tipConfidence: number;
  otherFees: string;
  otherFeesConfidence: number;
  usedMock: boolean;
}

// Mock fallback — used when GEMINI_API_KEY is missing or the API call fails.
// Hosts see the 'usedMock' banner on host-setup so they know to enter items manually.
const MOCK_RECEIPT: ParsedReceipt = {
  merchantName: "The Hungry Fork Restaurant",
  merchantNameConfidence: 1,
  items: [
    { name: "Margherita Pizza", unitPrice: "14.99", quantity: 1, confidence: 1, bbox: null },
    { name: "Caesar Salad", unitPrice: "9.50", quantity: 2, confidence: 1, bbox: null },
    { name: "Craft Beer", unitPrice: "6.00", quantity: 6, confidence: 1, bbox: null },
    { name: "Grilled Salmon", unitPrice: "22.00", quantity: 1, confidence: 1, bbox: null },
    { name: "Pasta Carbonara", unitPrice: "16.50", quantity: 1, confidence: 1, bbox: null },
    { name: "Tiramisu", unitPrice: "7.00", quantity: 3, confidence: 1, bbox: null },
  ],
  tax: "8.75",
  taxConfidence: 1,
  tip: "18.00",
  tipConfidence: 1,
  otherFees: "2.00",
  otherFeesConfidence: 1,
  usedMock: true,
};

const GEMINI_MODEL = "gemini-2.0-flash";

const EXTRACTION_PROMPT = `You are a precise receipt analyzer. Extract structured data from the provided restaurant receipt image(s). Return ONLY a JSON object matching this schema:

{
  "merchantName": string | null,
  "merchantNameConfidence": number,
  "items": [{
    "name": string,
    "unitPrice": string,
    "quantity": integer,
    "confidence": number,
    "imageIndex": integer,
    "box_2d": [ymin, xmin, ymax, xmax]
  }],
  "tax": string,
  "taxConfidence": number,
  "tip": string,
  "tipConfidence": number,
  "otherFees": string,
  "otherFeesConfidence": number
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

CONFIDENCE (0–1, calibrated honestly):
- Return a confidence per field reflecting how certain you are that the value matches the receipt.
- 0.95+ = the text is crisp, unambiguous, and you have no doubt.
- 0.70–0.94 = readable but with some risk (creased paper, partial occlusion, unusual formatting, ambiguous handwriting).
- Below 0.70 = you're guessing significantly — faint ink, cut-off line, doubt about whether it's even an item.
- For amounts that are absent on the receipt (e.g. no tip line), use confidence 1.0 with value "0.00" — you're certain it's absent.
- DO NOT inflate confidence. We use these scores to decide what the user must review; over-confidence makes the system useless.

BOUNDING BOXES (REQUIRED for every item):
- For each item, return a box_2d array locating that row on the source image.
- box_2d format: [ymin, xmin, ymax, xmax]. Values are INTEGERS normalized to 0–1000, where (0,0) is the top-left corner of the image and (1000, 1000) is the bottom-right.
- ymin = top edge of the row, xmin = left edge, ymax = bottom edge, xmax = right edge.
- The box should tightly enclose the FULL line — name, qty, and price — but NOT include adjacent lines.
- ALWAYS return a box_2d for every item. If a line is truly impossible to localize (heavily creased or cropped), return your best-effort box rather than omitting it. We use these boxes to show the user the original receipt strip next to the field they're reviewing.
- "imageIndex" is the 0-based index of the image the line appears in (relevant when multiple images were provided as parts of one long receipt).
- Bounding boxes only matter for items — no boxes for merchantName / tax / tip / otherFees.

MULTIPLE IMAGES: if more than one image is provided, they are sequential parts of the SAME receipt (top → bottom). Merge them into one logical receipt. If a line item appears at the bottom of one image and the top of the next (overlap), include it only ONCE. The merchant name comes from the first image; tax/tip/totals usually come from the last image. The imageIndex tells us which image to crop from.

If the image is not a receipt or no items are legible, return: {"merchantName": null, "merchantNameConfidence": 0, "items": [], "tax": "0.00", "taxConfidence": 0, "tip": "0.00", "tipConfidence": 0, "otherFees": "0.00", "otherFeesConfidence": 0}.

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

export async function parseReceiptImage(imageBase64s: string[]): Promise<ParsedReceipt> {
  const apiKey = process.env["GEMINI_API_KEY"];

  if (imageBase64s.length === 0) {
    logger.warn("parseReceiptImage called with no images — returning mock");
    return MOCK_RECEIPT;
  }

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

    const imageParts = imageBase64s.map((data) => ({
      inlineData: { data, mimeType: detectMimeType(data) },
    }));
    logger.info(
      { imageCount: imageParts.length, model: GEMINI_MODEL },
      "Calling Gemini for receipt analysis",
    );

    const result = await model.generateContent([...imageParts, EXTRACTION_PROMPT]);

    const text = result.response.text();
    return parseGeminiResponse(text);
  } catch (err) {
    logger.error({ err }, "Failed to call Gemini API, using mock data");
    return MOCK_RECEIPT;
  }
}

interface GeminiReceiptShape {
  merchantName?: unknown;
  merchantNameConfidence?: unknown;
  items?: Array<{
    name?: unknown;
    unitPrice?: unknown;
    quantity?: unknown;
    confidence?: unknown;
    // Gemini's native bbox format: [ymin, xmin, ymax, xmax] as ints in 0–1000.
    // It's what the model was trained on; asking for any other shape
    // (e.g. {x, y, width, height} fractions) gets unreliable results.
    box_2d?: unknown;
    // Older alternate name we may also see in responses.
    bbox?: unknown;
    imageIndex?: unknown;
  }>;
  tax?: unknown;
  taxConfidence?: unknown;
  tip?: unknown;
  tipConfidence?: unknown;
  otherFees?: unknown;
  otherFeesConfidence?: unknown;
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
            confidence: normalizeConfidence(it.confidence),
            bbox: normalizeBBox(it.box_2d ?? it.bbox, it.imageIndex),
          }))
          .filter((it) => it.name !== "Unknown Item" || parseFloat(it.unitPrice) > 0)
      : [];

    const bboxCount = items.filter((it) => it.bbox !== null).length;
    logger.info(
      { itemCount: items.length, bboxCount, bboxMissing: items.length - bboxCount },
      "Parsed receipt from Gemini",
    );

    return {
      merchantName: typeof data.merchantName === "string" && data.merchantName ? data.merchantName : null,
      merchantNameConfidence: normalizeConfidence(data.merchantNameConfidence),
      items,
      tax: normalizeMoneyString(data.tax),
      taxConfidence: normalizeConfidence(data.taxConfidence),
      tip: normalizeMoneyString(data.tip),
      tipConfidence: normalizeConfidence(data.tipConfidence),
      otherFees: normalizeMoneyString(data.otherFees),
      otherFeesConfidence: normalizeConfidence(data.otherFeesConfidence),
      usedMock: false,
    };
  } catch (err) {
    logger.error({ err, raw: raw.slice(0, 500) }, "Failed to parse Gemini response, using mock data");
    return MOCK_RECEIPT;
  }
}

function normalizeConfidence(value: unknown): number {
  // Defensive default: when Gemini omits or returns a bad confidence, treat as
  // borderline (0.5) so it surfaces as "low" and the user looks. We'd rather
  // over-flag than silently let an unscored field through.
  if (typeof value !== "number" || isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// Gemini returns boxes as [ymin, xmin, ymax, xmax] with integer values in
// 0–1000 (its native format). We convert to our internal {x, y, width, height}
// shape with fractions in [0, 1] so the frontend canvas crop can multiply by
// image dimensions directly.
function normalizeBBox(box: unknown, rawImageIndex: unknown): ItemBBox | null {
  if (!Array.isArray(box) || box.length < 4) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (
    typeof ymin !== "number" ||
    typeof xmin !== "number" ||
    typeof ymax !== "number" ||
    typeof xmax !== "number"
  ) {
    return null;
  }
  if (ymax <= ymin || xmax <= xmin) return null;

  // Default imageIndex to 0 — common case is a single-image upload, and
  // Gemini sometimes drops the field on single-image inputs.
  let imageIndex = 0;
  if (typeof rawImageIndex === "number" && Number.isInteger(rawImageIndex) && rawImageIndex >= 0) {
    imageIndex = rawImageIndex;
  }

  // Detect coordinate space. Most responses use 0–1000 (Gemini native);
  // occasionally we get 0–1 if the model decided to convert. Pick the
  // divisor that maps everything into [0, 1].
  const maxVal = Math.max(ymin, xmin, ymax, xmax);
  const divisor = maxVal > 1.5 ? 1000 : 1;

  const y = ymin / divisor;
  const x = xmin / divisor;
  const height = (ymax - ymin) / divisor;
  const width = (xmax - xmin) / divisor;

  // Clamp to the unit square + reject anything wildly out of bounds.
  if (x < -0.05 || y < -0.05 || x + width > 1.05 || y + height > 1.05) return null;
  if (width <= 0 || height <= 0) return null;

  return {
    imageIndex,
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.min(1 - Math.max(0, x), width),
    height: Math.min(1 - Math.max(0, y), height),
  };
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
