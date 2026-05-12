export interface SplitInput {
  participants: Array<{
    id: number;
    name: string;
    isHost: boolean;
    paid: boolean;
    selections: Array<{
      itemId: number;
      quantity: number;
    }>;
  }>;
  items: Array<{
    id: number;
    name: string;
    unitPrice: string;
    quantity: number;
  }>;
  tax: string;
  tip: string;
  otherFees: string;
  hostName: string;
  payerName: string;
  headcount: number;
}

export interface ParticipantResult {
  participantId: number;
  name: string;
  itemsEaten: string[];
  foodSubtotal: number;
  feesShare: number;
  totalOwed: number;
  isHost: boolean;
  paid: boolean;
}

export interface SplitResult {
  participants: ParticipantResult[];
  settlements: string[];
  totalFees: number;
  totalBill: number;
}

export function computeSplit(input: SplitInput): SplitResult {
  const { participants, items, tax, tip, otherFees, payerName, headcount } = input;

  const taxAmt = parseFloat(tax) || 0;
  const tipAmt = parseFloat(tip) || 0;
  const otherFeesAmt = parseFloat(otherFees) || 0;
  const totalFees = taxAmt + tipAmt + otherFeesAmt;

  // Always divide fees by the declared headcount — consistent with the estimate shown to guests.
  // Headcount represents everyone at the table, even those who didn't use the app.
  const n = Math.max(headcount, 1);
  const feesPerPerson = totalFees / n;

  const itemMap = new Map<number, { name: string; unitPrice: number }>();
  for (const item of items) {
    itemMap.set(item.id, {
      name: item.name,
      unitPrice: parseFloat(item.unitPrice) || 0,
    });
  }

  let totalFoodCost = 0;
  const results: ParticipantResult[] = [];

  for (const participant of participants) {
    let foodSubtotal = 0;
    const itemsEaten: string[] = [];

    for (const selection of participant.selections) {
      const item = itemMap.get(selection.itemId);
      if (!item) continue;
      const lineCost = item.unitPrice * selection.quantity;
      foodSubtotal += lineCost;
      totalFoodCost += lineCost;
      const label =
        selection.quantity > 1
          ? `${item.name} x${selection.quantity}`
          : item.name;
      itemsEaten.push(label);
    }

    const totalOwed = parseFloat((foodSubtotal + feesPerPerson).toFixed(2));

    results.push({
      participantId: participant.id,
      name: participant.name,
      itemsEaten,
      foodSubtotal: parseFloat(foodSubtotal.toFixed(2)),
      feesShare: parseFloat(feesPerPerson.toFixed(2)),
      totalOwed,
      isHost: participant.isHost,
      paid: participant.paid,
    });
  }

  const totalBill = parseFloat((totalFoodCost + totalFees).toFixed(2));

  const settlements: string[] = [];
  for (const result of results) {
    settlements.push(
      `${result.name} owes ${payerName} $${result.totalOwed.toFixed(2)}`,
    );
  }

  if (settlements.length === 0) {
    settlements.push(`No participants — ${payerName} paid $${totalBill.toFixed(2)}`);
  }

  return {
    participants: results,
    settlements,
    totalFees: parseFloat(totalFees.toFixed(2)),
    totalBill,
  };
}
