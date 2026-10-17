import { z } from "zod";
import { callModel, ModelCallError } from "./model.server";
import { validateCommand } from "@/mock-env/validate.server";
import { ALLOWLIST } from "@/mock-env/allowlist.server";
import type { KnowledgeNote } from "@/knowledge/notes.server";
import { applyPlaybooks, type Playbook } from "@/playbooks/playbooks.server";

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
  playbooks?: import("@/adapters/types").PlaybookInfluenceInfo;
}
export interface AssistantError {
  ok: false;
  error: string;
}

export function buildSystemPrompt() {
  const cmds = ALLOWLIST.map((c) => `- ${c.pattern} — ${c.description}${c.syntaxStatus === "illustrative" ? " (simulated syntax)" : ""}`).join("\n");
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

export function buildUserPrompt(question: string, state: unknown, notes: KnowledgeNote[], playbooks: Playbook[] = []) {
  return `Operator question: ${question}

Current system state (JSON):
${JSON.stringify(state).slice(0, 6000)}

Knowledge notes:
${notes.length ? notes.map((n) => `[${n.id}] (${n.source_type}, ${n.contributed_by}) ${n.title}: ${n.body}`).join("\n") : "(no relevant notes found)"}

Approved operations playbooks matching the current state (follow their step order when proposing):
${playbooks.length ? playbooks.map((p) => `[${p.id}] "${p.title}" v${p.version} by ${p.author}, approved by ${p.approved_by}. Steps in order:\n${p.steps.map((s, i) => `  ${i + 1}. ${s.action} — ${s.why}`).join("\n")}\n  Never do: ${p.never_do.join(", ") || "none"}`).join("\n") : "(none)"}`;
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

export interface PlaybookContext {
  playbooks: Playbook[]; // approved, trigger-matched only
  catalog: { id: string; action: string; requires?: string[]; requiresAny?: string[] }[];
  executedIds: Set<string>;
}

// Enforce allowlist, source existence and risk tier in code.
export function enforce(out: ModelOutput, knownIds: Set<string>, pb?: PlaybookContext): AssistantResult {
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
      simulated: v.entry.syntaxStatus === "illustrative",
    });
  }
  const base = { ok: true as const, explanation: out.explanation, blocked, uncertainty: out.uncertainty };
  if (!pb || pb.playbooks.length === 0) return { ...base, proposed_commands: proposed };

  // Playbook influence: reorder per the followed playbook, attach provenance,
  // rank never_do last with a warning. Risk tiers and requires rules are untouched.
  const { commands, influence } = applyPlaybooks(proposed, pb.playbooks, pb.catalog, pb.executedIds);
  const annotated = commands.map((c) => {
    const prov = influence?.provenance[Object.keys(influence.provenance).find((k) => k === c.command.toUpperCase()) ?? ""] ??
      influence?.provenance[c.command];
    const nd = influence?.never_do_warnings[c.command] ??
      influence?.never_do_warnings[Object.keys(influence.never_do_warnings).find((k) => k === c.command.toUpperCase()) ?? ""];
    return { ...c, ...(prov ? { playbook: prov } : {}), ...(nd ? { never_do: nd } : {}) };
  });
  return {
    ...base,
    proposed_commands: annotated,
    playbooks: influence
      ? { matched: influence.matched, followed: influence.followed, followed_reason: influence.followed_reason, conflicts: influence.conflicts }
      : undefined,
  };
}

export async function runAssistant(
  question: string,
  state: unknown,
  notes: KnowledgeNote[],
  knownIds: Set<string>,
  model: typeof callModel = callModel,
  pb?: PlaybookContext,
): Promise<AssistantResult | AssistantError> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(question, state, notes, pb?.playbooks ?? []);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const parsed = parse(await model(system, user));
      if (parsed) return enforce(parsed, knownIds, pb);
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
