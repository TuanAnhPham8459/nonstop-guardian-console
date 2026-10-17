import { z } from "zod";
import { callModel, ModelCallError } from "./model.server";
import { validateCommand } from "@/mock-env/validate.server";
import { ALLOWLIST } from "@/mock-env/allowlist.server";
import type { KnowledgeNote } from "@/knowledge/notes.server";

export const ModelOutputSchema = z.object({
  explanation: z.string(),
  proposed_commands: z.array(
    z.object({
      command: z.string(),
      reason: z.string(),
      sources: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    }),
  ),
  uncertainty: z.string(),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export interface CheckedCommand {
  command: string;
  reason: string;
  sources: string[];
  unknown_sources: string[];
  confidence: number;
  risk: "read-only" | "low-risk" | "high-risk";
  description: string;
  blast_radius: string | null;
  simulated: boolean;
}
export interface AssistantResult {
  ok: true;
  explanation: string;
  proposed_commands: CheckedCommand[];
  blocked: { command: string; reason: string }[];
  uncertainty: string;
}
export interface AssistantError {
  ok: false;
  error: string;
}

export function buildSystemPrompt() {
  const cmds = ALLOWLIST.map((c) => `- ${c.pattern} — ${c.description}${c.group === "simulated" ? " (simulated syntax)" : ""}`).join("\n");
  return `You are an operations assistant for a SIMULATED HPE NonStop banking system.
Rules:
1. You only PROPOSE commands. You NEVER execute anything; a human operator approves and runs commands.
2. Cite knowledge note IDs (e.g. "KN-001") in "sources" for every proposed command. Only cite IDs given to you.
3. State clearly what you are unsure of in "uncertainty".
4. NEVER invent commands. Propose only commands from this allowlist, copied exactly:
${cmds}
5. Do not state risk levels; risk is assigned by the system.
6. To diagnose slow SQL/MX work, propose SET STATISTICS ON then GET STATISTICS. Interpret the GET STATISTICS columns:
   - High "Lock Wait" and high "Lock Escl" (lock escalations) with normal "Disk I/Os" means a LOCK/CONTENTION problem (transactions blocking each other).
   - High "Disk I/Os" and high "Disk Process Busy Time" with low "Lock Wait" means a DISK/IO problem (slow or degraded volumes).
   Say explicitly which of the two the numbers indicate, and name the tables driving it.
Respond ONLY with a JSON object of this exact shape:
{"explanation": string, "proposed_commands": [{"command": string, "reason": string, "sources": [string], "confidence": number between 0 and 1}], "uncertainty": string}`;
}

export function buildUserPrompt(question: string, state: unknown, notes: KnowledgeNote[]) {
  return `Operator question: ${question}

Current system state (JSON):
${JSON.stringify(state).slice(0, 6000)}

Knowledge notes:
${notes.length ? notes.map((n) => `[${n.id}] (${n.source_type}, ${n.contributed_by}) ${n.title}: ${n.body}`).join("\n") : "(no relevant notes found)"}`;
}

function parse(raw: string): ModelOutput | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    const r = ModelOutputSchema.safeParse(JSON.parse(cleaned));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// Enforce allowlist, source existence and risk tier in code.
export function enforce(out: ModelOutput, knownIds: Set<string>): AssistantResult {
  const proposed: CheckedCommand[] = [];
  const blocked: { command: string; reason: string }[] = [];
  for (const p of out.proposed_commands) {
    const v = validateCommand(p.command);
    if (!v.ok) {
      blocked.push({ command: p.command, reason: v.reason });
      continue;
    }
    proposed.push({
      command: v.entry.pattern,
      reason: p.reason,
      sources: p.sources.filter((s) => knownIds.has(s)),
      unknown_sources: p.sources.filter((s) => !knownIds.has(s)),
      confidence: p.confidence,
      risk: v.entry.risk,
      description: v.entry.description,
      blast_radius: v.entry.blastRadius ?? null,
      simulated: v.entry.group === "simulated",
    });
  }
  return { ok: true, explanation: out.explanation, proposed_commands: proposed, blocked, uncertainty: out.uncertainty };
}

export async function runAssistant(
  question: string,
  state: unknown,
  notes: KnowledgeNote[],
  knownIds: Set<string>,
  model: typeof callModel = callModel,
): Promise<AssistantResult | AssistantError> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(question, state, notes);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = parse(await model(system, user));
      if (parsed) return enforce(parsed, knownIds);
    }
    return { ok: false, error: "The assistant returned an invalid response twice. No commands were proposed." };
  } catch (e) {
    if (e instanceof ModelCallError) {
      if (e.status === 402) return { ok: false, error: "AI credits are exhausted. Add credits in Settings → Plans & credits." };
      if (e.status === 429) return { ok: false, error: "The AI service is busy. Please try again in a moment." };
      return { ok: false, error: e.message };
    }
    console.error("assistant error", e);
    return { ok: false, error: "The assistant is unavailable right now." };
  }
}
