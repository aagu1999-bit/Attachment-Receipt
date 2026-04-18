import { pgTable, serial, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const selectionsTable = pgTable("selections", {
  id: serial("id").primaryKey(),
  participantId: integer("participant_id").notNull(),
  itemId: integer("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
}, (t) => [
  unique("selections_participant_item_unique").on(t.participantId, t.itemId),
]);

export const insertSelectionSchema = createInsertSchema(selectionsTable).omit({
  id: true,
});
export type InsertSelection = z.infer<typeof insertSelectionSchema>;
export type Selection = typeof selectionsTable.$inferSelect;
