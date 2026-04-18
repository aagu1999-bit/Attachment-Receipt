import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
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
} from "@workspace/api-zod";
import { emitToSession } from "../lib/socketServer";

const router: IRouter = Router();

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

  if (participant.submitted) {
    res.status(400).json({ error: "Already submitted — cannot change selections" });
    return;
  }

  const items = await db
    .select()
    .from(receiptItemsTable)
    .where(eq(receiptItemsTable.sessionId, session.id));

  const itemMap = new Map(items.map((i) => [i.id, i]));

  const otherSelections = await db
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
    .where(eq(participantsTable.sessionId, session.id));

  const othersClaimedMap = new Map<number, number>();
  for (const sel of otherSelections) {
    if (sel.participantId === participant.id) continue;
    const prev = othersClaimedMap.get(sel.itemId) ?? 0;
    othersClaimedMap.set(sel.itemId, prev + sel.quantity);
  }

  for (const sel of body.data.selections) {
    const item = itemMap.get(sel.itemId);
    if (!item) {
      res.status(400).json({ error: `Item ${sel.itemId} not found in this session` });
      return;
    }
    const othersHave = othersClaimedMap.get(sel.itemId) ?? 0;
    const maxAllowed = item.quantity - othersHave;
    if (sel.quantity > maxAllowed) {
      res.status(400).json({
        error: `Only ${maxAllowed} of "${item.name}" available (others have claimed ${othersHave})`,
      });
      return;
    }
    if (sel.quantity < 0) {
      res.status(400).json({ error: "Quantity cannot be negative" });
      return;
    }
  }

  await db
    .delete(selectionsTable)
    .where(eq(selectionsTable.participantId, participant.id));

  const nonZeroSelections = body.data.selections.filter((s) => s.quantity > 0);

  if (nonZeroSelections.length > 0) {
    await db.insert(selectionsTable).values(
      nonZeroSelections.map((s) => ({
        participantId: participant.id,
        itemId: s.itemId,
        quantity: s.quantity,
      })),
    );
  }

  const updatedSelections = await db
    .select({ itemId: selectionsTable.itemId, quantity: selectionsTable.quantity })
    .from(selectionsTable)
    .where(eq(selectionsTable.participantId, participant.id));

  const itemsRemaining = await getItemsRemaining(session.id);

  emitToSession(session.code, "selection:updated", {
    participantId: participant.id,
    participantName: participant.name,
    selections: updatedSelections,
    itemsRemaining,
  });

  res.json({ selections: updatedSelections, itemsRemaining });
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

  if (participant.submitted) {
    res.status(400).json({ error: "Already submitted" });
    return;
  }

  await db
    .update(participantsTable)
    .set({ submitted: true })
    .where(eq(participantsTable.id, participant.id));

  const withSelections = await getParticipantWithSelections(participant.id);

  emitToSession(session.code, "participant:submitted", {
    id: participant.id,
    name: participant.name,
  });

  res.json(withSelections);
});

export default router;
