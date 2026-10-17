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
  queue: { degraded: number; recovered: number }; // pending transactions
  unprotected: { degraded: number; recovered: number }; // processes without backup
  redundancy: { degraded: "FULL" | "REDUCED"; recovered: "FULL" | "REDUCED" };
  fix: "restore_cpu" | "switch_path" | "abort_transaction"; // command that remediates this scenario
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
  queue: { degraded: 1840, recovered: 120 },
  unprotected: { degraded: 3, recovered: 0 },
  redundancy: { degraded: "REDUCED", recovered: "FULL" },
  fix: "restore_cpu",
  alerts: [
    { time: "14:02:00", source: "EMS", text: "CPU 3 down — process pairs taking over", level: "crit" },
    { time: "14:02:04", source: "Measure", text: "Load shifted to CPUs 4-7", level: "warn" },
    { time: "14:05:30", source: "APM", text: "Payment authorization latency high", level: "crit" },
  ],
  recoveredAlert: "Latency recovering after $PAYAUTH restart",
  restartOutput: ["$PAYAUTH: STOP requested", "$PAYAUTH: backup takeover complete", "$PAYAUTH: restarted on CPU 5, work rebalanced"],
  disks: [...healthyDisks.slice(0, 2), { vol: "$DATA02", state: "STARTED", path: "MIRROR ONLY" }, healthyDisks[3]!],
  tmf: { state: "STARTED", auditUsed: 64 },
  // CPU failure: moderate lock waits (queued behind fewer CPUs), normal disk I/O.
  stats: {
    start: "2026-10-17 14:05:12", end: "2026-10-17 14:05:42", elapsed: "00:00:30",
    rows: [
      { table: "PAYAUTH_TXN", recordsAccessed: 48210, recordsUsed: 47980, diskIOs: 3120, messageCount: 96420, messageBytes: 48102400, lockEscl: 12, lockWait: 1840, diskProcBusy: 4210 },
      { table: "CARD_LEDGER", recordsAccessed: 22400, recordsUsed: 22110, diskIOs: 1980, messageCount: 44800, messageBytes: 22400000, lockEscl: 4, lockWait: 960, diskProcBusy: 2870 },
      { table: "AUTH_CODES", recordsAccessed: 8150, recordsUsed: 8150, diskIOs: 240, messageCount: 16300, messageBytes: 1630000, lockEscl: 0, lockWait: 45, diskProcBusy: 310 },
    ],
  },
  statsRecovered: {
    start: "2026-10-17 14:12:01", end: "2026-10-17 14:12:31", elapsed: "00:00:30",
    rows: [
      { table: "PAYAUTH_TXN", recordsAccessed: 61900, recordsUsed: 61720, diskIOs: 2980, messageCount: 123800, messageBytes: 61900000, lockEscl: 2, lockWait: 210, diskProcBusy: 2640 },
      { table: "CARD_LEDGER", recordsAccessed: 28700, recordsUsed: 28540, diskIOs: 1740, messageCount: 57400, messageBytes: 28700000, lockEscl: 1, lockWait: 90, diskProcBusy: 1980 },
      { table: "AUTH_CODES", recordsAccessed: 10400, recordsUsed: 10400, diskIOs: 230, messageCount: 20800, messageBytes: 2080000, lockEscl: 0, lockWait: 12, diskProcBusy: 280 },
    ],
  },
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
  queue: { degraded: 960, recovered: 140 },
  unprotected: { degraded: 0, recovered: 0 },
  redundancy: { degraded: "REDUCED", recovered: "FULL" },
  fix: "switch_path",
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
  // Disk degradation: high Disk I/Os and Disk Process Busy Time, low Lock Wait.
  stats: {
    start: "2026-10-17 09:44:20", end: "2026-10-17 09:44:50", elapsed: "00:00:30",
    rows: [
      { table: "CARD_LEDGER", recordsAccessed: 24100, recordsUsed: 23890, diskIOs: 41200, messageCount: 48200, messageBytes: 24100000, lockEscl: 3, lockWait: 110, diskProcBusy: 38400 },
      { table: "PAYAUTH_TXN", recordsAccessed: 39800, recordsUsed: 39610, diskIOs: 18600, messageCount: 79600, messageBytes: 39800000, lockEscl: 5, lockWait: 240, diskProcBusy: 12900 },
      { table: "AUTH_CODES", recordsAccessed: 7900, recordsUsed: 7900, diskIOs: 310, messageCount: 15800, messageBytes: 1580000, lockEscl: 0, lockWait: 18, diskProcBusy: 340 },
    ],
  },
  statsRecovered: {
    start: "2026-10-17 09:51:10", end: "2026-10-17 09:51:40", elapsed: "00:00:30",
    rows: [
      { table: "CARD_LEDGER", recordsAccessed: 27900, recordsUsed: 27720, diskIOs: 9800, messageCount: 55800, messageBytes: 27900000, lockEscl: 1, lockWait: 70, diskProcBusy: 8600 },
      { table: "PAYAUTH_TXN", recordsAccessed: 58300, recordsUsed: 58140, diskIOs: 6400, messageCount: 116600, messageBytes: 58300000, lockEscl: 2, lockWait: 130, diskProcBusy: 5100 },
      { table: "AUTH_CODES", recordsAccessed: 9800, recordsUsed: 9800, diskIOs: 240, messageCount: 19600, messageBytes: 1960000, lockEscl: 0, lockWait: 10, diskProcBusy: 290 },
    ],
  },
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
  queue: { degraded: 4812, recovered: 640 },
  unprotected: { degraded: 0, recovered: 0 },
  redundancy: { degraded: "FULL", recovered: "FULL" },
  fix: "abort_transaction",
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
  // Transaction backlog: high Lock Wait and Lock Escl, normal Disk I/Os.
  stats: {
    start: "2026-10-17 11:17:30", end: "2026-10-17 11:18:00", elapsed: "00:00:30",
    rows: [
      { table: "PAYAUTH_TXN", recordsAccessed: 52100, recordsUsed: 51230, diskIOs: 3340, messageCount: 104200, messageBytes: 52100000, lockEscl: 148, lockWait: 26800, diskProcBusy: 4460 },
      { table: "CARD_LEDGER", recordsAccessed: 19800, recordsUsed: 19420, diskIOs: 2110, messageCount: 39600, messageBytes: 19800000, lockEscl: 96, lockWait: 17400, diskProcBusy: 2910 },
      { table: "AUTH_CODES", recordsAccessed: 8400, recordsUsed: 8400, diskIOs: 260, messageCount: 16800, messageBytes: 1680000, lockEscl: 7, lockWait: 380, diskProcBusy: 330 },
    ],
  },
  statsRecovered: {
    start: "2026-10-17 11:24:15", end: "2026-10-17 11:24:45", elapsed: "00:00:30",
    rows: [
      { table: "PAYAUTH_TXN", recordsAccessed: 60400, recordsUsed: 60180, diskIOs: 3100, messageCount: 120800, messageBytes: 60400000, lockEscl: 6, lockWait: 420, diskProcBusy: 2980 },
      { table: "CARD_LEDGER", recordsAccessed: 27300, recordsUsed: 27110, diskIOs: 1890, messageCount: 54600, messageBytes: 27300000, lockEscl: 3, lockWait: 160, diskProcBusy: 2100 },
      { table: "AUTH_CODES", recordsAccessed: 10100, recordsUsed: 10100, diskIOs: 240, messageCount: 20200, messageBytes: 2020000, lockEscl: 0, lockWait: 14, diskProcBusy: 280 },
    ],
  },
};

export const SCENARIOS: Record<string, Scenario> = {
  [paymentSlowdown.id]: paymentSlowdown,
  [diskDegradation.id]: diskDegradation,
  [txnBacklog.id]: txnBacklog,
};
