import type { CheckedCommand, ModelAdapter, ModelRequest, ModelResponse, PolicyAdapter } from "./types";

// Rehearsal mode: a ModelAdapter that replays cached assistant responses instead of calling the AI.
// Live responses are recorded in the browser; built-in scripts cover anything never recorded.
// Risk tiers are always re-read from the server allowlist (via PolicyAdapter), never stored as truth.

type Seed = { explanation: string; commands: { command: string; reason: string; sources: string[]; confidence: number }[]; uncertainty: string };
const KEY = "ops-rehearsal-cache-v1";
const MODE_KEY = "ops-rehearsal-mode";

const SEEDS: Record<string, { proactive: Seed; ask: Seed }> = {
  "payment-slowdown": {
    proactive: {
      explanation: "CPU 3 is down and CPUs 4-7 are running near 90% busy. Payment response time is climbing. Confirm CPU state and TMF health before considering any restart.",
      commands: [
        { command: "SCF STATUS CPU *", reason: "Confirm which CPUs are up and how load is spread", sources: ["KN-001"], confidence: 0.9 },
        { command: "TMFCOM STATUS TMF", reason: "Check the transaction manager before restarting anything", sources: ["KN-005", "KN-002"], confidence: 0.85 },
      ],
      uncertainty: "I can't yet tell whether $PAYAUTH is stuck on the overloaded CPUs or just slowed by load.",
    },
    ask: {
      explanation: "Latency is most likely caused by the CPU 3 failure: its work moved to CPUs 4-7, which are now saturated. A similar past incident was resolved by restarting the payment process pair to rebalance work, after confirming TMF was healthy.",
      commands: [
        { command: "TMFCOM STATUS TMF", reason: "Rule out a TMF problem first", sources: ["KN-005"], confidence: 0.85 },
        { command: "SCF RESTART PROCESS $PAYAUTH", reason: "Rebalance payment work off the saturated CPUs", sources: ["KN-003", "KN-006"], confidence: 0.6 },
      ],
      uncertainty: "Restarting is disruptive; I'm unsure whether the backup process is healthy.",
    },
  },
  "disk-degradation": {
    proactive: {
      explanation: "$DATA02 is running on its mirror only and its queue is growing. Card ledger writes are slowing. Check disk paths and TMF first.",
      commands: [
        { command: "SCF STATUS DISK $*", reason: "See which volumes lost a path", sources: ["KN-004"], confidence: 0.9 },
        { command: "TMFCOM STATUS TMF", reason: "Make sure the audit trail volume is not affected", sources: ["KN-002"], confidence: 0.8 },
      ],
      uncertainty: "I don't know yet whether the primary path failed in hardware or was taken down.",
    },
    ask: {
      explanation: "The slowdown follows the loss of $DATA02's primary path: all I/O now goes to one mirror, so requests queue up. Restoring the path is a hardware task; meanwhile, keep monitoring queue length.",
      commands: [
        { command: "SCF STATUS DISK $*", reason: "Watch $DATA02 path state and queue", sources: ["KN-004"], confidence: 0.85 },
        { command: "MEASCOM ADD CPU *", reason: "Collect evidence before any high-risk action", sources: ["KN-006"], confidence: 0.6 },
      ],
      uncertainty: "If the mirror also fails, the volume goes down; I can't see hardware health from here.",
    },
  },
  "txn-backlog": {
    proactive: {
      explanation: "The TMF audit trail is 91% full and active transactions are about 8x normal. Payments are slowing sharply. Check TMF and CPUs first.",
      commands: [
        { command: "TMFCOM STATUS TMF", reason: "Confirm audit trail usage and the oldest open transaction", sources: ["KN-002"], confidence: 0.9 },
        { command: "SCF STATUS CPU *", reason: "Check whether CPU load is the cause or a symptom", sources: ["KN-001"], confidence: 0.75 },
      ],
      uncertainty: "I can't tell which application opened the long-running transactions until TMF status is checked.",
    },
    ask: {
      explanation: "Long-running transactions are holding the audit trail open, so new transactions queue behind them. If TMF shows they belong to $PAYAUTH, restarting it backs them out and lets the backlog drain.",
      commands: [
        { command: "TMFCOM STATUS TMF", reason: "Identify the oldest transaction owner", sources: ["KN-002", "KN-005"], confidence: 0.85 },
        { command: "SCF RESTART PROCESS $PAYAUTH", reason: "Back out stuck transactions if $PAYAUTH owns them", sources: ["KN-006"], confidence: 0.55 },
      ],
      uncertainty: "If the audit trail overflows before action, TMF may block new transactions entirely.",
    },
  },
};

const interpretSeed = (cmd: string, output: string): Seed => ({
  explanation: `Rehearsal replay — reading the output of ${cmd}:\n${output.split("\n").slice(0, 6).join("\n")}\n\nCompare these values with the alerts on the left. If response time has dropped, keep monitoring; otherwise continue with the next check.`,
  commands: [],
  uncertainty: "This is a scripted interpretation, not a live AI analysis.",
});

type Cache = Record<string, { q: string; res: Extract<ModelResponse, { ok: true }> }[]>;
const read = (): Cache => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? []);

function bucket(req: ModelRequest) {
  const sc = (req.state as { state?: { scenario?: { id?: string } } })?.state?.scenario?.id ?? "payment-slowdown";
  const kind = req.kind ?? "ask";
  return { sc, key: `${sc}|${kind}${kind === "interpret" ? `|${req.command ?? ""}` : ""}` };
}

export const rehearsal = {
  get enabled() { try { return localStorage.getItem(MODE_KEY) === "1"; } catch { return false; } },
  set(on: boolean) { localStorage.setItem(MODE_KEY, on ? "1" : "0"); },
  cachedCount() { return Object.values(read()).reduce((n, l) => n + l.length, 0); },
};

export function createRehearsalModel(live: ModelAdapter, policy: PolicyAdapter): ModelAdapter {
  async function replay(req: ModelRequest): Promise<ModelResponse> {
    const { sc, key } = bucket(req);
    const list = read()[key] ?? [];
    let hit = list[list.length - 1];
    if (req.kind === "ask" && list.length) {
      const q = words(req.question);
      hit = [...list].sort((a, b) => [...words(b.q)].filter((w) => q.has(w)).length - [...words(a.q)].filter((w) => q.has(w)).length)[0];
    }
    let seed: Seed | null = null;
    if (!hit) {
      const s = SEEDS[sc] ?? SEEDS["payment-slowdown"]!;
      seed = req.kind === "proactive" ? s.proactive : req.kind === "interpret" ? interpretSeed(req.command ?? "", req.question.split("\n").slice(1).join("\n")) : s.ask;
    }
    const base = hit?.res ?? { explanation: seed!.explanation, uncertainty: seed!.uncertainty, proposed_commands: [], blocked: [] };
    const raw = hit ? hit.res.proposed_commands : seed!.commands.map((c) => ({ ...c, unknown_sources: [] }));
    const proposed: CheckedCommand[] = [];
    const blocked: { command: string; reason: string }[] = [...base.blocked];
    for (const c of raw) {
      const cls = await policy.classify(c.command).catch(() => null);
      if (!cls) continue;
      if (!cls.allowed) { blocked.push({ command: c.command, reason: cls.reason }); continue; }
      proposed.push({ ...(c as CheckedCommand), risk: cls.risk, description: cls.description, blast_radius: cls.blastRadius });
    }
    return {
      ok: true,
      explanation: `[Rehearsal · ${hit ? "cached reply" : "scripted reply"}]\n${base.explanation}`,
      proposed_commands: proposed,
      blocked,
      uncertainty: base.uncertainty,
    };
  }

  return {
    async complete(req) {
      if (rehearsal.enabled) return replay(req);
      const res = await live.complete(req);
      if (res.ok) {
        const { key } = bucket(req);
        const c = read();
        c[key] = [...(c[key] ?? []), { q: req.question, res }].slice(-10);
        try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full */ }
      }
      return res;
    },
  };
}
