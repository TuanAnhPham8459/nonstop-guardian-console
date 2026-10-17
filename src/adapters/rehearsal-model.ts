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
      explanation: "CPU 3 is down and CPUs 4-7 are running near 90% busy. Payment response time is climbing, and 3 processes are running without backup. Confirm process state and TMF health before changing anything.",
      commands: [
        { command: "STATUS PROCESS $ZZKRN.#*", reason: "Confirm which processes lost their backup after the CPU failure", sources: ["note-01", "note-04"], confidence: 0.9 },
        { command: "TMFCOM STATUS TMF", reason: "Check the transaction manager before touching payment processes", sources: ["note-03", "note-02"], confidence: 0.85 },
      ],
      uncertainty: "I can't yet tell whether $PAYAUTH is stuck on the overloaded CPUs or just slowed by load.",
    },
    ask: {
      explanation: "Latency is most likely caused by the CPU 3 failure: its work moved to CPUs 4-7, which are now saturated. Once hardware confirms the repair, restoring CPU 3 rebalances the load. Until then, protect the unprotected processes.",
      commands: [
        { command: "TMFCOM STATUS TMF", reason: "Rule out a TMF problem first", sources: ["note-03"], confidence: 0.85 },
        { command: "START BACKUP FOR $ZZKRN.#PAYAUTH1 ON CPU 6", reason: "Protect the most critical unprotected process first", sources: ["note-04"], confidence: 0.7 },
        { command: "RESTORE CPU 3", reason: "Rebalance load once the CPU is repaired", sources: ["note-01", "note-02"], confidence: 0.6 },
      ],
      uncertainty: "Restoring the CPU only helps if the hardware repair is done; I can't see hardware health from here.",
    },
  },
  "disk-degradation": {
    proactive: {
      explanation: "$DATA02 is running on its mirror only and its queue is growing. Card ledger writes are slowing. CPUs are all up, so look at disk and path first.",
      commands: [
        { command: "TMFCOM STATUS DATAVOLS", reason: "See which volumes lost a path", sources: ["note-05", "note-07"], confidence: 0.9 },
        { command: "TMFCOM STATUS TMF", reason: "Make sure the audit trail volume is not affected", sources: ["note-02"], confidence: 0.8 },
      ],
      uncertainty: "I don't know yet whether the primary path failed in hardware or was taken down.",
    },
    ask: {
      explanation: "The slowdown follows the loss of $DATA02's primary path: all I/O now goes to one mirror, so requests queue up. Switching to the alternate path restores speed; redundancy stays reduced until repair.",
      commands: [
        { command: "TMFCOM STATUS DATAVOLS", reason: "Watch $DATA02 path state and queue", sources: ["note-07"], confidence: 0.85 },
        { command: "SWITCH STORAGE PATH $DATA02", reason: "Restore speed via the alternate path; repair later", sources: ["note-08"], confidence: 0.7 },
        { command: "OPEN HARDWARE TICKET CPU 3", reason: "Real repair runs alongside mitigation", sources: ["note-15"], confidence: 0.6 },
      ],
      uncertainty: "If the mirror also fails, the volume goes down; I can't see hardware health from here.",
    },
  },
  "txn-backlog": {
    proactive: {
      explanation: "The TMF audit trail is 91% full and active transactions are about 8x normal, while CPUs look normal. Payments are slowing sharply. Find the blocker before adding capacity.",
      commands: [
        { command: "TMFCOM STATUS TRANSACTIONS", reason: "List the longest-running transactions and owners first", sources: ["note-11"], confidence: 0.9 },
        { command: "TMFCOM STATUS AUDITTRAIL", reason: "Confirm how close the audit trail is to full", sources: ["note-02"], confidence: 0.85 },
      ],
      uncertainty: "I can't tell which application opened the long-running transactions until TMF status is checked.",
    },
    ask: {
      explanation: "Long-running transactions are holding locks and the audit trail open, so new transactions queue behind them. Adding capacity will not fix a lock. If the oldest transaction is a stuck $PAYAUTH one, aborting it lets the backlog drain — but check with the application owner first.",
      commands: [
        { command: "TMFCOM STATUS TRANSACTIONS", reason: "Identify the oldest transaction and its owner", sources: ["note-11", "note-12"], confidence: 0.85 },
        { command: "ABORT TRANSACTION 4821", reason: "Back out the stuck transaction if the owner confirms it is not legitimate work", sources: ["note-13"], confidence: 0.55 },
      ],
      uncertainty: "If the audit trail overflows before action, TMF may block new transactions entirely. Restarting TMF would be a last resort.",
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
      proposed.push({ ...(c as CheckedCommand), risk: cls.risk, description: cls.description, blast_radius: cls.blastRadius, simulated: cls.simulated });
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
