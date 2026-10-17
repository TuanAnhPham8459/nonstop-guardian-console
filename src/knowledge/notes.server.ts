// SERVER-ONLY knowledge store (simulated runbook notes). Source IDs are authoritative here.
export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export const KNOWLEDGE: readonly KnowledgeNote[] = [
  {
    id: "KB-101",
    title: "CPU down on a NonStop node",
    body: "When a CPU halts, process pairs fail over to backups in surviving CPUs. Check per-CPU state and load with SCF STATUS CPU *. Expect load to rise on CPUs hosting the backups.",
    tags: ["cpu", "down", "failover", "load"],
  },
  {
    id: "KB-102",
    title: "Payment authorization latency",
    body: "Rising payment latency after a CPU failure usually means the $PAYAUTH process pair is concentrated on overloaded CPUs. Restarting $PAYAUTH can rebalance it, but in-flight authorizations may fail during takeover.",
    tags: ["payment", "latency", "payauth", "restart", "slow"],
  },
  {
    id: "KB-103",
    title: "TMF health check",
    body: "Use TMFCOM STATUS TMF to confirm TMF is STARTED and audit trail capacity is below 80%. TMF problems can also cause transaction latency.",
    tags: ["tmf", "audit", "transaction"],
  },
  {
    id: "KB-104",
    title: "Disk volume checks",
    body: "SCF STATUS DISK $* lists volumes. A volume running on MIRROR ONLY has lost one path and is a resilience risk, though usually not a latency cause.",
    tags: ["disk", "volume", "mirror"],
  },
  {
    id: "KB-105",
    title: "Measure performance collection",
    body: "MEASCOM ADD CPU * starts a low-impact Measure collection to gather CPU-level performance evidence before taking riskier actions.",
    tags: ["measure", "performance", "cpu", "evidence"],
  },
];

export const knowledgeIds = () => new Set(KNOWLEDGE.map((n) => n.id));

export function searchKnowledge(query: string, limit = 4): KnowledgeNote[] {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = KNOWLEDGE.map((n) => {
    const hay = `${n.title} ${n.body} ${n.tags.join(" ")}`.toLowerCase();
    return { n, score: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
  });
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.n);
  return (hits.length ? hits : KNOWLEDGE.slice(0, 2)).slice(0, limit);
}
