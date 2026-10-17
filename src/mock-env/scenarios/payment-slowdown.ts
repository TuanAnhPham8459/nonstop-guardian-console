// Scenario data. Edit values here to change each story. All data is fictional.
type Level = "crit" | "warn" | "info";

// One row of RMXCI GET STATISTICS output (fictional values).
export interface StatsRow {
  table: string;
  recordsAccessed: number;
  recordsUsed: number;
  diskIOs: number;
  messageCount: number;
  messageBytes: number;
  lockEscl: number;
  lockWait: number; // ms
  diskProcBusy: number; // ms
}
export interface StatsSnapshot {
  start: string;
  end: string;
  elapsed: string;
  rows: StatsRow[];
}

export interface Scenario {
  id: string;
  label: string;
  opener: string; // proactive first line from the assistant
  node: string;
  incident: { id: string; title: string; severity: "SEV1" | "SEV2" | "SEV3" };
  cpuFailure: { cpu: number; at: string } | null;
  degradedBusy: number[];
  recoveredBusy: number[];
  responseMs: { start: number; peak: number; recovered: number };
  rampTicks: number;
  tps: { degraded: number; recovered: number };
  alerts: { time: string; source: string; text: string; level: Level }[];
  recoveredAlert: string;
  restartOutput: string[];
  disks: { vol: string; state: string; path: string }[];
  disksRecovered?: { vol: string; state: string; path: string }[];
  tmf: { state: string; auditUsed: number; extra?: string[] };
  tmfRecovered?: { state: string; auditUsed: number; extra?: string[] };
  stats: StatsSnapshot;
  statsRecovered: StatsSnapshot;
}

const healthyDisks = [
  { vol: "$SYSTEM", state: "STARTED", path: "PRIMARY/MIRROR" },
  { vol: "$DATA01", state: "STARTED", path: "PRIMARY/MIRROR" },
  { vol: "$DATA02", state: "STARTED", path: "PRIMARY/MIRROR" },
  { vol: "$AUDIT", state: "STARTED", path: "PRIMARY/MIRROR" },
];

export const paymentSlowdown: Scenario = {
  id: "payment-slowdown",
  label: "CPU failure",
  opener: "CPU 3 went down and load is shifting. Here is what I would check first.",
  node: "\\BANKPRD1",
  incident: { id: "INC-20417", title: "Payment authorization latency high", severity: "SEV2" },
  cpuFailure: { cpu: 3, at: "14:02:00" },
  degradedBusy: [36, 33, 39, 0, 88, 91, 86, 89],
  recoveredBusy: [40, 38, 42, 0, 55, 58, 53, 56],
  responseMs: { start: 120, peak: 900, recovered: 180 },
  rampTicks: 8,
  tps: { degraded: 1420, recovered: 1880 },
  alerts: [
    { time: "14:02:00", source: "EMS", text: "CPU 3 down — process pairs taking over", level: "crit" },
    { time: "14:02:04", source: "Measure", text: "Load shifted to CPUs 4-7", level: "warn" },
    { time: "14:05:30", source: "APM", text: "Payment authorization latency high", level: "crit" },
  ],
  recoveredAlert: "Latency recovering after $PAYAUTH restart",
  restartOutput: ["$PAYAUTH: STOP requested", "$PAYAUTH: backup takeover complete", "$PAYAUTH: restarted on CPU 5, work rebalanced"],
  disks: [...healthyDisks.slice(0, 2), { vol: "$DATA02", state: "STARTED", path: "MIRROR ONLY" }, healthyDisks[3]!],
  tmf: { state: "STARTED", auditUsed: 64 },
};

export const diskDegradation: Scenario = {
  id: "disk-degradation",
  label: "Disk degradation",
  opener: "Disk $DATA02 lost its primary path and I/O is slowing down. Here is what I would check first.",
  node: "\\BANKPRD1",
  incident: { id: "INC-20422", title: "Card ledger I/O latency high", severity: "SEV2" },
  cpuFailure: null,
  degradedBusy: [41, 38, 44, 40, 47, 43, 39, 45],
  recoveredBusy: [36, 34, 38, 35, 37, 36, 33, 38],
  responseMs: { start: 120, peak: 650, recovered: 210 },
  rampTicks: 8,
  tps: { degraded: 1610, recovered: 1840 },
  alerts: [
    { time: "09:41:12", source: "EMS", text: "$DATA02 primary path down — running on mirror only", level: "crit" },
    { time: "09:41:40", source: "Measure", text: "$DATA02 disk queue length 14 (normal < 2)", level: "warn" },
    { time: "09:44:05", source: "APM", text: "Card ledger write latency high", level: "crit" },
  ],
  recoveredAlert: "$PAYAUTH restarted; I/O retries cleared, $DATA02 still mirror-only",
  restartOutput: ["$PAYAUTH: STOP requested", "$PAYAUTH: backup takeover complete", "$PAYAUTH: reopened files, stuck I/O retries cleared"],
  disks: [
    healthyDisks[0]!, healthyDisks[1]!,
    { vol: "$DATA02", state: "STARTED", path: "MIRROR ONLY  (PRIMARY DOWN, QLEN 14)" },
    healthyDisks[3]!,
  ],
  disksRecovered: [
    healthyDisks[0]!, healthyDisks[1]!,
    { vol: "$DATA02", state: "STARTED", path: "MIRROR ONLY  (QLEN 3)" },
    healthyDisks[3]!,
  ],
  tmf: { state: "STARTED", auditUsed: 58 },
};

export const txnBacklog: Scenario = {
  id: "txn-backlog",
  label: "Transaction backlog",
  opener: "Transactions are piling up in TMF and the audit trail is filling fast. Here is what I would check first.",
  node: "\\BANKPRD1",
  incident: { id: "INC-20431", title: "Transaction backlog — TMF audit trail near full", severity: "SEV1" },
  cpuFailure: null,
  degradedBusy: [72, 69, 75, 71, 74, 70, 73, 76],
  recoveredBusy: [48, 45, 50, 47, 49, 46, 48, 51],
  responseMs: { start: 120, peak: 1400, recovered: 240 },
  rampTicks: 8,
  tps: { degraded: 860, recovered: 1790 },
  alerts: [
    { time: "11:15:20", source: "TMF", text: "Audit trail 91% full — overflow threshold near", level: "crit" },
    { time: "11:15:48", source: "Measure", text: "Active transactions 4,812 (normal ~600)", level: "warn" },
    { time: "11:17:02", source: "APM", text: "Payment authorization latency high", level: "crit" },
  ],
  recoveredAlert: "$PAYAUTH restarted; long-running transactions aborted, backlog draining",
  restartOutput: ["$PAYAUTH: STOP requested", "$PAYAUTH: 312 long-running transactions backed out", "$PAYAUTH: restarted, backlog draining"],
  disks: healthyDisks,
  tmf: { state: "STARTED", auditUsed: 91, extra: ["Active transactions: 4812", "Oldest transaction age: 00:07:41 ($PAYAUTH)"] },
  tmfRecovered: { state: "STARTED", auditUsed: 74, extra: ["Active transactions: 640", "Oldest transaction age: 00:00:03"] },
};

export const SCENARIOS: Record<string, Scenario> = {
  [paymentSlowdown.id]: paymentSlowdown,
  [diskDegradation.id]: diskDegradation,
  [txnBacklog.id]: txnBacklog,
};
