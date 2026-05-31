import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowRight,
  Receipt,
  Plus,
  Trash2,
  Loader2,
  ArrowLeft,
  Users,
  AlertTriangle,
  Camera,
  ImageIcon,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { SiVenmo, SiCashapp, SiZelle, SiApplepay, SiGooglepay } from "react-icons/si";
import {
  useCreateSession,
  useParseReceipt,
  useUpdateSessionItems,
  useStartSession,
  type ItemBBox,
  type ParsedReceiptItem,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const setupSchema = z.object({
  hostName: z.string().min(1, "Your name is required"),
  payerName: z.string().optional(),
  headcount: z.number().int().min(1, "Must be at least 1 person").max(50, "Max 50 people"),
  payerVenmo: z.string().optional(),
  payerCashapp: z.string().optional(),
  payerZelle: z.string().optional(),
  payerApplePay: z.string().optional(),
});

const PAYMENT_HANDLES_KEY = "slice_payment_handles";
type StoredHandles = { venmo?: string; cashapp?: string; zelle?: string; applePay?: string };

function loadStoredHandles(): StoredHandles {
  try {
    const raw = localStorage.getItem(PAYMENT_HANDLES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function normalizeVenmo(v: string): string {
  return v.trim().replace(/^@/, "");
}
function normalizeCashapp(v: string): string {
  return v.trim().replace(/^\$/, "");
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const itemsSchema = z.object({
  merchantName: z.string().optional(),
  items: z.array(z.object({
    name: z.string().min(1, "Name required"),
    unitPrice: z.string().min(1, "Price required"),
    quantity: z.number().min(0, "Qty can't be negative").int(),
  })).min(1, "Add at least one item"),
  tax: z.string().min(1, "Tax required"),
  tip: z.string().min(1, "Tip required"),
  otherFees: z.string().min(1, "Fees required"),
});

type PendingPhoto = { base64: string; dataUrl: string };

const TOP_LEVEL_AI_KEYS = ["merchantName", "tax", "tip", "otherFees"] as const;
type TopLevelKey = (typeof TOP_LEVEL_AI_KEYS)[number];

// Threshold below which an AI field is treated as "low confidence" — the user
// has to either edit it or tick the bottom checkbox to acknowledge they
// looked. 85% was the user's pick; tune in flight if Gemini turns out poorly
// calibrated.
const LOW_CONF_THRESHOLD = 0.85;

function LowConfBadge({ testId }: { testId?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-300"
      title="The AI wasn't confident about this value — check it against the receipt."
      data-testid={testId}
    >
      <AlertTriangle className="w-2.5 h-2.5" /> Low confidence
    </span>
  );
}

// Generates a cropped data-URL from a source image + normalized bbox. Used for
// the per-item visual reference strip on the review screen. If anything goes
// wrong (image fails to load, malformed bbox), returns null and the row
// renders without a crop.
function cropImageToDataUrl(sourceUrl: string, bbox: ItemBBox): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cropX = Math.max(0, Math.floor(bbox.x * img.naturalWidth));
        const cropY = Math.max(0, Math.floor(bbox.y * img.naturalHeight));
        const cropW = Math.max(1, Math.floor(bbox.width * img.naturalWidth));
        const cropH = Math.max(1, Math.floor(bbox.height * img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = cropW;
        canvas.height = cropH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = sourceUrl;
  });
}

function readFileAsBase64(file: File): Promise<PendingPhoto> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      resolve({ base64, dataUrl });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function HostSetup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<"details" | "receipt" | "review">("details");
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [showPayerField, setShowPayerField] = useState(false);
  const [usedMockReceipt, setUsedMockReceipt] = useState(false);

  // Photos the host has selected but not yet parsed — supports multi-image
  // uploads so long receipts can be captured across several photos.
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  // Photos that were actually parsed — used for the thumbnail strip + lightbox
  // on the review screen.
  const [parsedPhotos, setParsedPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // AI-inferred tracking. Top-level fields use TopLevelKey; item fields use
  // the stable id from useFieldArray so add/remove doesn't shift metadata.
  // Highlights are purely visual cues based on confidence — there's no
  // per-field "confirm" interaction anymore (overkill per real-table feedback).
  const [aiInferredTop, setAiInferredTop] = useState<Set<TopLevelKey>>(new Set());
  const [aiInferredItems, setAiInferredItems] = useState<Set<string>>(new Set());

  // Confidence values (0–1) for AI-inferred fields. Anything below
  // LOW_CONF_THRESHOLD triggers a stronger highlight + the bottom checkbox.
  const [topConfidence, setTopConfidence] = useState<Partial<Record<TopLevelKey, number>>>({});
  const [itemConfidence, setItemConfidence] = useState<Record<string, number>>({});

  // Per-item cropped data-URLs computed from bbox. Null/undefined = no crop.
  const [itemCrops, setItemCrops] = useState<Record<string, string>>({});

  // Snapshot of original AI values — editing past these counts as "verified by
  // editing", which clears the low-conf checkbox requirement for that field
  // (the user touched it; they've seen it).
  const originalAiValues = useRef<{
    top: Partial<Record<TopLevelKey, string>>;
    items: Record<string, { name: string; unitPrice: string; quantity: number }>;
  }>({ top: {}, items: {} });

  // Auto-detected "edited away from the AI original" sets — populated by
  // useWatch effects below. Used to compute which low-conf fields still need
  // acknowledgment.
  const [editedTop, setEditedTop] = useState<Set<TopLevelKey>>(new Set());
  const [editedItems, setEditedItems] = useState<Set<string>>(new Set());

  // Bottom checkbox state + soft-warn flag for submit gating.
  const [lowConfAcknowledged, setLowConfAcknowledged] = useState(false);
  const [showLowConfWarning, setShowLowConfWarning] = useState(false);

  // Holds items returned by a successful AI parse until useFieldArray re-keys
  // (which happens after itemsForm.reset). The effect below picks this up and
  // binds confidence/bbox/crops to the new stable ids.
  const pendingItemMetaRef = useRef<ParsedReceiptItem[] | null>(null);
  // Photo data URLs captured at parse time — used by the bbox crop pipeline.
  // Kept separate from parsedPhotos state so the crop effect doesn't race
  // against the render cycle.
  const pendingPhotoUrlsRef = useRef<string[]>([]);

  const createSession = useCreateSession();
  const parseReceipt = useParseReceipt();
  const updateItems = useUpdateSessionItems();
  const startSession = useStartSession();

  const stored = loadStoredHandles();

  const detailsForm = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      hostName: "",
      payerName: undefined,
      headcount: 2,
      payerVenmo: stored.venmo ?? "",
      payerCashapp: stored.cashapp ?? "",
      payerZelle: stored.zelle ?? "",
      payerApplePay: stored.applePay ?? "",
    },
  });

  useEffect(() => {
    if (!showPayerField) {
      detailsForm.setValue("payerName", undefined);
    }
  }, [showPayerField, detailsForm]);

  const itemsForm = useForm<z.infer<typeof itemsSchema>>({
    resolver: zodResolver(itemsSchema),
    defaultValues: {
      merchantName: "",
      items: [{ name: "", unitPrice: "0.00", quantity: 1 }],
      tax: "0.00",
      tip: "0.00",
      otherFees: "0.00",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: itemsForm.control,
    name: "items",
  });

  // After an AI parse completes and the form resets, useFieldArray re-keys
  // each row with a new stable id. Bind confidence + bbox + value snapshot to
  // those ids here, then kick off async crop generation for items with a
  // usable bbox.
  useEffect(() => {
    const pending = pendingItemMetaRef.current;
    if (!pending) return;
    const photoUrls = pendingPhotoUrlsRef.current;

    const ids = new Set<string>();
    const confidences: Record<string, number> = {};
    const snapshot: Record<string, { name: string; unitPrice: string; quantity: number }> = {};
    const bboxByField: Record<string, ItemBBox> = {};

    fields.forEach((f, idx) => {
      const item = pending[idx];
      if (!item) return;
      ids.add(f.id);
      confidences[f.id] = item.confidence;
      snapshot[f.id] = { name: item.name, unitPrice: item.unitPrice, quantity: item.quantity };
      if (item.bbox && item.bbox.imageIndex >= 0 && item.bbox.imageIndex < photoUrls.length) {
        bboxByField[f.id] = item.bbox;
      }
    });

    setAiInferredItems(ids);
    setItemConfidence(confidences);
    setEditedItems(new Set());
    originalAiValues.current = {
      ...originalAiValues.current,
      items: snapshot,
    };
    pendingItemMetaRef.current = null;

    // Generate crops in the background; ignore late returns (no cancellation
    // needed since the effect is idempotent and crops are append-only).
    Object.entries(bboxByField).forEach(([id, bbox]) => {
      const src = photoUrls[bbox.imageIndex];
      if (!src) return;
      cropImageToDataUrl(src, bbox).then((dataUrl) => {
        if (!dataUrl) return;
        setItemCrops((prev) => ({ ...prev, [id]: dataUrl }));
      });
    });
  }, [fields]);

  // Detect edits to AI-inferred values so the low-conf checkbox requirement
  // clears for the touched field (the host edited it → they've seen it).
  const watchedItems = useWatch({ control: itemsForm.control, name: "items" });
  useEffect(() => {
    if (aiInferredItems.size === 0) return;
    setEditedItems((prev) => {
      const next = new Set(prev);
      let changed = false;
      fields.forEach((f, idx) => {
        if (!aiInferredItems.has(f.id) || next.has(f.id)) return;
        const orig = originalAiValues.current.items[f.id];
        const cur = watchedItems?.[idx];
        if (!orig || !cur) return;
        if (
          cur.name !== orig.name ||
          cur.unitPrice !== orig.unitPrice ||
          cur.quantity !== orig.quantity
        ) {
          next.add(f.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [watchedItems, fields, aiInferredItems]);

  // Same for top-level fields.
  const watchedTop = useWatch({
    control: itemsForm.control,
    name: ["merchantName", "tax", "tip", "otherFees"],
  });
  useEffect(() => {
    if (aiInferredTop.size === 0) return;
    setEditedTop((prev) => {
      const next = new Set(prev);
      let changed = false;
      const [merchantName, tax, tip, otherFees] = watchedTop ?? [];
      const pairs: [TopLevelKey, string | undefined][] = [
        ["merchantName", merchantName],
        ["tax", tax],
        ["tip", tip],
        ["otherFees", otherFees],
      ];
      for (const [key, val] of pairs) {
        if (!aiInferredTop.has(key) || next.has(key)) continue;
        const orig = originalAiValues.current.top[key] ?? "";
        if ((val ?? "") !== orig) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [watchedTop, aiInferredTop]);

  // Derive which fields are currently "low confidence" (AI-inferred AND below
  // threshold AND not yet edited by the user). Editing a field is treated as
  // verification — the user looked at it.
  function isFieldLowConf(key: TopLevelKey): boolean {
    if (!aiInferredTop.has(key)) return false;
    if (editedTop.has(key)) return false;
    const c = topConfidence[key];
    return c !== undefined && c < LOW_CONF_THRESHOLD;
  }
  function isItemLowConf(id: string): boolean {
    if (!aiInferredItems.has(id)) return false;
    if (editedItems.has(id)) return false;
    const c = itemConfidence[id];
    return c !== undefined && c < LOW_CONF_THRESHOLD;
  }

  const lowConfTopCount = Array.from(aiInferredTop).filter(isFieldLowConf).length;
  const lowConfItemCount = Array.from(aiInferredItems).filter(isItemLowConf).length;
  const lowConfCount = lowConfTopCount + lowConfItemCount;

  function onDetailsSubmit(values: z.infer<typeof setupSchema>) {
    const venmo = values.payerVenmo ? normalizeVenmo(values.payerVenmo) : "";
    const cashapp = values.payerCashapp ? normalizeCashapp(values.payerCashapp) : "";
    const zelle = values.payerZelle ? values.payerZelle.trim() : "";
    const applePay = values.payerApplePay ? values.payerApplePay.trim() : "";

    const data = {
      hostName: values.hostName,
      payerName: showPayerField && values.payerName ? values.payerName : values.hostName,
      headcount: values.headcount,
      payerVenmo: venmo || null,
      payerCashapp: cashapp || null,
      payerZelle: zelle || null,
      payerApplePay: applePay || null,
    };

    try {
      localStorage.setItem(
        PAYMENT_HANDLES_KEY,
        JSON.stringify({ venmo, cashapp, zelle, applePay }),
      );
    } catch {
      /* localStorage full or disabled — non-fatal */
    }

    createSession.mutate({ data }, {
      onSuccess: (data) => {
        setSessionCode(data.code);
        localStorage.setItem(`slice_host_${data.code}`, data.hostToken);
        localStorage.setItem(`slice_participant_${data.code}`, String(data.hostParticipantId));
        localStorage.setItem(`slice_token_${data.code}`, data.hostParticipantToken);
        setStep("receipt");
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  }

  async function handlePhotoSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const photos = await Promise.all(Array.from(files).map(readFileAsBase64));
      setPendingPhotos((prev) => [...prev, ...photos]);
    } catch (err) {
      toast({
        title: "Couldn't read photo",
        description: err instanceof Error ? err.message : "Try a different image.",
        variant: "destructive",
      });
    }

    // Reset the input so the same file can be re-selected if removed and re-added.
    e.target.value = "";
  }

  function removePendingPhoto(index: number) {
    setPendingPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function parsePendingPhotos() {
    if (!sessionCode || pendingPhotos.length === 0) return;
    const imageBase64s = pendingPhotos.map((p) => p.base64);

    parseReceipt.mutate({ code: sessionCode, data: { imageBase64s } }, {
      onSuccess: (data) => {
        const photoUrls = pendingPhotos.map((p) => p.dataUrl);
        setParsedPhotos(photoUrls);

        if (data.usedMock) {
          itemsForm.reset({
            merchantName: "",
            items: [{ name: "", unitPrice: "0.00", quantity: 1 }],
            tax: "0.00",
            tip: "0.00",
            otherFees: "0.00",
          });
          // Mock fallback — host is entering manually, no AI metadata.
          resetAiMetadata();
        } else {
          itemsForm.reset({
            merchantName: data.merchantName || "",
            items: data.items.length > 0
              ? data.items.map((it) => ({ name: it.name, unitPrice: it.unitPrice, quantity: it.quantity }))
              : [{ name: "", unitPrice: "0.00", quantity: 1 }],
            tax: data.tax,
            tip: data.tip,
            otherFees: data.otherFees,
          });

          const topInferred = new Set<TopLevelKey>();
          const topSnapshot: Partial<Record<TopLevelKey, string>> = {};
          const topConf: Partial<Record<TopLevelKey, number>> = {};
          if (data.merchantName) {
            topInferred.add("merchantName");
            topSnapshot.merchantName = data.merchantName;
            topConf.merchantName = data.merchantNameConfidence;
          }
          // tax/tip/otherFees are always returned. Mark as inferred so the
          // amber tint shows up, but the confidence drives whether they're
          // flagged as low-conf.
          topInferred.add("tax");
          topSnapshot.tax = data.tax;
          topConf.tax = data.taxConfidence;
          topInferred.add("tip");
          topSnapshot.tip = data.tip;
          topConf.tip = data.tipConfidence;
          topInferred.add("otherFees");
          topSnapshot.otherFees = data.otherFees;
          topConf.otherFees = data.otherFeesConfidence;

          setAiInferredTop(topInferred);
          setTopConfidence(topConf);
          setEditedTop(new Set());

          // Item IDs aren't known until useFieldArray re-keys after reset; the
          // sync effect below binds confidence/bbox/crops to the new ids.
          setAiInferredItems(new Set());
          setItemConfidence({});
          setItemCrops({});
          setEditedItems(new Set());
          pendingItemMetaRef.current = data.items;
          pendingPhotoUrlsRef.current = photoUrls;

          originalAiValues.current = { top: topSnapshot, items: {} };
        }
        setUsedMockReceipt(data.usedMock);
        setShowLowConfWarning(false);
        setLowConfAcknowledged(false);
        setPendingPhotos([]);
        setStep("review");
      },
      onError: (err) => {
        toast({ title: "Error analyzing receipt", description: err.message, variant: "destructive" });
      }
    });
  }

  function resetAiMetadata() {
    setAiInferredTop(new Set());
    setAiInferredItems(new Set());
    setTopConfidence({});
    setItemConfidence({});
    setItemCrops({});
    setEditedTop(new Set());
    setEditedItems(new Set());
    originalAiValues.current = { top: {}, items: {} };
    pendingItemMetaRef.current = null;
    pendingPhotoUrlsRef.current = [];
  }

  function skipReceipt() {
    setUsedMockReceipt(false);
    setParsedPhotos([]);
    resetAiMetadata();
    setLowConfAcknowledged(false);
    setShowLowConfWarning(false);
    setStep("review");
  }

  function onReviewSubmit(values: z.infer<typeof itemsSchema>) {
    // Soft-warn: if any low-confidence fields are still unverified (neither
    // edited nor acknowledged via the checkbox), the first submit click
    // surfaces the warning banner. A second click submits anyway.
    if (lowConfCount > 0 && !lowConfAcknowledged && !showLowConfWarning) {
      setShowLowConfWarning(true);
      return;
    }

    if (!sessionCode) return;
    const hostToken = localStorage.getItem(`slice_host_${sessionCode}`);
    if (!hostToken) return;

    updateItems.mutate({ code: sessionCode, data: { hostToken, ...values } }, {
      onSuccess: () => {
        startSession.mutate({ code: sessionCode, data: { hostToken } }, {
          onSuccess: () => {
            setLocation(`/host/${sessionCode}`);
          },
          onError: (err) => {
            toast({ title: "Error starting session", description: err.message, variant: "destructive" });
          }
        });
      },
      onError: (err) => {
        toast({ title: "Error updating items", description: err.message, variant: "destructive" });
      }
    });
  }

  return (
    <div className="min-h-[100dvh] bg-muted/30 p-4 md:p-8 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => {
          if (step === "details") setLocation("/");
          else if (step === "review") setStep("receipt");
          else setStep("details");
        }}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>

        {step === "details" && (
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="text-2xl">Session Details</CardTitle>
              <CardDescription>Tell us about your group before sharing the link.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...detailsForm}>
                <form onSubmit={detailsForm.handleSubmit(onDetailsSubmit)} className="space-y-6">
                  <FormField
                    control={detailsForm.control}
                    name="hostName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Alice" {...field} data-testid="input-host-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end -mt-2">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-2"
                      onClick={() => setShowPayerField(s => !s)}
                      data-testid="toggle-payer-field"
                    >
                      {showPayerField ? "Never mind — I paid" : "Someone else paid?"}
                    </button>
                  </div>
                  {showPayerField && (
                    <FormField
                      control={detailsForm.control}
                      name="payerName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Who paid the bill?</FormLabel>
                          <FormControl>
                            <Input placeholder="Bob" {...field} value={field.value ?? ""} data-testid="input-payer-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <FormField
                    control={detailsForm.control}
                    name="headcount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-muted-foreground" />
                          How many people at the table?
                        </FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 rounded-full shrink-0"
                              onClick={() => field.onChange(Math.max(1, field.value - 1))}
                              disabled={field.value <= 1}
                              data-testid="button-headcount-decrement"
                            >
                              <span className="text-lg font-bold leading-none">−</span>
                            </Button>
                            <div className="flex-1 text-center">
                              <span className="text-3xl font-bold" data-testid="text-headcount">{field.value}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {field.value === 1 ? "person" : "people"} • Tax &amp; tip split {field.value === 1 ? "by you" : `${field.value} ways`}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-10 w-10 rounded-full shrink-0"
                              onClick={() => field.onChange(Math.min(50, field.value + 1))}
                              disabled={field.value >= 50}
                              data-testid="button-headcount-increment"
                            >
                              <span className="text-lg font-bold leading-none">+</span>
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="border-t pt-5 space-y-4">
                    <div>
                      <p className="font-semibold text-sm">How should guests pay you back?</p>
                      <p className="text-xs text-muted-foreground">
                        All fields are optional — fill in any you use, leave the rest blank. Whatever you add becomes a one-tap button on the results page.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <FormField
                        control={detailsForm.control}
                        name="payerVenmo"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                              <SiVenmo className="w-4 h-4 text-[#3D95CE]" aria-label="Venmo" />
                              Venmo username
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium pointer-events-none select-none">@</span>
                                <Input
                                  className="pl-7"
                                  placeholder="username"
                                  {...field}
                                  value={field.value ? field.value.replace(/^@/, "") : ""}
                                  onChange={(e) => field.onChange(e.target.value.replace(/^@+/, ""))}
                                  data-testid="input-payer-venmo"
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={detailsForm.control}
                        name="payerCashapp"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                              <SiCashapp className="w-4 h-4 text-[#00C244]" aria-label="Cash App" />
                              Cash App $cashtag
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium pointer-events-none select-none">$</span>
                                <Input
                                  className="pl-7"
                                  placeholder="cashtag"
                                  {...field}
                                  value={field.value ? field.value.replace(/^\$/, "") : ""}
                                  onChange={(e) => field.onChange(e.target.value.replace(/^\$+/, ""))}
                                  data-testid="input-payer-cashapp"
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={detailsForm.control}
                        name="payerZelle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                              <SiZelle className="w-4 h-4 text-[#6D1ED4]" aria-label="Zelle" />
                              Zelle phone or email
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="you@example.com or 555-555-5555"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  // Auto-format phone numbers, but leave email-looking input alone.
                                  const looksLikePhone = /^[\d\s\-()+.]*$/.test(v) && /\d/.test(v);
                                  field.onChange(looksLikePhone ? formatPhone(v) : v);
                                }}
                                data-testid="input-payer-zelle"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={detailsForm.control}
                        name="payerApplePay"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <SiApplepay className="w-5 h-5 text-foreground" aria-label="Apple Pay" />
                                <SiGooglepay className="w-5 h-5 text-foreground" aria-label="Google Pay" />
                              </span>
                              Phone for Apple Pay / Google Pay (via Messages)
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder="555-555-5555"
                                type="tel"
                                inputMode="tel"
                                {...field}
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(formatPhone(e.target.value))}
                                data-testid="input-payer-applepay"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createSession.isPending}
                    data-testid="button-create-session"
                  >
                    {createSession.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Continue <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {step === "receipt" && (
          <Card className="border-primary/20">
            <CardContent className="flex flex-col items-center gap-6 pt-8 pb-6">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Receipt className="w-8 h-8" />
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold mb-2">Upload Receipt</h3>
                <p className="text-muted-foreground max-w-sm">
                  We'll scan your receipt and extract the items automatically.
                </p>
              </div>

              <div
                className="w-full flex gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900"
                data-testid="banner-photo-guidance"
              >
                <Zap className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                <div className="space-y-1.5 text-left">
                  <p className="font-semibold text-sm">For best results — take a clear, well-lit photo</p>
                  <ul className="text-xs leading-relaxed list-disc pl-4 space-y-0.5">
                    <li><span className="font-medium">Turn on flash</span> so every line is readable</li>
                    <li>Lay the receipt flat and fill the frame</li>
                    <li>Avoid glare, shadows, and folded creases</li>
                    <li>For long receipts, take multiple photos top → bottom</li>
                  </ul>
                </div>
              </div>

              {pendingPhotos.length > 0 && (
                <div className="w-full">
                  <p className="text-xs text-muted-foreground mb-2">
                    {pendingPhotos.length} photo{pendingPhotos.length === 1 ? "" : "s"} ready
                    {pendingPhotos.length > 1 ? " — these will be merged into one receipt" : ""}
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-2" data-testid="pending-photos">
                    {pendingPhotos.map((p, idx) => (
                      <div
                        key={idx}
                        className="relative shrink-0 w-20 h-28 rounded-md overflow-hidden border bg-muted"
                      >
                        <img src={p.dataUrl} alt={`Receipt page ${idx + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          aria-label={`Remove photo ${idx + 1}`}
                          onClick={() => removePendingPhoto(idx)}
                          disabled={parseReceipt.isPending}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-50"
                          data-testid={`button-remove-pending-photo-${idx}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white rounded px-1.5 py-0.5 font-medium">
                          {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 w-full max-w-xs">
                <Label
                  htmlFor="receipt-camera"
                  className="flex items-center justify-center w-full h-14 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer transition-colors"
                  data-testid="label-take-photo"
                >
                  <Camera className="w-5 h-5 mr-2" />
                  {pendingPhotos.length === 0 ? "Take photo" : "Add another photo"}
                </Label>
                <input
                  id="receipt-camera"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoSelection}
                  disabled={parseReceipt.isPending}
                  data-testid="input-receipt-camera"
                />

                <Label
                  htmlFor="receipt-gallery"
                  className="flex items-center justify-center w-full h-12 rounded-lg border border-input bg-background hover:bg-accent cursor-pointer transition-colors text-sm"
                  data-testid="label-choose-gallery"
                >
                  <ImageIcon className="w-4 h-4 mr-2" />
                  Choose from gallery
                </Label>
                <input
                  id="receipt-gallery"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoSelection}
                  disabled={parseReceipt.isPending}
                  data-testid="input-receipt-gallery"
                />

                {pendingPhotos.length > 0 && (
                  <Button
                    type="button"
                    className="w-full h-12"
                    onClick={parsePendingPhotos}
                    disabled={parseReceipt.isPending}
                    data-testid="button-parse-photos"
                  >
                    {parseReceipt.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing {pendingPhotos.length} photo{pendingPhotos.length === 1 ? "" : "s"}...</>
                    ) : (
                      <><Sparkles className="w-4 h-4 mr-2" /> Analyze receipt</>
                    )}
                  </Button>
                )}

                <Button variant="outline" onClick={skipReceipt} disabled={parseReceipt.isPending}>
                  Enter manually
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "review" && (
          <Form {...itemsForm}>
            <form onSubmit={itemsForm.handleSubmit(onReviewSubmit)} className="space-y-6">
              {usedMockReceipt && (
                <div
                  className="flex gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900"
                  data-testid="banner-used-mock"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">Couldn't auto-read this receipt</p>
                    <p className="text-xs leading-relaxed">
                      The OCR service was unavailable or couldn't analyze the image, so the items aren't pre-filled.
                      Please enter the items, tax, and tip manually below. (Try a brighter, flatter photo and re-upload if you want to retry.)
                    </p>
                  </div>
                </div>
              )}

              {parsedPhotos.length > 0 && (
                <Card className="border-primary/20">
                  <CardContent className="py-4 flex gap-4 items-start">
                    <div className="flex gap-2 overflow-x-auto" data-testid="receipt-thumbnails">
                      {parsedPhotos.map((url, idx) => (
                        <button
                          type="button"
                          key={idx}
                          onClick={() => setLightboxIndex(idx)}
                          className="relative shrink-0 w-16 h-20 rounded-md overflow-hidden border bg-muted hover:ring-2 hover:ring-primary/60 transition"
                          data-testid={`button-thumbnail-${idx}`}
                          aria-label={`View receipt photo ${idx + 1}`}
                        >
                          <img src={url} alt={`Receipt page ${idx + 1}`} className="w-full h-full object-cover" />
                          {parsedPhotos.length > 1 && (
                            <div className="absolute bottom-0.5 left-0.5 text-[10px] bg-black/60 text-white rounded px-1 font-medium">
                              {idx + 1}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 text-xs text-muted-foreground leading-relaxed">
                      Tap a photo to zoom in. Anything the AI wasn't sure about is flagged below as
                      <span className="mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 bg-rose-50 text-rose-700 border border-rose-300 text-[10px] font-semibold align-middle">
                        <AlertTriangle className="w-2.5 h-2.5" /> Low confidence
                      </span>
                      — give those a closer look against the receipt.
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="border-primary/20">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl">Review Items</CardTitle>
                    <CardDescription>
                      {usedMockReceipt ? "Add each item from the receipt." : "Edit the scanned items or add new ones."}
                    </CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", unitPrice: "0.00", quantity: 1 })}>
                    <Plus className="w-4 h-4 mr-2" /> Add Item
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={itemsForm.control}
                    name="merchantName"
                    render={({ field }) => {
                      const isLow = isFieldLowConf("merchantName");
                      return (
                        <FormItem>
                          <div className="flex items-center gap-2 flex-wrap">
                            <FormLabel>Restaurant Name</FormLabel>
                            {isLow && <LowConfBadge testId="badge-lowconf-merchantName" />}
                          </div>
                          <FormControl>
                            <Input
                              placeholder="Chipotle"
                              className={isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}
                              {...field}
                              data-testid="input-merchant-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />

                  <div className="space-y-3">
                    {fields.map((field, index) => {
                      const isAi = aiInferredItems.has(field.id);
                      const isLow = isItemLowConf(field.id);
                      const crop = itemCrops[field.id];
                      const rowBg = isLow
                        ? "bg-rose-50/60 border-rose-300"
                        : isAi
                          ? "bg-amber-50/40 border-amber-200"
                          : "bg-muted/30";
                      return (
                        <div
                          key={field.id}
                          className={`p-3 rounded-lg border space-y-2 ${rowBg}`}
                          data-testid={`item-row-${index}`}
                        >
                          {(isAi || isLow) && (
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {isLow && <LowConfBadge testId={`badge-lowconf-item-${index}`} />}
                              </div>
                              <span className="text-[10px] text-muted-foreground">Row {index + 1}</span>
                            </div>
                          )}
                          <div className="flex gap-3 items-end">
                            {crop && (
                              <button
                                type="button"
                                onClick={() => {
                                  // Find which photo index this crop came from; open lightbox there.
                                  const item = pendingItemMetaRef.current?.[index] ?? null;
                                  if (item?.bbox) setLightboxIndex(item.bbox.imageIndex);
                                  else if (parsedPhotos.length > 0) setLightboxIndex(0);
                                }}
                                className="shrink-0 w-24 h-16 rounded-md overflow-hidden border-2 border-primary/30 bg-white hover:ring-2 hover:ring-primary/60 transition"
                                title="Tap to view this line on the receipt"
                                data-testid={`button-item-crop-${index}`}
                                aria-label={`View row ${index + 1} on the receipt`}
                              >
                                <img
                                  src={crop}
                                  alt={`Row ${index + 1} from receipt`}
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            )}
                            <div className="flex-1 grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                              <FormField
                                control={itemsForm.control}
                                name={`items.${index}.name`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs text-muted-foreground">Item name</FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder="Burrito"
                                        className={isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}
                                        {...field}
                                        data-testid={`input-item-name-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={itemsForm.control}
                                name={`items.${index}.unitPrice`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs text-muted-foreground">Price</FormLabel>
                                    <FormControl>
                                      <Input
                                        className={`w-20 ${isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}`}
                                        placeholder="9.99"
                                        {...field}
                                        data-testid={`input-item-price-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={itemsForm.control}
                                name={`items.${index}.quantity`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs text-muted-foreground">Qty</FormLabel>
                                    <FormControl>
                                      <Input
                                        className={`w-16 ${isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}`}
                                        type="number"
                                        min={0}
                                        step={1}
                                        {...field}
                                        onChange={e => {
                                          const n = e.target.valueAsNumber;
                                          // Floor negative typed values to 0 + handle empty input (NaN).
                                          field.onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
                                        }}
                                        data-testid={`input-item-qty-${index}`}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:bg-destructive/10 self-end"
                                onClick={() => remove(index)}
                                disabled={fields.length === 1}
                                data-testid={`button-remove-item-${index}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle className="text-lg">Fees &amp; Charges</CardTitle>
                  <CardDescription>These are split evenly across all {detailsForm.getValues("headcount")} people.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-4">
                  <FormField
                    control={itemsForm.control}
                    name="tax"
                    render={({ field }) => {
                      const isLow = isFieldLowConf("tax");
                      return (
                        <FormItem>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <FormLabel>Tax ($)</FormLabel>
                            {isLow && <LowConfBadge testId="badge-lowconf-tax" />}
                          </div>
                          <FormControl>
                            <Input
                              placeholder="2.50"
                              className={isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}
                              {...field}
                              data-testid="input-tax"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={itemsForm.control}
                    name="tip"
                    render={({ field }) => {
                      const isLow = isFieldLowConf("tip");
                      return (
                        <FormItem>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <FormLabel>Tip ($)</FormLabel>
                            {isLow && <LowConfBadge testId="badge-lowconf-tip" />}
                          </div>
                          <FormControl>
                            <Input
                              placeholder="5.00"
                              className={isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}
                              {...field}
                              data-testid="input-tip"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                  <FormField
                    control={itemsForm.control}
                    name="otherFees"
                    render={({ field }) => {
                      const isLow = isFieldLowConf("otherFees");
                      return (
                        <FormItem>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <FormLabel>Other ($)</FormLabel>
                            {isLow && <LowConfBadge testId="badge-lowconf-otherFees" />}
                          </div>
                          <FormControl>
                            <Input
                              placeholder="0.00"
                              className={isLow ? "border-rose-400 focus-visible:ring-rose-400" : ""}
                              {...field}
                              data-testid="input-other-fees"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </CardContent>
              </Card>

              {lowConfCount > 0 && (
                <Card className="border-rose-300 bg-rose-50/40">
                  <CardContent className="py-4 flex gap-3 items-start">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
                    <div className="space-y-3 flex-1">
                      <div className="space-y-1">
                        <p className="font-semibold text-sm text-rose-900">
                          {lowConfCount} low-confidence field{lowConfCount === 1 ? "" : "s"} to check
                        </p>
                        <p className="text-xs leading-relaxed text-rose-900/80">
                          The AI wasn't sure about {lowConfCount === 1 ? "this one" : "these"}. Compare against the
                          receipt photo above. Editing a value counts as verified — or tick the box below to confirm
                          you've eyeballed everything flagged in red.
                        </p>
                      </div>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <Checkbox
                          checked={lowConfAcknowledged}
                          onCheckedChange={(checked) => {
                            setLowConfAcknowledged(checked === true);
                            if (checked === true) setShowLowConfWarning(false);
                          }}
                          className="mt-0.5 border-rose-500 data-[state=checked]:bg-rose-600 data-[state=checked]:border-rose-600"
                          data-testid="checkbox-acknowledge-lowconf"
                        />
                        <span className="text-sm text-rose-900 select-none">
                          I've verified the low-confidence fields against the receipt.
                        </span>
                      </label>
                    </div>
                  </CardContent>
                </Card>
              )}

              {showLowConfWarning && lowConfCount > 0 && !lowConfAcknowledged && (
                <div
                  className="flex gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900"
                  data-testid="banner-lowconf-warning"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <div className="space-y-1 flex-1">
                    <p className="font-semibold text-sm">Submit without verifying?</p>
                    <p className="text-xs leading-relaxed">
                      You still have {lowConfCount} low-confidence field{lowConfCount === 1 ? "" : "s"} that aren't
                      edited or acknowledged. Tap <span className="font-semibold">Open Session</span> again to submit anyway.
                    </p>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full h-14 text-lg"
                disabled={updateItems.isPending || startSession.isPending}
                data-testid="button-start-session"
              >
                {(updateItems.isPending || startSession.isPending) ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                Open Session <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </form>
          </Form>
        )}

        <Dialog
          open={lightboxIndex !== null}
          onOpenChange={(open) => { if (!open) setLightboxIndex(null); }}
        >
          <DialogContent className="max-w-3xl p-0 bg-black border-0">
            {lightboxIndex !== null && parsedPhotos[lightboxIndex] && (
              <div className="flex flex-col">
                <img
                  src={parsedPhotos[lightboxIndex]}
                  alt={`Receipt photo ${lightboxIndex + 1}`}
                  className="w-full max-h-[80vh] object-contain bg-black"
                />
                {parsedPhotos.length > 1 && (
                  <div className="flex items-center justify-between p-3 bg-black/90 text-white text-sm">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-white/10"
                      onClick={() => setLightboxIndex((i) => (i === null ? null : Math.max(0, i - 1)))}
                      disabled={lightboxIndex === 0}
                    >
                      <ArrowLeft className="w-4 h-4 mr-1" /> Previous
                    </Button>
                    <span>{lightboxIndex + 1} / {parsedPhotos.length}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-white/10"
                      onClick={() => setLightboxIndex((i) => (i === null ? null : Math.min(parsedPhotos.length - 1, i + 1)))}
                      disabled={lightboxIndex === parsedPhotos.length - 1}
                    >
                      Next <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
