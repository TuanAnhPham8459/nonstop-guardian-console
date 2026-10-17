import type { AuditAdapter, AuditEvent, KnowledgeAdapter, ModelAdapter } from "./types";

// Placeholder adapters — no AI logic yet. Swap with real implementations later.

export const mockKnowledge: KnowledgeAdapter = {
  async search(query) {
    const q = query.toLowerCase();
    const hits = [
      { title: "Runbook: CPU down on NonStop node", snippet: "Verify process pair takeover, check EMS for halt code." },
      { title: "Runbook: Pathway queue backlog", snippet: "Inspect serverclass status; consider adding servers." },
    ];
    return hits.filter((h) => q.split(" ").some((w) => w.length > 3 && h.title.toLowerCase().includes(w)));
  },
};

export const mockModel: ModelAdapter = {
  async complete({ question }) {
    await new Promise((r) => setTimeout(r, 500));
    const q = question.toLowerCase();
    if (q.startsWith("interpret:"))
      return { text: "[placeholder] Output received. Interpretation will appear here once the model adapter is connected." };
    if (q.includes("cpu"))
      return { text: "[placeholder] I'd check per-CPU status first.", proposedCommand: "status cpu" };
    if (q.includes("queue") || q.includes("pathway") || q.includes("latency"))
      return { text: "[placeholder] Let's look at the AUTH-SVR serverclass.", proposedCommand: "pathcom $pm; status serverclass auth-svr" };
    if (q.includes("tmf") || q.includes("audit"))
      return { text: "[placeholder] Checking TMF state.", proposedCommand: "tmfcom status tmf" };
    return { text: "[placeholder] No AI logic yet. Try asking about CPUs, queues or TMF.", proposedCommand: "status" };
  },
};

const log: AuditEvent[] = [];
export const mockAudit: AuditAdapter = {
  log(e) {
    log.push({ ...e, at: new Date().toISOString().slice(11, 19) });
  },
  entries: () => [...log],
};
