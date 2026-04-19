import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import {
  sessionsTable,
  participantsTable,
  receiptItemsTable,
  selectionsTable,
} from "@workspace/db";
import {
  JoinSessionBody,
  JoinSessionParams,
  UpdateSelectionsBody,
  UpdateSelectionsParams,
  SubmitParticipantBody,
  SubmitParticipantParams,
  GetParticipantsParams,
  GetParticipantParams,
  GetParticipantQueryParams,
} from "@workspace/api-zod";
import { emitToSession } from "../lib/socketServer";

const router: IRouter = Router();

function generateParticipantToken(): string {
  return randomBytes(24).toString("hex");
}

router.get("/sessions/:code/participants", async (req, res): Promise<void> => {
  const params = GetParticipantsParams.safeParse(req.params);
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

  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, session.id));

  const allSelections = await db
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
  for (const sel of allSelections) {
    const existing = selByParticipant.get(sel.participantId) ?? [];
    existing.push({ itemId: sel.itemId, quantity: sel.quantity });
    selByParticipant.set(sel.participantId, existing);
  }

  const result = participants.map((p) => ({
    id: p.id,
    sessionId: p.sessionId,
    name: p.name,
    submitted: p.submitted,
    selections: selByParticipant.get(p.id) ?? [],
  }));

  res.json(result);
});

async function getParticipantWithSelections(participantId: number) {
  const [participant] = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.id, participantId));

  if (!participant) return null;

  const selections = await db
    .select({
      itemId: selectionsTable.itemId,
      quantity: selectionsTable.quantity,
    })
    .from(selectionsTable)
    .where(eq(selectionsTable.participantId, participantId));

  return {
    id: participant.id,
    sessionId: participant.sessionId,
    name: participant.name,
    submitted: participant.submitted,
    participantToken: participant.participantToken,
    selections,
  };
}

async function getItemsRemaining(sessionId: number) {
  const items = await db
    .select()
    .from(receiptItemsTable)
    .where(eq(receiptItemsTable.sessionId, sessionId));

  const sessionParticipants = await db
    .select({ id: participantsTable.id })
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, sessionId));

  const participantIds = sessionParticipants.map((p) => p.id);

  if (participantIds.length === 0) {
    return items.map((item) => ({ itemId: item.id, remaining: item.quantity }));
  }

  const allSelections = await db
    .select({
      itemId: selectionsTable.itemId,
      quantity: selectionsTable.quantity,
    })
    .from(selectionsTable)
    .innerJoin(
      participantsTable,
      eq(selectionsTable.participantId, participantsTable.id),
    )
    .where(eq(participantsTable.sessionId, sessionId));

  const claimedMap = new Map<number, number>();
  for (const sel of allSelections) {
    const prev = claimedMap.get(sel.itemId) ?? 0;
    claimedMap.set(sel.itemId, prev + sel.quantity);
  }

  return items.map((item) => ({
    itemId: item.id,
    remaining: item.quantity - (claimedMap.get(item.id) ?? 0),
  }));
}

router.get("/sessions/:code/participants/:participantId", async (req, res): Promise<void> => {
  const params = GetParticipantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const query = GetParticipantQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
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

  const [participant] = await db
    .select()
    .from(participantsTable)
    .where(
      and(
        eq(participantsTable.id, params.data.participantId),
        eq(participantsTable.sessionId, session.id),
      ),
    );

  if (!participant) {
    res.status(404).json({ error: "Participant not found" });
    return;
  }

  if (participant.participantToken !== query.data.participantToken) {
    res.status(403).json({ error: "Invalid participant token" });
    return;
  }

  const withSelections = await getParticipantWithSelections(participant.id);
  res.json(withSelections);
});

router.post("/sessions/:code/join", async (req, res): Promise<void> => {
  const params = JoinSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = JoinSessionBody.safeParse(req.body);
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

  if (session.status !== "open") {
    res.status(400).json({ error: "Session is not open for joining yet" });
    return;
  }

  const { name } = body.data;

  const [participant] = await db
    .insert(participantsTable)
    .values({
      sessionId: session.id,
      name,
      participantToken: generateParticipantToken(),
      submitted: false,
    })
    .returning();

  if (!participant) {
    res.status(500).json({ error: "Failed to join session" });
    return;
  }

  const withSelections = await getParticipantWithSelections(participant.id);

  emitToSession(session.code, "participant:joined", {
    id: participant.id,
    sessionId: participant.sessionId,
    name: participant.name,
    submitted: participant.submitted,
  });

  res.status(201).json(withSelections);
});

router.post("/sessions/:code/select", async (req, res): Promise<void> => {
  const params = UpdateSelectionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateSelectionsBody.safeParse(req.body);
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

  if (session.status !== "open") {
    res.status(400).json({ error: "Session is not accepting selections" });
    return;
  }

  const [participant] = await db
    .select()
    .from(participantsTable)
    .where(
      and(
        eq(participantsTable.id, body.data.participantId),
        eq(participantsTable.sessionId, session.id),
      ),
    );

  if (!participant) {
    res.status(404).json({ error: "Participant not found" });
    return;
  }

  if (participant.participantToken !== body.data.participantToken) {
    res.status(403).json({ error: "Invalid participant token" });
    return;
  }

  if (participant.submitted) {
    res.status(400).json({ error: "Already submitted — cannot change selections" });
    return;
  }

  // Normalize: merge duplicate itemIds in the request by summing quantities
  const normalizedMap = new Map<number, number>();
  for (const sel of body.data.selections) {
    normalizedMap.set(sel.itemId, (normalizedMap.get(sel.itemId) ?? 0) + sel.quantity);
  }
  const normalizedSelections = Array.from(normalizedMap.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));

  // Validate and persist inside a transaction so concurrent updates don't over-allocate
  let updatedSelections: Array<{ itemId: number; quantity: number }> = [];
  let validationError: string | null = null;

  await db.transaction(async (tx) => {
    // Lock receipt items for this session to prevent concurrent over-allocation
    const items = await tx
      .select()
      .from(receiptItemsTable)
      .where(eq(receiptItemsTable.sessionId, session.id))
      .for("update");

    const itemMap = new Map(items.map((i) => [i.id, i]));

    // Lock all selection rows in this session to get a consistent view
    const otherSelections = await tx
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
      .where(eq(participantsTable.sessionId, session.id))
      .for("update");

    const othersClaimedMap = new Map<number, number>();
    for (const sel of otherSelections) {
      if (sel.participantId === participant.id) continue;
      const prev = othersClaimedMap.get(sel.itemId) ?? 0;
      othersClaimedMap.set(sel.itemId, prev + sel.quantity);
    }

    for (const sel of normalizedSelections) {
      if (sel.quantity < 0) {
        validationError = "Quantity cannot be negative";
        return;
      }
      const item = itemMap.get(sel.itemId);
      if (!item) {
        validationError = `Item ${sel.itemId} not found in this session`;
        return;
      }
      const othersHave = othersClaimedMap.get(sel.itemId) ?? 0;
      const maxAllowed = item.quantity - othersHave;
      if (sel.quantity > maxAllowed) {
        validationError = `Only ${maxAllowed} of "${item.name}" available (others have claimed ${othersHave})`;
        return;
      }
    }

    if (validationError) return;

    await tx
      .delete(selectionsTable)
      .where(eq(selectionsTable.participantId, participant.id));

    const nonZeroSelections = normalizedSelections.filter((s) => s.quantity > 0);
    if (nonZeroSelections.length > 0) {
      await tx.insert(selectionsTable).values(
        nonZeroSelections.map((s) => ({
          participantId: participant.id,
          itemId: s.itemId,
          quantity: s.quantity,
        })),
      );
    }

    updatedSelections = await tx
      .select({ itemId: selectionsTable.itemId, quantity: selectionsTable.quantity })
      .from(selectionsTable)
      .where(eq(selectionsTable.participantId, participant.id));
  });

  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const itemsRemaining = await getItemsRemaining(session.id);

  emitToSession(session.code, "selection:updated", {
    participantId: participant.id,
    participantName: participant.name,
    selections: updatedSelections,
    itemsRemaining,
  });

  res.json({ selections: updatedSelections, itemsRemaining });
});

router.post("/sessions/:code/unsubmit", async (req, res): Promise<void> => {
  const params = SubmitParticipantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitParticipantBody.safeParse(req.body);
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

  if (session.status !== "open") {
    res.status(400).json({ error: "Session is not open" });
    return;
  }

  const [participant] = await db
    .select()
    .from(participantsTable)
    .where(
      and(
        eq(participantsTable.id, body.data.participantId),
        eq(participantsTable.sessionId, session.id),
      ),
    );

  if (!participant) {
    res.status(404).json({ error: "Participant not found" });
    return;
  }

  if (participant.participantToken !== body.data.participantToken) {
    res.status(403).json({ error: "Invalid participant token" });
    return;
  }

  if (!participant.submitted) {
    res.status(400).json({ error: "Not yet submitted" });
    return;
  }

  await db
    .update(participantsTable)
    .set({ submitted: false })
    .where(eq(participantsTable.id, participant.id));

  const withSelections = await getParticipantWithSelections(participant.id);
  const itemsRemaining = await getItemsRemaining(session.id);

  emitToSession(session.code, "participant:submitted", {
    id: participant.id,
    name: participant.name,
    submitted: false,
  });

  emitToSession(session.code, "selection:updated", {
    participantId: participant.id,
    participantName: participant.name,
    selections: withSelections.selections,
    itemsRemaining,
  });

  res.json(withSelections);
});

router.post("/sessions/:code/submit", async (req, res): Promise<void> => {
  const params = SubmitParticipantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitParticipantBody.safeParse(req.body);
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

  if (session.status !== "open") {
    res.status(400).json({ error: "Session is not open" });
    return;
  }

  const [participant] = await db
    .select()
    .from(participantsTable)
    .where(
      and(
        eq(participantsTable.id, body.data.participantId),
        eq(participantsTable.sessionId, session.id),
      ),
    );

  if (!participant) {
    res.status(404).json({ error: "Participant not found" });
    return;
  }

  if (participant.participantToken !== body.data.participantToken) {
    res.status(403).json({ error: "Invalid participant token" });
    return;
  }

  if (participant.submitted) {
    res.status(400).json({ error: "Already submitted" });
    return;
  }

  await db
    .update(participantsTable)
    .set({ submitted: true })
    .where(eq(participantsTable.id, participant.id));

  const withSelections = await getParticipantWithSelections(participant.id);
  const itemsRemaining = await getItemsRemaining(session.id);

  emitToSession(session.code, "participant:submitted", {
    id: participant.id,
    name: participant.name,
    submitted: true,
  });

  emitToSession(session.code, "selection:updated", {
    participantId: participant.id,
    participantName: participant.name,
    selections: withSelections.selections,
    itemsRemaining,
  });

  res.json(withSelections);
});

export default router;
