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
  // Tilt of the text line in degrees (positive = clockwise), for photos shot
  // at an angle. The frontend rotates the crop by -rotation so the enlarged
  // line comes out straight. 0 for a level receipt.
  rotation: number;
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
  // When usedMock is true, the real reason the scan fell back — surfaced on the
  // host banner so failures are diagnosable instead of a generic message.
  // Undefined on the happy path.
  failureDetail?: string;
}

// Returns a fresh mock copy tagged with why we fell back. Never mutate the
// shared MOCK_RECEIPT — each caller needs its own failureDetail.
function mockWith(failureDetail: string): ParsedReceipt {
  return { ...MOCK_RECEIPT, items: MOCK_RECEIPT.items.map((i) => ({ ...i })), failureDetail };
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

// gemini-2.0-flash was retired by Google sometime before mid-2026 — the SDK
// returns a GoogleGenerativeAIFetchError for every call against it. Current
// Flash-tier model is 2.5. Bump again when 2.5 gets retired.
const GEMINI_MODEL = "gemini-2.5-flash";

const EXTRACTION_PROMPT = `You are a precise receipt analyzer. Extract structured data from the provided restaurant receipt image(s). Return ONLY a JSON object matching this schema:

{
  "merchantName": string | null,
  "merchantNameConfidence": number,
  "items": [{
    "name": string,
    "unitPrice": string,
    "quantity": integer,
    "confidence": number,
    "bbox": { "imageIndex": integer, "box_2d": [ymin, xmin, ymax, xmax], "rotation": number } | null
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

BOUNDING BOXES ("box_2d", the standard detection format):
- For each item, return "box_2d" as [ymin, xmin, ymax, xmax], each an INTEGER from 0 to 1000, where 0 is the top/left edge of the image and 1000 is the bottom/right edge. (This is the same box format you use for object detection.)
- CRITICAL: the box must span the ENTIRE line for that item — from the left edge of the item name ALL THE WAY to the right edge of its price. Include the price in the box. Do NOT box only the item name.
- Make the box tight vertically to that single line (don't swallow the lines above or below), but be precise about WHICH line it is — the box's vertical position must match the line whose name/price you reported, not the line above or below it.
- "rotation": the tilt of the text line in DEGREES, positive = clockwise, negative = counter-clockwise, 0 if the line is level/horizontal. If the whole receipt is photographed at an angle, every line shares roughly the same rotation — report it consistently (typically between -45 and 45). Use 0 when unsure.
- imageIndex is the 0-based index of the image where the line appears (relevant when multiple images were provided).
- If you can't localize the line confidently (creased, faded, cropped out), set bbox to null. Don't guess box coordinates.
- Bounding boxes only matter for items — no bboxes for merchantName / tax / tip / otherFees.

MULTIPLE IMAGES: if more than one image is provided, they are sequential parts of the SAME receipt (top → bottom). Merge them into one logical receipt. If a line item appears at the bottom of one image and the top of the next (overlap), include it only ONCE. The merchant name comes from the first image; tax/tip/totals usually come from the last image. The bbox.imageIndex tells us which image to crop from.

If the image is not a receipt or no items are legible, return: {"merchantName": null, "merchantNameConfidence": 0, "items": [], "tax": "0.00", "taxConfidence": 0, "tip": "0.00", "tipConfidence": 0, "otherFees": "0.00", "otherFeesConfidence": 0}.

Return ONLY the JSON object. No markdown fences, no commentary, no prose before or after.`;

// JPEG magic bytes: FF D8 FF (base64: /9j/)
// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A (base64: iVBORw0KGgo)
// WebP RIFF...WEBP (base64 prefix: UklGR + ...UEJQ within first ~30 chars)
function detectMimeType(base64: string): string {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  // HEIC/HEIF — the DEFAULT format for iPhone camera photos. Gemini accepts
  // image/heic and image/heif natively, but ONLY if labeled correctly; a HEIC
  // mislabeled as image/jpeg comes back as an API error, which looked like a
  // generic OCR failure. Sniff the ISO-BMFF 'ftyp' brand from the header.
  try {
    const header = Buffer.from(base64.slice(0, 64), "base64").toString("latin1");
    if (header.includes("ftyp")) {
      if (/ftyp(heic|heix|hevc|hevx)/i.test(header)) return "image/heic";
      if (/ftyp(mif1|msf1|heif)/i.test(header)) return "image/heif";
    }
  } catch {
    // fall through to the default below
  }
  return "image/jpeg"; // sensible default for phone-camera receipts
}

// Lightweight, no-image probe of the Gemini path. Because parseReceiptImage
// swallows every failure into the mock fallback, hosts (and we) can't tell
// WHY a scan didn't go through — missing key, invalid key, quota, or a
// retired model all look identical. This surfaces the real reason so the
// fault can be fixed instead of guessed at. Never returns the key itself.
export interface OcrDiagnostics {
  keyPresent: boolean;
  keyLength: number;
  model: string;
  ok: boolean;
  detail: string;
}

export async function diagnoseOcr(): Promise<OcrDiagnostics> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    return {
      keyPresent: false,
      keyLength: 0,
      model: GEMINI_MODEL,
      ok: false,
      detail:
        "GEMINI_API_KEY is not set in this environment. On Replit, add it under Secrets for the *deployment* (not just the dev workspace) and redeploy.",
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent(["Reply with the single word: ok"]);
    const text = result.response.text().trim();
    return {
      keyPresent: true,
      keyLength: apiKey.length,
      model: GEMINI_MODEL,
      ok: true,
      detail: `Gemini reachable — responded "${text.slice(0, 40)}".`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "OCR diagnostic call to Gemini failed");
    return {
      keyPresent: true,
      keyLength: apiKey.length,
      model: GEMINI_MODEL,
      ok: false,
      detail: detail.slice(0, 500),
    };
  }
}

export async function parseReceiptImage(imageBase64s: string[]): Promise<ParsedReceipt> {
  const apiKey = process.env["GEMINI_API_KEY"];

  if (imageBase64s.length === 0) {
    logger.warn("parseReceiptImage called with no images — returning mock");
    return mockWith("No image was received by the server.");
  }

  if (!apiKey) {
    logger.info("GEMINI_API_KEY not set — returning mock receipt data");
    return mockWith("GEMINI_API_KEY is not set on the server.");
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      // NOTE: gemini-2.5-flash is a "thinking" model. On an image + JSON-mode
      // request its internal thinking either contaminates the returned text
      // (making it invalid JSON) or eats the whole output budget so no answer
      // comes back — which showed up as scans silently falling back while the
      // text-only probe worked. thinkingBudget:0 turns thinking off (fine for
      // structured extraction) and a generous maxOutputTokens leaves room for
      // the full JSON. thinkingConfig is newer than the SDK's types, hence the
      // cast.
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.0,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      },
    } as unknown as Parameters<typeof genAI.getGenerativeModel>[0]);

    const imageParts = imageBase64s.map((data) => ({
      inlineData: { data, mimeType: detectMimeType(data) },
    }));
    const totalBytes = imageBase64s.reduce((n, d) => n + Math.floor(d.length * 0.75), 0);
    logger.info(
      { imageCount: imageParts.length, model: GEMINI_MODEL, approxBytes: totalBytes },
      "Calling Gemini for receipt analysis",
    );

    const result = await model.generateContent([...imageParts, EXTRACTION_PROMPT]);

    // result.response.text() throws when the candidate has no text part (e.g.
    // finishReason MAX_TOKENS or a safety block). Extract defensively so the
    // real reason reaches the banner instead of a generic failure.
    const resp = result.response;
    let text = "";
    try {
      text = resp.text();
    } catch {
      text = "";
    }
    if (!text.trim()) {
      const finishReason = resp.candidates?.[0]?.finishReason ?? "unknown";
      const blockReason = resp.promptFeedback?.blockReason ?? "none";
      throw new Error(
        `Gemini returned no text (finishReason=${finishReason}, blockReason=${blockReason})`,
      );
    }
    return parseGeminiResponse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to call Gemini API, using mock data");
    return mockWith(`Gemini image call failed: ${detail.slice(0, 300)}`);
  }
}

interface GeminiBBoxShape {
  imageIndex?: unknown;
  box_2d?: unknown;
  rotation?: unknown;
}

interface GeminiReceiptShape {
  merchantName?: unknown;
  merchantNameConfidence?: unknown;
  items?: Array<{
    name?: unknown;
    unitPrice?: unknown;
    quantity?: unknown;
    confidence?: unknown;
    bbox?: GeminiBBoxShape | null;
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
            bbox: normalizeBBox(it.bbox),
          }))
          .filter((it) => it.name !== "Unknown Item" || parseFloat(it.unitPrice) > 0)
      : [];

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
    return mockWith(`Gemini returned a response we couldn't parse: ${raw.slice(0, 120)}`);
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

function normalizeBBox(value: GeminiBBoxShape | null | undefined): ItemBBox | null {
  if (!value || typeof value !== "object") return null;
  const { imageIndex, box_2d, rotation } = value;
  if (typeof imageIndex !== "number") return null;

  // box_2d is Gemini's native detection format: [ymin, xmin, ymax, xmax] as
  // integers 0–1000. Convert to normalized [0,1] x/y/width/height.
  if (!Array.isArray(box_2d) || box_2d.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box_2d;
  if (
    typeof ymin !== "number" ||
    typeof xmin !== "number" ||
    typeof ymax !== "number" ||
    typeof xmax !== "number"
  ) {
    return null;
  }
  const x = xmin / 1000;
  const y = ymin / 1000;
  const width = (xmax - xmin) / 1000;
  const height = (ymax - ymin) / 1000;
  // Reject degenerate boxes — width/height must be positive and the box must
  // sit inside the unit square. Anything else is junk; better to skip the
  // crop than render garbage.
  if (width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0 || x + width > 1.01 || y + height > 1.01) return null;
  if (imageIndex < 0 || !Number.isInteger(imageIndex)) return null;
  // Clamp rotation to a sane range; a receipt tilted past ±45° is unusual and
  // an out-of-range value is almost certainly a hallucination, so fall back to
  // level (0) rather than rotating the crop into nonsense.
  let rot = typeof rotation === "number" && Number.isFinite(rotation) ? rotation : 0;
  if (rot > 45 || rot < -45) rot = 0;
  return {
    imageIndex,
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(1 - x, width),
    height: Math.min(1 - y, height),
    rotation: rot,
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
