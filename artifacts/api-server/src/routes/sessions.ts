import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import {
  sessionsTable,
  receiptItemsTable,
  participantsTable,
  selectionsTable,
} from "@workspace/db";
import {
  CreateSessionBody,
  ParseReceiptBody,
  ParseReceiptParams,
  UpdateSessionItemsBody,
  UpdateSessionItemsParams,
  StartSessionBody,
  StartSessionParams,
  FinalizeSessionBody,
  FinalizeSessionParams,
  GetSessionParams,
  GetSessionResultsParams,
  UpdateHeadcountParams,
  UpdateHeadcountBody,
} from "@workspace/api-zod";
import { parseReceiptImage } from "../lib/ocrService";
import { computeSplit } from "../lib/splitAlgorithm";
import { emitToSession } from "../lib/socketServer";

const router: IRouter = Router();

async function getFullSession(sessionId: number, sessionCode: string) {
  const session = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .then((r) => r[0]);

  if (!session) return null;

  const items = await db
    .select()
    .from(receiptItemsTable)
    .where(eq(receiptItemsTable.sessionId, sessionId));

  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, sessionId));

  const selectionsByItem = new Map<number, number>();
  const selectionsFromDB = await db
    .select({
      itemId: selectionsTable.itemId,
      quantity: selectionsTable.quantity,
      participantId: selectionsTable.participantId,
    })
    .from(selectionsTable)
    .innerJoin(
      participantsTable,
      eq(selectionsTable.participantId, participantsTable.id),
    )
    .where(eq(participantsTable.sessionId, sessionId));

  for (const sel of selectionsFromDB) {
    const prev = selectionsByItem.get(sel.itemId) ?? 0;
    selectionsByItem.set(sel.itemId, prev + sel.quantity);
  }

  const itemsWithClaimed = items.map((item) => ({
    id: item.id,
    sessionId: item.sessionId,
    name: item.name,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    claimedQuantity: selectionsByItem.get(item.id) ?? 0,
  }));

  return {
    id: session.id,
    code: session.code,
    merchantName: session.merchantName,
    tax: session.tax,
    tip: session.tip,
    otherFees: session.otherFees,
    payerName: session.payerName,
    payerVenmo: session.payerVenmo,
    payerCashapp: session.payerCashapp,
    payerZelle: session.payerZelle,
    payerApplePay: session.payerApplePay,
    hostName: session.hostName,
    headcount: session.headcount,
    status: session.status,
    items: itemsWithClaimed,
    participants: participants.map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      name: p.name,
      submitted: p.submitted,
      paid: p.paid,
    })),
  };
}

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { hostName, payerName, headcount, payerVenmo, payerCashapp, payerZelle, payerApplePay } = parsed.data;
  const code = uuidv4().replace(/-/g, "").slice(0, 12).replace(
    /(.{4})(.{4})(.{4})/,
    "$1-$2-$3",
  ).toUpperCase();
  const hostToken = uuidv4();
  const hostParticipantToken = randomBytes(24).toString("hex");

  let sessionId: number;
  let hostParticipantId: number;

  try {
    await db.transaction(async (tx) => {
      const [session] = await tx
        .insert(sessionsTable)
        .values({
          code,
          hostToken,
          hostName,
          payerName,
          payerVenmo: payerVenmo ?? null,
          payerCashapp: payerCashapp ?? null,
          payerZelle: payerZelle ?? null,
          payerApplePay: payerApplePay ?? null,
          headcount,
          status: "pending",
          tax: "0",
          tip: "0",
          otherFees: "0",
        })
        .returning();

      if (!session) throw new Error("Failed to create session");
      sessionId = session.id;

      const [hostParticipant] = await tx
        .insert(participantsTable)
        .values({
          sessionId: session.id,
          name: hostName,
          participantToken: hostParticipantToken,
          submitted: false,
        })
        .returning();

      if (!hostParticipant) throw new Error("Failed to enroll host as participant");
      hostParticipantId = hostParticipant.id;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    res.status(500).json({ error: message });
    return;
  }

  const fullSession = await getFullSession(sessionId!, code);
  if (!fullSession) {
    res.status(500).json({ error: "Failed to retrieve session" });
    return;
  }

  req.log.info({ code }, "Session created");
  res.status(201).json({
    ...fullSession,
    hostToken,
    hostParticipantId: hostParticipantId!,
    hostParticipantToken,
  });
});

router.get("/sessions/:code", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const fullSession = await getFullSession(session.id, session.code);
  if (!fullSession) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(fullSession);
});

router.post("/sessions/:code/receipt", async (req, res): Promise<void> => {
  const params = ParseReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = ParseReceiptBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  req.log.info({ code: params.data.code }, "Parsing receipt via OCR");
  const parsed = await parseReceiptImage(body.data.imageBase64);

  res.json(parsed);
});

router.put("/sessions/:code/items", async (req, res): Promise<void> => {
  const params = UpdateSessionItemsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateSessionItemsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.hostToken !== body.data.hostToken) {
    res.status(403).json({ error: "Unauthorized: invalid host token" });
    return;
  }

  if (session.status !== "pending") {
    res.status(400).json({ error: "Items can only be edited before the session is started" });
    return;
  }

  await db
    .update(sessionsTable)
    .set({
      merchantName: body.data.merchantName ?? null,
      tax: body.data.tax,
      tip: body.data.tip,
      otherFees: body.data.otherFees,
    })
    .where(eq(sessionsTable.id, session.id));

  await db
    .delete(receiptItemsTable)
    .where(eq(receiptItemsTable.sessionId, session.id));

  if (body.data.items.length > 0) {
    await db.insert(receiptItemsTable).values(
      body.data.items.map((item) => ({
        sessionId: session.id,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
    );
  }

  const fullSession = await getFullSession(session.id, session.code);
  res.json(fullSession);
});

router.post("/sessions/:code/start", async (req, res): Promise<void> => {
  const params = StartSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = StartSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.hostToken !== body.data.hostToken) {
    res.status(403).json({ error: "Unauthorized: invalid host token" });
    return;
  }

  if (session.status !== "pending") {
    res.status(400).json({ error: "Session has already been started or finalized" });
    return;
  }

  await db
    .update(sessionsTable)
    .set({ status: "open" })
    .where(eq(sessionsTable.id, session.id));

  const fullSession = await getFullSession(session.id, session.code);

  emitToSession(session.code, "session:started", fullSession);

  res.json(fullSession);
});

router.post("/sessions/:code/finalize", async (req, res): Promise<void> => {
  const params = FinalizeSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = FinalizeSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.hostToken !== body.data.hostToken) {
    res.status(403).json({ error: "Unauthorized: invalid host token" });
    return;
  }

  if (session.status !== "open") {
    res.status(400).json({ error: "Session must be open to finalize" });
    return;
  }

  await db
    .update(sessionsTable)
    .set({ status: "closed" })
    .where(eq(sessionsTable.id, session.id));

  const items = await db
    .select()
    .from(receiptItemsTable)
    .where(eq(receiptItemsTable.sessionId, session.id));

  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, session.id));

  const participantSelections = await db
    .select({
      participantId: selectionsTable.participantId,
      itemId: selectionsTable.itemId,
      quantity: selectionsTable.quantity,
    })
    .from(selectionsTable)
    .innerJoin(
      participantsTable,
      eq(selectionsTable.participantId, participantsTable.id),
    )
    .where(eq(participantsTable.sessionId, session.id));

  const selByParticipant = new Map<number, Array<{ itemId: number; quantity: number }>>();
  for (const sel of participantSelections) {
    const existing = selByParticipant.get(sel.participantId) ?? [];
    existing.push({ itemId: sel.itemId, quantity: sel.quantity });
    selByParticipant.set(sel.participantId, existing);
  }

  const splitInput = {
    participants: participants.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.name === session.hostName,
      paid: p.paid,
      selections: selByParticipant.get(p.id) ?? [],
    })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
    tax: session.tax,
    tip: session.tip,
    otherFees: session.otherFees,
    hostName: session.hostName,
    payerName: session.payerName,
    headcount: session.headcount,
  };

  const splitResult = computeSplit(splitInput);

  const results = {
    sessionCode: session.code,
    merchantName: session.merchantName,
    hostName: session.hostName,
    payerName: session.payerName,
    payerVenmo: session.payerVenmo,
    payerCashapp: session.payerCashapp,
    payerZelle: session.payerZelle,
    payerApplePay: session.payerApplePay,
    preview: false,
    ...splitResult,
  };

  emitToSession(session.code, "session:finalized", results);

  res.json(results);
});

router.get("/sessions/:code/results", async (req, res): Promise<void> => {
  const params = GetSessionResultsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status === "pending") {
    res.status(400).json({ error: "Session has not been opened yet" });
    return;
  }

  const items = await db
    .select()
    .from(receiptItemsTable)
    .where(eq(receiptItemsTable.sessionId, session.id));

  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, session.id));

  const participantSelections = await db
    .select({
      participantId: selectionsTable.participantId,
      itemId: selectionsTable.itemId,
      quantity: selectionsTable.quantity,
    })
    .from(selectionsTable)
    .innerJoin(
      participantsTable,
      eq(selectionsTable.participantId, participantsTable.id),
    )
    .where(eq(participantsTable.sessionId, session.id));

  const selByParticipant = new Map<number, Array<{ itemId: number; quantity: number }>>();
  for (const sel of participantSelections) {
    const existing = selByParticipant.get(sel.participantId) ?? [];
    existing.push({ itemId: sel.itemId, quantity: sel.quantity });
    selByParticipant.set(sel.participantId, existing);
  }

  const splitInput = {
    participants: participants.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.name === session.hostName,
      paid: p.paid,
      selections: selByParticipant.get(p.id) ?? [],
    })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
    tax: session.tax,
    tip: session.tip,
    otherFees: session.otherFees,
    hostName: session.hostName,
    payerName: session.payerName,
    headcount: session.headcount,
  };

  const splitResult = computeSplit(splitInput);

  res.json({
    sessionCode: session.code,
    merchantName: session.merchantName,
    hostName: session.hostName,
    payerName: session.payerName,
    payerVenmo: session.payerVenmo,
    payerCashapp: session.payerCashapp,
    payerZelle: session.payerZelle,
    payerApplePay: session.payerApplePay,
    preview: session.status !== "closed",
    ...splitResult,
  });
});

router.patch("/sessions/:code/headcount", async (req, res): Promise<void> => {
  const params = UpdateHeadcountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateHeadcountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.code, params.data.code));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.hostToken !== body.data.hostToken) {
    res.status(403).json({ error: "Unauthorized: invalid host token" });
    return;
  }

  if (session.status !== "open") {
    res.status(400).json({ error: "Session must be open to update headcount" });
    return;
  }

  await db
    .update(sessionsTable)
    .set({ headcount: body.data.headcount })
    .where(eq(sessionsTable.id, session.id));

  const fullSession = await getFullSession(session.id, session.code);

  emitToSession(session.code, "session:headcount_updated", {
    headcount: body.data.headcount,
  });

  res.json(fullSession);
});

export default router;
