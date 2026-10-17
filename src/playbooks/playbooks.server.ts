import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { SystemState } from "@/adapters/types";
import { validateCommand, normalize } from "@/mock-env/validate.server";

// SERVER-ONLY access to the playbooks table.
// Rules enforced here, not in the model: only approved playbooks influence the
// assistant; a playbook cannot be approved by its own author; never_do options
// are ranked last with a warning; steps conflicting with safety rules are skipped.

export type PlaybookRow = Database["public"]["Tables"]["playbooks"]["Row"];

export interface TriggerCondition {
  metric: string; // cpus_down | unprotected_processes | avg_response_ms | queue_depth | redundancy | tps
  operator: ">" | ">=" | "<" | "<=" | "=" | "!=";
  value: number | string;
}
export interface PlaybookStep {
  option_id: string;
  action: string; // command text from the catalog
  why: string;
  check_after?: string | undefined;
}
export interface Playbook {
  id: string;
  title: string;
  author: string;
  status: "draft" | "approved";
  version: number;
  trigger: TriggerCondition[];
  steps: PlaybookStep[];
  stop_conditions: string;
  escalate_if: string;
  never_do: string[]; // option ids
  approved_by: string | null;
  created_at: string;
}

function db() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

const toPlaybook = (r: PlaybookRow): Playbook => ({
  id: r.id,
  title: r.title,
  author: r.author,
  status: r.status as Playbook["status"],
  version: r.version,
  trigger: (r.trigger ?? []) as unknown as TriggerCondition[],
  steps: (r.steps ?? []) as unknown as PlaybookStep[],
  stop_conditions: r.stop_conditions,
  escalate_if: r.escalate_if,
  never_do: (r.never_do ?? []) as unknown as string[],
  approved_by: r.approved_by,
  created_at: r.created_at,
});

export async function listPlaybooks(): Promise<Playbook[]> {
  const { data, error } = await db().from("playbooks").select("*").order("created_at");
  if (error) {
    console.error("playbooks read failed", error);
    return [];
  }
  return data.map(toPlaybook);
}

export async function savePlaybook(p: {
  id?: string | undefined;
  title: string;
  author: string;
  trigger: TriggerCondition[];
  steps: PlaybookStep[];
  stop_conditions: string;
  escalate_if: string;
  never_do: string[];
}): Promise<{ id: string } | { error: string }> {
  if (!p.title.trim() || !p.author.trim()) return { error: "Title and author are required." };
  if (p.steps.length === 0) return { error: "Add at least one step." };
  for (const s of p.steps) {
    const v = validateCommand(s.action);
    if (!v.ok) return { error: `Step "${s.action}" is not in the command catalog: ${v.reason}` };
  }
  if (p.id) {
    // Editing an approved playbook sends it back to draft and bumps the version.
    const { data: cur } = await db().from("playbooks").select("version").eq("id", p.id).maybeSingle();
    const { error } = await db()
      .from("playbooks")
      .update({
        title: p.title, author: p.author,
        trigger: p.trigger as never, steps: p.steps as never, never_do: p.never_do as never,
        stop_conditions: p.stop_conditions, escalate_if: p.escalate_if,
        status: "draft", approved_by: null, version: (cur?.version ?? 1) + 1,
      })
      .eq("id", p.id);
    if (error) return { error: "Could not save the playbook." };
    return { id: p.id };
  }
  const id = `PB-${Date.now().toString(36).toUpperCase()}`;
  const { error } = await db().from("playbooks").insert({
    id, title: p.title, author: p.author, status: "draft", version: 1,
    trigger: p.trigger as never, steps: p.steps as never, never_do: p.never_do as never,
    stop_conditions: p.stop_conditions, escalate_if: p.escalate_if,
  });
  if (error) return { error: "Could not save the playbook." };
  return { id };
}

export async function approvePlaybook(id: string, approver: string): Promise<{ ok: true } | { error: string }> {
  const name = approver.trim();
  if (!name) return { error: "Approver name is required." };
  const { data } = await db().from("playbooks").select("*").eq("id", id).maybeSingle();
  if (!data) return { error: "Playbook not found." };
  if (data.status === "approved") return { error: "Already approved." };
  if (name.toLowerCase() === data.author.trim().toLowerCase())
    return { error: "A playbook cannot be approved by its own author. A different approver is required." };
  const { error } = await db().from("playbooks").update({ status: "approved", approved_by: name }).eq("id", id);
  if (error) return { error: "Could not approve the playbook." };
  return { ok: true };
}

// --- Trigger evaluation (ALL conditions must match) ---

export function stateMetrics(state: SystemState): Record<string, number | string> {
  return {
    cpus_down: state.cpus.filter((c) => c.status === "down").length,
    unprotected_processes: state.unprotected,
    avg_response_ms: state.responseMs,
    queue_depth: state.queueDepth,
    redundancy: state.redundancy,
    tps: state.tps,
  };
}

function condMatches(c: TriggerCondition, m: Record<string, number | string>): boolean {
  const v = m[c.metric];
  if (v === undefined) return false;
  if (typeof v === "number" && typeof c.value === "number") {
    switch (c.operator) {
      case ">": return v > c.value;
      case ">=": return v >= c.value;
      case "<": return v < c.value;
      case "<=": return v <= c.value;
      case "=": return v === c.value;
      case "!=": return v !== c.value;
      default: return false;
    }
  }
  const eq = String(v).toLowerCase() === String(c.value).toLowerCase();
  return c.operator === "=" ? eq : c.operator === "!=" ? !eq : false;
}

export function triggerMatches(p: Playbook, m: Record<string, number | string>): boolean {
  return p.trigger.length > 0 && p.trigger.every((c) => condMatches(c, m));
}

// Only approved playbooks, only those whose trigger fully matches.
export async function matchingPlaybooks(state: SystemState): Promise<Playbook[]> {
  const m = stateMetrics(state);
  return (await listPlaybooks()).filter((p) => p.status === "approved" && triggerMatches(p, m));
}

// --- Recommendation influence (pure, tested) ---

export interface PlaybookProvenance {
  playbook_id: string;
  title: string;
  version: number;
  step: number; // 1-based step number
  author: string;
  approver: string | null;
}
export interface PlaybookInfluence {
  matched: { id: string; title: string; version: number; author: string; approved_by: string | null }[];
  followed: string | null; // playbook id whose ordering was applied
  followed_reason: string | null;
  provenance: Record<string, PlaybookProvenance>; // keyed by normalized command
  never_do_warnings: Record<string, string>; // command -> warning text
  conflicts: string[]; // skipped steps, with reasons
}

interface OptionGate {
  id: string;
  action: string;
  requires?: string[] | undefined;
  requiresAny?: string[] | undefined;
}

// Reorder/annotate proposed commands per the first matching approved playbook.
// executedIds = scenario options already run (for requires/unlock conflict checks).
export function applyPlaybooks<T extends { command: string }>(
  proposed: T[],
  playbooks: Playbook[],
  catalog: OptionGate[],
  executedIds: Set<string>,
): { commands: T[]; influence: PlaybookInfluence | null } {
  if (playbooks.length === 0) return { commands: proposed, influence: null };

  const followed = playbooks[0]!;
  const influence: PlaybookInfluence = {
    matched: playbooks.map((p) => ({ id: p.id, title: p.title, version: p.version, author: p.author, approved_by: p.approved_by })),
    followed: followed.id,
    followed_reason:
      playbooks.length > 1
        ? `${playbooks.length} approved playbooks match the current state; following "${followed.title}" v${followed.version} because it was created first. The other matching playbook(s) are shown for comparison.`
        : `Following "${followed.title}" v${followed.version}.`,
    provenance: {},
    never_do_warnings: {},
    conflicts: [],
  };

  // Safety check every step of every matched playbook: skip steps that conflict
  // with catalog rules (unknown command, or requires/unlock not met).
  const validSteps = new Map<string, { step: PlaybookStep; num: number; pb: Playbook }>();
  for (const pb of playbooks) {
    const neverSet = new Set(pb.never_do);
    pb.steps.forEach((step, i) => {
      const opt = catalog.find((o) => o.id === step.option_id || normalize(o.action) === normalize(step.action));
      const why = (msg: string): void => { influence.conflicts.push(`Conflict: "${pb.title}" step ${i + 1} (${step.action}) skipped — ${msg}.`); };
      if (!opt) { why("the command is not in the command catalog"); return; }
      const v = validateCommand(opt.action);
      if (!v.ok) { why(v.reason); return; }
      for (const r of opt.requires ?? [])
        if (!executedIds.has(r)) { why(`its prerequisite ${r} has not been executed yet`); return; }
      if (opt.requiresAny && !opt.requiresAny.some((r) => executedIds.has(r))) {
        why(`none of its prerequisites (${opt.requiresAny.join(", ")}) has been executed yet`);
        return;
      }
      if (neverSet.has(opt.id)) { why("the same playbook lists it under never_do"); return; }
      if (pb.id === followed.id && !validSteps.has(normalize(opt.action)))
        validSteps.set(normalize(opt.action), { step, num: i + 1, pb });
    });
    // never_do: rank those commands last with a warning.
    for (const nd of pb.never_do) {
      const opt = catalog.find((o) => o.id === nd);
      if (opt) influence.never_do_warnings[normalize(opt.action)] = `Listed in never_do of playbook "${pb.title}" v${pb.version} — ranked last.`;
    }
  }

  const rank = (c: T) => {
    const n = normalize(c.command);
    if (influence.never_do_warnings[n]) return 1000;
    const s = validSteps.get(n);
    return s ? s.num : 500;
  };
  const commands = [...proposed].sort((a, b) => rank(a) - rank(b));
  for (const c of commands) {
    const s = validSteps.get(normalize(c.command));
    if (s)
      influence.provenance[normalize(c.command)] = {
        playbook_id: s.pb.id, title: s.pb.title, version: s.pb.version,
        step: s.num, author: s.pb.author, approver: s.pb.approved_by,
      };
  }
  return { commands, influence };
}
