import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  merchantName: text("merchant_name"),
  tax: text("tax").notNull().default("0"),
  tip: text("tip").notNull().default("0"),
  otherFees: text("other_fees").notNull().default("0"),
  payerName: text("payer_name").notNull(),
  payerVenmo: text("payer_venmo"),
  payerCashapp: text("payer_cashapp"),
  payerZelle: text("payer_zelle"),
  payerApplePay: text("payer_apple_pay"),
  hostName: text("host_name").notNull(),
  hostToken: text("host_token").notNull(),
  headcount: integer("headcount").notNull().default(2),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
