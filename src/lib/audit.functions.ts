import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { appendAudit, listAudit } from "@/audit/audit.server";

const ev = z.object({
  session_id: z.string().min(1).max(100),
  actor: z.enum(["operator", "assistant", "system"]),
  event_type: z.enum(["question", "proposed", "blocked", "approved", "rejected", "output", "interpretation", "debrief", "error", "proactive"]),
  question: z.string().max(2000).optional(),
  command: z.string().max(200).optional(),
  risk: z.string().max(20).optional(),
  output: z.string().max(10000).optional(),
  interpretation: z.string().max(10000).optional(),
  detail: z.string().max(4000).optional(),
});

export const writeAudit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ev.parse(d))
  .handler(async ({ data }) => appendAudit(data));

export const readAudit = createServerFn({ method: "GET" }).handler(async () => listAudit());
