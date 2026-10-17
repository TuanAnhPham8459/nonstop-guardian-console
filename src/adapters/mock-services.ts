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
      return { text: "[placeholder] I'd check per-CPU status first.", proposedCommand: "SCF STATUS CPU *" };
    if (q.includes("restart") || q.includes("fix"))
      return { text: "[placeholder] Restarting $PAYAUTH may rebalance load. HIGH RISK — review before approving.", proposedCommand: "SCF RESTART PROCESS $PAYAUTH" };
    if (q.includes("disk"))
      return { text: "[placeholder] Checking disk volumes.", proposedCommand: "SCF STATUS DISK $*" };
    if (q.includes("tmf") || q.includes("audit"))
      return { text: "[placeholder] Checking TMF state.", proposedCommand: "TMFCOM STATUS TMF" };
    return { text: "[placeholder] No AI logic yet. Try asking about CPUs, disks, TMF, or a restart.", proposedCommand: "SCF STATUS CPU *" };
  },
};

const log: AuditEvent[] = [];
export const mockAudit: AuditAdapter = {
  log(e) {
    log.push({ ...e, at: new Date().toISOString().slice(11, 19) });
  },
  entries: () => [...log],
};
