import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { diagnoseOcr } from "../lib/ocrService";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Diagnostic: is the Gemini receipt reader actually reachable? Open
// /api/ocr/diagnose in a browser to see the real reason scans fall back to
// manual entry (missing key, invalid key, quota, retired model). Read-only
// and never returns the API key itself.
router.get("/ocr/diagnose", async (_req, res) => {
  const diag = await diagnoseOcr();
  res.status(diag.ok ? 200 : 503).json(diag);
});

export default router;
